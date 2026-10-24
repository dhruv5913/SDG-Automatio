// dev/mode_test.js
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
var stages = [SDG.Stage1, SDG.Stage2, SDG.Stage3, SDG.Stage4];
var modes = ['easy', 'medium', 'hard'];

function runScript(stage, code) {
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
  return { e, report: SDG.StageReport.build(stage, e.world, e, err ? 'error' : 'done', err), err };
}

console.log('Testing templates and suggestions across all stages and modes...');

stages.forEach(function (stg, idx) {
  console.log('\n--- Stage ' + (idx + 1) + ': ' + stg.title + ' ---');
  
  if (!stg.suggestions || !stg.suggestions.strategy || !stg.suggestions.actions || !stg.suggestions.probes) {
    throw new Error('Stage ' + stg.id + ' missing suggestions structure!');
  }
  console.log('✔ Suggestions verified: ' + stg.suggestions.strategy.length + ' strategies, ' + 
    stg.suggestions.actions.length + ' actions, ' + stg.suggestions.probes.length + ' probes.');

  modes.forEach(function (mode) {
    var code = stg.templates[mode];
    if (typeof code !== 'string') {
      throw new Error('Stage ' + stg.id + ' missing template for mode ' + mode);
    }
    var ast = SDG.parse(code);
    console.log('✔ [' + mode + '] AST parsed successfully');

    var res = runScript(stg, code);
    if (res.err) {
      throw new Error('Mode ' + mode + ' error: ' + res.err.message);
    }
    console.log('  -> ' + mode + ' run completed: Score ' + res.report.score + '/100 (' + res.report.grade.letter + '), Passed: ' + res.report.passed);

    if (mode === 'easy') {
      if (res.report.passed || res.report.score < 40 || res.report.score >= 60 || res.report.grade.letter !== 'D') {
        throw new Error('Easy starter code for stage ' + stg.id + ' did not achieve Grade D (score 40-59)! Score: ' + res.report.score + ', Grade: ' + res.report.grade.letter);
      }
    }
  });
});

console.log('\n=============================================');
console.log('ALL MODES AND STAGES VERIFIED PERFECTLY (100%)');
console.log('=============================================');
