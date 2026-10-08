(function (root) {
  'use strict';
  var SDG = (root.SDG = root.SDG || {});

  var MAX_OPS = 60000;

  function PyError(msg, line) {
    var e = new Error(line ? 'Runtime error (line ' + line + '): ' + msg : 'Runtime error: ' + msg);
    e.py = true; e.line = line;
    return e;
  }
  SDG.PyError = PyError;

  function BreakSig() {}
  function ContinueSig() {}
  function ReturnSig(v) { this.value = v; }

  function Env(parent) {
    this.vars = new Map();
    this.parent = parent || null;
  }
  Env.prototype.find = function (name) {
    var e = this;
    while (e) { if (e.vars.has(name)) return e; e = e.parent; }
    return null;
  };
  Env.prototype.get = function (name, line) {
    var e = this.find(name);
    if (!e) throw PyError("name '" + name + "' is not defined", line);
    return e.vars.get(name);
  };
  Env.prototype.set = function (name, val) {
    // Python semantics: assignment binds in the current scope
    this.vars.set(name, val);
  };
  Env.prototype.define = function (name, val) { this.vars.set(name, val); };

  function truthy(v) {
    if (v === null || v === undefined || v === false) return false;
    if (v === 0 || v === '') return false;
    if (Array.isArray(v) && v.length === 0) return false;
    return true;
  }

  function pyRepr(v) {
    if (v === null || v === undefined) return 'None';
    if (v === true) return 'True';
    if (v === false) return 'False';
    if (Array.isArray(v)) return '[' + v.map(pyRepr).join(', ') + ']';
    if (typeof v === 'object') return '<fn>';
    if (typeof v === 'string') return "'" + v + "'";
    return String(v);
  }

  // ---------- builtins ----------

  function makeBuiltins(ctx) {
    function num(a, i, name) {
      var v = a[i];
      if (typeof v !== 'number') throw PyError(name + ' must be a number');
      return v;
    }
    return {
      range: function (args) {
        var start = 0, stop = 0, step = 1;
        if (args.length === 1) stop = args[0];
        else if (args.length >= 2) { start = args[0]; stop = args[1]; if (args.length >= 3) step = args[2]; }
        else throw PyError('range() needs at least 1 argument');
        if (typeof stop !== 'number' || typeof start !== 'number' || typeof step !== 'number') throw PyError('range() expects numbers');
        if (step === 0) throw PyError('range() step cannot be 0');
        var out = [];
        if (step > 0) { for (var i = start; i < stop && out.length < 50000; i += step) out.push(i); }
        else { for (var j = start; j > stop && out.length < 50000; j += step) out.push(j); }
        return out;
      },
      len: function (args) {
        var v = args[0];
        if (typeof v === 'string' || Array.isArray(v)) return v.length;
        throw PyError('len() expects a string or list');
      },
      min: function (args) { return Math.min.apply(null, args.flat()); },
      max: function (args) { return Math.max.apply(null, args.flat()); },
      abs: function (args) { return Math.abs(num(args, 0, 'abs')); },
      int: function (args) { return Math.trunc(Number(args[0])); },
      float: function (args) { return Number(args[0]); },
      str: function (args) { return pyRepr(args[0]); },
      print: function (args) {
        ctx.print(args.map(function (v) { return typeof v === 'string' ? v : pyRepr(v); }).join(' '));
        return null;
      }
    };
  }

  // ---------- generators ----------

  function* execBlock(body, ctx) {
    for (var i = 0; i < body.length; i++) yield* execStmt(body[i], ctx);
  }

  function* execStmt(node, ctx) {
    ctx.ops.n++;
    if (ctx.ops.n > MAX_OPS) throw PyError('execution budget exceeded (possible infinite loop)', node.line);
    yield;
    try {
      yield* execStmtInner(node, ctx);
    } catch (e) {
      if (e && e.py && e.line === undefined) e.line = node.line;
      throw e;
    }
  }

  function* execStmtInner(node, ctx) {
    switch (node.type) {
      case 'Expr':
        yield* evalExpr(node.value, ctx);
        return;
      case 'Assign': {
        var v = yield* evalExpr(node.value, ctx);
        ctx.env.set(node.target, v);
        return;
      }
      case 'SubscriptAssign': {
        var obj = yield* evalExpr(node.obj, ctx);
        var idx = yield* evalExpr(node.index, ctx);
        var item = yield* evalExpr(node.value, ctx);
        if (!Array.isArray(obj)) throw PyError('can only assign into lists', node.line);
        if (typeof idx !== 'number') throw PyError('index must be a number', node.line);
        var ii = idx < 0 ? obj.length + idx : idx;
        if (ii < 0 || ii >= obj.length) throw PyError('index out of range', node.line);
        obj[ii] = item;
        return;
      }
      case 'AugAssign': {
        var cur = ctx.env.get(node.target, node.line);
        var rhs = yield* evalExpr(node.value, ctx);
        ctx.env.set(node.target, binop(node.op, cur, rhs, node.line));
        return;
      }
      case 'Return':
        throw new ReturnSig(node.value ? (yield* evalExpr(node.value, ctx)) : null);
      case 'Break':
        throw new BreakSig();
      case 'Continue':
        throw new ContinueSig();
      case 'If': {
        var t = yield* evalExpr(node.test, ctx);
        if (truthy(t)) yield* execBlock(node.body, ctx);
        else if (node.orelse) yield* execBlock(node.orelse, ctx);
        return;
      }
      case 'While': {
        for (;;) {
          var wt = yield* evalExpr(node.test, ctx);
          if (!truthy(wt)) break;
          try { yield* execBlock(node.body, ctx); }
          catch (e) {
            if (e instanceof BreakSig) break;
            if (e instanceof ContinueSig) continue;
            throw e;
          }
        }
        return;
      }
      case 'For': {
        var seq = yield* evalExpr(node.iter, ctx);
        if (typeof seq === 'string') seq = seq.split('');
        if (!Array.isArray(seq)) throw PyError('for-loop expects a list or range(...)', node.line);
        for (var i = 0; i < seq.length; i++) {
          ctx.env.set(node.target, seq[i]);
          try { yield* execBlock(node.body, ctx); }
          catch (e) {
            if (e instanceof BreakSig) break;
            if (e instanceof ContinueSig) continue;
            throw e;
          }
        }
        return;
      }
      case 'FunctionDef': {
        ctx.env.define(node.name, { pyfn: { node: node, closure: ctx.env } });
        return;
      }
      default:
        throw PyError('unknown statement ' + node.type, node.line);
    }
  }

  function binop(op, a, b, line) {
    switch (op) {
      case '+':
        if (typeof a === 'string' && typeof b === 'string') return a + b;
        if (Array.isArray(a) && Array.isArray(b)) return a.concat(b);
        return num(a, line, op) + num(b, line, op);
      case '-': return num(a, line, op) - num(b, line, op);
      case '*':
        if (typeof a === 'string' && typeof b === 'number') return a.repeat(Math.max(0, Math.trunc(b)));
        return num(a, line, op) * num(b, line, op);
      case '/':
        if (num(b, line, op) === 0) throw PyError('division by zero', line);
        return num(a, line, op) / num(b, line, op);
      case '//':
        if (num(b, line, op) === 0) throw PyError('division by zero', line);
        return Math.floor(num(a, line, op) / num(b, line, op));
      case '%':
        if (num(b, line, op) === 0) throw PyError('modulo by zero', line);
        return num(a, line, op) % num(b, line, op);
      case '**': return Math.pow(num(a, line, op), num(b, line, op));
      default: throw PyError('unknown operator ' + op, line);
    }
  }
  function num(v, line, ctxName) {
    if (typeof v !== 'number') throw PyError("unsupported operand type for '" + ctxName + "'", line);
    return v;
  }

  function compare(op, a, b) {
    switch (op) {
      case '==': return a === b;
      case '!=': return a !== b;
      case '<': return a < b;
      case '<=': return a <= b;
      case '>': return a > b;
      case '>=': return a >= b;
    }
    throw PyError('unknown comparison ' + op);
  }

  function* evalExpr(node, ctx) {
    switch (node.type) {
      case 'Num': case 'Str': case 'Bool':
        return node.value;
      case 'None':
        return null;
      case 'Name':
        return ctx.env.get(node.name, node.line);
      case 'List': {
        var out = [];
        for (var i = 0; i < node.items.length; i++) out.push(yield* evalExpr(node.items[i], ctx));
        return out;
      }
      case 'BinOp': {
        var l = yield* evalExpr(node.left, ctx);
        var r = yield* evalExpr(node.right, ctx);
        return binop(node.op, l, r, node.line);
      }
      case 'UnaryOp': {
        var uv = yield* evalExpr(node.operand, ctx);
        if (node.op === 'not') return !truthy(uv);
        if (node.op === '-') return -num(uv, node.line, '-');
        if (node.op === '+') return +num(uv, node.line, '+');
        throw PyError('unknown unary ' + node.op, node.line);
      }
      case 'BoolOp': {
        if (node.op === 'and') {
          var lv = yield* evalExpr(node.left, ctx);
          if (!truthy(lv)) return lv;
          return yield* evalExpr(node.right, ctx);
        }
        var rv = yield* evalExpr(node.left, ctx);
        if (truthy(rv)) return rv;
        return yield* evalExpr(node.right, ctx);
      }
      case 'Compare': {
        var cl = yield* evalExpr(node.left, ctx);
        var cr = yield* evalExpr(node.right, ctx);
        return compare(node.op, cl, cr);
      }
      case 'Subscript': {
        var sv = yield* evalExpr(node.value, ctx);
        var si = yield* evalExpr(node.index, ctx);
        if (Array.isArray(sv) || typeof sv === 'string') {
          if (typeof si !== 'number') throw PyError('index must be a number', node.line);
          var idx = si < 0 ? sv.length + si : si;
          if (idx < 0 || idx >= sv.length) throw PyError('index out of range', node.line);
          return sv[idx];
        }
        throw PyError('object is not subscriptable', node.line);
      }
      case 'Call': {
        if (node.func.type !== 'Name') throw PyError('can only call named functions', node.line);
        var name = node.func.name;

        var args = [];
        for (var a = 0; a < node.args.length; a++) args.push(yield* evalExpr(node.args[a], ctx));
        var kwargs = {};
        for (var k = 0; k < node.kwargs.length; k++) {
          kwargs[node.kwargs[k].name] = yield* evalExpr(node.kwargs[k].value, ctx);
        }

        // host API (stage actions & probes)
        if (ctx.hasHost(name)) {
          var res = ctx.host(name, args, kwargs, node);
          if (res.action) yield;
          return res.value;
        }

        // user-defined function
        var target = ctx.env.find(name);
        if (target) {
          var tv = target.vars.get(name);
          if (tv && tv.pyfn) return yield* callUserFn(tv.pyfn, args, kwargs, node, ctx);
          throw PyError("'" + name + "' is not a function", node.line);
        }

        // builtin
        var b = makeBuiltins(ctx)[name];
        if (b) return b(args, kwargs);

        throw PyError("'" + name + "' is not defined", node.line);
      }
      default:
        throw PyError('unknown expression ' + node.type, node.line);
    }
  }

  function* callUserFn(fn, args, kwargs, node, ctx) {
    var params = fn.node.params;
    if (args.length > params.length) throw PyError('too many arguments for ' + fn.node.name, node.line);
    for (var kn in kwargs) {
      var found = false;
      for (var q = 0; q < params.length; q++) if (params[q].name === kn) found = true;
      if (!found) throw PyError("unexpected keyword argument '" + kn + "'", node.line);
    }

    var scope = new Env(fn.closure);
    for (var i = 0; i < params.length; i++) {
      var p = params[i];
      if (i < args.length) {
        if (Object.prototype.hasOwnProperty.call(kwargs, p.name)) {
          throw PyError("got multiple values for argument '" + p.name + "'", node.line);
        }
        scope.define(p.name, args[i]);
      } else if (Object.prototype.hasOwnProperty.call(kwargs, p.name)) {
        scope.define(p.name, kwargs[p.name]);
      } else if (p.default) {
        scope.define(p.name, yield* evalExpr(p.default, { ...ctx, env: fn.closure }));
      } else {
        throw PyError("missing argument '" + p.name + "'", node.line);
      }
    }

    var child = { ...ctx, env: scope };
    try {
      yield* execBlock(fn.node.body, child);
    } catch (e) {
      if (e instanceof ReturnSig) return e.value;
      throw e;
    }
    return null;
  }

  // Run a parsed program. Returns a generator; pump it with .next().
  SDG.run = function (ast, ctx) {
    return execBlock(ast.body, ctx);
  };
  SDG.Env = Env;
  SDG.truthy = truthy;
  SDG.pyRepr = pyRepr;
})(typeof window !== 'undefined' ? window : globalThis);
