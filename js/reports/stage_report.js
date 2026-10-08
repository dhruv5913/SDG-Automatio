(function (root) {
  'use strict';
  var SDG = (root.SDG = root.SDG || {});
  var M = SDG.Metrics;

  function gradeOf(score, allPassed) {
    if (!allPassed) { // failing any goal caps the grade — you cleared it, but it is unstable
      if (score >= 60) return { letter: 'C', text: 'Cleared, but goals failed' };
      return { letter: 'F', text: 'Needs work' };
    }
    if (score >= 85) return { letter: 'A', text: 'Excellent' };
    if (score >= 70) return { letter: 'B', text: 'Good' };
    if (score >= 60) return { letter: 'C', text: 'Pass' };
    return { letter: 'F', text: 'Needs work' };
  }

  function build(stage, world, engine, runStatus, runError) {
    var stats = world.stats;
    var adv = stage.advice || {};

    var goalRows = SDG.Goals.evaluate(stage, world);
    var score = SDG.Goals.score(goalRows);
    var grade = gradeOf(score, goalRows.every(function (r) { return r.pass; }));
    var passed = score >= 60;

    var actionNames = Object.keys(stats.actions);
    var totalActions = actionNames.reduce(function (s, k) { return s + stats.actions[k]; }, 0);

    var worked = [], failed = [], improve = [];

    if (totalActions > 0) worked.push('Executed ' + totalActions + ' actions across ' + actionNames.length + ' different commands' +
      (actionNames.length ? ' (' + actionNames.join(', ') + ')' : '') + '.');
    goalRows.filter(function (r) { return r.pass; }).forEach(function (r) {
      worked.push(r.label + ' met its target (' + M.fmt(r.key, r.actual) + ' vs target ' + (r.cmp === '>=' ? '≥ ' : '≤ ') + r.target + ').');
    });

    if (runStatus === 'error' && runError) {
      failed.push('Your program stopped with an error: ' + runError.message);
      improve.push('Fix the error and re-run. Errors end the program early, so the world keeps decaying without you.');
    }
    if (stats.rejected.length > 0) {
      var first = stats.rejected[0];
      failed.push(stats.rejected.length + ' action(s) were rejected for insufficient resources. First: ' + first.message);
      improve.push(adv.rejected || 'Check money() and energy() before calling expensive actions.');
    }
    goalRows.filter(function (r) { return !r.pass; }).forEach(function (r) {
      failed.push(r.label + ' missed its target: actual ' + M.fmt(r.key, r.actual) + ', target ' + (r.cmp === '>=' ? '≥ ' : '≤ ') + r.target + '.');
      if (adv[r.key]) improve.push(adv[r.key]);
    });
    Object.keys(stats.criticals).forEach(function (k) {
      failed.push('CRITICAL: ' + k + ' hit 0 at tick ' + stats.criticals[k] + '.');
      if (adv.critical) improve.push(adv.critical);
    });
    if (totalActions === 0) {
      failed.push('No actions were executed — the world simply decayed for ' + world.tick + ' ticks.');
      if (adv.noActions) improve.push(adv.noActions);
    }
    if (runStatus === 'done' && world.tick < stage.TICK_LIMIT && totalActions > 0) {
      improve.push(adv.endedEarly || ('Your script ended at tick ' + world.tick + ' of ' + stage.TICK_LIMIT + '; keep a loop running for the whole stage.'));
    }
    if (passed && improve.length === 0) {
      improve.push('All targets met. Try squeezing more margin for a cleaner A grade.');
    }

    var tradeoffs = SDG.Tradeoffs.summarize(world.events);

    var report = {
      stage: stage,
      score: score,
      grade: grade,
      passed: passed,
      runStatus: runStatus,
      runError: runError || null,
      ticksSurvived: world.tick,
      tickLimit: stage.TICK_LIMIT,
      goals: goalRows,
      stats: {
        actions: stats.actions,
        totalActions: totalActions,
        rejected: stats.rejected,
        criticals: stats.criticals,
        events: stats.events
      },
      final: {},
      worked: worked,
      failed: failed,
      improve: improve,
      tradeoffs: tradeoffs
    };
    (stage.snapshotKeys || []).forEach(function (k) {
      report.final[k] = world[k];
    });
    if (stage.counts) {
      var counts = stage.counts(world);
      Object.keys(counts).forEach(function (k) { report.final[k] = counts[k]; });
    }
    report.final.tick = world.tick;
    return report;
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function render(rep) {
    var s = rep.stage;
    var h = '';

    h += '<div class="rep-header ' + (rep.passed ? 'pass' : 'fail') + '">';
    h += '<div class="rep-score"><span class="rep-grade">' + rep.grade.letter + '</span>' +
         '<span class="rep-num">' + rep.score + '/100</span></div>';
    h += '<div class="rep-title">' + esc(s.title) + '<div class="rep-sub">' +
         (rep.passed ? 'Stage cleared — ' + rep.grade.text : 'Stage not cleared — ' + rep.grade.text) +
         ' · ticks ' + rep.ticksSurvived + '/' + rep.tickLimit + '</div></div>';
    h += '</div>';

    h += '<h3>Goals</h3><table class="rep-table"><tr><th>Metric</th><th>Target</th><th>Actual</th><th>Result</th></tr>';
    rep.goals.forEach(function (g) {
      h += '<tr class="' + (g.pass ? 'ok' : 'bad') + '"><td>' + esc(g.label) + '</td><td>' +
        (g.cmp === '>=' ? '≥ ' : '≤ ') + g.target + '</td><td>' + esc(M.fmt(g.key, g.actual)) +
        '</td><td>' + (g.pass ? 'PASS' : 'FAIL') + '</td></tr>';
    });
    h += '</table>';

    function list(title, items, cls) {
      if (!items.length) return '';
      var out = '<h3>' + title + '</h3><ul class="rep-list ' + cls + '">';
      items.forEach(function (i) { out += '<li>' + esc(i) + '</li>'; });
      return out + '</ul>';
    }
    h += list('What worked', rep.worked, 'good');
    h += list('What failed', rep.failed, 'bad');
    h += list('How to improve', rep.improve, 'tip');

    if (rep.stats.events.length) {
      h += '<h3>Critical events</h3><ul class="rep-list bad">';
      rep.stats.events.forEach(function (e) { h += '<li>tick ' + e.tick + ': ' + esc(e.text) + '</li>'; });
      h += '</ul>';
    }

    if (rep.tradeoffs.length) {
      h += '<h3>Trade-offs of your actions</h3><table class="rep-table"><tr><th>Action</th><th>Used</th><th>Benefits</th><th>Costs</th></tr>';
      rep.tradeoffs.forEach(function (t) {
        var pros = t.pros.map(SDG.Tradeoffs.fmtDelta).join(', ') || '—';
        var cons = t.cons.map(SDG.Tradeoffs.fmtDelta).join(', ') || '—';
        h += '<tr><td>' + esc(t.name) + '</td><td>' + t.count + '</td><td class="ok">' +
             esc(pros) + '</td><td class="bad">' + esc(cons) + '</td></tr>';
      });
      h += '</table>';
    }

    var fin = (s.bars || []).slice(0, 3).map(function (b) {
      var v = rep.final[b.key];
      if (v === undefined) return null;
      return b.label + ': ' + (Math.round(v * 10) / 10);
    }).filter(Boolean).join(' · ');
    h += '<div class="rep-final">Final state — ' + esc(fin || ('ticks ' + rep.ticksSurvived + '/' + rep.tickLimit)) +
         ' · ticks ' + rep.ticksSurvived + '/' + rep.tickLimit + '</div>';
    return h;
  }

  SDG.StageReport = { build: build, render: render };
})(typeof window !== 'undefined' ? window : globalThis);
