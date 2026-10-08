(function (root) {
  'use strict';
  var SDG = (root.SDG = root.SDG || {});
  var M = SDG.Metrics;
  var G = SDG.Goals;

  // helper: write textContent only when it actually changed (rAF runs 60/s)
  function setText(el, v) {
    if (el && el.__v !== v) { el.__v = v; el.textContent = v; }
  }
  function setWidth(el, v) {
    if (el && el.__w !== v) { el.__w = v; el.style.width = v; }
  }
  function setClass(el, name, on) {
    if (!el) return;
    var has = el.classList.contains(name);
    if (has !== !!on) el.classList.toggle(name, !!on);
  }

  function HUD(stage) {
    this.stage = null;
    this.chips = {};
    this.goalRows = [];
    this.lastAction = document.getElementById('lastAction');
    this.lastEventSeen = -1;
    this.setStage(stage);
  }

  HUD.prototype.setStage = function (stage) {
    this.stage = stage;
    this.buildChips();
    this.buildGoals();
    this.lastEventSeen = -1;
  };

  HUD.prototype.buildChips = function () {
    var bar = document.getElementById('resourceBar');
    bar.innerHTML = '';
    this.chips = {};
    this.stage.bars.forEach(function (b) {
      var chip = document.createElement('div');
      chip.className = 'chip';
      chip.innerHTML =
        '<span class="chip-label">' + b.label + '</span>' +
        '<span class="chip-val" data-v="' + b.key + '">–</span>' +
        '<div class="chip-bar"><div class="chip-fill" data-f="' + b.key + '"></div></div>';
      bar.appendChild(chip);
      this.chips[b.key] = {
        fill: chip.querySelector('[data-f]'),
        val: chip.querySelector('[data-v]'),
        max: b.max,
        better: b.better
      };
    }, this);
  };

  HUD.prototype.buildGoals = function () {
    var goalsEl = document.getElementById('goalList');
    goalsEl.innerHTML = '';
    this.goalRows = this.stage.goals.map(function (g) {
      var row = document.createElement('div');
      row.className = 'goal';
      row.innerHTML = '<span class="goal-mark">•</span><span class="goal-label">' + g.label +
        '</span><span class="goal-prog"><i></i></span>' +
        '<span class="goal-target">' + (g.cmp === '>=' ? '≥' : '≤') + ' ' + g.target + '</span>' +
        '<span class="goal-cur" data-c="' + g.key + '">–</span>';
      goalsEl.appendChild(row);
      return {
        g: g, el: row,
        cur: row.querySelector('[data-c]'),
        mark: row.querySelector('.goal-mark'),
        fill: row.querySelector('.goal-prog i')
      };
    });
  };

  HUD.prototype.update = function (world) {
    var key;
    for (key in this.chips) {
      var c = this.chips[key];
      var v = world[key] != null ? world[key] : 0;
      var pct = c.max === Infinity ? Math.min(100, v) : M.clamp(v / c.max * 100, 0, 100);
      var pctR = Math.round(pct * 10) / 10;
      setWidth(c.fill, pctR + '%');
      setText(c.val, M.fmt(key, v));
      var bad = c.better === 'low' ? pct > 75 : pct < 30;
      setClass(c.fill, 'danger', !!bad);
      setClass(c.fill, 'inverse', c.better === 'low' && !bad);
    }

    this.goalRows.forEach(function (row) {
      var v = world[row.g.key];
      var pass = G.pass(row.g, v);
      var prog = G.progress(row.g, v);
      setText(row.cur, M.fmt(row.g.key, v));
      setWidth(row.fill, Math.round(prog * 100) + '%');
      setClass(row.el, 'pass', pass);
      setClass(row.el, 'fail', !pass);
      setText(row.mark, pass ? '✓' : '✗');
      setClass(row.fill, 'full', pass);
    });

    if (this.lastAction && world.events.length !== this.lastEventSeen) {
      this.lastEventSeen = world.events.length;
      if (world.events.length) {
        var ev = world.events[world.events.length - 1];
        var parts = Object.keys(ev.deltas).map(function (k) {
          if (k === 'tick') return null;
          var d = ev.deltas[k];
          return (M.METRICS[k] ? M.METRICS[k].label : k) + ' ' + (d > 0 ? '+' : '') + d;
        }).filter(Boolean);
        setText(this.lastAction, 't' + ev.tick + ' · ' + ev.name + (parts.length ? ' → ' + parts.join(', ') : ''));
      } else {
        setText(this.lastAction, '–');
      }
    }
  };

  SDG.HUD = HUD;
})(typeof window !== 'undefined' ? window : globalThis);
