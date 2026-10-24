(function (root) {
  'use strict';
  var SDG = (root.SDG = root.SDG || {});

  function Editor(textareaId, lineNumbersId, onRun, onSave, onCursor) {
    this.ta = document.getElementById(textareaId);
    this.ta.setAttribute('wrap', 'off');
    this.gutter = document.getElementById(lineNumbersId);
    this.hl = document.getElementById('highlight');
    this.hlCode = this.hl ? this.hl.querySelector('code') : null;
    this.wrap = this.ta.parentElement;
    this.onSave = onSave || null;
    this.onCursor = onCursor || null;
    this.errLine = null;
    this.curLine = 1;
    var self = this;

    // caret + error stripes
    this.stripeCur = document.createElement('div');
    this.stripeCur.className = 'line-stripe cur';
    this.stripeErr = document.createElement('div');
    this.stripeErr.className = 'line-stripe err';
    this.wrap.appendChild(this.stripeCur);
    this.wrap.appendChild(this.stripeErr);

    this.ta.addEventListener('input', function () {
      self.setErrorLine(null);
      self.renderLines();
      self.trackCaret();
    });
    this.ta.addEventListener('scroll', function () {
      self.gutter.scrollTop = self.ta.scrollTop;
      if (self.hl) {
        self.hl.scrollTop = self.ta.scrollTop;
        self.hl.scrollLeft = self.ta.scrollLeft;
      }
      self.positionStripes();
    });
    ['click', 'keyup', 'select'].forEach(function (ev) {
      self.ta.addEventListener(ev, function () { self.trackCaret(); });
    });
    this.ta.addEventListener('keydown', function (e) { self.onKeyDown(e, onRun); });
    this.renderLines();
    this.trackCaret();

    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () { self.renderLines(); self.trackCaret(); });
    }
  }

  Editor.prototype.onKeyDown = function (e, onRun) {
    var self = this;

    // 1) Enter with smart indentation & colon handling
    if (e.key === 'Enter') {
      e.preventDefault();
      var start = this.ta.selectionStart, end = this.ta.selectionEnd;
      var val = this.ta.value;
      var lineStart = val.lastIndexOf('\n', start - 1) + 1;
      var curLine = val.slice(lineStart, start);
      var indentMatch = curLine.match(/^( +)/);
      var baseIndent = indentMatch ? indentMatch[1] : '';
      var extraIndent = curLine.trim().endsWith(':') ? '    ' : '';
      var insert = '\n' + baseIndent + extraIndent;
      this.replaceRange(start, end, insert);
      var newPos = start + insert.length;
      this.ta.setSelectionRange(newPos, newPos);
      this.renderLines();
      this.trackCaret();
      return;
    }

    // 2) Tab / Shift+Tab indent and outdent
    if (e.key === 'Tab') {
      e.preventDefault();
      var start = this.ta.selectionStart, end = this.ta.selectionEnd;
      var collapsed = start === end;
      var multiline = !collapsed && this.ta.value.slice(start, end).indexOf('\n') !== -1;
      var lineStart = this.ta.value.lastIndexOf('\n', start - 1) + 1;

      if (e.shiftKey) {
        var upto = Math.min(lineStart + 4, this.ta.value.length);
        var head = this.ta.value.slice(lineStart, upto);
        var removed = head.replace(/^( {1,4})/, '');
        if (removed.length !== head.length) {
          var delta = head.length - removed.length;
          this.ta.setSelectionRange(lineStart, upto);
          if (removed === '') document.execCommand('delete');
          else document.execCommand('insertText', false, removed);
          this.ta.setSelectionRange(Math.max(lineStart, start - delta), Math.max(lineStart, end - delta));
        }
      } else if (multiline) {
        var first = this.ta.value.slice(0, start);
        var indentFrom = first.lastIndexOf('\n') + 1;
        var block = this.ta.value.slice(indentFrom, end);
        var indented = block.replace(/^(?=.)/gm, '    ');
        this.replaceRange(indentFrom, end, indented);
        this.ta.setSelectionRange(
          Math.min(start + 4, this.ta.value.length),
          Math.min(indentFrom + indented.length, this.ta.value.length));
      } else if (!collapsed) {
        this.replaceRange(lineStart, lineStart, '    ');
        this.ta.setSelectionRange(
          Math.min(start + 4, this.ta.value.length),
          Math.min(end + 4, this.ta.value.length));
      } else {
        document.execCommand('insertText', false, '    ');
      }
      this.renderLines();
      this.trackCaret();
      return;
    }

    // 3) Auto-closing pairs: (), [], {}, "", ''
    var pairs = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'" };
    if (pairs[e.key]) {
      var start = this.ta.selectionStart, end = this.ta.selectionEnd;
      var val = this.ta.value;
      var closeChar = pairs[e.key];

      if (start === end && (e.key === '"' || e.key === "'") && val.charAt(start) === e.key) {
        e.preventDefault();
        this.ta.setSelectionRange(start + 1, start + 1);
        this.trackCaret();
        return;
      }

      if (start !== end) {
        e.preventDefault();
        var selected = val.slice(start, end);
        var wrapped = e.key + selected + closeChar;
        this.replaceRange(start, end, wrapped);
        this.ta.setSelectionRange(start + 1, end + 1);
        this.renderLines();
        this.trackCaret();
        return;
      } else {
        e.preventDefault();
        this.replaceRange(start, end, e.key + closeChar);
        this.ta.setSelectionRange(start + 1, start + 1);
        this.renderLines();
        this.trackCaret();
        return;
      }
    }

    // Step over closing bracket if typed
    if (e.key === ')' || e.key === ']' || e.key === '}') {
      var start = this.ta.selectionStart, end = this.ta.selectionEnd;
      var val = this.ta.value;
      if (start === end && val.charAt(start) === e.key) {
        e.preventDefault();
        this.ta.setSelectionRange(start + 1, start + 1);
        this.trackCaret();
        return;
      }
    }

    // 4) Smart backspace deleting empty pairs
    if (e.key === 'Backspace') {
      var start = this.ta.selectionStart, end = this.ta.selectionEnd;
      if (start === end && start > 0) {
        var val = this.ta.value;
        var prev = val.charAt(start - 1);
        var next = val.charAt(start);
        var openPairs = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'" };
        if (openPairs[prev] === next) {
          e.preventDefault();
          this.ta.setSelectionRange(start - 1, start + 1);
          document.execCommand('delete');
          this.renderLines();
          this.trackCaret();
          return;
        }
      }
    }

    // 5) Toggle comment with Ctrl+/ or Cmd+/
    if ((e.ctrlKey || e.metaKey) && (e.key === '/' || e.code === 'Slash')) {
      e.preventDefault();
      this.toggleComment();
      return;
    }

    // 6) Ctrl+Enter to run
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      if (onRun) onRun();
      return;
    }

    // 7) Ctrl+S to save
    if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
      e.preventDefault();
      if (self.onSave) self.onSave();
    }
  };

  // Toggle comment on current line or selection
  Editor.prototype.toggleComment = function () {
    var start = this.ta.selectionStart, end = this.ta.selectionEnd;
    var val = this.ta.value;
    var lineStart = val.lastIndexOf('\n', start - 1) + 1;
    var lineEnd = val.indexOf('\n', end);
    if (lineEnd === -1) lineEnd = val.length;

    var block = val.slice(lineStart, lineEnd);
    var lines = block.split('\n');
    var allCommented = lines.every(function (l) {
      var trimmed = l.trim();
      return trimmed.length === 0 || trimmed.charAt(0) === '#';
    });

    var newLines = lines.map(function (l) {
      if (allCommented) {
        return l.replace(/^(\s*)# ?/, '$1');
      } else {
        return l.length > 0 ? '# ' + l : l;
      }
    });

    var replacement = newLines.join('\n');
    this.replaceRange(lineStart, lineEnd, replacement);
    this.ta.setSelectionRange(lineStart, lineStart + replacement.length);
    this.renderLines();
    this.trackCaret();
  };

  // Insert snippet at caret with indentation alignment
  Editor.prototype.insertSnippet = function (text) {
    this.ta.focus();
    var start = this.ta.selectionStart, end = this.ta.selectionEnd;
    var val = this.ta.value;
    var lineStart = val.lastIndexOf('\n', start - 1) + 1;
    var curLine = val.slice(lineStart, start);
    var indentMatch = curLine.match(/^( +)/);
    var baseIndent = indentMatch ? indentMatch[1] : '';

    var lines = text.split('\n');
    if (lines.length > 1) {
      var reindented = [lines[0]];
      for (var i = 1; i < lines.length; i++) {
        reindented.push(baseIndent + lines[i]);
      }
      text = reindented.join('\n');
    }

    this.replaceRange(start, end, text);
    var newPos = start + text.length;
    this.ta.setSelectionRange(newPos, newPos);
    this.renderLines();
    this.trackCaret();
  };

  // Format indentation and trim trailing whitespace
  Editor.prototype.formatCode = function () {
    var val = this.ta.value;
    var lines = val.split('\n');
    var cleaned = lines.map(function (l) {
      return l.replace(/\t/g, '    ').replace(/\s+$/, '');
    });
    var res = cleaned.join('\n');
    if (res !== val) {
      this.setValue(res);
    }
  };

  Editor.prototype.undo = function () {
    this.ta.focus();
    document.execCommand('undo');
    this.renderLines();
    this.trackCaret();
  };

  Editor.prototype.redo = function () {
    this.ta.focus();
    document.execCommand('redo');
    this.renderLines();
    this.trackCaret();
  };

  // text replacement using standard setRangeText to avoid cursor displacement
  Editor.prototype.replaceRange = function (from, to, text) {
    this.ta.focus();
    if (typeof this.ta.setRangeText === 'function') {
      this.ta.setRangeText(text, from, to, 'end');
    } else {
      var v = this.ta.value;
      this.ta.value = v.slice(0, from) + text + v.slice(to);
      this.ta.setSelectionRange(from + text.length, from + text.length);
    }
  };

  Editor.prototype.caretLine = function () {
    return this.ta.value.slice(0, this.ta.selectionStart).split('\n').length;
  };

  Editor.prototype.getCursorPosition = function () {
    var pos = this.ta.selectionStart;
    var val = this.ta.value;
    var lines = val.slice(0, pos).split('\n');
    var line = lines.length;
    var col = lines[lines.length - 1].length + 1;
    return { line: line, col: col };
  };

  Editor.prototype.trackCaret = function () {
    this.curLine = this.caretLine();
    if (this.hl) {
      this.hl.scrollTop = this.ta.scrollTop;
      this.hl.scrollLeft = this.ta.scrollLeft;
    }
    this.positionStripes();
    if (this.onCursor) {
      this.onCursor(this.getCursorPosition());
    }
  };

  Editor.prototype.setErrorLine = function (line) {
    this.errLine = typeof line === 'number' && line > 0 ? Math.floor(line) : null;
    this.positionStripes();
  };

  Editor.prototype.lineHeight = function () {
    return 21;
  };

  Editor.prototype.positionStripes = function () {
    var lh = 21;
    var padTop = 10;
    var left = (this.gutter ? this.gutter.offsetWidth : 38) + 'px';
    this.stripeCur.style.height = this.stripeErr.style.height = lh + 'px';
    this.stripeCur.style.left = this.stripeErr.style.left = left;

    var top = padTop + (this.curLine - 1) * lh - this.ta.scrollTop;
    var visible = top + lh > 0 && top < this.ta.clientHeight;
    this.stripeCur.style.display = visible ? 'block' : 'none';
    this.stripeCur.style.top = Math.round(top) + 'px';

    if (this.errLine) {
      var etop = padTop + (this.errLine - 1) * lh - this.ta.scrollTop;
      var evis = etop + lh > 0 && etop < this.ta.clientHeight;
      this.stripeErr.style.display = evis ? 'block' : 'none';
      this.stripeErr.style.top = Math.round(etop) + 'px';
      this.stripeErr.title = 'Error on line ' + this.errLine;
    } else {
      this.stripeErr.style.display = 'none';
    }
  };

  Editor.prototype.renderLines = function () {
    var count = this.ta.value.split('\n').length;
    var out = '';
    for (var i = 1; i <= count; i++) out += i + '\n';
    this.gutter.textContent = out;
    if (this.hlCode && SDG.highlight) this.hlCode.innerHTML = SDG.highlight(this.ta.value);
    var left = this.gutter.offsetWidth + 'px';
    this.ta.style.left = left;
    if (this.hl) this.hl.style.left = left;
    this.positionStripes();
  };

  Editor.prototype.getValue = function () { return this.ta.value; };
  Editor.prototype.setValue = function (v) {
    this.ta.value = v;
    this.ta.scrollTop = 0;
    this.ta.selectionStart = this.ta.selectionEnd = 0;
    if (this.hl) { this.hl.scrollTop = 0; this.hl.scrollLeft = 0; }
    this.setErrorLine(null);
    this.renderLines();
    this.trackCaret();
  };

  SDG.Editor = Editor;
})(typeof window !== 'undefined' ? window : globalThis);
