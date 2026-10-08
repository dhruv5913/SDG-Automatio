(function (root) {
  'use strict';
  var SDG = (root.SDG = root.SDG || {});

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  var METRICS = {
    hydration:   { label: 'Hydration',   min: 0, max: 100, higherIsBetter: true,  unit: '%' },
    nutrition:   { label: 'Nutrition',   min: 0, max: 100, higherIsBetter: true,  unit: '%' },
    shelter:     { label: 'Shelter',     min: 0, max: 100, higherIsBetter: true,  unit: '%' },
    energy:      { label: 'Energy',      min: 0, max: 100, higherIsBetter: true,  unit: '' },
    morale:      { label: 'Morale',      min: 0, max: 100, higherIsBetter: true,  unit: '%' },
    money:       { label: 'Budget',      min: 0, max: Infinity, higherIsBetter: true, unit: 'k' },
    emissions:   { label: 'Emissions',   min: 0, max: Infinity, higherIsBetter: false, unit: 'CO2e' },
    water_reserve: { label: 'Water store', min: 0, max: 100, higherIsBetter: true, unit: '' },
    food_reserve:  { label: 'Food store',  min: 0, max: 100, higherIsBetter: true, unit: '' },
    farms:       { label: 'Farms',       min: 0, max: Infinity, higherIsBetter: true, unit: '' },
    shelters:    { label: 'Shelters',    min: 0, max: Infinity, higherIsBetter: true, unit: '' },
    panels:      { label: 'Solar panels', min: 0, max: Infinity, higherIsBetter: true, unit: '' },
    // stage 2 — manufacturing
    output:      { label: 'Output',      min: 0, max: Infinity, higherIsBetter: true, unit: '' },
    ore:         { label: 'Ore',         min: 0, max: 100, higherIsBetter: true, unit: '' },
    steel:       { label: 'Steel',       min: 0, max: 100, higherIsBetter: true, unit: '' },
    goods:       { label: 'Goods',       min: 0, max: 100, higherIsBetter: true, unit: '' },
    waste:       { label: 'Waste',       min: 0, max: 100, higherIsBetter: false, unit: '' },
    pollution:   { label: 'Pollution',   min: 0, max: Infinity, higherIsBetter: false, unit: '' },
    safety:      { label: 'Safety',      min: 0, max: 100, higherIsBetter: true, unit: '%' },
    workers:     { label: 'Crew',        min: 0, max: 12, higherIsBetter: true, unit: '' },
    recyclers:   { label: 'Recyclers',   min: 0, max: Infinity, higherIsBetter: true, unit: '' },
    // stage 3 — environment
    biodiversity:{ label: 'Biodiversity', min: 0, max: 100, higherIsBetter: true, unit: '%' },
    air:         { label: 'Air quality', min: 0, max: 100, higherIsBetter: true, unit: '%' },
    water_quality:{ label: 'Water quality', min: 0, max: 100, higherIsBetter: true, unit: '%' },
    carbon:      { label: 'Carbon',      min: 0, max: Infinity, higherIsBetter: false, unit: '' },
    soil:        { label: 'Soil health', min: 0, max: 100, higherIsBetter: true, unit: '%' },
    economy:     { label: 'Economy',     min: 0, max: Infinity, higherIsBetter: true, unit: 'k' },
    trees:       { label: 'Trees',       min: 0, max: Infinity, higherIsBetter: true, unit: '' },
    wetlands:    { label: 'Wetlands',    min: 0, max: Infinity, higherIsBetter: true, unit: '' },
    filters:     { label: 'Air filters', min: 0, max: Infinity, higherIsBetter: true, unit: '' },
    restricted:  { label: 'Restricted',  min: 0, max: Infinity, higherIsBetter: null, unit: '' },
    // stage 4 — healthy lifestyle
    sleep:       { label: 'Sleep',       min: 0, max: 100, higherIsBetter: true, unit: '%' },
    fitness:     { label: 'Fitness',     min: 0, max: 100, higherIsBetter: true, unit: '%' },
    stress:      { label: 'Stress',      min: 0, max: 100, higherIsBetter: false, unit: '%' },
    focus:       { label: 'Focus',       min: 0, max: 100, higherIsBetter: true, unit: '%' },
    screen:      { label: 'Screen time', min: 0, max: 100, higherIsBetter: false, unit: '%' },
    discipline:  { label: 'Discipline',  min: 0, max: 100, higherIsBetter: true, unit: '%' },
    gyms:        { label: 'Gyms',        min: 0, max: Infinity, higherIsBetter: true, unit: '' },
    parks:       { label: 'Parks',       min: 0, max: Infinity, higherIsBetter: true, unit: '' },
    kitchens:    { label: 'Kitchens',    min: 0, max: Infinity, higherIsBetter: true, unit: '' },
    tick:        { label: 'Tick',        min: 0, max: Infinity, higherIsBetter: null, unit: '' }
  };

  function fmt(key, v) {
    var m = METRICS[key];
    if (typeof v !== 'number') return String(v);
    var s = Math.abs(v) >= 100 ? String(Math.round(v)) : (Math.round(v * 10) / 10).toString();
    return m && m.unit ? s + ' ' + m.unit : s;
  }

  SDG.Metrics = {
    clamp: clamp,
    METRICS: METRICS,
    fmt: fmt
  };
})(typeof window !== 'undefined' ? window : globalThis);
