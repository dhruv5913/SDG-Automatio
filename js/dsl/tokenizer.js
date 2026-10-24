(function (root) {
  'use strict';
  var SDG = (root.SDG = root.SDG || {});

  var KEYWORDS = new Set([
    'def', 'return', 'if', 'elif', 'else', 'while', 'for', 'in',
    'and', 'or', 'not', 'True', 'False', 'None', 'break', 'continue', 'pass'
  ]);

  // longest-first so two-char operators win
  var OPERATORS = [
    '==', '!=', '<=', '>=', '+=', '-=', '*=', '/=', '%=', '//', '**',
    '(', ')', '[', ']', ',', ':', '+', '-', '*', '/', '%', '<', '>', '='
  ];

  function isDigit(c) { return c >= '0' && c <= '9'; }
  function isIdentStart(c) { return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_'; }
  function isIdentPart(c) { return isIdentStart(c) || isDigit(c); }

  function tokenize(src) {
    var tokens = [];
    var indentStack = [0];
    var i = 0, line = 1;
    var parenDepth = 0;
    var atLineStart = true;
    var n = src.length;

    function err(msg) {
      var e = new Error('Lex error (line ' + line + '): ' + msg);
      e.lex = true; e.line = line;
      throw e;
    }

    while (i < n) {
      if (atLineStart && parenDepth === 0) {
        var j = i, indent = 0;
        while (j < n && (src[j] === ' ' || src[j] === '\t')) {
          indent += src[j] === '\t' ? 4 : 1;
          j++;
        }
        if (j < n && src[j] === '\n') { // blank line
          i = j + 1; line++; continue;
        }
        if (j < n && src[j] === '#') { // comment-only line
          while (j < n && src[j] !== '\n') j++;
          i = j; continue;
        }
        i = j;
        var cur = indentStack[indentStack.length - 1];
        if (indent > cur) {
          indentStack.push(indent);
          tokens.push({ type: 'INDENT', line: line });
        } else if (indent < cur) {
          while (indentStack.length > 1 && indent < indentStack[indentStack.length - 1]) {
            indentStack.pop();
            tokens.push({ type: 'DEDENT', line: line });
          }
          if (indent !== indentStack[indentStack.length - 1]) err('inconsistent indentation');
        }
        atLineStart = false;
        continue;
      }

      var ch = src[i];

      if (ch === ' ' || ch === '\t' || ch === '\r') { i++; continue; }

      if (ch === '\n') {
        if (parenDepth > 0) { i++; line++; continue; }
        tokens.push({ type: 'NEWLINE', line: line });
        i++; line++; atLineStart = true;
        continue;
      }

      if (ch === '#') {
        while (i < n && src[i] !== '\n') i++;
        continue;
      }

      if (ch === '"' || ch === "'") {
        var quote = ch, startLine = line, k = i + 1, buf = '';
        while (k < n && src[k] !== quote) {
          if (src[k] === '\n') err('unterminated string');
          if (src[k] === '\\' && k + 1 < n) {
            var nx = src[k + 1];
            buf += nx === 'n' ? '\n' : nx === 't' ? '\t' : nx;
            k += 2;
          } else {
            buf += src[k]; k++;
          }
        }
        if (k >= n) err('unterminated string');
        tokens.push({ type: 'STRING', value: buf, line: startLine });
        i = k + 1;
        continue;
      }

      if (isDigit(ch) || (ch === '.' && isDigit(src[i + 1]))) {
        var m = /^\d*\.?\d+/.exec(src.slice(i, i + 32));
        if (!m || !m[0]) err('bad number');
        tokens.push({ type: 'NUMBER', value: parseFloat(m[0]), line: line });
        i += m[0].length;
        continue;
      }

      if (isIdentStart(ch)) {
        var s = i;
        while (i < n && isIdentPart(src[i])) i++;
        var word = src.slice(s, i);
        if (KEYWORDS.has(word)) tokens.push({ type: 'KEYWORD', value: word, line: line });
        else tokens.push({ type: 'NAME', value: word, line: line });
        continue;
      }

      var matched = null;
      for (var oi = 0; oi < OPERATORS.length; oi++) {
        if (src.startsWith(OPERATORS[oi], i)) { matched = OPERATORS[oi]; break; }
      }
      if (!matched) err("unexpected character '" + ch + "'");
      if (matched === '(' || matched === '[') parenDepth++;
      if (matched === ')' || matched === ']') parenDepth--;
      tokens.push({ type: 'OP', value: matched, line: line });
      i += matched.length;
    }

    while (indentStack.length > 1) {
      indentStack.pop();
      tokens.push({ type: 'DEDENT', line: line });
    }
    tokens.push({ type: 'EOF', line: line });
    return tokens;
  }

  SDG.tokenize = tokenize;
})(typeof window !== 'undefined' ? window : globalThis);
