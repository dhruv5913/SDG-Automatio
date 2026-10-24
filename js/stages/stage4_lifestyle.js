(function (root) {
  'use strict';
  var SDG = (root.SDG = root.SDG || {});
  var clamp = SDG.Metrics.clamp;
  var PyError = SDG.PyError;
  var argNum = SDG.util.argNum;
  var argStr = SDG.util.argStr;

  var COLS = 14;
  var ROWS = 9;

  function makeGrid() {
    var grid = [];
    for (var y = 0; y < ROWS; y++) {
      for (var x = 0; x < COLS; x++) grid.push({ x: x, y: y, type: 'floor' });
    }
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
    if (w.money < amount) throw PyError('not enough budget (need ' + amount + ', have ' + Math.floor(w.money) + ')');
  }
  function needDiscipline(w, amount) {
    if (w.discipline < amount) throw PyError('not enough discipline (need ' + amount + ', have ' + Math.floor(w.discipline) + ')');
  }
  function place(w, type, cost) {
    if (countType(w.grid, 'floor') < 1) throw PyError('not enough free space');
    needMoney(w, cost);
    w.money -= cost;
    var idx = firstOf(w.grid, 'floor');
    w.grid[idx] = { x: w.grid[idx].x, y: w.grid[idx].y, type: type };
    w.lastTile = idx;
    return null;
  }

  function counts(w) {
    return {
      gyms: countType(w.grid, 'gym'),
      parks: countType(w.grid, 'park'),
      kitchens: countType(w.grid, 'kitchen'),
      free: countType(w.grid, 'floor')
    };
  }

  function createWorld() {
    var grid = makeGrid();
    return {
      cols: COLS, rows: ROWS, grid: grid,
      tick: 0,
      sleep: 65, nutrition: 60, fitness: 45,
      stress: 40, focus: 55, screen: 20,
      discipline: 80, money: 80,
      lastTile: null,
      events: [],
      stats: { actions: {}, rejected: [], criticals: {}, events: [] }
    };
  }

  function applyTick(w) {
    var c = counts(w);

    w.sleep -= 1.0;
    w.nutrition -= 0.75;
    w.fitness -= 0.5;
    w.focus -= 0.3;
    w.stress += 0.5 + 0.005 * w.screen;
    w.screen += 0.1;            // bad habits creep back
    w.discipline -= 0.5;
    w.money -= 0.15;            // living costs

    w.fitness += 0.15 * c.gyms;
    w.stress -= 0.1 * c.parks;
    w.fitness += 0.05 * c.parks;
    w.nutrition += 0.1 * c.kitchens;

    w.sleep = clamp(w.sleep, 0, 100);
    w.nutrition = clamp(w.nutrition, 0, 100);
    w.fitness = clamp(w.fitness, 0, 100);
    w.stress = clamp(w.stress, 0, 100);
    w.focus = clamp(w.focus, 0, 100);
    w.screen = clamp(w.screen, 0, 100);
    w.discipline = clamp(w.discipline, 0, 100);
    w.money = clamp(w.money, 0, Infinity);
  }

  // ---------------- API ----------------

  var api = {
    tick:       { kind: 'probe', exec: function (w) { return w.tick; } },
    sleep:      { kind: 'probe', exec: function (w) { return w.sleep; } },
    nutrition:  { kind: 'probe', exec: function (w) { return w.nutrition; } },
    fitness:    { kind: 'probe', exec: function (w) { return w.fitness; } },
    stress:     { kind: 'probe', exec: function (w) { return w.stress; } },
    focus:      { kind: 'probe', exec: function (w) { return w.focus; } },
    screen:     { kind: 'probe', exec: function (w) { return w.screen; } },
    discipline: { kind: 'probe', exec: function (w) { return w.discipline; } },
    money:      { kind: 'probe', exec: function (w) { return w.money; } },
    gyms:       { kind: 'probe', exec: function (w) { return countType(w.grid, 'gym'); } },
    parks:      { kind: 'probe', exec: function (w) { return countType(w.grid, 'park'); } },
    kitchens:   { kind: 'probe', exec: function (w) { return countType(w.grid, 'kitchen'); } },
    free_land:  { kind: 'probe', exec: function (w) { return countType(w.grid, 'floor'); } },

    sleep_for: {
      kind: 'action',
      exec: function (w, a) {
        var hours = argNum(a, 'hours', 0, 8);
        if (hours < 4 || hours > 10) throw PyError("'hours' must be between 4 and 10");
        w.sleep = clamp(w.sleep + 30 * (hours / 8), 0, 100);
        w.stress = clamp(w.stress - 6, 0, 100);
        w.discipline = clamp(w.discipline + 10, 0, 100);
        w.focus = clamp(w.focus + 4, 0, 100);
        w.lastTile = firstOf(w.grid, 'floor');
        return null;
      }
    },
    cook: {
      kind: 'action',
      exec: function (w, a) {
        var meal = argStr(a, 'meal', 0, 'balanced');
        if (meal === 'balanced') {
          needMoney(w, 4);
          w.money -= 4;
          w.nutrition = clamp(w.nutrition + 12, 0, 100);
          w.discipline = clamp(w.discipline - 2, 0, 100);
        } else if (meal === 'fast') {
          needMoney(w, 1);
          w.money -= 1;
          w.nutrition = clamp(w.nutrition + 5, 0, 100);
          w.stress = clamp(w.stress + 1, 0, 100);
        } else {
          throw PyError("meal must be 'balanced' or 'fast'");
        }
        w.lastTile = firstOf(w.grid, 'floor');
        return null;
      }
    },
    exercise: {
      kind: 'action',
      exec: function (w, a) {
        var mins = argNum(a, 'mins', 0, 30);
        if (mins < 10) throw PyError("'mins' must be at least 10");
        needDiscipline(w, 3);
        w.discipline -= 3;
        var gain = countType(w.grid, 'gym') > 0 ? 7 : 4;
        w.fitness = clamp(w.fitness + gain, 0, 100);
        w.stress = clamp(w.stress - 4, 0, 100);
        w.sleep = clamp(w.sleep + 1, 0, 100);
        w.nutrition = clamp(w.nutrition - 2, 0, 100);
        w.lastTile = firstOf(w.grid, 'gym') >= 0 ? firstOf(w.grid, 'gym') : null;
        return null;
      }
    },
    meditate: {
      kind: 'action',
      exec: function (w, a) {
        var mins = argNum(a, 'mins', 0, 10);
        if (mins < 5) throw PyError("'mins' must be at least 5");
        needDiscipline(w, 2);
        w.discipline -= 2;
        w.stress = clamp(w.stress - 8, 0, 100);
        w.focus = clamp(w.focus + 3, 0, 100);
        w.lastTile = firstOf(w.grid, 'park') >= 0 ? firstOf(w.grid, 'park') : null;
        return null;
      }
    },
    work: {
      kind: 'action',
      exec: function (w, a) {
        var hours = argNum(a, 'hours', 0, 2);
        if (hours < 1 || hours > 4) throw PyError("'hours' must be between 1 and 4");
        w.money += 2.5 * hours;
        w.focus = clamp(w.focus - 2, 0, 100);
        w.stress = clamp(w.stress + 3, 0, 100);
        w.sleep = clamp(w.sleep - 1, 0, 100);
        return null;
      }
    },
    screen_time: {
      kind: 'action',
      exec: function (w, a) {
        var hours = argNum(a, 'hours', 0, 1);
        if (hours < 1 || hours > 3) throw PyError("'hours' must be between 1 and 3");
        w.screen += 7 * hours;
        w.stress = clamp(w.stress - 3 * hours, 0, 100);
        w.focus = clamp(w.focus - 2 * hours, 0, 100);
        w.sleep = clamp(w.sleep - 1, 0, 100);
        w.screen = clamp(w.screen, 0, 100);
        return null;
      }
    },
    buy_gym: {
      kind: 'action',
      exec: function (w) { return place(w, 'gym', 20); }
    },
    buy_park: {
      kind: 'action',
      exec: function (w) { return place(w, 'park', 25); }
    },
    buy_kitchen: {
      kind: 'action',
      exec: function (w) { return place(w, 'kitchen', 18); }
    }
  };

  // ---------------- goals / grading ----------------

  var goals = [
    { key: 'sleep',      label: 'Sleep',      cmp: '>=', target: 60 },
    { key: 'nutrition',  label: 'Nutrition',  cmp: '>=', target: 60 },
    { key: 'fitness',    label: 'Fitness',    cmp: '>=', target: 55 },
    { key: 'stress',     label: 'Stress',     cmp: '<=', target: 40 },
    { key: 'focus',      label: 'Focus',      cmp: '>=', target: 45 },
    { key: 'screen',     label: 'Screen time',cmp: '<=', target: 45 }
  ];

  var advice = {
    sleep: 'Sleep ended too low. It decays 1.0/tick — call sleep_for(8) whenever sleep() drops below ~70 (+30 each, also −6 stress, +10 discipline).',
    nutrition: 'Nutrition ended too low. cook("balanced") gives +12 for 4k; cook("fast") is cheap but adds stress. buy_kitchen() adds +0.1/tick forever for 18k.',
    fitness: 'Fitness ended too low. It decays 0.5/tick; exercise(30) gives +4 (7 with a gym) but costs 3 discipline. buy_gym() makes every workout stronger and adds +0.15/tick.',
    stress: 'Stress stayed above 40. meditate(10) is the strongest reducer (−8, costs 2 discipline); screen_time() gives −3 but pushes the screen-time goal up and focus down. parks reduce stress −0.1/tick.',
    focus: 'Focus ended too low. It decays 0.3/tick and work()/screen_time() drain it. sleep_for() and meditate() restore focus — rest is productive.',
    screen: 'Screen time exceeded 45. It creeps +0.1/tick and each screen_time(1) adds +7. It is cheap stress relief — budget it (1–2 calls per run), or use meditate() instead.',
    discipline: 'Discipline hit 0 and your program crashed. sleep_for() restores +10; exercise (−3) and meditate (−2) spend it. Guard workouts: if discipline() > 5: exercise(30).',
    money: 'Budget hit zero. work(2) earns +5k but costs focus and stress — earn early, spend on healthy infrastructure.',
    rejected: 'An action was rejected because you could not afford it (or lacked discipline) and stopped your program. Guard with money()/discipline().',
    endedEarly: 'Your program finished before day 3 ended. Keep a while True: loop running the whole simulation.',
    noActions: 'You never called an action. Start with sleep_for(8), cook("balanced"), exercise(30).'
  };

  var template = [
    '# SDG Stage 4 — Healthy Lifestyle',
    '# 3 days (72 ticks): sleep >= 60, nutrition >= 60, fitness >= 55,',
    '# stress <= 40, focus >= 45, screen time <= 45.',
    '',
    'def live_well():',
    '    while True:',
    '        # rest and food',
    '        if sleep() < 70:',
    '            sleep_for(8)',
    '        if nutrition() < 75 and money() > 6:',
    '            cook("balanced")',
    '',
    '        # fitness and mindset',
    '        if discipline() > 8 and fitness() < 85:',
    '            exercise(30)',
    '        if stress() > 55 and discipline() > 3:',
    '            meditate(10)',
    '',
    '        # quick stress relief — handy, but watch the habit grow',
    '        if stress() > 45:',
    '            screen_time(1)',
    '',
    '        # income',
    '        if money() < 35 and money() > 8:',
    '            work(2)',
    '',
    '        # infrastructure',
    '        if gyms() == 0 and money() >= 24:',
    '            buy_gym()',
    '        if parks() == 0 and money() >= 29:',
    '            buy_park()',
    '',
    'live_well()'
  ].join('\n');

  var templateEasy = [
    '# SDG Stage 4 — Healthy Lifestyle (Starter Code)',
    '# Current Rating: Grade D (Score ~47/100, Needs work).',
    '# Objective: Upgrade this life schedule to achieve Grade A (Score >= 85)!',
    '#',
    '# Flaws in this starter code:',
    '#   - Relies on cheap screen time for quick stress relief, causing mental fatigue & screen overload.',
    '#   - Never exercises (no exercise() or walk()), leading to poor physical fitness (< 55).',
    '#   - Relies purely on fast food cooking instead of balanced or healthy meals.',
    '',
    'def play():',
    '    while True:',
    '        # 1) Sleep when exhausted',
    '        if sleep() < 60:',
    '            sleep_for(6)',
    '',
    '        # 2) Quick fast food',
    '        if nutrition() < 60 and money() >= 3:',
    '            cook("fast")',
    '',
    '        # 3) Work for basic income',
    '        if money() < 50:',
    '            work(2)',
    '',
    '        # 4) Cheap screen time instead of exercise, causing mental health to suffer!',
    '        if stress() > 40:',
    '            screen_time(2)',
    '',
    'play()'
  ].join('\n');

  var templateHard = [
    '# SDG Stage 4 — Healthy Lifestyle (Hard Mode)',
    '# Objective: Sleep >= 60, Nutrition >= 60, Fitness >= 55, Stress <= 40, Focus >= 45, Screen <= 45.',
    '# Automate 3 days of life balance from scratch!',
    '#',
    '# SUGGESTED PROBES:',
    '#   sleep(), nutrition(), fitness(), stress(), focus(), screen(),',
    '#   discipline(), money(), gyms(), parks(), kitchens()',
    '#',
    '# SUGGESTED ACTIONS:',
    '#   sleep_for(8)       # Restores +30 sleep, -6 stress, +10 discipline, +4 focus',
    '#   cook("balanced")   # +12 nutrition, -2 discipline, -4k budget',
    '#   cook("fast")       # +5 nutrition, +1 stress, -1k budget',
    '#   exercise(30)       # +4 fitness (7 with gym), -4 stress, +1 sleep, -2 nutrition, -3 discipline',
    '#   meditate(10)       # -8 stress, +3 focus, -2 discipline (best stress reducer!)',
    '#   work(2)            # +5k earnings, -2 focus, +3 stress, -1 sleep',
    '#   screen_time(1)     # -3 stress, +7 screen time, -2 focus, -1 sleep (use sparingly!)',
    '#   buy_gym()          # Workout boost +7 fitness & +0.15 fitness/tick (-20k)',
    '#   buy_park()         # Passively lowers stress by -0.1/tick (-25k)',
    '#   buy_kitchen()      # Passively adds +0.1 nutrition/tick (-18k)',
    '',
    'def live_well():',
    '    while True:',
    '        # Tip: Guard workouts with discipline() > 5 to prevent motivation collapse',
    '        pass',
    '',
    'live_well()'
  ].join('\n');

  var suggestions = {
    strategy: [
      'Discipline is your operating energy: sleep_for(8) restores +10 discipline; exercise and meditate spend it.',
      'Never let discipline hit 0 or motivation collapses and your script crashes!',
      'Meditate instead of screen_time to control stress: screen_time hurts focus and drives screen time over 45.',
      'Work a few shifts early to afford a gym (-20k) and park (-25k) for passive benefits across all 3 days.'
    ],
    actions: [
      { name: 'sleep_for(8)', text: 'Sleep 8 hours: +30 sleep, -6 stress, +10 discipline, +4 focus' },
      { name: 'cook("balanced")', text: 'Cook wholesome meal: +12 nutrition, -2 discipline (-4k)' },
      { name: 'exercise(30)', text: 'Physical training: +4 fitness (7 with gym), -4 stress, -3 discipline' },
      { name: 'meditate(10)', text: 'Mindfulness session: -8 stress, +3 focus, -2 discipline' },
      { name: 'work(2)', text: 'Job shift: +5k budget income, -2 focus, +3 stress, -1 sleep' },
      { name: 'screen_time(1)', text: 'Casual screen entertainment: -3 stress, +7 screen, -2 focus (danger!)' },
      { name: 'buy_gym()', text: 'Home gym: +7 fitness per workout and +0.15 fitness/tick passive (-20k)' },
      { name: 'buy_park()', text: 'Community park: -0.1 stress/tick passive forever (-25k)' },
      { name: 'buy_kitchen()', text: 'Kitchen upgrade: +0.1 nutrition/tick passive forever (-18k)' }
    ],
    probes: [
      { name: 'sleep()', text: 'Rest and sleep percentage (target >= 60)' },
      { name: 'nutrition()', text: 'Nutritional wellness (target >= 60)' },
      { name: 'fitness()', text: 'Physical conditioning index (target >= 55)' },
      { name: 'stress()', text: 'Mental fatigue and anxiety (keep <= 40)' },
      { name: 'focus()', text: 'Attention and productivity capacity (target >= 45)' },
      { name: 'screen()', text: 'Cumulative digital screen time (keep <= 45)' },
      { name: 'discipline()', text: 'Willpower reserve -- never let hit 0!' },
      { name: 'money()', text: 'Available personal savings' },
      { name: 'gyms()', text: 'Count of installed gym equipment' },
      { name: 'parks()', text: 'Count of nearby community parks' },
      { name: 'kitchens()', text: 'Count of upgraded cooking stations' }
    ]
  };

  SDG.Stage4 = {
    id: 'stage4',
    title: 'Stage 4 — Healthy Lifestyle',
    subtitle: 'Automate 3 days of sleep, food, fitness, focus and fun',
    TICK_LIMIT: 72,
    COLS: COLS,
    ROWS: ROWS,
    snapshotKeys: ['sleep', 'nutrition', 'fitness', 'stress', 'focus', 'screen',
      'discipline', 'money', 'gyms', 'parks', 'kitchens'],
    counts: counts,
    criticals: [
      { key: 'discipline', text: 'Discipline hit 0 — motivation collapsed!' }
    ],
    bars: [
      { key: 'sleep', label: 'Sleep', max: 100, better: 'high' },
      { key: 'nutrition', label: 'Nutrition', max: 100, better: 'high' },
      { key: 'fitness', label: 'Fitness', max: 100, better: 'high' },
      { key: 'stress', label: 'Stress', max: 100, better: 'low' },
      { key: 'focus', label: 'Focus', max: 100, better: 'high' },
      { key: 'screen', label: 'Screen', max: 100, better: 'low' },
      { key: 'discipline', label: 'Discipline', max: 100, better: 'high' },
      { key: 'money', label: 'Budget', max: 200, better: 'high' }
    ],
    sprite: 'person',
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
      { name: 'sleep_for(hours=8)', text: '+30 sleep, −6 stress, +10 discipline, +4 focus.' },
      { name: 'cook(meal="balanced")', text: '"balanced": −4k, +12 nutrition, −2 discipline. "fast": −1k, +5 nutrition, +1 stress.' },
      { name: 'exercise(mins=30)', text: '+4 fitness (7 with gym), −4 stress, +1 sleep, −2 nutrition, −3 discipline. Guard with discipline().' },
      { name: 'meditate(mins=10)', text: '−8 stress, +3 focus, −2 discipline. Best stress tool.' },
      { name: 'work(hours=2)', text: '+2.5k/hour, but −2 focus, +3 stress, −1 sleep.' },
      { name: 'screen_time(hours=1)', text: '−3 stress (the pro) but +7 screen, −2 focus, −1 sleep (the cons).' },
      { name: 'buy_gym() / buy_park() / buy_kitchen()', text: '−20k / −25k / −18k. Gym: workouts +7 & +0.15 fitness/tick. Park: −0.1 stress/tick. Kitchen: +0.1 nutrition/tick.' },
      { name: 'Probes', text: 'tick() sleep() nutrition() fitness() stress() focus() screen() discipline() money() gyms() parks() kitchens() free_land()' }
    ]
  };
})(typeof window !== 'undefined' ? window : globalThis);
