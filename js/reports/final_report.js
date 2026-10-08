(function (root) {
  'use strict';
  var SDG = (root.SDG = root.SDG || {});

  // results: [{ id, title, score, grade, passed, failed: [labels] }] for all 4 stages
  function build(results) {
    var rows = results.filter(Boolean);
    var avg = rows.length ? rows.reduce(function (s, r) { return s + r.score; }, 0) / rows.length : 0;
    var allPassed = rows.length === 4 && rows.every(function (r) { return r.passed; });
    var rating, text;
    if (avg >= 90 && allPassed) { rating = 'A+'; text = 'SDG Champion — your automation is sustainable end to end.'; }
    else if (avg >= 75 && allPassed) { rating = 'A'; text = 'Sustainable Builder — solid systems with minor rough edges.'; }
    else if (avg >= 60 && allPassed) { rating = 'B'; text = 'On the Right Track — cleared, but trade-offs still bite.'; }
    else if (allPassed) { rating = 'C'; text = 'Cleared — functional, but fragile under pressure.'; }
    else { rating = 'D'; text = 'Needs Rethinking — one or more stages were not cleared.'; }
    return {
      rows: rows,
      avg: Math.round(avg),
      allPassed: allPassed,
      rating: rating,
      text: text
    };
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function toText(rep) {
    var lines = [];
    lines.push('SDG AUTOMATION — FINAL REPORT');
    lines.push('=============================');
    lines.push('');
    rep.rows.forEach(function (r) {
      lines.push(r.title + ': ' + r.score + '/100 (' + r.grade + ') ' + (r.passed ? 'CLEARED' : 'NOT CLEARED'));
      if (r.failed && r.failed.length) lines.push('  missed: ' + r.failed.join(', '));
    });
    lines.push('');
    lines.push('Overall average: ' + rep.avg + '/100 — rating ' + rep.rating);
    lines.push(rep.text);
    return lines.join('\n');
  }

  function render(rep) {
    var h = '';
    h += '<div class="rep-header ' + (rep.allPassed ? 'pass' : 'fail') + '">';
    h += '<div class="rep-score"><span class="rep-grade">' + esc(rep.rating) + '</span>' +
         '<span class="rep-num">avg ' + rep.avg + '/100</span></div>';
    h += '<div class="rep-title">Final Report — 4 stages<div class="rep-sub">' + esc(rep.text) + '</div></div>';
    h += '</div>';

    h += '<h3>Stage results</h3><table class="rep-table"><tr><th>Stage</th><th>Score</th><th>Grade</th><th>Result</th></tr>';
    rep.rows.forEach(function (r) {
      h += '<tr class="' + (r.passed ? 'ok' : 'bad') + '"><td>' + esc(r.title) + '</td><td>' + r.score +
        '</td><td>' + esc(r.grade) + '</td><td>' + (r.passed ? 'CLEARED' : 'NOT CLEARED') + '</td></tr>';
    });
    h += '</table>';

    var missed = [];
    rep.rows.forEach(function (r) {
      (r.failed || []).forEach(function (f) { missed.push(r.title.split('—')[0].trim() + ': ' + f); });
    });
    if (missed.length) {
      h += '<h3>What still needs work</h3><ul class="rep-list bad">';
      missed.forEach(function (m) { h += '<li>' + esc(m) + '</li>'; });
      h += '</ul>';
    } else {
      h += '<h3>Highlights</h3><ul class="rep-list good"><li>Every stage cleared all goals — needs, industry, environment and health all in balance.</li></ul>';
    }

    h += '<div class="rep-final">Replay any stage from its tab to raise its score — the final average updates live.</div>';
    return h;
  }

  SDG.FinalReport = { build: build, render: render, toText: toText };
})(typeof window !== 'undefined' ? window : globalThis);
