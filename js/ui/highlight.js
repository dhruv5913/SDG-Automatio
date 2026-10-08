(function (root) {
  'use strict';
  var SDG = (root.SDG = root.SDG || {});

  function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  var RE = /(#[^\n]*)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|\b(def|return|if|elif|else|while|for|in|and|or|not|True|False|None|break|continue)\b|\b(\d+\.?\d*)\b|\b([A-Za-z_]\w*)(?=\s*\()/g;

  // Python-like syntax highlighting -> safe HTML
  function highlight(code) {
    var out = '', last = 0, m;
    RE.lastIndex = 0;
    while ((m = RE.exec(code)) !== null) {
      out += esc(code.slice(last, m.index));
      var cls = m[1] ? 'tok-com' : m[2] ? 'tok-str' : m[3] ? 'tok-kw' : m[4] ? 'tok-num' : 'tok-fn';
      out += '<span class="' + cls + '">' + esc(m[0]) + '</span>';
      last = RE.lastIndex;
    }
    out += esc(code.slice(last));
    return out + '\n';
  }

  SDG.highlight = highlight;
})(typeof window !== 'undefined' ? window : globalThis);
