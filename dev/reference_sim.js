// Headless multi-stage simulator — tests the DSL/engine and balances each stage.
// Usage: node dev/reference_sim.js [stageId]   e.g. node dev/reference_sim.js stage2
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const files = [
  'js/dsl/tokenizer.js',
  'js/dsl/parser.js',
  'js/dsl/interpreter.js',
  'js/core/metrics.js',
  'js/core/tradeoffs.js',
  'js/core/engine.js',
  'js/core/goals.js',
  'js/stages/stage1_basic.js',
  'js/stages/stage2_manufacturing.js',
  'js/stages/stage3_environment.js',
  'js/stages/stage4_lifestyle.js',
  'js/reports/stage_report.js'
];
files.forEach(f => vm.runInThisContext(fs.readFileSync(path.join(root, f), 'utf8'), { filename: f }));

const SDG = globalThis.SDG;

// Reference solutions — the "A" strategies used for balance tuning.
const REFS = {
  stage1: `
def play():
    while True:
        if water_reserve() < 40 and energy() > 5:
            pump_water(10)
        if food_reserve() < 50 and money() >= 7 and energy() > 2 and free_land() > 0:
            plant("vegetable", 1)
        if hydration() < 75 and water_reserve() >= 25 and energy() > 2:
            distribute("water", 25)
        if nutrition() < 75 and food_reserve() >= 25 and energy() > 2:
            distribute("food", 25)
        if shelter() < 78 and money() >= 12 and energy() > 5:
            build_shelter(1)
        if energy() < 45 and money() >= 15 and free_land() > 0:
            solar_panel()
        if money() > 110 and panels() < 9 and free_land() > 0:
            solar_panel()
        if energy() < 20 and money() >= 2 and emissions() < 40:
            burn_fuel()

play()
`,
  stage2: `
def run_factory():
    while True:
        if workers() < 4 and money() >= 12:
            hire(1)
        if recyclers() == 0 and money() >= 18:
            build_recycler()
        if panels() < 6 and money() >= 20:
            solar()
        if ore() < 20 and energy() > 3:
            mine(5)
        if ore() >= 20 and steel() < 30 and energy() > 6:
            smelt(5)
        if steel() >= 30 and goods() < 30 and energy() > 4:
            assemble(5)
        if goods() >= 10 and energy() > 2:
            ship(5)
        if waste() > 25 and money() > 6 and energy() > 4:
            recycle(10)
        if energy() < 30 and money() >= 2 and pollution() < 45:
            grid_power()

run_factory()
`,
  stage3: `
def steward():
    while True:
        if restricted() < 1 and factories() > 1:
            restrict_polluter()
        if trees() < 7 and money() >= 8 and free_land() > 0:
            plant_trees(3)
        if water_quality() < 72 and money() >= 8:
            clean_river()
        if filters() < 2 and money() >= 20 and free_land() > 0:
            filter_air()
        if wetlands() < 2 and money() >= 24 and free_land() > 0:
            restore_wetland()
        if carbon() > 40 and money() >= 10:
            ban_plastic()
        if soil() < 62 and money() >= 13 and free_land() > 0:
            plant_trees(3)

steward()
`,
  stage4: `
def live_well():
    while True:
        if sleep() < 72:
            sleep_for(8)
        if nutrition() < 80 and money() > 6:
            cook("balanced")
        if discipline() > 8 and fitness() < 88:
            exercise(30)
        if focus() < 55 and discipline() > 6:
            meditate(10)
        if screen() < 30 and stress() > 65:
            screen_time(1)
        if money() < 55 and money() > 12:
            work(2)
        if gyms() == 0 and money() >= 24:
            buy_gym()
        if parks() == 0 and money() >= 29:
            buy_park()
        if kitchens() == 0 and money() >= 34:
            buy_kitchen()

live_well()
`
};

const NOOP = `
x = 0
while x < 1000000:
    x += 1
`;

const STAGES = () => ({
  stage1: SDG.Stage1, stage2: SDG.Stage2, stage3: SDG.Stage3, stage4: SDG.Stage4
});

function runScript(stage, code) {
  const engine = new SDG.Engine(stage);
  let ast, err = null, status = 'done';
  try {
    ast = SDG.parse(code);
  } catch (e) {
    return { engine: null, err: e, status: 'parse-error', report: null };
  }
  const ctx = {
    env: new SDG.Env(null),
    ops: { n: 0 },
    hasHost: n => engine.hasHost(n),
    host: (n, a, k, node) => engine.callHost(n, a, k, node),
    print: () => {}
  };
  const gen = SDG.run(ast, ctx);
  let pureOps = 0;
  try {
    for (let guard = 0; guard < 5000000; guard++) {
      if (engine.world.tick >= stage.TICK_LIMIT) break;
      const step = gen.next();
      if (step.done) break;
      if (engine.actionThisStep) { engine.actionThisStep = false; pureOps = 0; continue; }
      pureOps++;
      if (pureOps >= 40) { pureOps = 0; if (!engine.advanceTick()) break; }
    }
  } catch (e) {
    err = e; status = 'error';
  }
  engine.fastForward();
  const report = SDG.StageReport.build(stage, engine.world, engine, err ? 'error' : 'done', err);
  return { engine, err, status, report };
}

function show(title, stage, res) {
  console.log('\n=== ' + title + ' ===');
  if (res.status === 'parse-error') { console.log('PARSE ERROR: ' + res.err.message); return; }
  const r = res.report;
  console.log('score: ' + r.score + '/100  grade: ' + r.grade.letter + '  passed: ' + r.passed +
    '  status: ' + res.status + '  ticks: ' + r.ticksSurvived + '/' + r.tickLimit);
  if (res.err) console.log('error: ' + res.err.message);
  console.log('goals:');
  r.goals.forEach(g => console.log('  ' + (g.pass ? 'PASS' : 'FAIL') + ' ' + g.label + ' = ' +
    Math.round(g.actual * 10) / 10 + ' (target ' + (g.cmp === '>=' ? '>=' : '<=') + g.target + ')'));
  const fin = (stage.bars || []).map(b => b.label + '=' + Math.round((r.final[b.key] || 0) * 10) / 10).join(' ');
  console.log('final: ' + fin);
  console.log('actions: ' + JSON.stringify(r.stats.actions));
  if (r.stats.rejected.length) console.log('rejected: ' + r.stats.rejected.length + ' first: ' + r.stats.rejected[0].message);
  if (r.failed.length) { console.log('failed:'); r.failed.forEach(f => console.log('  - ' + f)); }
  if (r.improve.length) { console.log('improve:'); r.improve.forEach(f => console.log('  - ' + f)); }
}

function runOne(stageId) {
  const stage = STAGES()[stageId];
  if (!stage) { console.log('unknown stage: ' + stageId); return; }
  show('reference solution', stage, runScript(stage, REFS[stageId]));
  show('shipped template', stage, runScript(stage, stage.template));
  show('no-op script (should fail)', stage, runScript(stage, NOOP));
}

const arg = process.argv[2];
if (arg) {
  runOne(arg);
} else {
  Object.keys(STAGES()).forEach(runOne);
}
