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

  // ---------- persistence ----------

  function loadSave() {
    try {
      var prev = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
      if (prev && typeof prev === 'object') {
        save.unlocked = prev.unlocked || 1;
        save.results = prev.results || {};
        save.codes = prev.codes || {};
      }
    } catch (e) { /* ignore */ }
  }
  function persist() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* ignore */ }
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
    save.codes[stage.id] = editor.getValue();
    persist();

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
    editor.setValue(save.codes[stage.id] || stage.template);
    renderHelpApi();

    $('stageTitle').textContent = stage.title;
    $('stageSubtitle').textContent = stage.subtitle;
    $('badgeCleared').classList.toggle('hidden', !(save.results[stage.id] && save.results[stage.id].passed));
    $('btnReport').disabled = true;
    consoleClear();
    consoleWrite('→ ' + stage.title + ' — press Run to start', 'out');
    setStatus('idle');
    updateTabs();
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
    save.codes[stage.id] = code;
    persist();
    var ast;
    try {
      ast = SDG.parse(code);
    } catch (e) {
      consoleWrite(e.message, 'err');
      if (e.line) editor.setErrorLine(e.line);
      setStatus('idle', 'syntax error');
      return false;
    }

    engine.reset();
    renderer.reset(stage);
    runError = null;
    pureOps = 0;
    codeAtStart = code;
    lastSeq = engine.actionSeq;
    nextPumpAt = 0;
    editor.setErrorLine(null);
    consoleClear();
    consoleWrite('▶ run started — ' + stage.title);

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
        break;
      }
      pureOps++;
      if (pureOps >= 40) {
        pureOps = 0;
        if (!engine.advanceTick()) {
          finishRun('done', null);
          return;
        }
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
    if (!err) consoleWrite('✔ run finished — score ' + lastReport.score + '/100 (' + lastReport.grade.letter + ')', lastReport.passed ? 'ok' : 'warn');
    else consoleWrite('✖ program crashed at tick ' + engine.world.tick + ' — score ' + lastReport.score + '/100', 'err');
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
        break;
      }
      pureOps++;
      if (pureOps >= 40) {
        pureOps = 0;
        if (!engine.advanceTick()) {
          finishRun('done', null);
          return;
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

    editor = new SDG.Editor('code', 'lineNumbers', startRun, function () {
      save.codes[stage.id] = editor.getValue();
      persist();
      consoleWrite('saved — ' + stage.title + ' code stored', 'ok');
    });
    renderer = new SDG.Renderer($('world'));
    hud = new SDG.HUD(stage);

    buildTabs();
    renderHelpApi();
    editor.setValue(save.codes[stage.id] || stage.template);
    $('stageTitle').textContent = stage.title;
    $('stageSubtitle').textContent = stage.subtitle;
    $('badgeCleared').classList.toggle('hidden', !(save.results[stage.id] && save.results[stage.id].passed));

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
    $('btnTemplate').addEventListener('click', function () {
      editor.setValue(stage.template);
      resetRun(true);
    });
    el.btnHelp.addEventListener('click', function () { $('helpModal').classList.remove('hidden'); });
    $('helpClose').addEventListener('click', function () { $('helpModal').classList.add('hidden'); });
    el.btnSpeed.addEventListener('click', function () {
      speed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
      el.btnSpeed.textContent = speed + '×';
      $('statSpeed').textContent = speed + '× speed';
    });

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
