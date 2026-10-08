(function (root) {
  'use strict';
  var SDG = (root.SDG = root.SDG || {});
  var clamp = SDG.Metrics.clamp;
  var PyError = SDG.PyError;
  var argNum = SDG.util.argNum;

  var COLS = 14;
  var ROWS = 9;
  var FACTORIES = [[11, 1], [11, 6]];
  var FORESTS = [[4, 2], [6, 4]];

  function makeGrid() {
    var grid = [];
    for (var y = 0; y < ROWS; y++) {
      for (var x = 0; x < COLS; x++) grid.push({ x: x, y: y, type: x === 0 ? 'river' : 'barren' });
    }
    FORESTS.forEach(function (f) { grid[f[1] * COLS + f[0]].type = 'forest'; });
    FACTORIES.forEach(function (f) { grid[f[1] * COLS + f[0]] = { x: f[0], y: f[1], type: 'factory', restricted: false }; });
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
  function needMoney(w, amount) {
    if (w.economy < amount) throw PyError('not enough budget (need ' + amount + ', have ' + Math.floor(w.economy) + ')');
  }
  function place(w, type, n, extra) {
    var placed = 0, last = null;
    for (var i = 0; i < w.grid.length && placed < n; i++) {
      if (w.grid[i].type === 'barren') {
        var t = { x: w.grid[i].x, y: w.grid[i].y, type: type };
        if (extra) Object.keys(extra).forEach(function (k) { t[k] = extra[k]; });
        w.grid[i] = t; last = i; placed++;
      }
    }
    w.lastTile = last;
    return placed;
  }

  function counts(w) {
    return {
      trees: countType(w.grid, 'forest'),
      wetlands: countType(w.grid, 'wetland'),
      filters: countType(w.grid, 'filter'),
      factories: countType(w.grid, 'factory'),
      free: countType(w.grid, 'barren')
    };
  }
  function factoryState(w) {
    var active = 0, restricted = 0;
    w.grid.forEach(function (t) { if (t.type === 'factory') { if (t.restricted) restricted++; else active++; } });
    return { active: active, restricted: restricted };
  }

  function createWorld() {
    var grid = makeGrid();
    return {
      cols: COLS, rows: ROWS, grid: grid,
      tick: 0,
      biodiversity: 45, air: 50, water_quality: 55,
      carbon: 30, soil: 50, economy: 80,
      lastTile: null,
      events: [],
      stats: { actions: {}, rejected: [], criticals: {}, events: [] }
    };
  }

  function applyTick(w) {
    var c = counts(w);
    var f = factoryState(w);

    w.economy += 1.0 + 1.5 * f.active - 0.6 * f.restricted;
    w.air += 0.05 - 0.12 * f.active + 0.06 * c.trees + 0.15 * c.filters;
    w.water_quality += 0.03 - 0.07 * f.active + 0.12 * c.wetlands;
    w.carbon += 0.1 + 0.12 * f.active - 0.05 * c.trees - 0.03 * c.filters - 0.04 * c.wetlands;
    w.biodiversity += -0.03 - 0.05 * f.active + 0.1 * c.trees + 0.1 * c.wetlands;
    w.soil += -0.08 + 0.03 * c.trees;

    w.biodiversity = clamp(w.biodiversity, 0, 100);
    w.air = clamp(w.air, 0, 100);
    w.water_quality = clamp(w.water_quality, 0, 100);
    w.soil = clamp(w.soil, 0, 100);
    w.carbon = clamp(w.carbon, 0, Infinity);
    w.economy = clamp(w.economy, 0, Infinity);
  }

  // ---------------- API ----------------

  var api = {
    tick:          { kind: 'probe', exec: function (w) { return w.tick; } },
    biodiversity:  { kind: 'probe', exec: function (w) { return w.biodiversity; } },
    air:           { kind: 'probe', exec: function (w) { return w.air; } },
    water_quality: { kind: 'probe', exec: function (w) { return w.water_quality; } },
    carbon:        { kind: 'probe', exec: function (w) { return w.carbon; } },
    soil:          { kind: 'probe', exec: function (w) { return w.soil; } },
    economy:       { kind: 'probe', exec: function (w) { return w.economy; } },
    money:         { kind: 'probe', exec: function (w) { return w.economy; } },
    trees:         { kind: 'probe', exec: function (w) { return countType(w.grid, 'forest'); } },
    wetlands:      { kind: 'probe', exec: function (w) { return countType(w.grid, 'wetland'); } },
    filters:       { kind: 'probe', exec: function (w) { return countType(w.grid, 'filter'); } },
    factories:     { kind: 'probe', exec: function (w) { return factoryState(w).active; } },
    restricted:    { kind: 'probe', exec: function (w) { return factoryState(w).restricted; } },
    free_land:     { kind: 'probe', exec: function (w) { return countType(w.grid, 'barren'); } },

    plant_trees: {
      kind: 'action',
      exec: function (w, a) {
        var n = Math.trunc(argNum(a, 'n', 0, 3));
        if (n <= 0) throw PyError("'n' must be positive");
        var free = countType(w.grid, 'barren');
        if (free < n) throw PyError('not enough free land (need ' + n + ', ' + free + ' free)');
        needMoney(w, 4 * n);
        w.economy -= 4 * n;
        w.biodiversity = clamp(w.biodiversity + 1.5 * n, 0, 100);
        place(w, 'forest', n);
        return null;
      }
    },
    clean_river: {
      kind: 'action',
      exec: function (w, a) {
        needMoney(w, 8);
        w.economy -= 8;
        w.water_quality = clamp(w.water_quality + 14, 0, 100);
        w.lastTile = firstOf(w.grid, 'river');
        return null;
      }
    },
    filter_air: {
      kind: 'action',
      exec: function (w, a) {
        var n = Math.trunc(argNum(a, 'n', 0, 1));
        if (n <= 0) throw PyError("'n' must be positive");
        var free = countType(w.grid, 'barren');
        if (free < n) throw PyError('not enough free land for filters');
        needMoney(w, 10 * n);
        w.economy -= 10 * n;
        w.air = clamp(w.air + 6 * n, 0, 100);
        place(w, 'filter', n);
        return null;
      }
    },
    restore_wetland: {
      kind: 'action',
      exec: function (w, a) {
        var n = Math.trunc(argNum(a, 'n', 0, 1));
        if (n <= 0) throw PyError("'n' must be positive");
        var free = countType(w.grid, 'barren');
        if (free < n) throw PyError('not enough free land for a wetland');
        needMoney(w, 12 * n);
        w.economy -= 12 * n;
        w.biodiversity = clamp(w.biodiversity + 4 * n, 0, 100);
        w.water_quality = clamp(w.water_quality + 3 * n, 0, 100);
        place(w, 'wetland', n);
        return null;
      }
    },
    restrict_polluter: {
      kind: 'action',
      exec: function (w) {
        for (var i = w.grid.length - 1; i >= 0; i--) {
          if (w.grid[i].type === 'factory' && !w.grid[i].restricted) {
            w.grid[i].restricted = true;
            w.lastTile = i;
            return null;
          }
        }
        throw PyError('no active factories left to restrict');
      }
    },
    reopen_factory: {
      kind: 'action',
      exec: function (w) {
        for (var i = 0; i < w.grid.length; i++) {
          if (w.grid[i].type === 'factory' && w.grid[i].restricted) {
            w.grid[i].restricted = false;
            w.lastTile = i;
            return null;
          }
        }
        throw PyError('no restricted factories to reopen');
      }
    },
    ban_plastic: {
      kind: 'action',
      exec: function (w, a) {
        needMoney(w, 10);
        w.economy -= 10;
        w.carbon = Math.max(0, w.carbon - 6);
        w.air = clamp(w.air + 4, 0, 100);
        return null;
      }
    }
  };

  // ---------------- goals / grading ----------------

  var goals = [
    { key: 'biodiversity', label: 'Biodiversity', cmp: '>=', target: 60 },
    { key: 'air',          label: 'Air quality',  cmp: '>=', target: 65 },
    { key: 'water_quality',label: 'Water quality',cmp: '>=', target: 65 },
    { key: 'carbon',       label: 'Carbon',       cmp: '<=', target: 55 },
    { key: 'soil',         label: 'Soil health',  cmp: '>=', target: 55 },
    { key: 'economy',      label: 'Economy',      cmp: '>=', target: 60 }
  ];

  var advice = {
    biodiversity: 'Biodiversity ended too low. Each tree gives +0.1/tick and each wetland +0.1/tick forever; plant_trees(3) also grants +1.5 immediately. Factories drain −0.05/tick each — consider restrict_polluter().',
    air: 'Air quality fell short. Each active factory drains −0.12/tick; filter_air() adds +0.15/tick and +6 immediately for 10k. restrict_polluter() stops a factory\'s damage at a cost of 0.6k economy/tick.',
    water_quality: 'Water fell short. The river decays −0.07/tick per active factory. clean_river() gives +14 now (8k) and wetlands add +0.12/tick — combine both.',
    carbon: 'Carbon exceeded the cap. Trees (−0.05/tick), filters (−0.03) and wetlands (−0.04) all pull carbon down; each active factory pushes +0.12/tick. ban_plastic() cuts 6 instantly for 10k.',
    soil: 'Soil health fell short. Soil decays 0.08/tick; every tree restores +0.03/tick. Plant early — the bonus compounds over 80 ticks.',
    economy: 'Economy fell below 60. You earn +1/tick baseline plus 1.5 per active factory, minus 0.6 per restricted one. Restricting BOTH factories without restoring services will bankrupt you — keep one running while nature recovers.',
    money: 'Budget hit zero. Keep at least one factory active for income, then spend surplus on trees (4k), filters (10k) and wetlands (12k).',
    rejected: 'An action was rejected (unaffordable) and stopped your program. Guard with money().',
    endedEarly: 'Your program ended before tick 80 and the ecosystem decayed on its own. Use a while True: maintenance loop.',
    noActions: 'You never called an action. Start with plant_trees(3) and restrict_polluter().'
  };

  var template = [
    '# SDG Stage 3 — Environment',
    '# Restore nature while keeping the economy alive:',
    '# biodiversity >= 60, air >= 65, water >= 65, carbon <= 55, soil >= 55, economy >= 60',
    '',
    'def steward():',
    '    while True:',
    '        # green the land',
    '        if trees() < 6 and money() >= 13 and free_land() > 0:',
    '            plant_trees(3)',
    '        if water_quality() < 60 and money() >= 8:',
    '            clean_river()',
    '',
    '        # industry first — the factories pay for everything',
    '        if money() < 60 and restricted() > 0:',
    '            reopen_factory()',
    '',
    'steward()'
  ].join('\n');

  SDG.Stage3 = {
    id: 'stage3',
    title: 'Stage 3 — Environment',
    subtitle: 'Balance ecosystem restoration against a working economy',
    TICK_LIMIT: 80,
    COLS: COLS,
    ROWS: ROWS,
    snapshotKeys: ['biodiversity', 'air', 'water_quality', 'carbon', 'soil', 'economy',
      'trees', 'wetlands', 'filters', 'factories'],
    counts: counts,
    criticals: [],
    bars: [
      { key: 'biodiversity', label: 'Biodiversity', max: 100, better: 'high' },
      { key: 'air', label: 'Air', max: 100, better: 'high' },
      { key: 'water_quality', label: 'Water', max: 100, better: 'high' },
      { key: 'carbon', label: 'Carbon', max: 100, better: 'low' },
      { key: 'soil', label: 'Soil', max: 100, better: 'high' },
      { key: 'economy', label: 'Economy', max: 300, better: 'high' }
    ],
    sprite: 'ranger',
    createWorld: createWorld,
    applyTick: applyTick,
    api: api,
    goals: goals,
    advice: advice,
    template: template,
    desc: [
      { name: 'plant_trees(n=3)', text: '−4k each, +1.5 biodiversity now, then +0.1 bio, +0.06 air, −0.05 carbon, +0.03 soil per tick.' },
      { name: 'clean_river()', text: '−8k, +14 water quality immediately.' },
      { name: 'filter_air(n=1)', text: '−10k each, +6 air now, then +0.15 air and −0.03 carbon/tick.' },
      { name: 'restore_wetland(n=1)', text: '−12k each, +4 bio / +3 water now, then +0.1 bio, +0.12 water, −0.04 carbon/tick.' },
      { name: 'restrict_polluter()', text: 'Shut a factory: stops its pollution, but −0.6k economy/tick.' },
      { name: 'reopen_factory()', text: 'Restart a restricted factory: +1.5k economy/tick, pollution returns.' },
      { name: 'ban_plastic()', text: '−10k, −6 carbon, +4 air in one call.' },
      { name: 'Probes', text: 'tick() biodiversity() air() water_quality() carbon() soil() economy() money() trees() wetlands() filters() factories() restricted() free_land()' }
    ]
  };
})(typeof window !== 'undefined' ? window : globalThis);
