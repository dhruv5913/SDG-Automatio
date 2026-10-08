(function (root) {
  'use strict';
  var SDG = (root.SDG = root.SDG || {});
  var M = SDG.Metrics;

  // Build a per-action trade-off summary from the actual event log.
  function summarize(events) {
    var byAction = {};
    events.forEach(function (ev) {
      var e = byAction[ev.name] || (byAction[ev.name] = { count: 0, deltas: {} });
      e.count++;
      Object.keys(ev.deltas).forEach(function (k) {
        e.deltas[k] = (e.deltas[k] || 0) + ev.deltas[k];
      });
    });
    var rows = Object.keys(byAction).map(function (name) {
      var e = byAction[name];
      var pros = [], cons = [];
      Object.keys(e.deltas).forEach(function (k) {
        var d = e.deltas[k] / e.count;
        if (Math.abs(d) < 0.01) return;
        var meta = M.METRICS[k];
        var good = meta && meta.higherIsBetter !== null ? (meta.higherIsBetter ? d > 0 : d < 0) : null;
        var item = { metric: k, label: meta ? meta.label : k, delta: d };
        if (good === null) return;
        (good ? pros : cons).push(item);
      });
      return { name: name, count: e.count, pros: pros, cons: cons };
    });
    return rows;
  }

  function fmtDelta(item) {
    var d = Math.round(item.delta * 10) / 10;
    return item.label + ' ' + (d > 0 ? '+' : '') + d;
  }

  SDG.Tradeoffs = { summarize: summarize, fmtDelta: fmtDelta };
})(typeof window !== 'undefined' ? window : globalThis);
