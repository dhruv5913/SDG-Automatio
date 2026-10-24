(function (root) {
  'use strict';
  var SDG = (root.SDG = root.SDG || {});

  var history = [];

  var COLORS = {
    hydration: '#38bdf8',
    nutrition: '#4ade80',
    shelter: '#fbbf24',
    energy: '#facc15',
    emissions: '#f87171',
    money: '#a78bfa',
    output: '#34d399',
    waste: '#fb923c',
    pollution: '#ef4444',
    safety: '#60a5fa',
    biodiversity: '#4ade80',
    air: '#38bdf8',
    water_quality: '#2dd4bf',
    carbon: '#f87171',
    soil: '#d97706',
    economy: '#a78bfa',
    sleep: '#818cf8',
    fitness: '#34d399',
    stress: '#ef4444',
    focus: '#38bdf8',
    screen: '#fb923c',
    discipline: '#facc15'
  };

  function reset() {
    history = [];
  }

  function record(stage, world) {
    var snap = { tick: world.tick };
    stage.goals.forEach(function (g) {
      snap[g.key] = world[g.key];
    });
    // add additional primary metrics
    ['energy', 'money', 'pollution', 'waste', 'carbon', 'stress', 'discipline'].forEach(function (k) {
      if (world[k] !== undefined) snap[k] = world[k];
    });
    history.push(snap);
  }

  function getHistory() {
    return history;
  }

  function render(canvas, stage) {
    if (!canvas || history.length === 0) return;
    var ctx = canvas.getContext('2d');
    var dpr = window.devicePixelRatio || 1;
    var w = canvas.clientWidth || canvas.width;
    var h = canvas.clientHeight || canvas.height;

    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.clearRect(0, 0, w, h);

    var padL = 36, padR = 14, padT = 16, padB = 24;
    var plotW = w - padL - padR;
    var plotH = h - padT - padB;

    // Draw background grid
    ctx.fillStyle = '#0f131a';
    ctx.fillRect(padL, padT, plotW, plotH);
    ctx.strokeStyle = '#1e2633';
    ctx.lineWidth = 1;

    for (var yStep = 0; yStep <= 100; yStep += 25) {
      var yPos = padT + plotH - (yStep / 100) * plotH;
      ctx.beginPath();
      ctx.moveTo(padL, yPos);
      ctx.lineTo(padL + plotW, yPos);
      ctx.stroke();

      ctx.fillStyle = '#536377';
      ctx.font = '10px Consolas, monospace';
      ctx.textAlign = 'right';
      ctx.fillText(String(yStep), padL - 6, yPos + 3);
    }

    var maxTick = stage.TICK_LIMIT || 80;
    for (var tStep = 0; tStep <= maxTick; tStep += 20) {
      var xPos = padL + (tStep / maxTick) * plotW;
      ctx.beginPath();
      ctx.moveTo(xPos, padT);
      ctx.lineTo(xPos, padT + plotH);
      ctx.stroke();

      ctx.fillStyle = '#536377';
      ctx.font = '10px Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(String(tStep), xPos, padT + plotH + 15);
    }

    // Draw target threshold lines
    stage.goals.forEach(function (g) {
      if (typeof g.target === 'number' && g.target <= 100) {
        var ty = padT + plotH - (g.target / 100) * plotH;
        ctx.save();
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(padL, ty);
        ctx.lineTo(padL + plotW, ty);
        ctx.stroke();
        ctx.restore();
      }
    });

    // Draw metric lines
    stage.goals.forEach(function (g) {
      var color = COLORS[g.key] || '#38bdf8';
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();

      history.forEach(function (pt, idx) {
        var val = pt[g.key];
        if (typeof val !== 'number') return;
        var clamped = Math.max(0, Math.min(100, val));
        var px = padL + (pt.tick / maxTick) * plotW;
        var py = padT + plotH - (clamped / 100) * plotH;
        if (idx === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();
    });

    // Draw legend
    var legX = padL + 8;
    var legY = padT + 12;
    ctx.font = '10.5px Consolas, monospace';
    stage.goals.forEach(function (g) {
      var col = COLORS[g.key] || '#38bdf8';
      ctx.fillStyle = col;
      ctx.fillRect(legX, legY - 7, 8, 8);
      ctx.fillStyle = '#cbd5e1';
      ctx.textAlign = 'left';
      ctx.fillText(g.label, legX + 12, legY);
      legX += ctx.measureText(g.label).width + 24;
    });
  }

  SDG.Telemetry = {
    reset: reset,
    record: record,
    getHistory: getHistory,
    render: render
  };
})(typeof window !== 'undefined' ? window : globalThis);
