(function (root) {
  'use strict';
  var SDG = (root.SDG = root.SDG || {});

  function Editor(textareaId, lineNumbersId, onRun, onSave) {
    this.ta = document.getElementById(textareaId);
    // no soft wrapping: the highlight overlay uses white-space:pre, so a
    // wrapped textarea would desync the visible text from the real caret
    this.ta.setAttribute('wrap', 'off');
    this.gutter = document.getElementById(lineNumbersId);
    this.hl = document.getElementById('highlight');
    this.hlCode = this.hl ? this.hl.querySelector('code') : null;
    this.wrap = this.ta.parentElement;
    this.onSave = onSave || null;
    this.errLine = null;
    this.curLine = 1;
    var self = this;

    // caret + error stripes (created here so index.html stays declarative)
    this.stripeCur = document.createElement('div');
    this.stripeCur.className = 'line-stripe cur';
    this.stripeErr = document.createElement('div');
    this.stripeErr.className = 'line-stripe err';
    this.wrap.appendChild(this.stripeCur);
    this.wrap.appendChild(this.stripeErr);

    this.ta.addEventListener('input', function () {
      self.setErrorLine(null); // typing fixes the error until it happens again
      self.renderLines();
      self.trackCaret();
    });
    this.ta.addEventListener('scroll', function () {
      self.gutter.scrollTop = self.ta.scrollTop;
      if (self.hl) { self.hl.scrollTop = self.ta.scrollTop; self.hl.scrollLeft = self.ta.scrollLeft; }
      self.positionStripes();
    });
    ['click', 'keyup', 'select'].forEach(function (ev) {
      self.ta.addEventListener(ev, function () { self.trackCaret(); });
    });
    this.ta.addEventListener('keydown', function (e) { self.onKeyDown(e, onRun); });
    this.renderLines();
    this.trackCaret();
    // web fonts change metrics after load — re-sync overlay positions
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () { self.renderLines(); self.trackCaret(); });
    }
  }

  Editor.prototype.onKeyDown = function (e, onRun) {
    var self = this;

    if (e.key === 'Tab') {
      // execCommand keeps the native undo/redo stack alive (direct .value
      // mutation would wipe the user's undo history)
      e.preventDefault();
      var start = this.ta.selectionStart, end = this.ta.selectionEnd;
      var collapsed = start === end;
      var multiline = !collapsed && this.ta.value.slice(start, end).indexOf('\n') !== -1;
      var lineStart = this.ta.value.lastIndexOf('\n', start - 1) + 1;

      if (e.shiftKey) {
        // outdent the caret's line, keeping the caret/selection column
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
        // no leading spaces → true no-op, caret untouched
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
        // single-line selection: indent its line instead of eating the text
        this.replaceRange(lineStart, lineStart, '    ');
        this.ta.setSelectionRange(
          Math.min(start + 4, this.ta.value.length),
          Math.min(end + 4, this.ta.value.length));
      } else {
        document.execCommand('insertText', false, '    ');
      }
      this.renderLines();
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      if (onRun) onRun();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
      e.preventDefault();
      if (self.onSave) self.onSave();
    }
  };

  // text replacement that goes through execCommand so undo still works
  Editor.prototype.replaceRange = function (from, to, text) {
    this.ta.setSelectionRange(from, to);
    document.execCommand('insertText', false, text);
  };

  Editor.prototype.caretLine = function () {
    return this.ta.value.slice(0, this.ta.selectionStart).split('\n').length;
  };

  Editor.prototype.trackCaret = function () {
    this.curLine = this.caretLine();
    this.positionStripes();
  };

  Editor.prototype.setErrorLine = function (line) {
    this.errLine = typeof line === 'number' && line > 0 ? Math.floor(line) : null;
    this.positionStripes();
  };

  Editor.prototype.lineHeight = function () {
    var lh = parseFloat(getComputedStyle(this.ta).lineHeight);
    return lh > 0 ? lh : 19.5;
  };

  Editor.prototype.positionStripes = function () {
    var lh = this.lineHeight();
    var padTop = parseFloat(getComputedStyle(this.ta).paddingTop) || 0;
    var left = this.ta.style.left || '34px';
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
