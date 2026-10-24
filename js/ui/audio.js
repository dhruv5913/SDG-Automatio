(function (root) {
  'use strict';
  var SDG = (root.SDG = root.SDG || {});

  var MUTE_KEY = 'sdg-sound-muted';
  var ctx = null;
  var muted = false;

  try {
    muted = localStorage.getItem(MUTE_KEY) === 'true';
  } catch (e) { /* ignore */ }

  function getCtx() {
    if (!ctx) {
      var AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) ctx = new AudioCtx();
    }
    if (ctx && ctx.state === 'suspended') {
      ctx.resume();
    }
    return ctx;
  }

  function tone(freq, type, duration, gainVal, endFreq) {
    if (muted) return;
    var ac = getCtx();
    if (!ac) return;
    var osc = ac.createOscillator();
    var gain = ac.createGain();
    var now = ac.currentTime;

    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, now);
    if (endFreq) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(10, endFreq), now + duration);
    }

    gain.gain.setValueAtTime(gainVal || 0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    osc.connect(gain);
    gain.connect(ac.destination);

    osc.start(now);
    osc.stop(now + duration);
  }

  function noise(duration, gainVal, filterFreq) {
    if (muted) return;
    var ac = getCtx();
    if (!ac) return;
    var bufferSize = Math.floor(ac.sampleRate * duration);
    var buffer = ac.createBuffer(1, bufferSize, ac.sampleRate);
    var data = buffer.getChannelData(0);
    for (var i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    var noiseSrc = ac.createBufferSource();
    noiseSrc.buffer = buffer;

    var filter = ac.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(filterFreq || 800, ac.currentTime);

    var gain = ac.createGain();
    gain.gain.setValueAtTime(gainVal || 0.1, ac.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + duration);

    noiseSrc.connect(filter);
    filter.connect(gain);
    gain.connect(ac.destination);

    noiseSrc.start(ac.currentTime);
  }

  var SFX = {
    click: function () { tone(1200, 'sine', 0.04, 0.08); },
    step: function () { tone(480, 'sine', 0.05, 0.07, 300); },
    water: function () {
      noise(0.18, 0.14, 600);
      tone(400, 'sine', 0.15, 0.1, 260);
    },
    plant: function () {
      tone(523, 'triangle', 0.12, 0.12);
      setTimeout(function () { tone(659, 'triangle', 0.15, 0.1); }, 60);
    },
    build: function () {
      tone(180, 'square', 0.08, 0.15, 80);
      noise(0.08, 0.12, 1200);
    },
    solar: function () {
      tone(880, 'sine', 0.1, 0.12);
      setTimeout(function () { tone(1320, 'sine', 0.22, 0.1); }, 70);
    },
    burn: function () {
      noise(0.2, 0.2, 350);
      tone(90, 'sawtooth', 0.2, 0.15, 50);
    },
    mine: function () {
      tone(800, 'triangle', 0.12, 0.2, 400);
      noise(0.1, 0.1, 1500);
    },
    smelt: function () {
      noise(0.25, 0.18, 500);
      tone(220, 'sawtooth', 0.2, 0.1, 140);
    },
    assemble: function () {
      tone(600, 'square', 0.05, 0.08, 400);
      setTimeout(function () { tone(800, 'square', 0.06, 0.08); }, 50);
    },
    ship: function () {
      tone(523, 'sine', 0.1, 0.15);
      setTimeout(function () { tone(784, 'sine', 0.25, 0.16); }, 90);
    },
    recycle: function () {
      tone(350, 'sawtooth', 0.18, 0.1, 550);
    },
    tree: function () {
      tone(440, 'triangle', 0.12, 0.12);
      setTimeout(function () { tone(554, 'triangle', 0.16, 0.12); }, 60);
    },
    sleep: function () {
      tone(330, 'sine', 0.35, 0.12, 220);
    },
    work: function () {
      tone(300, 'square', 0.08, 0.1, 200);
    },
    warning: function () {
      tone(440, 'sawtooth', 0.12, 0.2);
      setTimeout(function () { tone(370, 'sawtooth', 0.15, 0.22); }, 130);
    },
    error: function () {
      tone(160, 'sawtooth', 0.22, 0.25, 100);
    },
    fanfare: function () {
      var notes = [523.25, 659.25, 783.99, 1046.5];
      notes.forEach(function (n, i) {
        setTimeout(function () { tone(n, 'triangle', 0.3, 0.18); }, i * 110);
      });
    }
  };

  function play(name) {
    if (muted) return;
    if (SFX[name]) {
      try { SFX[name](); } catch (e) { /* ignore */ }
    } else {
      SFX.click();
    }
  }

  function playForAction(name) {
    if (name.indexOf('water') !== -1 || name.indexOf('river') !== -1) play('water');
    else if (name.indexOf('plant') !== -1) play('plant');
    else if (name.indexOf('shelter') !== -1 || name.indexOf('gym') !== -1 || name.indexOf('park') !== -1 || name.indexOf('kitchen') !== -1) play('build');
    else if (name.indexOf('solar') !== -1) play('solar');
    else if (name.indexOf('burn') !== -1 || name.indexOf('fuel') !== -1 || name.indexOf('grid') !== -1) play('burn');
    else if (name.indexOf('mine') !== -1) play('mine');
    else if (name.indexOf('smelt') !== -1) play('smelt');
    else if (name.indexOf('assemble') !== -1) play('assemble');
    else if (name.indexOf('ship') !== -1) play('ship');
    else if (name.indexOf('recycle') !== -1) play('recycle');
    else if (name.indexOf('sleep') !== -1 || name.indexOf('meditate') !== -1) play('sleep');
    else if (name.indexOf('work') !== -1) play('work');
    else play('step');
  }

  function toggleMute() {
    muted = !muted;
    try { localStorage.setItem(MUTE_KEY, String(muted)); } catch (e) { /* ignore */ }
    if (!muted) play('click');
    return muted;
  }

  function isMuted() {
    return muted;
  }

  SDG.Audio = {
    play: play,
    playForAction: playForAction,
    toggleMute: toggleMute,
    isMuted: isMuted
  };
})(typeof window !== 'undefined' ? window : globalThis);
