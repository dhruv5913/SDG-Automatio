// Metric / calculation / consistency tests — node dev/calc_test.js
// Verifies: tick math, goal math (progress/pass/attainment), scoring, clamping,
// action atomicity, report-vs-world consistency, final report aggregation,
// and the shipped balance targets.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
[
  'js/dsl/tokenizer.js', 'js/dsl/parser.js', 'js/dsl/interpreter.js',
  'js/core/metrics.js', 'js/core/goals.js', 'js/core/tradeoffs.js', 'js/core/engine.js',
  'js/stages/stage1_basic.js', 'js/stages/stage2_manufacturing.js',
  'js/stages/stage3_environment.js', 'js/stages/stage4_lifestyle.js',
  'js/reports/stage_report.js', 'js/reports/final_report.js'
].forEach(f => vm.runInThisContext(fs.readFileSync(path.join(root, f), 'utf8'), { filename: f }));

const SDG = globalThis.SDG;
let pass = 0, fail = 0;

function ok(name, cond, detail) {
  if (cond) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + (detail !== undefined ? ' — ' + detail : '')); }
}
function near(name, got, want, eps) {
  eps = eps === undefined ? 1e-6 : eps;
  ok(name, typeof got === 'number' && Math.abs(got - want) <= eps, 'got ' + got + ', want ' + want);
}

// ---------- helpers ----------

function newEngine(stage) { return new SDG.Engine(stage); }

function host(e, name, args) {
  return e.callHost(name, args || [], {}, { line: 1 }).value;
}

// run a script like the app does; stop BEFORE fastForward unless asked
function runScript(stage, code, fastForward) {
  const e = newEngine(stage);
  const ast = SDG.parse(code);
  const ctx = {
    env: new SDG.Env(null), ops: { n: 0 },
    hasHost: n => e.hasHost(n),
    host: (n, a, k, node) => e.callHost(n, a, k, node),
    print: () => {}
  };
  const gen = SDG.run(ast, ctx);
  let pureOps = 0, err = null;
  try {
    for (let guard = 0; guard < 2000000; guard++) {
      if (e.world.tick >= stage.TICK_LIMIT) break;
      const s = gen.next();
      if (s.done) break;
      if (e.actionThisStep) { e.actionThisStep = false; pureOps = 0; continue; }
      pureOps++;
      if (pureOps >= 40) { pureOps = 0; if (!e.advanceTick()) break; }
    }
  } catch (ex) { err = ex; }
  if (fastForward) e.fastForward();
  const report = SDG.StageReport.build(stage, e.world, e, err ? 'error' : 'done', err);
  return { e, err, report };
}

// ---------- A. goal math ----------

const G = SDG.Goals;
const ge = { cmp: '>=', target: 50 };
const le = { cmp: '<=', target: 45 };

ok('pass >=: exactly at target', G.pass(ge, 50) === true);
ok('pass >=: just below target', G.pass(ge, 49.9) === false);
ok('pass <=: exactly at target', G.pass(le, 45) === true);
ok('pass <=: just over target', G.pass(le, 45.1) === false);
ok('pass <=: 0 always passes', G.pass(le, 0) === true);

near('progress >=: half way', G.progress(ge, 25), 0.5);
near('progress >=: over target clamps to 1', G.progress(ge, 75), 1);
near('progress <=: double target', G.progress(le, 90), 0.5);
near('progress <=: at target = 1', G.progress(le, 45), 1);
near('progress <=: zero = 1', G.progress(le, 0), 1);

near('attainment: exact target = 0.8', G.attainment(ge, 50), 0.8);
near('attainment: +25% = 1.0', G.attainment(ge, 62.5), 1);
near('attainment: half = 0.4', G.attainment(ge, 25), 0.4);
near('attainment: <= exact = 0.8', G.attainment(le, 45), 0.8);
near('attainment: <= at 0 = 1.0', G.attainment(le, 0), 1);

// scoring
const row = (p, a) => ({ pass: p, attainment: a });
near('score: all exact pass = 80', G.score([row(true, 0.8), row(true, 0.8)]), 80);
near('score: all fail at 0 = 0', G.score([row(false, 0), row(false, 0)]), 0);
near('score: mixed = round(49.5) = 50', G.score([row(true, 0.8), row(false, 0.4)]), 50);

// ---------- B. tick math (advanceTick directly) ----------

// stage 1
{
  const e = newEngine(SDG.Stage1), w = e.world;
  ok('s1 tick 0->1', e.advanceTick() === true && w.tick === 1);
  near('s1 hydration -1.5/tick', w.hydration, 63.5);
  near('s1 nutrition -1.2/tick', w.nutrition, 58.8);
  near('s1 shelter -0.5 + 0.15*1 shelter', w.shelter, 29.65);
  near('s1 energy -0.8/tick', w.energy, 49.2);
  near('s1 water store -0.4/tick', w.water_reserve, 19.6);
  near('s1 food store -0.4/tick', w.food_reserve, 14.6);
  near('s1 money +2.5/tick', w.money, 122.5);
  near('s1 emissions +0.12/tick', w.emissions, 8.12);
  near('s1 morale recomputed', w.morale, 0.5 * ((63.5 + 58.8 + 29.65) / 3) + 0.25 * 49.2 + 0.25 * (100 - 8.12));
  e.advanceTick();
  near('s1 hydration after 2 ticks', w.hydration, 62);
  near('s1 energy after 2 ticks', w.energy, 48.4);
  near('s1 money after 2 ticks', w.money, 125);
}
{
  const e = newEngine(SDG.Stage1), w = e.world;
  w.hydration = 0.5;
  e.advanceTick();
  near('s1 hydration clamps at 0', w.hydration, 0);
  w.emissions = 0.05;
  for (let i = 0; i < 10; i++) { // 10 panels: 0.12 - 0.6 = -0.48/tick
    const idx = w.grid.findIndex(t => t.type === 'dirt');
    w.grid[idx] = { x: w.grid[idx].x, y: w.grid[idx].y, type: 'panel' };
  }
  e.advanceTick();
  near('s1 emissions clamps at 0', w.emissions, 0);
}

// stage 2
{
  const e = newEngine(SDG.Stage2), w = e.world;
  e.advanceTick();
  near('s2 energy -0.9/tick', w.energy, 54.1);
  near('s2 money +2/tick (no crew)', w.money, 152);
  near('s2 waste -0.15+0.25/tick', w.waste, 0.1);
  near('s2 pollution +0.08/tick', w.pollution, 0.08);
  near('s2 safety -0.2/tick', w.safety, 74.8);
  near('s2 ore untouched by tick', w.ore, 10);
}
{
  const e = newEngine(SDG.Stage2), w = e.world;
  host(e, 'build_recycler');           // -18k, then +2k tick income
  near('s2 build_recycler cost', w.money, 134);
  w.waste = 10;
  e.advanceTick();
  near('s2 recycler passive -0.35/tick (bug fix)', w.waste, 9.75);
}
{
  const e = newEngine(SDG.Stage2), w = e.world;
  const idx = w.grid.findIndex(t => t.type === 'lot');
  w.grid[idx] = { x: w.grid[idx].x, y: w.grid[idx].y, type: 'panel' };
  e.advanceTick();
  near('s2 panel passive +0.7 energy/tick', w.energy, 54.8);
  near('s2 panel passive -0.04 pollution/tick', w.pollution, 0.04);
}

// stage 3
{
  const e = newEngine(SDG.Stage3), w = e.world;
  e.advanceTick();
  near('s3 economy +1 +1.5*2 active factories', w.economy, 84);
  near('s3 air: +0.05 -0.12*2 +0.06*2 trees', w.air, 49.93);
  near('s3 water: +0.03 -0.07*2', w.water_quality, 54.89);
  near('s3 carbon: +0.1 +0.24 -0.05*2', w.carbon, 30.24);
  near('s3 biodiversity: -0.03 -0.1 +0.2', w.biodiversity, 45.07);
  near('s3 soil: -0.08 +0.06', w.soil, 49.98);
}

// stage 4
{
  const e = newEngine(SDG.Stage4), w = e.world;
  e.advanceTick();
  near('s4 sleep -1/tick', w.sleep, 64);
  near('s4 nutrition -0.75/tick', w.nutrition, 59.25);
  near('s4 fitness -0.5/tick', w.fitness, 44.5);
  near('s4 focus -0.3/tick', w.focus, 54.7);
  near('s4 stress +0.5+0.005*screen', w.stress, 40.6);
  near('s4 screen +0.1/tick', w.screen, 20.1);
  near('s4 discipline -0.5/tick', w.discipline, 79.5);
  near('s4 money -0.15/tick', w.money, 79.85);
}

// ---------- C. action semantics ----------

{
  const r = runScript(SDG.Stage1, 'pump_water(10)');
  const w = r.e.world;
  ok('one action = exactly 1 tick', w.tick === 1, 'tick=' + w.tick);
  near('pump_water +10 store, -0.4 tick', w.water_reserve, 29.6);
  near('pump_water -4 energy, -0.8 tick', w.energy, 45.2);
  near('pump_water -1k, +2.5 tick', w.money, 121.5);
  near('pump_water +0.5 emissions, +0.12 tick', w.emissions, 8.62);
  ok('action recorded', r.e.world.stats.actions.pump_water === 1);
}
{
  const r = runScript(SDG.Stage1, 'x = 0\nwhile x < 200:\n    x += 1');
  ok('pure ops still advance ticks', r.e.world.tick > 0, 'tick=' + r.e.world.tick);
  ok('pure ops execute no actions', Object.keys(r.e.world.stats.actions).length === 0);
}
{
  const e = newEngine(SDG.Stage1), w = e.world;
  const hydrationBefore = w.hydration;
  const probe = host(e, 'hydration');
  near('probe returns value', probe, 65);
  ok('probe does not tick', w.tick === 0 && e.actionSeq === 0);
  w.money = 0;
  let threw = null;
  try { host(e, 'build_shelter', [1]); } catch (ex) { threw = ex; }
  ok('unaffordable action throws', threw && threw.py === true, threw ? threw.message : 'no throw');
  ok('rejected action logged', w.stats.rejected.length === 1);
  ok('rejected action is atomic (no partial apply)', w.money === 0 && w.hydration === hydrationBefore && w.tick === 0);
}

// ---------- D. report consistency ----------

{
  const stage = SDG.Stage2;
  const r = runScript(stage, stage.template, true);
  const w = r.e.world, rep = r.report;

  let allActual = true, allPass = true, allFinal = true;
  stage.goals.forEach((g, i) => {
    if (rep.goals[i].actual !== w[g.key]) allActual = false;
    if (rep.goals[i].pass !== G.pass(g, w[g.key])) allPass = false;
  });
  const snap = SDG.util.snapshot(stage, w);
  stage.snapshotKeys.forEach(k => { if (rep.final[k] !== snap[k]) allFinal = false; });
  ok('report goal actuals == world values', allActual);
  ok('report pass == shared Goals.pass (what HUD shows)', allPass);
  ok('report final snapshot == engine snapshot', allFinal && rep.final.tick === w.tick);
  ok('report score recomputes identically',
    rep.score === G.score(G.evaluate(stage, w)), rep.score + ' vs ' + G.score(G.evaluate(stage, w)));
  ok('failed goal caps grade at C (stage2 template)',
    rep.grade.letter === 'C' && rep.passed === true, rep.grade.letter + '/' + rep.passed);
  ok('progress field exposed for HUD bars',
    rep.goals.every(g => typeof g.progress === 'number' && g.progress >= 0 && g.progress <= 1));
}
{
  const stage = SDG.Stage1;
  const r = runScript(stage, stage.template, true);
  ok('stage1 template still scores 91 (balance)',
    r.report.score === 91 && r.report.grade.letter === 'C',
    r.report.score + '/' + r.report.grade.letter);
}

// ---------- E. final report aggregation ----------

{
  const mk = (score, passed) => ({ id: 'x', title: 'Stage — x', score, grade: 'C', passed, failed: [] });
  const rep = SDG.FinalReport.build([mk(85, true), mk(75, true), mk(65, true), mk(55, true)]);
  ok('final: 4 passed rows average', rep.avg === 70);
  ok('final: allPassed true', rep.allPassed === true);
  ok('final: rating B for avg 70 all passed', rep.rating === 'B', rep.rating);
  const partial = SDG.FinalReport.build([mk(90, true)]);
  ok('final: incomplete run is not allPassed', partial.allPassed === false);
  ok('final: rating D when not all passed', partial.rating === 'D', partial.rating);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
