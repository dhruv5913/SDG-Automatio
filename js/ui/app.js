(function (root) {
  'use strict';
  var SDG = (root.SDG = root.SDG || {});

  var OPS_PER_FRAME = 200;
  var SAVE_KEY = 'sdg-game-save-v2';
  var SPEEDS = [1, 2, 4];
  var BASE_MS = 275; // 1x = one action every 275ms (2x=137, 4x=69)

  var STAGES = [SDG.Stage1, SDG.Stage2, SDG.Stage3, SDG.Stage4];
  var save = { unlocked: 1, results: {}, codes: {} };

  var stageIdx = 0;
  var stage = STAGES[0];
  var engine = new SDG.Engine(stage);
  var gen = null;
  var status = 'idle'; // idle | running | paused | finished
  var runError = null;
  var pureOps = 0;
  var lastReport = null;
  var codeAtStart = '';
  var speed = 1;
  var lastSeq = 0;
  var nextPumpAt = 0;
  var pendingFinal = false;

  var editor, renderer, hud;

  var el = {};
  function $(id) { return document.getElementById(id); }

  // ---------- persistence & notifications ----------

  function showToast(message, type, duration) {
    var toast = $('appToast');
    if (!toast) return;
    toast.textContent = message;
    toast.className = 'toast toast-' + (type || 'info') + ' show';
    clearTimeout(toast._timer);
    toast._timer = setTimeout(function () {
      toast.classList.remove('show');
    }, duration || 3200);
  }
  SDG.showToast = showToast;

  function loadSave() {
    try {
      var prev = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
      if (prev && typeof prev === 'object') {
        save.unlocked = prev.unlocked || 1;
        save.results = prev.results || {};
        save.codes = prev.codes || {};
        save.modes = prev.modes || {};
        if (typeof prev.lastStageIdx === 'number' && prev.lastStageIdx >= 0 && prev.lastStageIdx < STAGES.length) {
          save.lastStageIdx = prev.lastStageIdx;
        }
        if (prev.lastMode) save.lastMode = prev.lastMode;
      }
    } catch (e) { /* ignore */ }
  }

  function persist() {
    var curMode = getCurMode();
    save.lastStageIdx = stageIdx;
    save.lastMode = curMode;
    if (SDG.Storage) {
      SDG.Storage.save({
        lastStageIdx: stageIdx,
        lastMode: curMode,
        unlocked: save.unlocked,
        results: save.results,
        codes: save.codes,
        modes: save.modes,
        settings: {
          view3d: renderer ? renderer.viewMode === '3d' : true,
          sound: SDG.Audio ? !SDG.Audio.isMuted() : true
        }
      });
    } else {
      try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* ignore */ }
    }
  }

  function handleSaveGame() {
    saveCurrentCode();
    persist();
    if (SDG.Storage) {
      var fname = SDG.Storage.exportSaveFile({
        lastStageIdx: stageIdx,
        lastMode: getCurMode(),
        unlocked: save.unlocked,
        results: save.results,
        codes: save.codes,
        modes: save.modes,
        settings: {
          view3d: renderer ? renderer.viewMode === '3d' : true,
          sound: SDG.Audio ? !SDG.Audio.isMuted() : true
        }
      });
      showToast('💾 Save downloaded: ' + fname, 'ok');
      consoleWrite('💾 Exported save file: ' + fname, 'ok');
    }
  }

  function handleLoadGame() {
    var input = $('importSaveInput');
    if (input) input.click();
  }

  function onSaveFileSelected(e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    e.target.value = '';

    if (SDG.Storage && SDG.Storage.hasProgress(save)) {
      if (!confirm('Existing game progress detected. Do you want to overwrite your current progress with this save file?')) {
        return;
      }
    }

    SDG.Storage.parseSaveFile(file, function (err, imported) {
      if (err) {
        showToast('✕ ' + err.message, 'err');
        consoleWrite('✕ Failed to load save file: ' + err.message, 'err');
        return;
      }

      save.unlocked = imported.unlocked || 1;
      save.results = imported.results || {};
      save.codes = imported.codes || {};
      save.modes = imported.modes || {};
      var targetStage = (typeof imported.lastStageIdx === 'number' && imported.lastStageIdx < STAGES.length) ? imported.lastStageIdx : 0;
      var targetMode = imported.lastMode || 'easy';

      stageIdx = targetStage;
      stage = STAGES[stageIdx];
      engine = new SDG.Engine(stage);

      persist();
      buildTabs();
      updateTabs();
      setMode(targetMode);
      var code = getCodeForStage(stage, targetMode);
      editor.setValue(code);
      savedCode = code;
      updateDirtyState();
      resetRun(true);

      showToast('✓ Game successfully restored from save file!', 'ok');
      consoleWrite('✓ Imported save from ' + file.name + ' (Stage ' + (stageIdx + 1) + ', ' + targetMode.toUpperCase() + ')', 'ok');
    });
  }

  function handleNewGame() {
    if (SDG.Storage && SDG.Storage.hasProgress(save)) {
      if (!confirm('Start a New Game? This will reset your unlocked stages, grades, and custom codes. (Tip: click Save first to create a backup file).')) {
        return;
      }
    }

    if (SDG.Storage) {
      SDG.Storage.clearAll(function () {
        save = { unlocked: 1, results: {}, codes: {}, modes: {}, lastStageIdx: 0, lastMode: 'easy' };
        stageIdx = 0;
        stage = STAGES[0];
        engine = new SDG.Engine(stage);
        buildTabs();
        updateTabs();
        setMode('easy');
        var code = getCodeForStage(stage, 'easy');
        editor.setValue(code);
        savedCode = code;
        updateDirtyState();
        resetRun(true);
        showToast('✨ Started fresh new game at Stage 1', 'ok');
        consoleWrite('✨ Reset to fresh new game (Stage 1)', 'warn');
      });
    }
  }

  function getCurMode() {
    return (save.modes && save.modes[stage.id]) || 'easy';
  }

  function getCodeForStage(stg, mode) {
    var key = stg.id + '_' + mode;
    if (save.codes[key]) return save.codes[key];
    if (mode === 'medium' && save.codes[stg.id]) return save.codes[stg.id];
    if (stg.templates && stg.templates[mode]) return stg.templates[mode];
    return stg.template;
  }

  var savedCode = '';

  function isCodeDirty() {
    return editor && editor.getValue() !== savedCode;
  }

  function updateDirtyState() {
    var dirty = isCodeDirty();
    var badge = $('codeDirtyBadge');
    if (badge) badge.classList.toggle('hidden', !dirty);
    var btnRevert = $('btnRevertCode');
    if (btnRevert) btnRevert.disabled = !dirty;
    var btnSave = $('btnSaveCode');
    if (btnSave) {
      btnSave.classList.toggle('accent', dirty);
      btnSave.textContent = dirty ? '💾 Save*' : '💾 Save';
    }
  }

  function saveCurrentCode() {
    var mode = getCurMode();
    var curVal = editor.getValue();
    save.codes[stage.id + '_' + mode] = curVal;
    save.codes[stage.id] = curVal;
    savedCode = curVal;
    persist();
    updateDirtyState();
  }

  function updateModeUI(mode) {
    ['modeEasy', 'modeMedium', 'modeHard'].forEach(function (id) {
      var btn = $(id);
      if (btn) {
        btn.classList.toggle('active', btn.getAttribute('data-mode') === mode);
      }
    });
    var badge = $('modeBadge');
    if (badge) {
      badge.textContent = mode.charAt(0).toUpperCase() + mode.slice(1);
    }
  }

  function setMode(newMode) {
    var curMode = getCurMode();
    if (newMode === curMode) return;
    if (status === 'running') forceStop();
    if (isCodeDirty()) {
      if (confirm('Save your changes to ' + curMode.toUpperCase() + ' mode before switching? (OK = Save, Cancel = Discard)')) {
        saveCurrentCode();
      }
    }
    save.modes = save.modes || {};
    save.modes[stage.id] = newMode;
    persist();
    updateModeUI(newMode);
    var code = getCodeForStage(stage, newMode);
    editor.setValue(code);
    savedCode = code;
    updateDirtyState();
    resetRun(false);

    if (newMode === 'hard') {
      var drawer = $('suggestionsDrawer');
      if (drawer) drawer.classList.remove('hidden');
    }
    consoleWrite('Switched to ' + newMode.toUpperCase() + ' mode', 'warn');
  }

  function renderSnippetBar() {
    var bar = $('snippetBar');
    if (!bar) return;
    bar.innerHTML = '';

    var chips = [
      { label: '+ while True:', code: 'while True:\n    ', cls: 'flow' },
      { label: '+ if ...:', code: 'if condition:\n    ', cls: 'flow' }
    ];

    if (stage.suggestions && stage.suggestions.actions) {
      stage.suggestions.actions.forEach(function (act) {
        chips.push({ label: '+ ' + act.name, code: act.name, cls: 'act' });
      });
    }
    if (stage.suggestions && stage.suggestions.probes) {
      stage.suggestions.probes.slice(0, 5).forEach(function (pr) {
        chips.push({ label: '+ ' + pr.name, code: pr.name, cls: 'prob' });
      });
    }

    chips.forEach(function (c) {
      var btn = document.createElement('button');
      btn.className = 'snippet-chip ' + (c.cls || '');
      btn.textContent = c.label;
      btn.title = 'Insert ' + c.code;
      btn.addEventListener('click', function () {
        editor.insertSnippet(c.code);
      });
      bar.appendChild(btn);
    });
  }

  function renderSuggestions() {
    var body = $('drawerBody');
    if (!body) return;
    var s = stage.suggestions;
    if (!s) {
      body.innerHTML = '<p class="hint">No suggestions available for this stage.</p>';
      return;
    }
    var html = '';

    if (s.strategy && s.strategy.length) {
      html += '<h4>Strategy Guide</h4><ul class="strategy-list">';
      s.strategy.forEach(function (st) {
        html += '<li>' + st + '</li>';
      });
      html += '</ul>';
    }

    if (s.actions && s.actions.length) {
      html += '<h4>Recommended Actions</h4>';
      s.actions.forEach(function (act) {
        html += '<div class="drawer-card">';
        html += '<div class="drawer-card-title"><span>' + act.name + '</span>' +
          '<button class="drawer-insert-btn" data-code="' + act.name.replace(/"/g, '&quot;') + '">+ Insert</button></div>';
        html += '<div class="drawer-card-desc">' + act.text + '</div>';
        html += '</div>';
      });
    }

    if (s.probes && s.probes.length) {
      html += '<h4>Recommended Probes</h4>';
      s.probes.forEach(function (pr) {
        html += '<div class="drawer-card">';
        html += '<div class="drawer-card-title probe"><span>' + pr.name + '</span>' +
          '<button class="drawer-insert-btn" data-code="' + pr.name.replace(/"/g, '&quot;') + '">+ Insert</button></div>';
        html += '<div class="drawer-card-desc">' + pr.text + '</div>';
        html += '</div>';
      });
    }

    body.innerHTML = html;

    body.querySelectorAll('.drawer-insert-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var code = btn.getAttribute('data-code');
        if (code) editor.insertSnippet(code);
      });
    });
  }

  // ---------- stage tabs ----------

  function buildTabs() {
    var nav = $('stageTabs');
    nav.innerHTML = '';
    STAGES.forEach(function (s, i) {
      var btn = document.createElement('button');
      btn.className = 'tab';
      btn.dataset.i = i;
      btn.addEventListener('click', function () { selectStage(i); });
      nav.appendChild(btn);
    });
    updateTabs();
  }

  function updateTabs() {
    var nav = $('stageTabs');
    Array.prototype.forEach.call(nav.children, function (btn, i) {
      var s = STAGES[i];
      var r = save.results[s.id];
      var locked = i >= save.unlocked;
      btn.className = 'tab' + (i === stageIdx ? ' active' : '') + (locked ? ' locked' : '') + (r && r.passed ? ' done' : '');
      var short = s.title.replace(/^Stage \d+ — /, '');
      btn.innerHTML = '<span class="tab-num">' + (i + 1) + '</span>' + short +
        (r ? '<span class="tab-grade ' + (r.passed ? 'ok' : 'bad') + '">' + r.grade + '</span>' : '') +
        (locked ? '<span class="tab-lock" title="Clear the previous stage first">locked</span>' : '');
      btn.disabled = locked;
      btn.title = locked ? 'Clear stage ' + i + ' to unlock' : s.subtitle;
    });
    var allDone = STAGES.every(function (s) { return save.results[s.id]; });
    $('btnFinal').classList.toggle('hidden', !allDone);
  }

  // ---------- stage switching ----------

  function selectStage(i) {
    if (i >= save.unlocked || i === stageIdx) return;
    if (status === 'running') forceStop();
    if (isCodeDirty()) {
      if (confirm('Save your changes to ' + stage.title + ' before switching? (OK = Save, Cancel = Discard)')) {
        saveCurrentCode();
      }
    }

    stageIdx = i;
    stage = STAGES[i];
    engine = new SDG.Engine(stage);
    gen = null;
    runError = null;
    pureOps = 0;
    lastReport = null;
    lastSeq = 0;
    nextPumpAt = 0;

    hud.setStage(stage);
    renderer.reset(stage);
    var mode = getCurMode();
    updateModeUI(mode);
    var code = getCodeForStage(stage, mode);
    editor.setValue(code);
    savedCode = code;
    updateDirtyState();
    renderHelpApi();
    renderSnippetBar();
    renderSuggestions();

    $('stageTitle').textContent = stage.title;
    $('stageSubtitle').textContent = stage.subtitle;
    $('badgeCleared').classList.toggle('hidden', !(save.results[stage.id] && save.results[stage.id].passed));
    $('btnReport').disabled = true;
    consoleClear();
    consoleWrite('→ ' + stage.title + ' (' + mode.toUpperCase() + ' mode) — press Run to start', 'out');
    setStatus('idle');
    updateTabs();
    persist();
  }

  function renderHelpApi() {
    $('helpApi').innerHTML = stage.desc.map(function (d) {
      return '<div class="cmd"><code>' + d.name.replace(/</g, '&lt;') + '</code><span>' + d.text + '</span></div>';
    }).join('');
  }

  // ---------- run control ----------

  function setStatus(s, detail) {
    status = s;
    var label = { idle: 'Ready', running: 'Running…', paused: 'Paused', finished: 'Finished' }[s];
    el.state.textContent = label + (detail ? ' — ' + detail : '');
    el.state.className = 'state state-' + s;
    el.btnRun.textContent = '▶ Run';
    el.btnRun.disabled = s === 'running';
    el.btnPause.disabled = s !== 'running';
    el.btnStep.disabled = s === 'running';
    el.btnStop.disabled = s !== 'running' && s !== 'paused';
  }

  function consoleWrite(text, cls) {
    var line = document.createElement('div');
    line.className = 'console-line ' + (cls || '');
    line.textContent = text;
    el.consoleOut.appendChild(line);
    el.consoleOut.scrollTop = el.consoleOut.scrollHeight;
    while (el.consoleOut.children.length > 200) el.consoleOut.removeChild(el.consoleOut.firstChild);
  }

  function consoleClear() { el.consoleOut.innerHTML = ''; }

  // Parse + (re)arm the run. Returns false when the code does not even parse.
  function setupRun() {
    var code = editor.getValue();
    saveCurrentCode();
    var ast;
    try {
      ast = SDG.parse(code);
    } catch (e) {
      consoleWrite(e.message, 'err');
      if (e.line) editor.setErrorLine(e.line);
      setStatus('idle', 'syntax error');
      if (SDG.Audio) SDG.Audio.play('error');
      return false;
    }

    engine.reset();
    renderer.reset(stage);
    if (SDG.Telemetry) {
      SDG.Telemetry.reset();
      SDG.Telemetry.record(stage, engine.world);
    }
    runError = null;
    pureOps = 0;
    codeAtStart = code;
    lastSeq = engine.actionSeq;
    nextPumpAt = 0;
    editor.setErrorLine(null);
    consoleClear();
    consoleWrite('▶ run started — ' + stage.title);
    if (SDG.Audio) SDG.Audio.play('click');

    var ctx = {
      env: new SDG.Env(null),
      ops: { n: 0 },
      hasHost: function (n) { return engine.hasHost(n); },
      host: function (n, args, kwargs, node) { return engine.callHost(n, args, kwargs, node); },
      print: function (msg) { consoleWrite('print: ' + msg, 'out'); }
    };

    gen = SDG.run(ast, ctx);
    el.btnReport.disabled = true;
    return true;
  }

  function startRun() {
    if (status === 'running') return;
    // resume a paused run untouched; if the code changed, restart from scratch
    if (status === 'paused' && gen && editor.getValue() === codeAtStart) {
      setStatus('running');
      return;
    }
    if (status === 'finished' || runError || gen) resetRun(true);
    if (!setupRun()) return;
    setStatus('running');
    if (SDG.Multiplayer && SDG.Multiplayer.inGame) {
      SDG.Multiplayer.sendTelemetry('running', 0, 0, '–', Math.round(engine.world.emissions || 0), 'start');
    }
  }

  function pauseRun() {
    if (status !== 'running') return;
    setStatus('paused');
  }

  // Advance exactly one unit of simulation time (one action, or one 40-op
  // tick for action-free code) while staying paused.
  function stepRun() {
    if (status === 'running') return;
    if (!gen) {
      if (status === 'finished' || runError) resetRun(true);
      if (!setupRun()) return;
    }
    var acted = false;
    for (var k = 0; k < OPS_PER_FRAME && !acted; k++) {
      var step;
      try {
        step = gen.next();
      } catch (e) {
        finishRun('error', e);
        return;
      }
      if (step.done) {
        finishRun('done', null);
        return;
      }
      if (engine.actionThisStep) {
        engine.actionThisStep = false;
        pureOps = 0;
        acted = true;
        var ev = engine.world.events && engine.world.events[engine.world.events.length - 1];
        if (ev) {
          if (SDG.Audio) SDG.Audio.playForAction(ev.name);
          var actEl = $('lastAction');
          if (actEl) actEl.textContent = ev.name;
        }
        if (SDG.Telemetry) SDG.Telemetry.record(stage, engine.world);
        break;
      }
      pureOps++;
      if (pureOps >= 40) {
        pureOps = 0;
        if (!engine.advanceTick()) {
          finishRun('done', null);
          return;
        }
        if (SDG.Telemetry) SDG.Telemetry.record(stage, engine.world);
        acted = true;
      }
    }
    if (engine.world.tick >= stage.TICK_LIMIT) {
      finishRun('done', null);
      return;
    }
    setStatus('paused', 'stepped — tick ' + engine.world.tick + '/' + stage.TICK_LIMIT);
  }

  // Terminate the program now; the world fast-forwards without you and the
  // run is graded as usual.
  function stopRun() {
    if (!gen || status === 'finished') return;
    consoleWrite('■ stopped by user at tick ' + engine.world.tick, 'warn');
    finishRun('done', null);
  }

  function forceStop() {
    gen = null;
    setStatus('idle');
  }

  function resetRun(silent) {
    engine.reset();
    gen = null;
    runError = null;
    pureOps = 0;
    lastSeq = engine.actionSeq;
    nextPumpAt = 0;
    renderer.reset(stage);
    if (SDG.Telemetry) {
      SDG.Telemetry.reset();
      SDG.Telemetry.record(stage, engine.world);
    }
    var actEl = $('lastAction');
    if (actEl) actEl.textContent = '–';
    lastReport = null;
    el.btnReport.disabled = true;
    setStatus('idle');
    if (!silent) consoleClear();
  }

  function finishRun(statusKind, err) {
    if (err) {
      runError = err;
      consoleWrite(err.message, 'err');
      if (err.line) editor.setErrorLine(err.line);
    }
    engine.fastForward();
    gen = null;
    var runStatus = err ? 'error' : 'done';
    lastReport = SDG.StageReport.build(stage, engine.world, engine, runStatus, err);
    setStatus('finished', err ? 'error' : 'tick ' + engine.world.tick + '/' + stage.TICK_LIMIT);
    if (!err) {
      consoleWrite('✔ run finished — score ' + lastReport.score + '/100 (' + lastReport.grade.letter + ')', lastReport.passed ? 'ok' : 'warn');
      if (SDG.Audio) {
        if (lastReport.passed && (lastReport.grade.letter === 'A+' || lastReport.grade.letter === 'A')) {
          SDG.Audio.play('fanfare');
        } else if (lastReport.passed) {
          SDG.Audio.play('build');
        } else {
          SDG.Audio.play('warning');
        }
      }
    } else {
      consoleWrite('✖ program crashed at tick ' + engine.world.tick + ' — score ' + lastReport.score + '/100', 'err');
      if (SDG.Audio) SDG.Audio.play('error');
    }
    if (SDG.Multiplayer && SDG.Multiplayer.inGame) {
      SDG.Multiplayer.sendFinished(lastReport);
      if (SDG.MultiplayerUI && SDG.MultiplayerUI.onLocalRunFinish) {
        SDG.MultiplayerUI.onLocalRunFinish(lastReport);
      }
    }
    recordResult();
    openReport();
  }

  function recordResult() {
    if (!lastReport) return;
    var failed = lastReport.goals.filter(function (g) { return !g.pass; })
      .map(function (g) { return g.label; });
    var prev = save.results[stage.id];
    if (!prev || lastReport.score > prev.score) {
      save.results[stage.id] = {
        score: lastReport.score,
        grade: lastReport.grade.letter,
        passed: lastReport.passed,
        title: stage.title,
        tickLimit: stage.TICK_LIMIT,
        failed: failed
      };
    }
    if (lastReport.passed && stageIdx + 1 < STAGES.length && save.unlocked < stageIdx + 2) {
      save.unlocked = stageIdx + 2;
      consoleWrite('Stage ' + (stageIdx + 2) + ' unlocked!', 'ok');
    }
    if (stageIdx === STAGES.length - 1 && lastReport.passed) pendingFinal = true;
    persist();
    updateTabs();
    $('badgeCleared').classList.toggle('hidden', !save.results[stage.id].passed);
  }

  function pump() {
    if (!gen) return;
    for (var k = 0; k < OPS_PER_FRAME * speed; k++) {
      var step;
      try {
        step = gen.next();
      } catch (e) {
        finishRun('error', e);
        return;
      }
      if (step.done) {
        finishRun('done', null);
        return;
      }
      if (engine.actionThisStep) {
        engine.actionThisStep = false;
        pureOps = 0;
        var ev = engine.world.events && engine.world.events[engine.world.events.length - 1];
        if (ev) {
          if (SDG.Audio) SDG.Audio.playForAction(ev.name);
          var actEl = $('lastAction');
          if (actEl) actEl.textContent = ev.name;
        }
        if (SDG.Telemetry) SDG.Telemetry.record(stage, engine.world);
        if (SDG.Multiplayer && SDG.Multiplayer.inGame) {
          try {
            var mRows = SDG.Goals.evaluate(stage, engine.world);
            var mSc = SDG.Goals.score(mRows);
            var mGr = mSc >= 85 ? 'A' : (mSc >= 70 ? 'B' : (mSc >= 60 ? 'C' : (mSc >= 40 ? 'D' : 'F')));
            SDG.Multiplayer.sendTelemetry('running', engine.world.tick, mSc, mGr, Math.round(engine.world.emissions || 0), ev ? ev.name : 'action');
            if (SDG.MultiplayerUI) SDG.MultiplayerUI.updateLocalTelemetry(mSc, mGr);
          } catch (e) { /* ignore */ }
        }
        break;
      }
      pureOps++;
      if (pureOps >= 40) {
        pureOps = 0;
        if (!engine.advanceTick()) {
          finishRun('done', null);
          return;
        }
        if (SDG.Telemetry) SDG.Telemetry.record(stage, engine.world);
        if (SDG.Multiplayer && SDG.Multiplayer.inGame) {
          try {
            var tRows = SDG.Goals.evaluate(stage, engine.world);
            var tSc = SDG.Goals.score(tRows);
            var tGr = tSc >= 85 ? 'A' : (tSc >= 70 ? 'B' : (tSc >= 60 ? 'C' : (tSc >= 40 ? 'D' : 'F')));
            SDG.Multiplayer.sendTelemetry('running', engine.world.tick, tSc, tGr, Math.round(engine.world.emissions || 0), 'tick');
            if (SDG.MultiplayerUI) SDG.MultiplayerUI.updateLocalTelemetry(tSc, tGr);
          } catch (e) { /* ignore */ }
        }
      }
    }
    if (engine.world.tick >= stage.TICK_LIMIT) finishRun('done', null);
  }

  // ---------- reports ----------

  function openReport() {
    if (!lastReport) return;
    el.reportBody.innerHTML = SDG.StageReport.render(lastReport);
    el.reportModal.classList.remove('hidden');
    el.btnReport.disabled = false;
    if (SDG.Telemetry) {
      var repCanvas = $('reportTelemetryCanvas');
      if (repCanvas) {
        setTimeout(function () {
          SDG.Telemetry.render(repCanvas, stage);
        }, 50);
      }
    }
  }
  function closeReport() {
    el.reportModal.classList.add('hidden');
    if (pendingFinal) { pendingFinal = false; openFinal(); }
  }

  function openFinal() {
    var results = STAGES.map(function (s) { return save.results[s.id]; }).filter(Boolean);
    if (results.length < STAGES.length) return;
    var rep = SDG.FinalReport.build(results);
    el.finalBody.innerHTML = SDG.FinalReport.render(rep);
    el.finalRep = rep;
    el.finalModal.classList.remove('hidden');
  }
  function closeFinal() { el.finalModal.classList.add('hidden'); }

  function downloadFinal() {
    if (!el.finalRep) return;
    var blob = new Blob([SDG.FinalReport.toText(el.finalRep)], { type: 'text/plain' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'sdg-final-report.txt';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  // ---------- main loop ----------

  function frame() {
    frame.count = (frame.count || 0) + 1;
    var now = performance.now();
    if (status === 'running') {
      if (lastSeq !== engine.actionSeq) {
        lastSeq = engine.actionSeq;
        nextPumpAt = now + BASE_MS / speed;
      } else if (now >= nextPumpAt) {
        pump();
        if (lastSeq !== engine.actionSeq) {
          lastSeq = engine.actionSeq;
          nextPumpAt = performance.now() + BASE_MS / speed;
        }
      }
    }
    var last = frame.last || now;
    frame.last = now;
    renderer.draw(engine.world, stage, Math.min(0.1, (now - last) / 1000));
    hud.update(engine.world);
    if (SDG.Telemetry && (frame.count % 8 === 0)) {
      var telemDrawer = $('telemetryDrawer');
      if (telemDrawer && !telemDrawer.classList.contains('hidden')) {
        var liveCanvas = $('liveTelemetryCanvas');
        if (liveCanvas) SDG.Telemetry.render(liveCanvas, stage);
      }
    }
    var tickText = engine.world.tick + ' / ' + stage.TICK_LIMIT;
    if (el.tick.__v !== tickText) { el.tick.__v = tickText; el.tick.textContent = tickText; }
    if (el.goalTick) {
      var gt = 'tick ' + engine.world.tick + '/' + stage.TICK_LIMIT;
      if (el.goalTick.__v !== gt) { el.goalTick.__v = gt; el.goalTick.textContent = gt; }
    }
    requestAnimationFrame(frame);
  }

  // ---------- init ----------

  function init() {
    el.btnRun = $('btnRun');
    el.btnPause = $('btnPause');
    el.btnStep = $('btnStep');
    el.btnStop = $('btnStop');
    el.btnReset = $('btnReset');
    el.btnReport = $('btnReport');
    el.btnFinal = $('btnFinal');
    el.btnHelp = $('btnHelp');
    el.btnSpeed = $('btnSpeed');
    el.consoleOut = $('consoleOut');
    el.reportModal = $('reportModal');
    el.reportBody = $('reportBody');
    el.finalModal = $('finalModal');
    el.finalBody = $('finalBody');
    el.state = $('runState');
    el.tick = $('statTick');
    el.goalTick = $('goalTick');

    loadSave();

    // Check if player has saved stage progress and restore it directly
    if (typeof save.lastStageIdx === 'number' && save.lastStageIdx >= 0 && save.lastStageIdx < STAGES.length && save.lastStageIdx < save.unlocked) {
      stageIdx = save.lastStageIdx;
      stage = STAGES[stageIdx];
    }
    engine = new SDG.Engine(stage);

    editor = new SDG.Editor('code', 'lineNumbers', startRun, function () {
      saveCurrentCode();
      consoleWrite('saved — ' + stage.title + ' (' + getCurMode().toUpperCase() + ') code stored', 'ok');
    }, function (pos) {
      var posEl = $('editorPos');
      if (posEl) posEl.textContent = 'Ln ' + pos.line + ', Col ' + pos.col;
    });
    renderer = new SDG.Renderer($('world'), $('world3d'));
    hud = new SDG.HUD(stage);

    buildTabs();
    renderHelpApi();

    var curMode = (save.lastMode) || getCurMode();
    if (save.modes) save.modes[stage.id] = curMode;
    updateModeUI(curMode);

    var initialCode = getCodeForStage(stage, curMode);
    editor.setValue(initialCode);
    savedCode = initialCode;
    updateDirtyState();
    editor.ta.addEventListener('input', updateDirtyState);
    renderSnippetBar();
    renderSuggestions();

    $('stageTitle').textContent = stage.title;
    $('stageSubtitle').textContent = stage.subtitle;
    $('badgeCleared').classList.toggle('hidden', !(save.results[stage.id] && save.results[stage.id].passed));

    // Asynchronous IndexedDB check to restore complete persistent data
    if (SDG.Storage) {
      SDG.Storage.load(function (err, loaded) {
        if (loaded && SDG.Storage.hasProgress(loaded)) {
          var updated = false;
          if (loaded.unlocked && loaded.unlocked > save.unlocked) {
            save.unlocked = loaded.unlocked;
            updated = true;
          }
          if (loaded.results) {
            Object.keys(loaded.results).forEach(function (k) { save.results[k] = loaded.results[k]; });
            updated = true;
          }
          if (loaded.codes) {
            Object.keys(loaded.codes).forEach(function (k) { save.codes[k] = loaded.codes[k]; });
            updated = true;
          }
          if (loaded.modes) {
            Object.keys(loaded.modes).forEach(function (k) { save.modes[k] = loaded.modes[k]; });
            updated = true;
          }
          if (typeof loaded.lastStageIdx === 'number' && loaded.lastStageIdx < STAGES.length && loaded.lastStageIdx < save.unlocked && loaded.lastStageIdx !== stageIdx) {
            stageIdx = loaded.lastStageIdx;
            stage = STAGES[stageIdx];
            engine = new SDG.Engine(stage);
            updated = true;
          }
          if (updated) {
            buildTabs();
            updateTabs();
            var m = getCurMode();
            updateModeUI(m);
            var code = getCodeForStage(stage, m);
            editor.setValue(code);
            savedCode = code;
            updateDirtyState();
            hud.setStage(stage);
            renderer.reset(stage);
            $('stageTitle').textContent = stage.title;
            $('stageSubtitle').textContent = stage.subtitle;
            $('badgeCleared').classList.toggle('hidden', !(save.results[stage.id] && save.results[stage.id].passed));
          }
        }
      });
    }

    // Mode buttons
    $('modeEasy').addEventListener('click', function () { setMode('easy'); });
    $('modeMedium').addEventListener('click', function () { setMode('medium'); });
    $('modeHard').addEventListener('click', function () { setMode('hard'); });

    // View mode 3D / 2D toggle
    var btnViewMode = $('btnViewMode');
    if (btnViewMode) {
      btnViewMode.textContent = renderer.viewMode === '3d' ? '📐 3D' : '⬛ 2D';
      btnViewMode.addEventListener('click', function () {
        var mode = renderer.toggleViewMode();
        btnViewMode.textContent = mode === '3d' ? '📐 3D' : '⬛ 2D';
        consoleWrite('View switched to ' + mode.toUpperCase() + (mode === '3d' ? ' (Isometric Voxel)' : ' (Top-Down)'), 'out');
      });
    }

    // Audio sound toggle
    var btnSound = $('btnSound');
    if (btnSound && SDG.Audio) {
      btnSound.textContent = SDG.Audio.isMuted() ? '🔇' : '🔊';
      btnSound.addEventListener('click', function () {
        var muted = SDG.Audio.toggleMute();
        btnSound.textContent = muted ? '🔇' : '🔊';
        consoleWrite('Audio ' + (muted ? 'muted' : 'enabled'), 'out');
      });
    }

    // Telemetry drawer
    var btnTelemetry = $('btnTelemetry');
    var telemetryDrawer = $('telemetryDrawer');
    if (btnTelemetry && telemetryDrawer) {
      btnTelemetry.addEventListener('click', function () {
        telemetryDrawer.classList.toggle('hidden');
        if (!telemetryDrawer.classList.contains('hidden') && SDG.Telemetry) {
          SDG.Telemetry.render($('liveTelemetryCanvas'), stage);
        }
      });
    }
    var telemetryClose = $('telemetryClose');
    if (telemetryClose && telemetryDrawer) {
      telemetryClose.addEventListener('click', function () {
        telemetryDrawer.classList.add('hidden');
      });
    }

    // Editor tools
    $('btnSuggestions').addEventListener('click', function () {
      var d = $('suggestionsDrawer');
      if (d) d.classList.toggle('hidden');
    });
    var dClose = $('drawerClose');
    if (dClose) {
      dClose.addEventListener('click', function () {
        $('suggestionsDrawer').classList.add('hidden');
      });
    }

    $('btnFormat').addEventListener('click', function () {
      editor.formatCode();
      consoleWrite('Formatted code & cleaned indentation', 'ok');
    });
    $('btnComment').addEventListener('click', function () {
      editor.toggleComment();
    });
    $('btnCopy').addEventListener('click', function () {
      var text = editor.getValue();
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () {
          var copyBtn = $('btnCopy');
          copyBtn.textContent = '✓';
          setTimeout(function () { copyBtn.textContent = '📋'; }, 1200);
          consoleWrite('Code copied to clipboard', 'ok');
        });
      } else {
        consoleWrite('Clipboard API not available', 'warn');
      }
    });
    $('btnUndo').addEventListener('click', function () { editor.undo(); });
    $('btnRedo').addEventListener('click', function () { editor.redo(); });

    el.btnRun.addEventListener('click', startRun);
    el.btnPause.addEventListener('click', pauseRun);
    el.btnStep.addEventListener('click', stepRun);
    el.btnStop.addEventListener('click', stopRun);
    el.btnReset.addEventListener('click', function () { resetRun(false); });
    el.btnReport.addEventListener('click', openReport);
    el.btnFinal.addEventListener('click', openFinal);
    $('reportClose').addEventListener('click', closeReport);
    $('reportCloseBtn').addEventListener('click', closeReport);
    $('reportModal').addEventListener('click', function (e) {
      if (e.target === el.reportModal) closeReport();
    });
    $('finalClose').addEventListener('click', closeFinal);
    $('finalDownload').addEventListener('click', downloadFinal);
    $('finalModal').addEventListener('click', function (e) {
      if (e.target === el.finalModal) closeFinal();
    });

    // Save, Revert, and Reset starter template controls
    var btnSaveCode = $('btnSaveCode');
    if (btnSaveCode) {
      btnSaveCode.addEventListener('click', function () {
        saveCurrentCode();
        if (SDG.Audio) SDG.Audio.play('click');
        consoleWrite('💾 Saved changes for ' + stage.title + ' (' + getCurMode().toUpperCase() + ')', 'ok');
      });
    }

    var btnRevertCode = $('btnRevertCode');
    if (btnRevertCode) {
      btnRevertCode.addEventListener('click', function () {
        if (!isCodeDirty()) return;
        if (confirm('Discard unsaved changes and revert back to last saved code?')) {
          editor.setValue(savedCode);
          updateDirtyState();
          resetRun(true);
          consoleWrite('↩ Reverted code back to last saved version', 'warn');
        }
      });
    }

    function resetToStarterTemplate() {
      var m = getCurMode();
      if (confirm('Reset code to the original ' + m.toUpperCase() + ' starter template? All changes will be replaced.')) {
        var templateCode = (stage.templates && stage.templates[m]) || stage.template;
        editor.setValue(templateCode);
        saveCurrentCode();
        savedCode = templateCode;
        updateDirtyState();
        resetRun(true);
        consoleWrite('⟲ Reset code back to original ' + m.toUpperCase() + ' starter template', 'warn');
      }
    }

    var btnResetCode = $('btnResetCode');
    if (btnResetCode) {
      btnResetCode.addEventListener('click', resetToStarterTemplate);
    }
    if ($('btnTemplate')) {
      $('btnTemplate').addEventListener('click', resetToStarterTemplate);
    }

    el.btnHelp.addEventListener('click', function () { $('helpModal').classList.remove('hidden'); });
    $('helpClose').addEventListener('click', function () { $('helpModal').classList.add('hidden'); });
    el.btnSpeed.addEventListener('click', function () {
      speed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
      el.btnSpeed.textContent = speed + '×';
      $('statSpeed').textContent = speed + '× speed';
    });

    // Save Game (Download JSON)
    var btnSaveGame = $('btnSaveGame');
    if (btnSaveGame) {
      btnSaveGame.addEventListener('click', handleSaveGame);
    }

    // Load Game (Import JSON)
    var btnLoadGame = $('btnLoadGame');
    if (btnLoadGame) {
      btnLoadGame.addEventListener('click', handleLoadGame);
    }
    var importInput = $('importSaveInput');
    if (importInput) {
      importInput.addEventListener('change', onSaveFileSelected);
    }

    // New Game (Reset with Confirmation)
    var btnNewGame = $('btnNewGame');
    if (btnNewGame) {
      btnNewGame.addEventListener('click', handleNewGame);
    }

    // Periodic Background Auto-Save (Every 25 seconds)
    setInterval(function () {
      if (status === 'running' || isCodeDirty()) {
        if (isCodeDirty()) saveCurrentCode();
        else persist();
      }
    }, 25000);

    setStatus('idle');
    requestAnimationFrame(frame);
  }

  // test/debug hook (used by dev/smoke.html)
  SDG.debug = {
    frame: frame,
    pump: pump,
    start: startRun,
    step: stepRun,
    stop: stopRun,
    reset: resetRun,
    state: function () { return status; },
    world: function () { return engine.world; },
    engine: function () { return engine; },
    editor: function () { return editor; },
    getStageIdx: function () { return stageIdx; },
    actionSeq: function () { return engine.actionSeq; },
    pace: function () {
      return { count: frame.count || 0, last: lastSeq, at: nextPumpAt, now: performance.now(), speed: speed, seq: engine.actionSeq, tick: engine.world.tick };
    },
    report: function () { return lastReport; },
    stage: function () { return stage; },
    stages: function () { return STAGES; },
    selectStage: function (i) {
      // bypass unlock for tests
      save.unlocked = Math.max(save.unlocked, i + 1);
      selectStage(i);
    },
    save: function () { return save; },
    setSpeed: function (s) {
      speed = s;
      el.btnSpeed.textContent = s + '×';
    }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(typeof window !== 'undefined' ? window : globalThis);
