// dev/test_d_grades.js
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

function run(stage, code) {
  const e = new SDG.Engine(stage);
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
  e.fastForward();
  var rep = SDG.StageReport.build(stage, e.world, e, err ? 'error' : 'done', err);
  return { rep, err };
}

// Stage 1 draft
var s1 = `
# SDG Stage 1 — Basic Needs (Starter Code)
# Current Rating: Grade D.
# Flaws: Relies on dirty fuel combustion and ignores shelter maintenance.
def play():
    while True:
        # Pumps and distributes water naively
        if water_reserve() < 30 and energy() > 5:
            pump_water(10)
        if hydration() < 60 and water_reserve() >= 25:
            distribute("water", 25)

        # Basic food farming
        if food_reserve() < 30 and money() >= 7 and free_land() > 0:
            plant("vegetable", 1)
        if nutrition() < 60 and food_reserve() >= 25:
            distribute("food", 25)

        # Naive power: burns dirty fuel constantly, spikes emissions!
        if energy() < 35 and money() >= 2:
            burn_fuel()

play()
`;

// Stage 2 draft
var s2 = `
# SDG Stage 2 — Manufacturing (Starter Code)
# Current Rating: Grade D.
# Flaws: Runs dirty grid power without solar or safety crew, causing pollution & safety hazards.
def run_factory():
    while True:
        # Production pipeline
        if ore() < 20 and energy() > 5:
            mine(5)
        if ore() >= 20 and steel() < 20 and energy() > 8:
            smelt(5)
        if steel() >= 20 and goods() < 20 and energy() > 6:
            assemble(5)
        if goods() >= 5 and energy() > 3:
            ship(5)

        # Dirty grid power & basic waste clearing
        if energy() < 20 and money() >= 6:
            grid_power()
        if waste() > 30 and money() >= 3 and energy() >= 5:
            recycle(10)

run_factory()
`;

// Stage 3 draft
var s3 = `
# SDG Stage 3 — Environment (Starter Code)
# Current Rating: Grade D.
# Flaws: Maximizes industrial revenue without filtering air or wetlands, letting pollution degrade nature.
def steward():
    while True:
        # Cleans river only when severely polluted
        if water_quality() < 45 and money() >= 8:
            clean_river()
        # Plants a minimal tree patch
        if trees() < 2 and money() >= 8 and free_land() > 0:
            plant_trees(1)

steward()
`;

// Stage 4 draft
var s4 = `
# SDG Stage 4 — Healthy Lifestyle (Starter Code)
# Current Rating: Grade D.
# Flaws: Overworks and relies on screen time for cheap stress relief, neglecting fitness.
def play():
    while True:
        # Basic sleep and quick food
        if sleep() < 60:
            sleep_for(6)
        if nutrition() < 60 and money() >= 3:
            cook("fast")

        # Works for income
        if money() < 50:
            work(2)

        # Uses cheap screen time instead of exercising, causing health and stress to degrade!
        if stress() > 40:
            screen_time(2)

play()
`;

var r1 = run(SDG.Stage1, s1);
var r2 = run(SDG.Stage2, s2);
var r3 = run(SDG.Stage3, s3);
var r4 = run(SDG.Stage4, s4);

console.log('Stage 1:', r1.rep.score, r1.rep.grade.letter, 'err:', r1.err && r1.err.message);
console.log('Stage 2:', r2.rep.score, r2.rep.grade.letter, 'err:', r2.err && r2.err.message);
console.log('Stage 3:', r3.rep.score, r3.rep.grade.letter, 'err:', r3.err && r3.err.message);
console.log('Stage 4:', r4.rep.score, r4.rep.grade.letter, 'err:', r4.err && r4.err.message);



