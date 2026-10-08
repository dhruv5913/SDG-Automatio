// Single source of truth for goal math — used by HUD (live), StageReport and tests.
// NOTE: a goal PASSES only on the exact comparison (>= target / <= target).
// goalProgress() is a normalized 0..1 display value for bars; it never decides pass/fail.
(function (root) {
  'use strict';
  var SDG = (root.SDG = root.SDG || {});
  var clamp = SDG.Metrics.clamp;

  // Raw headroom ratio: 1.0 = exactly on target, >1 = beating it, <1 = missing it.
  function rawRatio(goal, actual) {
    if (goal.cmp === '>=') {
      if (goal.target > 0) return actual / goal.target;
      return actual >= goal.target ? 1 : 0;
    }
    if (actual <= 0) return 1; // nothing left of a "keep low" metric = fully achieved
    if (goal.target > 0) return goal.target / actual;
    return actual <= goal.target ? 1 : 0;
  }

  // Normalized progress toward the goal, clamped 0..1 (display only).
  function progress(goal, actual) {
    return clamp(rawRatio(goal, actual), 0, 1);
  }

  function pass(goal, actual) {
    return goal.cmp === '>=' ? actual >= goal.target : actual <= goal.target;
  }

  // Scoring contribution: exactly meeting the target = 0.8, beating it by 25%+ = 1.0.
  // A "<=" metric driven all the way to 0 counts as fully achieved (1.0).
  function attainment(goal, actual) {
    if (goal.cmp === '<=' && actual <= 0) return 1;
    return clamp(rawRatio(goal, actual) * 0.8, 0, 1);
  }

  // Evaluate every goal of a stage against a world snapshot.
  function evaluate(stage, world) {
    return stage.goals.map(function (g) {
      var actual = world[g.key];
      return {
        key: g.key, label: g.label, cmp: g.cmp,
        target: g.target, actual: actual,
        pass: pass(g, actual),
        progress: progress(g, actual),
        attainment: attainment(g, actual)
      };
    });
  }

  // score = 100 * mean(attainment) * (0.65 + 0.35 * passRatio)
  function score(rows) {
    var avg = rows.reduce(function (s, r) { return s + r.attainment; }, 0) / rows.length;
    var passRatio = rows.filter(function (r) { return r.pass; }).length / rows.length;
    return Math.round(100 * avg * (0.65 + 0.35 * passRatio));
  }

  SDG.Goals = {
    rawRatio: rawRatio,
    progress: progress,
    pass: pass,
    attainment: attainment,
    evaluate: evaluate,
    score: score
  };
})(typeof window !== 'undefined' ? window : globalThis);
