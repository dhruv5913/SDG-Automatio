(function (root) {
  'use strict';
  var SDG = (root.SDG = root.SDG || {});
  var PyError = SDG.PyError;
  var clamp = SDG.Metrics.clamp;

  function snapshot(stage, world) {
    var s = {};
    var counts = stage.counts ? stage.counts(world) : {};
    stage.snapshotKeys.forEach(function (k) {
      s[k] = k in counts ? counts[k] : world[k];
    });
    return s;
  }

  function diff(stage, before, after) {
    var d = {};
    stage.snapshotKeys.forEach(function (k) {
      var dv = after[k] - before[k];
      if (dv !== 0) d[k] = Math.round(dv * 100) / 100;
    });
    return d;
  }

  function countTypes(grid) {
    var c = {};
    grid.forEach(function (t) { c[t.type] = (c[t.type] || 0) + 1; });
    return c;
  }

  function arg(a, name, idx, dflt) {
    if (a.kwargs && Object.prototype.hasOwnProperty.call(a.kwargs, name)) return a.kwargs[name];
    if (a.args && a.args[idx] !== undefined) return a.args[idx];
    return dflt;
  }
  function argNum(a, name, idx, dflt) {
    var v = arg(a, name, idx, dflt);
    if (typeof v !== 'number') throw PyError("'" + name + "' must be a number");
    return v;
  }
  function argStr(a, name, idx, dflt) {
    var v = arg(a, name, idx, dflt);
    if (typeof v !== 'string') throw PyError("'" + name + "' must be a string");
    return v;
  }

  function Engine(stage) {
    this.stage = stage;
    this.world = null;
    this.actionThisStep = false;
    this.actionSeq = 0;
    this.reset();
  }

  Engine.prototype.reset = function () {
    this.world = this.stage.createWorld();
    this.actionThisStep = false;
    this.actionSeq = 0;
    if (!this.world.bot) this.world.bot = { x: 1, y: 1 };
    if (!this.world.events) this.world.events = [];
  };

  Engine.prototype.hasHost = function (name) {
    return Object.prototype.hasOwnProperty.call(this.stage.api, name);
  };

  // Called by the interpreter for every stage API call.
  Engine.prototype.callHost = function (name, args, kwargs, node) {
    var api = this.stage.api[name];
    if (!api) throw PyError("'" + name + "' is not defined", node.line);
    var w = this.world;
    var a = { args: args, kwargs: kwargs, line: node.line };

    if (api.kind === 'probe') {
      return { value: api.exec(w, a), action: false };
    }

    // action: validate + apply atomically, log deltas, then time advances one tick
    var before = snapshot(this.stage, w);
    var value;
    try {
      value = api.exec(w, a);
    } catch (e) {
      if (e && e.py) {
        if (e.line === undefined) e.line = node.line;
        w.stats.rejected.push({ name: name, tick: w.tick, message: e.message });
      }
      throw e;
    }
    var after = snapshot(this.stage, w);
    var deltas = diff(this.stage, before, after);

    w.stats.actions[name] = (w.stats.actions[name] || 0) + 1;
    if (w.lastTile != null) {
      w.events.push({ tick: w.tick, name: name, args: args, deltas: deltas, tile: w.lastTile });
      w.lastTile = null;
    } else {
      w.events.push({ tick: w.tick, name: name, args: args, deltas: deltas, tile: null });
    }

    this.actionThisStep = true;
    this.actionSeq++;
    this.advanceTick();
    return { value: value === undefined ? null : value, action: true };
  };

  // One unit of in-game time passes: decay, passive production, derived stats.
  Engine.prototype.advanceTick = function () {
    var w = this.world;
    if (w.tick >= this.stage.TICK_LIMIT) return false;
    w.tick++;
    this.stage.applyTick(w);
    this.checkCriticals();
    return w.tick < this.stage.TICK_LIMIT;
  };

  Engine.prototype.checkCriticals = function () {
    var w = this.world;
    var s = w.stats.criticals;
    (this.stage.criticals || []).forEach(function (c) {
      if (w[c.key] <= 0 && !s[c.key]) {
        s[c.key] = w.tick;
        w.stats.events.push({ tick: w.tick, text: c.text });
      }
    });
  };

  // After the script ends (or errors), keep simulating the remaining ticks
  // with no player actions so the score reflects sustained performance.
  Engine.prototype.fastForward = function () {
    var guard = 0;
    while (this.world.tick < this.stage.TICK_LIMIT && guard++ < 10000) {
      this.advanceTick();
    }
  };

  SDG.Engine = Engine;
  SDG.util = { arg: arg, argNum: argNum, argStr: argStr, countTiles: countTypes, snapshot: snapshot };
  // countTiles(grid) -> { type: n }  (legacy alias kept for stage1)
})(typeof window !== 'undefined' ? window : globalThis);
