(function (root) {
  'use strict';
  var SDG = (root.SDG = root.SDG || {});
  var clamp = SDG.Metrics.clamp;
  var PyError = SDG.PyError;
  var arg = SDG.util.arg;
  var argNum = SDG.util.argNum;
  var argStr = SDG.util.argStr;

  var COLS = 14;
  var ROWS = 9;

  var CROPS = {
    wheat:    { cost: 5, rate: 0.35, emissions: 0.4, label: 'wheat' },
    vegetable:{ cost: 7, rate: 0.60, emissions: 0.5, label: 'vegetable' },
    fruit:    { cost: 6, rate: 0.50, emissions: 0.45, label: 'fruit' }
  };

  function makeGrid() {
    var grid = [];
    for (var y = 0; y < ROWS; y++) {
      for (var x = 0; x < COLS; x++) {
        grid.push({ x: x, y: y, type: x === 0 ? 'river' : 'dirt', crop: null });
      }
    }
    return grid;
  }

  function firstOf(grid, type) {
    for (var i = 0; i < grid.length; i++) if (grid[i].type === type) return i;
    return -1;
  }
  function countType(grid, type) {
    var n = 0;
    for (var i = 0; i < grid.length; i++) if (grid[i].type === type) n++;
    return n;
  }

  function need(w, key, amount, msg) {
    if (w[key] < amount) throw PyError(msg + ' (need ' + amount + ' ' + key + ', have ' + Math.floor(w[key]) + ')');
  }
  function needMoney(w, amount) {
    if (w.money < amount) throw PyError('not enough budget (need ' + amount + ', have ' + Math.floor(w.money) + ')');
  }

  // ---------------- world ----------------

  function createWorld() {
    var grid = makeGrid();
    grid[2 * COLS + 3] = { x: 3, y: 2, type: 'shelter', crop: null }; // one starter house
    var w = {
      cols: COLS, rows: ROWS, grid: grid,
      tick: 0,
      population: 100,
      hydration: 65, nutrition: 60, shelter: 30, energy: 50,
      money: 120, emissions: 8, morale: 50,
      water_reserve: 20, food_reserve: 15,
      lastTile: null,
      events: [],
      stats: { actions: {}, rejected: [], criticals: {}, events: [] }
    };
    w.morale = computeMorale(w);
    return w;
  }

  function computeMorale(w) {
    var needs = (w.hydration + w.nutrition + w.shelter) / 3;
    var e = clamp(w.energy, 0, 100);
    var clean = 100 - clamp(w.emissions, 0, 100);
    return clamp(0.5 * needs + 0.25 * e + 0.25 * clean, 0, 100);
  }

  function counts(w) {
    return { farms: countType(w.grid, 'farm'), shelters: countType(w.grid, 'shelter'), panels: countType(w.grid, 'panel') };
  }

  function applyTick(w) {
    // population consumes
    w.hydration -= 1.5;
    w.nutrition -= 1.2;
    w.shelter -= 0.5;      // wear and tear
    w.energy -= 0.8;       // baseline demand

    // stores degrade
    w.water_reserve -= 0.4;  // evaporation
    w.food_reserve -= 0.4;   // spoilage

    // passive production
    var farmRate = 0;
    w.grid.forEach(function (t) {
      if (t.type === 'farm' && t.crop) farmRate += CROPS[t.crop].rate;
    });
    w.food_reserve += farmRate;

    var c = counts(w);
    w.shelter += 0.15 * c.shelters;
    w.energy += 0.5 * c.panels;
    w.money += 2.5; // community budget income

    // emissions: baseline footprint, offset by renewables
    w.emissions += 0.12 - 0.06 * c.panels;

    // clamp
    w.hydration = clamp(w.hydration, 0, 100);
    w.nutrition = clamp(w.nutrition, 0, 100);
    w.shelter = clamp(w.shelter, 0, 100);
    w.energy = clamp(w.energy, 0, 100);
    w.money = clamp(w.money, 0, Infinity);
    w.emissions = clamp(w.emissions, 0, Infinity);
    w.water_reserve = clamp(w.water_reserve, 0, 100);
    w.food_reserve = clamp(w.food_reserve, 0, 100);
    w.morale = computeMorale(w);
  }

  // ---------------- API ----------------

  var api = {
    // ---- probes (read-only) ----
    tick:          { kind: 'probe', exec: function (w) { return w.tick; } },
    population:    { kind: 'probe', exec: function (w) { return w.population; } },
    hydration:     { kind: 'probe', exec: function (w) { return w.hydration; } },
    nutrition:     { kind: 'probe', exec: function (w) { return w.nutrition; } },
    shelter:       { kind: 'probe', exec: function (w) { return w.shelter; } },
    energy:        { kind: 'probe', exec: function (w) { return w.energy; } },
    money:         { kind: 'probe', exec: function (w) { return w.money; } },
    emissions:     { kind: 'probe', exec: function (w) { return w.emissions; } },
    morale:        { kind: 'probe', exec: function (w) { return w.morale; } },
    water_reserve: { kind: 'probe', exec: function (w) { return w.water_reserve; } },
    food_reserve:  { kind: 'probe', exec: function (w) { return w.food_reserve; } },
    farms:         { kind: 'probe', exec: function (w) { return countType(w.grid, 'farm'); } },
    shelters:      { kind: 'probe', exec: function (w) { return countType(w.grid, 'shelter'); } },
    panels:        { kind: 'probe', exec: function (w) { return countType(w.grid, 'panel'); } },
    free_land:     { kind: 'probe', exec: function (w) { return countType(w.grid, 'dirt'); } },

    // ---- actions ----
    pump_water: {
      kind: 'action',
      exec: function (w, a) {
        var units = argNum(a, 'units', 0, 10);
        if (units <= 0) throw PyError("'units' must be positive");
        if (units > 60) units = 60;
        need(w, 'energy', 4, 'not enough energy to pump');
        needMoney(w, 1);
        w.energy -= 4;
        w.money -= 1;
        w.emissions += 0.5;
        w.water_reserve += units;
        w.water_reserve = clamp(w.water_reserve, 0, 100);
        w.lastTile = firstOf(w.grid, 'river');
        return null;
      }
    },
    plant: {
      kind: 'action',
      exec: function (w, a) {
        var cropName = argStr(a, 'crop', 0, 'wheat');
        var plots = Math.trunc(argNum(a, 'plots', 1, 1));
        if (plots <= 0) throw PyError("'plots' must be positive");
        var crop = CROPS[cropName];
        if (!crop) throw PyError("unknown crop '" + cropName + "' — use wheat, vegetable or fruit");
        var free = countType(w.grid, 'dirt');
        if (free < plots) throw PyError('not enough free land (need ' + plots + ' plots, ' + free + ' free)');
        needMoney(w, crop.cost * plots);
        need(w, 'energy', 2, 'not enough energy to plant');
        w.money -= crop.cost * plots;
        w.energy -= 2;
        w.emissions += crop.emissions * plots;
        var placed = 0;
        for (var i = 0; i < w.grid.length && placed < plots; i++) {
          if (w.grid[i].type === 'dirt') {
            w.grid[i] = { x: w.grid[i].x, y: w.grid[i].y, type: 'farm', crop: cropName };
            placed++;
          }
        }
        w.lastTile = w.grid.indexOf(w.grid.filter(function (t) { return t.type === 'farm'; }).pop());
        return null;
      }
    },
    build_shelter: {
      kind: 'action',
      exec: function (w, a) {
        var n = Math.trunc(argNum(a, 'n', 0, 1));
        if (n <= 0) throw PyError("'n' must be positive");
        var free = countType(w.grid, 'dirt');
        if (free < n) throw PyError('not enough free land for shelter');
        needMoney(w, 12 * n);
        need(w, 'energy', 5, 'not enough energy to build');
        w.money -= 12 * n;
        w.energy -= 5;
        w.emissions += 1.0;
        w.shelter = clamp(w.shelter + 10 * n, 0, 100);
        var placed = 0, last = null;
        for (var i = 0; i < w.grid.length && placed < n; i++) {
          if (w.grid[i].type === 'dirt') {
            w.grid[i] = { x: w.grid[i].x, y: w.grid[i].y, type: 'shelter', crop: null };
            last = i; placed++;
          }
        }
        w.lastTile = last;
        return null;
      }
    },
    solar_panel: {
      kind: 'action',
      exec: function (w, a) {
        if (countType(w.grid, 'dirt') < 1) throw PyError('not enough free land for a solar panel');
        needMoney(w, 15);
        w.money -= 15;
        w.emissions += 1; // manufacturing footprint
        w.energy += 4;    // quick install boost
        w.energy = clamp(w.energy, 0, 100);
        var idx = firstOf(w.grid, 'dirt');
        w.grid[idx] = { x: w.grid[idx].x, y: w.grid[idx].y, type: 'panel', crop: null };
        w.lastTile = idx;
        return null;
      }
    },
    burn_fuel: {
      kind: 'action',
      exec: function (w, a) {
        needMoney(w, 2);
        w.money -= 2;
        w.energy += 12;
        w.energy = clamp(w.energy, 0, 100);
        w.emissions += 4; // dirty but cheap
        return null;
      }
    },
    distribute: {
      kind: 'action',
      exec: function (w, a) {
        var kind = argStr(a, 'kind', 0, 'water');
        var amount = argNum(a, 'amount', 1, 20);
        if (amount <= 0) throw PyError("'amount' must be positive");
        need(w, 'energy', 1, 'not enough energy to distribute');
        w.energy -= 1;
        w.emissions += 0.15;
        if (kind === 'water') {
          if (w.water_reserve <= 0) throw PyError('water store is empty — pump_water() first');
          var sentW = Math.min(amount, w.water_reserve);
          w.water_reserve -= sentW;
          w.hydration += sentW * 0.7;
        } else if (kind === 'food') {
          if (w.food_reserve <= 0) throw PyError('food store is empty — plant() first');
          var sentF = Math.min(amount, w.food_reserve);
          w.food_reserve -= sentF;
          w.nutrition += sentF * 0.6;
        } else {
          throw PyError("kind must be 'water' or 'food'");
        }
        w.hydration = clamp(w.hydration, 0, 100);
        w.nutrition = clamp(w.nutrition, 0, 100);
        return null;
      }
    }
  };

  // ---------------- goals / grading ----------------

  var goals = [
    { key: 'hydration', label: 'Hydration', cmp: '>=', target: 60 },
    { key: 'nutrition', label: 'Nutrition', cmp: '>=', target: 60 },
    { key: 'shelter',   label: 'Shelter',   cmp: '>=', target: 60 },
    { key: 'energy',    label: 'Energy',    cmp: '>=', target: 40 },
    { key: 'emissions', label: 'Emissions', cmp: '<=', target: 45 },
    { key: 'morale',    label: 'Morale',    cmp: '>=', target: 50 }
  ];

  var advice = {
    hydration: 'Hydration ended too low. Call pump_water() to refill the store and distribute("water", 25) every few ticks — population drains ~1.5 hydration per tick.',
    nutrition: 'Nutrition ended too low. plant("vegetable", 2) grows food fastest, then distribute("food", 25) regularly. Food store spoils 0.4 per tick, so do not overstock.',
    shelter: 'Shelter ended too low. build_shelter(1) adds +10 now and a small passive bonus; wear and tear removes 0.5 per tick, so keep building.',
    energy: 'Energy ran out. burn_fuel() is instant but dirty (+4 emissions each); solar_panel() costs 15k but gives +4 energy now and +0.5 per tick forever. Guard every action with energy().',
    emissions: 'Emissions exceeded the cap. Each burn_fuel() adds +4 CO2e — guard it with emissions() < 40 so you only burn when you must, and invest in solar_panel() (each panel pulls -0.06 CO2e per tick).',
    morale: 'Morale is derived from hydration, nutrition, shelter, energy and emissions. Meet all needs above 70 and keep emissions below 45.',
    money: 'Budget hit zero. You earn +2.5k per tick; pump_water only costs 1k, but shelters (12k) and panels (15k) need saving up.',
    critical: 'A critical need hit 0 during the run. Guard your loop with thresholds (e.g. while hydration() < 40) BEFORE a resource is empty, not after.',
    rejected: 'Some actions were rejected because you could not afford them (an unaffordable action stops your program). Check money()/energy() first.',
    endedEarly: 'Your program finished before the simulation ended, so the world kept running without you. Wrap your logic in a maintenance loop (while True: ...) that lasts the whole run.',
    noActions: 'You never called an action, so nothing changed and all needs decayed. Start with pump_water(10) and distribute("water", 25).'
  };

  var template = [
    '# SDG Stage 1 — Basic Needs',
    '# Keep hydration / nutrition / shelter >= 60, emissions <= 45 at tick 80.',
    '# Every action has a cost: watch energy, budget and emissions.',
    '',
    'def maintain():',
    '    while True:',
    '        # 1) keep water pumped and delivered',
    '        if water_reserve() < 40 and energy() > 5:',
    '            pump_water(10)          # costs energy, budget, emissions',
    '        if hydration() < 75 and water_reserve() >= 25 and energy() > 2:',
    '            distribute("water", 25)',
    '',
    '        # 2) grow and deliver food',
    '        if food_reserve() < 50 and money() >= 7 and energy() > 2 and free_land() > 0:',
    '            plant("vegetable", 1)   # vegetable = more food, more cost',
    '        if nutrition() < 75 and food_reserve() >= 25 and energy() > 2:',
    '            distribute("food", 25)',
    '',
    '        # 3) shelter, power and budget',
    '        if shelter() < 78 and money() >= 12 and energy() > 5:',
    '            build_shelter(1)',
    '        if energy() < 45 and money() >= 15 and free_land() > 0:',
    '            solar_panel()           # clean but slow',
    '        if energy() < 30 and money() >= 2:',
    '            burn_fuel()             # fast, but +4 emissions each time',
    '',
    'maintain()'
  ].join('\n');

  SDG.Stage1 = {
    id: 'stage1',
    title: 'Stage 1 — Basic Needs',
    subtitle: 'Automate water, food, shelter and energy distribution',
    TICK_LIMIT: 80,
    COLS: COLS,
    ROWS: ROWS,
    snapshotKeys: ['hydration', 'nutrition', 'shelter', 'energy', 'money', 'emissions',
      'water_reserve', 'food_reserve', 'farms', 'shelters', 'panels'],
    counts: counts,
    criticals: [
      { key: 'hydration', text: 'Hydration hit 0 — people went without water!' },
      { key: 'nutrition', text: 'Nutrition hit 0 — food ran out!' },
      { key: 'shelter', text: 'Shelter hit 0 — housing failed!' },
      { key: 'energy', text: 'Energy hit 0 — grid went dark!' }
    ],
    bars: [
      { key: 'hydration', label: 'Hydration', max: 100, better: 'high' },
      { key: 'nutrition', label: 'Nutrition', max: 100, better: 'high' },
      { key: 'shelter', label: 'Shelter', max: 100, better: 'high' },
      { key: 'energy', label: 'Energy', max: 100, better: 'high' },
      { key: 'money', label: 'Budget', max: 300, better: 'high' },
      { key: 'emissions', label: 'Emissions', max: 100, better: 'low' },
      { key: 'morale', label: 'Morale', max: 100, better: 'high' }
    ],
    sprite: 'robot',
    createWorld: createWorld,
    applyTick: applyTick,
    api: api,
    goals: goals,
    advice: advice,
    template: template,
    desc: [
      { name: 'pump_water(units=10)', text: 'Fill the water store. −4 energy, −1k, +0.5 CO2e.' },
      { name: 'plant(crop="wheat", plots=1)', text: 'Build farms (wheat/vegetable/fruit). Costs land, budget, energy.' },
      { name: 'distribute(kind, amount=20)', text: 'Deliver water/food from store to people (partial if store is low). −1 energy, +0.15 CO2e.' },
      { name: 'build_shelter(n=1)', text: '+10 shelter now, +0.15/tick. −12k each, −5 energy, +1 CO2e.' },
      { name: 'solar_panel()', text: '−15k, +1 CO2e and +4 energy now; then +0.5 energy and −0.06 CO2e every tick.' },
      { name: 'burn_fuel()', text: '+12 energy instantly, but −2k and +4 CO2e.' },
      { name: 'Probes', text: 'tick() hydration() nutrition() shelter() energy() money() emissions() morale() water_reserve() food_reserve() farms() shelters() panels() free_land()' }
    ]
  };
})(typeof window !== 'undefined' ? window : globalThis);
