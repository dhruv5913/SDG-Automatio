(function (root) {
  'use strict';
  var SDG = (root.SDG = root.SDG || {});

  function ParseError(msg, line) {
    var e = new Error('Syntax error (line ' + line + '): ' + msg);
    e.parse = true; e.line = line;
    return e;
  }

  function Parser(tokens) {
    this.toks = tokens;
    this.pos = 0;
  }

  Parser.prototype.peek = function (offset) {
    return this.toks[Math.min(this.pos + (offset || 0), this.toks.length - 1)];
  };
  Parser.prototype.next = function () { return this.toks[this.pos++]; };
  Parser.prototype.at = function (type, value) {
    var t = this.peek();
    if (t.type !== type) return false;
    return value === undefined || t.value === value;
  };
  Parser.prototype.accept = function (type, value) {
    if (this.at(type, value)) { return this.next(); }
    return null;
  };
  Parser.prototype.expect = function (type, value) {
    var t = this.next();
    if (t.type !== type || (value !== undefined && t.value !== value)) {
      throw ParseError('expected ' + (value || type) + ' but found ' + (t.value || t.type), t.line);
    }
    return t;
  };
  Parser.prototype.skipNewlines = function () {
    while (this.at('NEWLINE')) this.next();
  };

  // ---------- program ----------

  Parser.prototype.parse = function () {
    var body = [];
    this.skipNewlines();
    while (!this.at('EOF')) {
      body.push(this.statement());
      this.skipNewlines();
    }
    return { type: 'Program', body: body, line: 1 };
  };

  Parser.prototype.statement = function () {
    if (this.at('KEYWORD', 'def')) return this.funcDef();
    if (this.at('KEYWORD', 'if')) return this.ifStatement();
    if (this.at('KEYWORD', 'while')) return this.whileStatement();
    if (this.at('KEYWORD', 'for')) return this.forStatement();
    return this.simpleStatement();
  };

  Parser.prototype.endSimple = function () {
    if (this.accept('NEWLINE')) return;
    if (this.at('DEDENT') || this.at('EOF')) return;
    var t = this.peek();
    throw ParseError('unexpected ' + (t.value || t.type), t.line);
  };

  Parser.prototype.simpleStatement = function () {
    var line = this.peek().line;
    if (this.accept('KEYWORD', 'return')) {
      var value = null;
      if (!this.at('NEWLINE') && !this.at('DEDENT') && !this.at('EOF')) value = this.expression();
      this.endSimple();
      return { type: 'Return', value: value, line: line };
    }
    if (this.accept('KEYWORD', 'break')) { this.endSimple(); return { type: 'Break', line: line }; }
    if (this.accept('KEYWORD', 'continue')) { this.endSimple(); return { type: 'Continue', line: line }; }
    if (this.accept('KEYWORD', 'pass')) { this.endSimple(); return { type: 'Pass', line: line }; }

    var expr = this.expression();

    var aug = this.at('OP') && ['+=', '-=', '*=', '/=', '%='].indexOf(this.peek().value) >= 0;
    if (aug) {
      var opTok = this.next();
      if (expr.type !== 'Name') throw ParseError('cannot assign to this expression', line);
      var rhs = this.expression();
      this.endSimple();
      return { type: 'AugAssign', target: expr.name, op: opTok.value[0], value: rhs, line: line };
    }
    if (this.accept('OP', '=')) {
      if (expr.type === 'Subscript') {
        var sval = this.expression();
        this.endSimple();
        return { type: 'SubscriptAssign', obj: expr.value, index: expr.index, value: sval, line: line };
      }
      if (expr.type !== 'Name') throw ParseError('only simple names can be assigned to', line);
      var val = this.expression();
      this.endSimple();
      return { type: 'Assign', target: expr.name, value: val, line: line };
    }

    this.endSimple();
    return { type: 'Expr', value: expr, line: line };
  };

  Parser.prototype.funcDef = function () {
    var line = this.expect('KEYWORD', 'def').line;
    var name = this.expect('NAME').value;
    this.expect('OP', '(');
    var params = [];
    if (!this.at('OP', ')')) {
      do {
        var pName = this.expect('NAME').value;
        var def = null;
        if (this.accept('OP', '=')) def = this.expression();
        params.push({ name: pName, default: def });
      } while (this.accept('OP', ','));
    }
    this.expect('OP', ')');
    var body = this.suite();
    return { type: 'FunctionDef', name: name, params: params, body: body, line: line };
  };

  Parser.prototype.ifStatement = function () {
    var line = this.expect('KEYWORD', 'if').line;
    var test = this.expression();
    var body = this.suite();
    var orelse = null;
    if (this.at('KEYWORD', 'elif')) {
      orelse = [this.ifStatementElif()];
    } else if (this.accept('KEYWORD', 'else')) {
      orelse = this.suite();
    }
    return { type: 'If', test: test, body: body, orelse: orelse, line: line };
  };
  Parser.prototype.ifStatementElif = function () {
    var line = this.expect('KEYWORD', 'elif').line;
    var test = this.expression();
    var body = this.suite();
    var orelse = null;
    if (this.at('KEYWORD', 'elif')) {
      orelse = [this.ifStatementElif()];
    } else if (this.accept('KEYWORD', 'else')) {
      orelse = this.suite();
    }
    return { type: 'If', test: test, body: body, orelse: orelse, line: line };
  };

  Parser.prototype.whileStatement = function () {
    var line = this.expect('KEYWORD', 'while').line;
    var test = this.expression();
    var body = this.suite();
    return { type: 'While', test: test, body: body, line: line };
  };

  Parser.prototype.forStatement = function () {
    var line = this.expect('KEYWORD', 'for').line;
    var target = this.expect('NAME').value;
    this.expect('KEYWORD', 'in');
    var iter = this.expression();
    var body = this.suite();
    return { type: 'For', target: target, iter: iter, body: body, line: line };
  };

  // suite: ':' NEWLINE INDENT ... DEDENT   or   ':' simple-statement
  Parser.prototype.suite = function () {
    this.expect('OP', ':');
    if (this.accept('NEWLINE')) {
      this.expect('INDENT');
      var body = [];
      while (!this.at('DEDENT')) {
        if (this.accept('NEWLINE')) continue;
        body.push(this.statement());
      }
      this.next(); // DEDENT
      if (body.length === 0) throw ParseError('expected an indented block', this.peek().line);
      return body;
    }
    return [this.simpleStatement()];
  };

  // ---------- expressions ----------

  Parser.prototype.expression = function () { return this.orExpr(); };

  Parser.prototype.orExpr = function () {
    var left = this.andExpr();
    while (this.at('KEYWORD', 'or')) {
      var line = this.next().line;
      var right = this.andExpr();
      left = { type: 'BoolOp', op: 'or', left: left, right: right, line: line };
    }
    return left;
  };

  Parser.prototype.andExpr = function () {
    var left = this.notExpr();
    while (this.at('KEYWORD', 'and')) {
      var line = this.next().line;
      var right = this.notExpr();
      left = { type: 'BoolOp', op: 'and', left: left, right: right, line: line };
    }
    return left;
  };

  Parser.prototype.notExpr = function () {
    if (this.at('KEYWORD', 'not')) {
      var line = this.next().line;
      return { type: 'UnaryOp', op: 'not', operand: this.notExpr(), line: line };
    }
    return this.comparison();
  };

  Parser.prototype.comparison = function () {
    var left = this.additive();
    var ops = ['==', '!=', '<', '<=', '>', '>='];
    if (this.at('OP') && ops.indexOf(this.peek().value) >= 0) {
      var operands = [left];
      var opToks = [];
      while (this.at('OP') && ops.indexOf(this.peek().value) >= 0) {
        opToks.push(this.next());
        operands.push(this.additive());
      }
      if (operands.length === 2) {
        return { type: 'Compare', op: opToks[0].value, left: operands[0], right: operands[1], line: opToks[0].line };
      }
      // chained: a < b < c  =>  (a<b) and (b<c)
      var node = { type: 'Compare', op: opToks[0].value, left: operands[0], right: operands[1], line: opToks[0].line };
      for (var k = 1; k < opToks.length; k++) {
        var cmp = { type: 'Compare', op: opToks[k].value, left: operands[k], right: operands[k + 1], line: opToks[k].line };
        node = { type: 'BoolOp', op: 'and', left: node, right: cmp, line: opToks[k].line };
      }
      return node;
    }
    return left;
  };

  Parser.prototype.additive = function () {
    var left = this.term();
    while (this.at('OP') && (this.peek().value === '+' || this.peek().value === '-')) {
      var op = this.next();
      var right = this.term();
      left = { type: 'BinOp', op: op.value, left: left, right: right, line: op.line };
    }
    return left;
  };

  Parser.prototype.term = function () {
    var left = this.unary();
    while (this.at('OP') && ['*', '/', '%', '//'].indexOf(this.peek().value) >= 0) {
      var op = this.next();
      var right = this.unary();
      left = { type: 'BinOp', op: op.value, left: left, right: right, line: op.line };
    }
    return left;
  };

  Parser.prototype.unary = function () {
    if (this.at('OP') && (this.peek().value === '-' || this.peek().value === '+')) {
      var op = this.next();
      return { type: 'UnaryOp', op: op.value, operand: this.unary(), line: op.line };
    }
    return this.power();
  };

  Parser.prototype.power = function () {
    var base = this.postfix();
    if (this.at('OP', '**')) {
      var line = this.next().line;
      return { type: 'BinOp', op: '**', left: base, right: this.unary(), line: line };
    }
    return base;
  };

  Parser.prototype.postfix = function () {
    var node = this.atom();
    for (;;) {
      if (this.at('OP', '(')) {
        var line = this.next().line;
        if (node.type !== 'Name') throw ParseError('only functions can be called', line);
        var args = [], kwargs = [];
        if (!this.at('OP', ')')) {
          do {
            if (this.at('NAME') && this.peek(1).type === 'OP' && this.peek(1).value === '=') {
              var kn = this.next().value;
              this.next(); // '='
              kwargs.push({ name: kn, value: this.expression() });
            } else {
              args.push(this.expression());
            }
          } while (this.accept('OP', ','));
        }
        this.expect('OP', ')');
        node = { type: 'Call', func: node, args: args, kwargs: kwargs, line: line };
      } else if (this.at('OP', '[')) {
        var l2 = this.next().line;
        var idx = this.expression();
        this.expect('OP', ']');
        node = { type: 'Subscript', value: node, index: idx, line: l2 };
      } else {
        return node;
      }
    }
  };

  Parser.prototype.atom = function () {
    var t = this.peek();
    if (t.type === 'NUMBER') { this.next(); return { type: 'Num', value: t.value, line: t.line }; }
    if (t.type === 'STRING') { this.next(); return { type: 'Str', value: t.value, line: t.line }; }
    if (t.type === 'NAME') { this.next(); return { type: 'Name', name: t.value, line: t.line }; }
    if (t.type === 'KEYWORD') {
      if (t.value === 'True') { this.next(); return { type: 'Bool', value: true, line: t.line }; }
      if (t.value === 'False') { this.next(); return { type: 'Bool', value: false, line: t.line }; }
      if (t.value === 'None') { this.next(); return { type: 'None', line: t.line }; }
    }
    if (t.type === 'OP' && t.value === '(') {
      this.next();
      var e = this.expression();
      this.expect('OP', ')');
      return e;
    }
    if (t.type === 'OP' && t.value === '[') {
      this.next();
      var items = [];
      if (!this.at('OP', ']')) {
        do { items.push(this.expression()); } while (this.accept('OP', ','));
      }
      this.expect('OP', ']');
      return { type: 'List', items: items, line: t.line };
    }
    throw ParseError('unexpected ' + (t.value || t.type), t.line);
  };

  SDG.parse = function (src) {
    var tokens = SDG.tokenize(src);
    return new Parser(tokens).parse();
  };
  SDG.ParseError = ParseError;
})(typeof window !== 'undefined' ? window : globalThis);
