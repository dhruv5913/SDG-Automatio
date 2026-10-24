(function (root) {
  'use strict';
  var SDG = (root.SDG = root.SDG || {});

  function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  var ACTIONS = /^(?:pump_water|plant|distribute|build_shelter|solar_panel|burn_fuel|mine|smelt|assemble|ship|recycle|hire|solar|build_recycler|grid_power|plant_trees|clean_river|filter_air|restore_wetland|restrict_polluter|reopen_factory|ban_plastic|sleep_for|cook|exercise|meditate|work|screen_time|buy_gym|buy_park|buy_kitchen)$/;
  var PROBES = /^(?:tick|population|hydration|nutrition|shelter|energy|emissions|morale|water_reserve|food_reserve|farms|shelters|panels|free_land|output|ore|steel|goods|waste|pollution|safety|workers|recyclers|biodiversity|air|water_quality|carbon|soil|economy|trees|wetlands|filters|factories|restricted|sleep|fitness|stress|focus|screen|discipline|money|gyms|parks|kitchens)$/;
  var BUILTINS = /^(?:range|len|print|abs|min|max|round)$/;

  var RE = /(#[^\n]*)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|\b(def|return|if|elif|else|while|for|in|and|or|not|True|False|None|break|continue|pass)\b|\b(\d+\.?\d*)\b|\b([A-Za-z_]\w*)(?=\s*\()/g;

  // Python-like syntax highlighting -> safe HTML with rich semantic tokens
  function highlight(code) {
    var out = '', last = 0, m;
    RE.lastIndex = 0;
    while ((m = RE.exec(code)) !== null) {
      out += esc(code.slice(last, m.index));
      var cls = 'tok-fn';
      if (m[1]) {
        cls = 'tok-com';
      } else if (m[2]) {
        cls = 'tok-str';
      } else if (m[3]) {
        cls = 'tok-kw';
      } else if (m[4]) {
        cls = 'tok-num';
      } else if (m[5]) {
        var fnName = m[5];
        if (ACTIONS.test(fnName)) cls = 'tok-action';
        else if (PROBES.test(fnName)) cls = 'tok-probe';
        else if (BUILTINS.test(fnName)) cls = 'tok-builtin';
      }
      out += '<span class="' + cls + '">' + esc(m[0]) + '</span>';
      last = RE.lastIndex;
    }
    out += esc(code.slice(last));
    return out + '\n';
  }

  SDG.highlight = highlight;
})(typeof window !== 'undefined' ? window : globalThis);
