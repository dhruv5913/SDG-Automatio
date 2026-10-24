(function (root) {
  'use strict';
  var SDG = (root.SDG = root.SDG || {});
  var clamp = SDG.Metrics.clamp;
  var PyError = SDG.PyError;
  var argNum = SDG.util.argNum;

  var COLS = 14;
  var ROWS = 9;
  var MINES = [[3, 1], [8, 1], [11, 3], [2, 5], [6, 6], [10, 6]];

  function makeGrid() {
    var grid = [];
    for (var y = 0; y < ROWS; y++) {
      for (var x = 0; x < COLS; x++) grid.push({ x: x, y: y, type: 'lot' });
    }
    MINES.forEach(function (m) { grid[m[1] * COLS + m[0]].type = 'mine'; });
    return grid;
  }
  function countType(grid, type) {
    var n = 0;
    for (var i = 0; i < grid.length; i++) if (grid[i].type === type) n++;
    return n;
  }
  function firstOf(grid, type) {
    for (var i = 0; i < grid.length; i++) if (grid[i].type === type) return i;
    return -1;
  }
  function need(w, key, amount, msg) {
    if (w[key] < amount) throw PyError(msg + ' (need ' + amount + ' ' + key + ', have ' + Math.floor(w[key]) + ')');
  }
  function needMoney(w, amount) {
    if (w.money < amount) throw PyError('not enough budget (need ' + amount + ', have ' + Math.floor(w.money) + ')');
  }

  function counts(w) {
    return {
      panels: countType(w.grid, 'panel'),
      recyclers: countType(w.grid, 'recycler'),
      mines: countType(w.grid, 'mine'),
      free: countType(w.grid, 'lot')
    };
  }

  function createWorld() {
    var grid = makeGrid();
    return {
      cols: COLS, rows: ROWS, grid: grid,
      tick: 0,
      output: 0, ore: 10, steel: 0, goods: 0,
      waste: 0, pollution: 0, safety: 75, energy: 55,
      money: 150, workers: 0,
      lastTile: null,
      events: [],
      stats: { actions: {}, rejected: [], criticals: {}, events: [] }
    };
  }

  function applyTick(w) {
    var c = counts(w);
    w.energy -= 0.9;
    w.energy += 0.7 * c.panels;
    w.money += 2.0 - 0.4 * w.workers;        // orders minus wages
    w.waste -= 0.15;                          // municipal pickup
    w.waste += 0.25;                          // production byproduct
    w.waste -= 0.35 * c.recyclers;            // each recycler eats waste every tick
    w.pollution += 0.08 - 0.04 * c.panels;
    w.safety -= 0.2;
    w.safety += 0.12 * w.workers;             // crew keeps the floor safe

    w.energy = clamp(w.energy, 0, 100);
    w.money = clamp(w.money, 0, Infinity);
    w.waste = clamp(w.waste, 0, 100);
    w.pollution = clamp(w.pollution, 0, Infinity);
    w.safety = clamp(w.safety, 0, 100);
    w.ore = clamp(w.ore, 0, 100);
    w.steel = clamp(w.steel, 0, 100);
    w.goods = clamp(w.goods, 0, 100);
    w.output = clamp(w.output, 0, Infinity);
    w.workers = clamp(w.workers, 0, 12);
  }

  // ---------------- API ----------------

  var api = {
    tick:       { kind: 'probe', exec: function (w) { return w.tick; } },
    output:     { kind: 'probe', exec: function (w) { return w.output; } },
    ore:        { kind: 'probe', exec: function (w) { return w.ore; } },
    steel:      { kind: 'probe', exec: function (w) { return w.steel; } },
    goods:      { kind: 'probe', exec: function (w) { return w.goods; } },
    waste:      { kind: 'probe', exec: function (w) { return w.waste; } },
    pollution:  { kind: 'probe', exec: function (w) { return w.pollution; } },
    safety:     { kind: 'probe', exec: function (w) { return w.safety; } },
    energy:     { kind: 'probe', exec: function (w) { return w.energy; } },
    money:      { kind: 'probe', exec: function (w) { return w.money; } },
    workers:    { kind: 'probe', exec: function (w) { return w.workers; } },
    panels:     { kind: 'probe', exec: function (w) { return countType(w.grid, 'panel'); } },
    recyclers:  { kind: 'probe', exec: function (w) { return countType(w.grid, 'recycler'); } },
    free_land:  { kind: 'probe', exec: function (w) { return countType(w.grid, 'lot'); } },

    mine: {
      kind: 'action',
      exec: function (w, a) {
        var n = argNum(a, 'n', 0, 5);
        if (n <= 0) throw PyError("'n' must be positive");
        if (n > 30) n = 30;
        need(w, 'energy', 3, 'not enough energy to mine');
        w.energy -= 3;
        w.ore += n;
        w.waste += 0.2 * n;
        w.safety -= 0.8;
        w.pollution += 0.6;
        w.lastTile = firstOf(w.grid, 'mine');
        return null;
      }
    },
    smelt: {
      kind: 'action',
      exec: function (w, a) {
        var n = argNum(a, 'n', 0, 5);
        if (n <= 0) throw PyError("'n' must be positive");
        if (n > w.ore) n = Math.trunc(w.ore);
        if (n < 1) throw PyError('no ore — mine() first');
        need(w, 'energy', 6, 'not enough energy to smelt');
        w.energy -= 6;
        w.ore -= n;
        w.steel += n;
        w.waste += 0.3 * n;
        w.safety -= 0.1 * n;
        w.pollution += 0.35 * n;
        return null;
      }
    },
    assemble: {
      kind: 'action',
      exec: function (w, a) {
        var n = argNum(a, 'n', 0, 5);
        if (n <= 0) throw PyError("'n' must be positive");
        if (n > w.steel) n = Math.trunc(w.steel);
        if (n < 1) throw PyError('no steel — smelt() first');
        need(w, 'energy', 4, 'not enough energy to assemble');
        w.energy -= 4;
        w.steel -= n;
        w.goods += n;
        w.waste += 0.25 * n;
        w.safety -= 0.08 * n;
        w.pollution += 0.1 * n;
        return null;
      }
    },
    ship: {
      kind: 'action',
      exec: function (w, a) {
        var n = argNum(a, 'n', 0, 5);
        if (n <= 0) throw PyError("'n' must be positive");
        if (n > w.goods) n = Math.trunc(w.goods);
        if (n < 1) throw PyError('no goods to ship — assemble() first');
        need(w, 'energy', 2, 'not enough energy to ship');
        w.energy -= 2;
        w.goods -= n;
        w.output += n;
        w.money += 2.5 * n;
        w.waste += 0.1 * n;
        w.pollution += 0.15 * n;
        w.lastTile = firstOf(w.grid, 'lot');
        return null;
      }
    },
    recycle: {
      kind: 'action',
      exec: function (w, a) {
        var n = argNum(a, 'n', 0, 10);
        if (n <= 0) throw PyError("'n' must be positive");
        if (n > w.waste) n = Math.trunc(w.waste);
        if (n < 1) throw PyError('nothing to recycle — waste() is empty');
        need(w, 'energy', 3, 'not enough energy to recycle');
        needMoney(w, 2);
        w.energy -= 3;
        w.money -= 2;
        w.waste -= n;
        w.safety += 0.5;
        return null;
      }
    },
    hire: {
      kind: 'action',
      exec: function (w, a) {
        var n = Math.trunc(argNum(a, 'n', 0, 1));
        if (n <= 0) throw PyError("'n' must be positive");
        if (w.workers + n > 12) throw PyError('crew limit is 12');
        needMoney(w, 6 * n);
        w.money -= 6 * n;
        w.workers += n;
        return null;
      }
    },
    solar: {
      kind: 'action',
      exec: function (w, a) {
        if (countType(w.grid, 'lot') < 1) throw PyError('not enough free land for solar');
        needMoney(w, 18);
        w.money -= 18;
        w.pollution += 1;
        w.energy += 4;
        w.energy = clamp(w.energy, 0, 100);
        var idx = firstOf(w.grid, 'lot');
        w.grid[idx] = { x: w.grid[idx].x, y: w.grid[idx].y, type: 'panel' };
        w.lastTile = idx;
        return null;
      }
    },
    build_recycler: {
      kind: 'action',
      exec: function (w, a) {
        if (countType(w.grid, 'lot') < 1) throw PyError('not enough free land for a recycler');
        needMoney(w, 18);
        w.money -= 18;
        w.waste = clamp(w.waste - 5, 0, 100);
        var idx = firstOf(w.grid, 'lot');
        w.grid[idx] = { x: w.grid[idx].x, y: w.grid[idx].y, type: 'recycler' };
        w.lastTile = idx;
        return null;
      }
    },
    grid_power: {
      kind: 'action',
      exec: function (w, a) {
        needMoney(w, 2);
        w.money -= 2;
        w.energy += 10;
        w.energy = clamp(w.energy, 0, 100);
        w.pollution += 3;
        return null;
      }
    }
  };

  // ---------------- goals / grading ----------------

  var goals = [
    { key: 'output',    label: 'Output',    cmp: '>=', target: 50 },
    { key: 'waste',     label: 'Waste',     cmp: '<=', target: 35 },
    { key: 'pollution', label: 'Pollution', cmp: '<=', target: 60 },
    { key: 'safety',    label: 'Safety',    cmp: '>=', target: 55 },
    { key: 'energy',    label: 'Energy',    cmp: '>=', target: 20 }
  ];

  var advice = {
    output: 'Output fell short. The full pipeline is mine(5) → smelt(5) → assemble(5) → ship(5); one cycle = 5 units of output for 15 energy. Run it on repeat inside while True and guard each step with its probe (ore/steel/goods).',
    waste: 'Waste exceeded the cap. Each pipeline step adds byproduct (+0.2/mine, +0.3/smelt, +0.25/assemble). build_recycler(1) removes 0.35 waste per tick forever, and recycle(10) clears a burst for 2k + 3 energy.',
    pollution: 'Pollution exceeded 60. grid_power() gives +10 energy but +3 pollution each — guard it (e.g. grid_power() only when pollution() < 45). Every solar panel instead removes 0.04 pollution per tick.',
    safety: 'Safety fell below 55. Mining and smelting hurt the crew; hire(1) (6k each) adds +0.12 safety per tick per worker for the whole run. Hire early — the bonus accumulates over 80 ticks.',
    energy: 'Energy ran out. Solar gives +0.7/tick and +4 now for 18k; grid_power() is the dirty stopgap. Never call mine()/smelt()/assemble() without checking energy() first — an unaffordable action stops your program.',
    money: 'Budget hit zero. You earn +2k per tick minus wages, plus 2.5k per unit shipped — shipping goods is your real income. Guard buys with money().',
    critical: 'Something hit 0 mid-run. Always check the probe BEFORE acting (if energy() < 10: ...), never after.',
    rejected: 'An action was rejected because you could not afford it (it stops the program). Check energy()/money() first.',
    endedEarly: 'Your program finished before tick 80 and the factory ran itself into the ground. Wrap everything in a while True: maintenance loop.',
    noActions: 'You never called an action. Start with the pipeline: mine(5), smelt(5), assemble(5), ship(5).'
  };

  var template = [
    '# SDG Stage 2 — Manufacturing',
    '# Ship 50+ units while keeping waste <= 35, pollution <= 60, safety >= 55.',
    '# Pipeline: mine -> smelt -> assemble -> ship',
    '',
    'def run_factory():',
    '    while True:',
    '        # crew and waste infrastructure',
    '        if workers() < 4 and money() >= 6:',
    '            hire(1)',
    '        if recyclers() == 0 and money() >= 18:',
    '            build_recycler()',
    '        if panels() < 4 and money() >= 18:',
    '            solar()',
    '',
    '        # production pipeline',
    '        if ore() < 25 and energy() > 3:',
    '            mine(5)',
    '        if ore() >= 25 and steel() < 25 and energy() > 6:',
    '            smelt(5)',
    '        if steel() >= 25 and goods() < 25 and energy() > 4:',
    '            assemble(5)',
    '        if goods() >= 15 and energy() > 2:',
    '            ship(5)',
    '',
    '        # keep the lights on (danger: unbounded!)',
    '        if energy() < 35 and money() >= 2:',
    '            grid_power()',
    '',
    '        if waste() > 25 and money() > 3 and energy() > 4:',
    '            recycle(10)',
    '',
    'run_factory()'
  ].join('\n');

  var templateEasy = [
    '# SDG Stage 2 — Manufacturing (Starter Code)',
    '# Current Rating: Grade D (Score ~52/100, Needs work).',
    '# Objective: Upgrade this factory automation to achieve Grade A (Score >= 85)!',
    '#',
    '# Flaws in this starter code:',
    '#   - Relies on dirty grid power instead of solar panels, causing massive pollution (> 60).',
    '#   - Never hires safety crew (hire(1)), causing workplace safety to collapse below 55.',
    '#   - Only uses reactive recycling without building permanent recycling facilities.',
    '',
    'def run_factory():',
    '    while True:',
    '        # 1) Basic production pipeline',
    '        if ore() < 20 and energy() > 5:',
    '            mine(5)',
    '        if ore() >= 20 and steel() < 20 and energy() > 8:',
    '            smelt(5)',
    '        if steel() >= 20 and goods() < 20 and energy() > 6:',
    '            assemble(5)',
    '        if goods() >= 5 and energy() > 3:',
    '            ship(5)',
    '',
    '        # 2) Dirty grid power & reactive waste clearing',
    '        if energy() < 20 and money() >= 6:',
    '            grid_power()',
    '        if waste() > 30 and money() >= 3 and energy() >= 5:',
    '            recycle(10)',
    '',
    'run_factory()'
  ].join('\n');

  var templateHard = [
    '# SDG Stage 2 — Manufacturing (Hard Mode)',
    '# Objective: Output >= 50, Waste <= 35, Pollution <= 60, Safety >= 55, Energy >= 20.',
    '# Design an industrial production pipeline with clean power and worker safety.',
    '#',
    '# SUGGESTED PROBES:',
    '#   ore(), steel(), goods(), output(), waste(), pollution(), safety(),',
    '#   energy(), money(), workers(), recyclers(), panels()',
    '#',
    '# SUGGESTED ACTIONS:',
    '#   mine(5)            # +5 ore, costs 3 energy, generates waste & pollution, hurts safety',
    '#   smelt(5)           # ore -> steel (1:1), costs 6 energy',
    '#   assemble(5)        # steel -> goods (1:1), costs 4 energy',
    '#   ship(5)            # goods -> output & +12.5k revenue, costs 2 energy',
    '#   hire(1)            # Crew: +0.12 safety/tick passive (-6k now, -0.4k/tick wage)',
    '#   build_recycler()   # Clears 5 waste now and -0.35 waste/tick forever (-18k)',
    '#   recycle(10)        # Burst waste cleaning (-3 energy, -2k, +0.5 safety)',
    '#   solar()            # Clean energy: +4 energy now, +0.7 energy and -0.04 pollution/tick (-18k)',
    '#   grid_power()       # Dirty stopgap: +10 energy, -2k, +3 pollution (guard it!)',
    '',
    'def run_factory():',
    '    while True:',
    '        # Tip: Guard every action with probes to keep machines running reliably',
    '        pass',
    '',
    'run_factory()'
  ].join('\n');

  var suggestions = {
    strategy: [
      'Hire 3-4 crew early: their passive safety bonus (+0.12/tick per worker) compounds over all 80 ticks.',
      'Build a recycler early to passively remove -0.35 waste every tick, preventing landfill overflow.',
      'Shipping goods is your primary source of revenue (+2.5k per unit) — keep the pipeline flowing.',
      'Guard grid_power() with pollution() < 45 and invest in solar panels to offset pollution.'
    ],
    actions: [
      { name: 'mine(5)', text: 'Mines raw ore (-3 energy, +1 waste, -0.8 safety, +0.6 pollution)' },
      { name: 'smelt(5)', text: 'Converts ore into steel (-6 energy, +1.5 waste, +1.75 pollution, -0.5 safety)' },
      { name: 'assemble(5)', text: 'Fabricates goods from steel (-4 energy, +1.25 waste, +0.5 pollution)' },
      { name: 'ship(5)', text: 'Ships finished goods (+12.5k revenue, +5 output, -2 energy)' },
      { name: 'hire(1)', text: 'Hire worker (+0.12 safety/tick passive, -6k now, -0.4k/tick wage)' },
      { name: 'build_recycler()', text: 'Permanent recycler: -0.35 waste/tick passive (-18k)' },
      { name: 'recycle(10)', text: 'Clear 10 waste immediately (-3 energy, -2k, +0.5 safety)' },
      { name: 'solar()', text: 'Install solar panel (+4 energy, +0.7/tick, -0.04 pollution/tick, -18k)' },
      { name: 'grid_power()', text: 'Fast grid electricity (+10 energy, -2k, +3 pollution -- guard it!)' }
    ],
    probes: [
      { name: 'ore()', text: 'Stock of raw ore' },
      { name: 'steel()', text: 'Stock of refined steel' },
      { name: 'goods()', text: 'Stock of assembled goods ready to ship' },
      { name: 'output()', text: 'Total units shipped (target >= 50)' },
      { name: 'waste()', text: 'Industrial byproduct accumulated (keep <= 35)' },
      { name: 'pollution()', text: 'Smog and particulate pollution (keep <= 60)' },
      { name: 'safety()', text: 'Workplace safety index (keep >= 55)' },
      { name: 'energy()', text: 'Factory electrical power reserve' },
      { name: 'money()', text: 'Operating cash budget' },
      { name: 'workers()', text: 'Current active workforce' },
      { name: 'recyclers()', text: 'Count of active recycling facilities' },
      { name: 'panels()', text: 'Count of installed solar arrays' }
    ]
  };

  SDG.Stage2 = {
    id: 'stage2',
    title: 'Stage 2 — Manufacturing',
    subtitle: 'Run a production pipeline: mine, smelt, assemble, ship',
    TICK_LIMIT: 80,
    COLS: COLS,
    ROWS: ROWS,
    snapshotKeys: ['output', 'ore', 'steel', 'goods', 'waste', 'pollution', 'safety',
      'energy', 'money', 'workers', 'panels', 'recyclers'],
    counts: counts,
    criticals: [
      { key: 'energy', text: 'Energy hit 0 — the production line stopped!' }
    ],
    bars: [
      { key: 'output', label: 'Output', max: 80, better: 'high' },
      { key: 'energy', label: 'Energy', max: 100, better: 'high' },
      { key: 'safety', label: 'Safety', max: 100, better: 'high' },
      { key: 'waste', label: 'Waste', max: 100, better: 'low' },
      { key: 'pollution', label: 'Pollution', max: 100, better: 'low' },
      { key: 'money', label: 'Budget', max: 400, better: 'high' },
      { key: 'workers', label: 'Crew', max: 12, better: 'high' }
    ],
    sprite: 'robot',
    createWorld: createWorld,
    applyTick: applyTick,
    api: api,
    goals: goals,
    advice: advice,
    template: template,
    templates: {
      easy: templateEasy,
      medium: template,
      hard: templateHard
    },
    suggestions: suggestions,
    desc: [
      { name: 'mine(n=5)', text: '+n ore. −3 energy, +0.2n waste, −0.8 safety, +0.6 pollution.' },
      { name: 'smelt(n=5)', text: 'ore → steel 1:1. −6 energy, +0.3n waste, +0.35n pollution, −0.1n safety.' },
      { name: 'assemble(n=5)', text: 'steel → goods 1:1. −4 energy, +0.25n waste, +0.1n pollution.' },
      { name: 'ship(n=5)', text: 'goods → output, +2.5k each. −2 energy, +0.15n pollution.' },
      { name: 'recycle(n=10)', text: 'Clear n waste. −3 energy, −2k, +0.5 safety.' },
      { name: 'hire(n=1)', text: 'Crew member: +0.12 safety/tick, costs 6k now + 0.4k/tick.' },
      { name: 'solar()', text: '−18k, +4 energy now, +0.7 energy and −0.04 pollution every tick.' },
      { name: 'build_recycler()', text: '−18k, clears 5 waste now and −0.35 waste/tick forever.' },
      { name: 'grid_power()', text: '+10 energy, −2k, but +3 pollution. Dirty — guard it!' },
      { name: 'Probes', text: 'tick() output() ore() steel() goods() waste() pollution() safety() energy() money() workers() panels() recyclers() free_land()' }
    ]
  };
})(typeof window !== 'undefined' ? window : globalThis);
