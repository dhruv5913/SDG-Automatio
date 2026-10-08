(function (root) {
  'use strict';
  var SDG = (root.SDG = root.SDG || {});

  // per-tile-type fill colors (checkered base drawn for ground types)
  var TILES = {
    river:       { fill: '#1c5d99', alt: '#164a7c', wave: true },
    dirt:        { fill: '#5a4632', alt: '#51402c', ground: true },
    floor:       { fill: '#3a3f4b', alt: '#343945', ground: true },
    lot:         { fill: '#3d424c', alt: '#373c46', ground: true },
    barren:      { fill: '#6b5d43', alt: '#61543b', ground: true },
    farm:        { fill: '#3f7d3a' },
    shelter:     { fill: '#8a6d5a' },
    panel:       { fill: '#2d4a7a' },
    mine:        { fill: '#4a4550' },
    recycler:    { fill: '#2f6b4f' },
    forest:      { fill: '#2e6b34' },
    wetland:     { fill: '#2f7d74' },
    factory:     { fill: '#5c5560' },
    filter:      { fill: '#3f6f9e' },
    gym:         { fill: '#7a4a8f' },
    park:        { fill: '#3f8f4a' },
    kitchen:     { fill: '#9e6a3f' }
  };

  var MAX_FLOATERS = 8;        // hard cap — never snowball the overlay
  var MAX_DELTA_LINES = 3;     // biggest movers only inside one floater
  var FLOADER_LIFE = 1400;

  function Renderer(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.floaters = [];
    this.lastEventCount = 0;
    this.flash = null;
    this.bot = { x: 1.5, y: 1.5 };
    this.botTarget = null;
    this.botState = 'idle';
    this.sprite = 'robot';
    // static layer cache — rebuilt only on action/resize/reset, not per frame
    this.staticCanvas = null;
    this.staticDirty = true;
    this.animTiles = [];
    this.resize();
    var self = this;
    window.addEventListener('resize', function () { self.resize(); });
  }

  Renderer.prototype.reset = function (stage) {
    this.floaters = [];
    this.lastEventCount = 0;
    this.flash = null;
    this.bot = { x: 1.5, y: 1.5 };
    this.botTarget = null;
    this.botState = 'idle';
    this.sprite = stage.sprite || 'robot';
    this.staticDirty = true;
  };

  Renderer.prototype.resize = function () {
    var rect = this.canvas.parentElement.getBoundingClientRect();
    var w = Math.max(320, rect.width);
    var h = Math.max(240, rect.height - (document.getElementById('resourceBar') ?
      document.getElementById('resourceBar').getBoundingClientRect().height : 0));
    var dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.cssW = w; this.cssH = h; this.dpr = dpr;
    this.staticDirty = true;
  };

  Renderer.prototype.collectEvents = function (world) {
    var now = performance.now();
    var newOnes = 0;
    for (var i = this.lastEventCount; i < world.events.length; i++) {
      var ev = world.events[i];
      newOnes++;
      // stagger onto any floater already showing this tile
      var stagger = 0;
      for (var f = 0; f < this.floaters.length; f++) {
        if (this.floaters[f].tile === ev.tile) stagger += 15;
      }
      this.floaters.push({ name: ev.name, deltas: ev.deltas, tile: ev.tile, t0: now, stagger: stagger });
      if (ev.tile != null && world.grid[ev.tile]) {
        this.flash = { tile: ev.tile, t0: now };
        this.botTarget = { x: world.grid[ev.tile].x + 0.5, y: world.grid[ev.tile].y + 0.5 };
      }
    }
    this.lastEventCount = world.events.length;
    if (newOnes) this.staticDirty = true; // actions can change tiles/flags
    // expire + enforce the cap (oldest first)
    var cutoff = now - FLOADER_LIFE;
    this.floaters = this.floaters.filter(function (f) { return f.t0 > cutoff; });
    while (this.floaters.length > MAX_FLOATERS) this.floaters.shift();
  };

  Renderer.prototype.moveBot = function (dt) {
    if (!this.botTarget) {
      this.botState = (this.flash && performance.now() - this.flash.t0 < 450) ? 'work' : 'idle';
      return;
    }
    this.botState = 'walk';
    var dx = this.botTarget.x - this.bot.x;
    var dy = this.botTarget.y - this.bot.y;
    var dist = Math.hypot(dx, dy);
    if (dist < 0.06) { this.bot.x = this.botTarget.x; this.bot.y = this.botTarget.y; this.botTarget = null; return; }
    var step = Math.min(dist, 6 * dt); // 6 tiles per second — visible glide
    this.bot.x += (dx / dist) * step;
    this.bot.y += (dy / dist) * step;
  };

  // ---------- tiles ----------

  Renderer.prototype.drawTileStatic = function (ctx, t, x, y, size) {
    var def = TILES[t.type] || { fill: '#555' };
    var fill = def.ground ? ((t.x + t.y) % 2 ? def.fill : def.alt) : def.fill;
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, size, size);
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.strokeRect(x + 0.5, y + 0.5, size - 1, size - 1);

    var cx = x + size / 2, cy = y + size / 2;

    switch (t.type) {
      case 'farm':
        ctx.fillStyle = t.crop === 'wheat' ? '#d9b44a' : t.crop === 'fruit' ? '#d76a8b' : '#6fbf53';
        ctx.beginPath();
        ctx.arc(cx, cy, size * 0.18, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillRect(x + size * 0.2, y + size * 0.6, size * 0.6, 2);
        break;
      case 'shelter':
        ctx.fillStyle = '#d9d0c5';
        ctx.beginPath();
        ctx.moveTo(cx, y + size * 0.18);
        ctx.lineTo(x + size * 0.85, y + size * 0.5);
        ctx.lineTo(x + size * 0.15, y + size * 0.5);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#5a4632';
        ctx.fillRect(x + size * 0.3, y + size * 0.5, size * 0.4, size * 0.32);
        break;
      case 'panel':
        ctx.fillStyle = '#7fb3ff';
        ctx.fillRect(x + size * 0.18, y + size * 0.25, size * 0.64, size * 0.4);
        ctx.fillStyle = '#c9d6e8';
        ctx.fillRect(x + size * 0.46, y + size * 0.65, size * 0.08, size * 0.2);
        break;
      case 'mine':
        ctx.fillStyle = '#8a8496';
        ctx.beginPath();
        ctx.moveTo(cx, y + size * 0.22);
        ctx.lineTo(x + size * 0.78, cy + size * 0.1);
        ctx.lineTo(x + size * 0.72, y + size * 0.74);
        ctx.lineTo(x + size * 0.28, y + size * 0.74);
        ctx.lineTo(x + size * 0.22, cy + size * 0.1);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#e8cf6a';
        ctx.fillRect(cx - 1.5, cy - 1.5, 3, 3);
        break;
      case 'recycler':
        ctx.strokeStyle = '#9fe6c0';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, size * 0.24, 0.4, Math.PI * 1.8);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(cx + size * 0.2, cy - size * 0.16);
        ctx.lineTo(cx + size * 0.3, cy + size * 0.02);
        ctx.lineTo(cx + size * 0.12, cy + size * 0.02);
        ctx.closePath();
        ctx.fillStyle = '#9fe6c0';
        ctx.fill();
        ctx.lineWidth = 1;
        break;
      case 'forest':
        ctx.fillStyle = '#1f4d24';
        ctx.fillRect(cx - 2, cy + size * 0.05, 4, size * 0.28);
        ctx.fillStyle = '#54b060';
        ctx.beginPath();
        ctx.moveTo(cx, y + size * 0.12);
        ctx.lineTo(x + size * 0.78, cy + size * 0.12);
        ctx.lineTo(x + size * 0.22, cy + size * 0.12);
        ctx.closePath();
        ctx.fill();
        break;
      case 'wetland':
        ctx.strokeStyle = 'rgba(210,255,240,0.5)';
        ctx.beginPath();
        ctx.moveTo(x + size * 0.2, y + size * 0.4);
        ctx.lineTo(x + size * 0.45, y + size * 0.4);
        ctx.moveTo(x + size * 0.55, y + size * 0.6);
        ctx.lineTo(x + size * 0.8, y + size * 0.6);
        ctx.stroke();
        ctx.fillStyle = '#63c9a8';
        ctx.fillRect(cx - 1, y + size * 0.3, 2, size * 0.4);
        break;
      case 'factory':
        ctx.fillStyle = '#3a3540';
        ctx.fillRect(x + size * 0.2, y + size * 0.4, size * 0.6, size * 0.42);
        ctx.fillStyle = '#7a7480';
        ctx.fillRect(x + size * 0.6, y + size * 0.14, size * 0.14, size * 0.3);
        if (t.restricted) {
          ctx.strokeStyle = '#e06060';
          ctx.lineWidth = 2;
          ctx.strokeRect(x + 3, y + 3, size - 6, size - 6);
          ctx.lineWidth = 1;
          ctx.fillStyle = '#e06060';
          ctx.font = 'bold ' + Math.floor(size * 0.4) + 'px system-ui';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('×', cx, cy);
          ctx.textBaseline = 'alphabetic';
        }
        break;
      case 'filter':
        ctx.fillStyle = '#d7e8ff';
        ctx.fillRect(x + size * 0.22, y + size * 0.24, size * 0.56, size * 0.52);
        ctx.strokeStyle = '#2d4a7a';
        ctx.beginPath();
        ctx.arc(cx, cy, size * 0.16, 0, Math.PI * 2);
        ctx.stroke();
        break;
      case 'gym':
        ctx.fillStyle = '#e8d9f5';
        ctx.fillRect(x + size * 0.2, cy - 2, size * 0.6, 4);
        ctx.fillRect(x + size * 0.16, cy - size * 0.16, size * 0.1, size * 0.32);
        ctx.fillRect(x + size * 0.74, cy - size * 0.16, size * 0.1, size * 0.32);
        break;
      case 'park':
        ctx.fillStyle = '#7ed98a';
        ctx.beginPath();
        ctx.arc(x + size * 0.35, cy, size * 0.16, 0, Math.PI * 2);
        ctx.arc(x + size * 0.65, cy - size * 0.08, size * 0.14, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#5a4632';
        ctx.fillRect(x + size * 0.32, cy, 3, size * 0.24);
        ctx.fillRect(x + size * 0.63, cy - size * 0.02, 3, size * 0.26);
        break;
      case 'kitchen':
        ctx.fillStyle = '#f5e6d0';
        ctx.fillRect(x + size * 0.24, y + size * 0.36, size * 0.52, size * 0.36);
        ctx.fillStyle = '#c96a3f';
        ctx.fillRect(x + size * 0.24, y + size * 0.3, size * 0.52, size * 0.08);
        ctx.fillStyle = '#f5e6d0';
        ctx.fillRect(x + size * 0.4, y + size * 0.16, size * 0.2, size * 0.12);
        break;
    }
  };

  // animated overlays — kept out of the static cache
  Renderer.prototype.drawTileAnim = function (ctx, t, x, y, size, now) {
    var cx = x + size / 2, cy = y + size / 2;
    if (t.type === 'river') {
      if (t.x % 3 === 0) {
        ctx.strokeStyle = 'rgba(255,255,255,0.25)';
        ctx.beginPath();
        var wy = y + size * (0.35 + 0.12 * Math.sin((now / 500) + t.y));
        ctx.moveTo(x + size * 0.15, wy);
        ctx.lineTo(x + size * 0.85, wy);
        ctx.stroke();
      }
    } else if (t.type === 'factory' && !t.restricted) {
      ctx.fillStyle = 'rgba(180,180,190,0.5)';
      ctx.beginPath();
      ctx.arc(x + size * 0.67, y + size * 0.1 + Math.sin(now / 400) * 2, size * 0.09, 0, Math.PI * 2);
      ctx.fill();
    }
  };

  Renderer.prototype.buildStatic = function (world, stage) {
    if (!this.staticCanvas) this.staticCanvas = document.createElement('canvas');
    var sc = this.staticCanvas;
    if (sc.width !== this.canvas.width || sc.height !== this.canvas.height) {
      sc.width = this.canvas.width;
      sc.height = this.canvas.height;
    }
    var sctx = sc.getContext('2d');
    sctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    sctx.clearRect(0, 0, this.cssW, this.cssH);
    sctx.fillStyle = '#10131a';
    sctx.fillRect(0, 0, this.cssW, this.cssH);

    var size = this.tileSize, ox = this.ox, oy = this.oy;
    this.animTiles = [];
    for (var i = 0; i < world.grid.length; i++) {
      var t = world.grid[i];
      this.drawTileStatic(sctx, t, ox + t.x * size, oy + t.y * size, size);
      if (t.type === 'river' || t.type === 'factory') this.animTiles.push(t);
    }
    this.staticDirty = false;
  };

  // ---------- worker bot ----------

  Renderer.prototype.drawBot = function (px, py, size) {
    var ctx = this.ctx;
    var now = performance.now();
    var skin = this.sprite === 'robot' ? '#cfd6e0' : this.sprite === 'ranger' ? '#e8c39e' : '#f0c8a0';
    var shirt = this.sprite === 'robot' ? '#7c9bb5' : this.sprite === 'ranger' ? '#3f7d3a' : '#4a90d9';
    var bob, swing = 0;
    if (this.botState === 'walk') {
      bob = Math.abs(Math.sin(now / 90)) * -2;   // quick march bob
      swing = Math.sin(now / 90) * 3;            // arm/leg swing
    } else if (this.botState === 'work') {
      bob = 1.5 + Math.sin(now / 70) * 1.5;      // leaning into the job
      swing = Math.sin(now / 70) * 5;
    } else {
      bob = Math.sin(now / 550) * 0.8;           // slow idle breathing
    }

    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(px, py + size * 0.34, size * 0.24, size * 0.08, 0, 0, Math.PI * 2);
    ctx.fill();

    // legs (visible while walking)
    ctx.fillStyle = this.sprite === 'robot' ? '#5b6675' : '#2c3540';
    if (this.botState === 'walk') {
      ctx.fillRect(px - size * 0.12, py + size * 0.22 + swing, size * 0.09, size * 0.14);
      ctx.fillRect(px + size * 0.03, py + size * 0.22 - swing, size * 0.09, size * 0.14);
    } else {
      ctx.fillRect(px - size * 0.12, py + size * 0.22, size * 0.09, size * 0.14);
      ctx.fillRect(px + size * 0.03, py + size * 0.22, size * 0.09, size * 0.14);
    }

    // body
    ctx.fillStyle = shirt;
    ctx.fillRect(px - size * 0.16, py - size * 0.05 + bob, size * 0.32, size * 0.32);
    // arm / tool while working
    if (this.botState === 'work') {
      ctx.strokeStyle = shirt;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(px + size * 0.12, py + bob);
      ctx.lineTo(px + size * 0.3, py + bob + swing);
      ctx.stroke();
      ctx.lineWidth = 1;
    }
    // head
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.arc(px, py - size * 0.16 + bob, size * 0.16, 0, Math.PI * 2);
    ctx.fill();
    // eyes
    ctx.fillStyle = '#1a1d22';
    ctx.fillRect(px - size * 0.08, py - size * 0.19 + bob, size * 0.05, size * 0.05);
    ctx.fillRect(px + size * 0.03, py - size * 0.19 + bob, size * 0.05, size * 0.05);

    if (this.sprite === 'robot') {
      ctx.strokeStyle = '#cfd6e0';
      ctx.beginPath();
      ctx.moveTo(px, py - size * 0.32 + bob);
      ctx.lineTo(px, py - size * 0.42 + bob);
      ctx.stroke();
      ctx.fillStyle = '#e06060';
      ctx.beginPath();
      ctx.arc(px, py - size * 0.44 + bob, 2.2, 0, Math.PI * 2);
      ctx.fill();
    } else if (this.sprite === 'ranger') {
      ctx.fillStyle = '#2e5d2e';
      ctx.beginPath();
      ctx.arc(px, py - size * 0.2 + bob, size * 0.17, Math.PI, 0);
      ctx.fill();
      ctx.fillRect(px - size * 0.2, py - size * 0.22 + bob, size * 0.4, size * 0.05);
    } else {
      ctx.fillStyle = '#3a2f28';
      ctx.beginPath();
      ctx.arc(px, py - size * 0.16 + bob, size * 0.16, Math.PI, 0);
      ctx.fill();
    }
  };

  // ---------- main draw ----------

  Renderer.prototype.draw = function (world, stage, dt) {
    this.collectEvents(world);
    if (dt) this.moveBot(dt);
    var ctx = this.ctx;
    var cols = stage.COLS, rows = stage.ROWS;
    var pad = 8;
    var size = Math.min((this.cssW - pad * 2) / cols, (this.cssH - pad * 2) / rows);
    var ox = (this.cssW - size * cols) / 2;
    var oy = (this.cssH - size * rows) / 2;
    this.tileSize = size; this.ox = ox; this.oy = oy;

    var now = performance.now();
    if (this.staticDirty) this.buildStatic(world, stage);

    ctx.clearRect(0, 0, this.cssW, this.cssH);
    ctx.drawImage(this.staticCanvas, 0, 0, this.cssW, this.cssH);

    // animated tile bits only (river waves, factory smoke)
    for (var a = 0; a < this.animTiles.length; a++) {
      var at = this.animTiles[a];
      this.drawTileAnim(ctx, at, ox + at.x * size, oy + at.y * size, size, now);
    }

    // action flash on tile
    if (this.flash && now - this.flash.t0 < 450) {
      var ft = world.grid[this.flash.tile];
      if (ft) {
        var af = 1 - (now - this.flash.t0) / 450;
        ctx.strokeStyle = 'rgba(255,255,255,' + af + ')';
        ctx.lineWidth = 3;
        ctx.strokeRect(ox + ft.x * size + 2, oy + ft.y * size + 2, size - 4, size - 4);
        ctx.lineWidth = 1;
      }
    } else if (this.flash && now - this.flash.t0 >= 450) {
      this.flash = null;
    }

    // worker bot
    this.drawBot(ox + this.bot.x * size, oy + this.bot.y * size, size);

    // floating action labels — capped, staggered, biggest deltas only
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    var barInfo = {};
    (stage.bars || []).forEach(function (b) { barInfo[b.key] = { better: b.better, label: b.label }; });
    this.floaters.forEach(function (f) {
      var age = (now - f.t0) / FLOADER_LIFE;
      var px, py;
      if (f.tile != null && world.grid[f.tile]) {
        px = ox + (world.grid[f.tile].x + 0.5) * size;
        py = oy + world.grid[f.tile].y * size;
      } else {
        px = ox + size * cols / 2;
        py = oy + size * rows / 2;
      }
      py -= (f.stagger || 0) + age * 42;
      var alpha = age < 0.7 ? 1 : 1 - (age - 0.7) / 0.3;

      var parts = [];
      Object.keys(f.deltas).forEach(function (k) {
        if (k === 'tick') return;
        var d = f.deltas[k];
        var info = barInfo[k];
        var want = info ? info.better : null;
        var good = want === 'low' ? d < 0 : d > 0;
        parts.push({
          t: (info ? info.label : k) + ' ' + (d > 0 ? '+' : '') + Math.round(d * 10) / 10,
          m: Math.abs(d), good: good
        });
      });
      parts.sort(function (p, q) { return q.m - p.m; });
      parts = parts.slice(0, MAX_DELTA_LINES);

      ctx.fillStyle = 'rgba(255,255,255,' + alpha + ')';
      ctx.fillText(f.name, px, py);
      parts.forEach(function (p, idx) {
        ctx.fillStyle = (p.good ? 'rgba(120,220,140,' : 'rgba(255,140,120,') + alpha + ')';
        ctx.fillText(p.t, px, py + 13 * (idx + 1));
      });
    });
  };

  SDG.Renderer = Renderer;
})(typeof window !== 'undefined' ? window : globalThis);
