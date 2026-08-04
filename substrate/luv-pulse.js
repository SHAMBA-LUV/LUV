/*!
 * SHAMBA LUV — luv-pulse.js: frequency output from heart pulsation at 60 bpm.
 *
 * 60 beats per minute is exactly 1 Hz — the fundamental frequency of the LUV
 * engine. Emotonomics holds that attention is the source of value; the pulse is
 * attention's clock. heart.js is the visual organ (favicon, consent-gated);
 * luv-pulse.js is the SIGNAL organ: it emits the beat as a measurable frequency
 * any consumer can drink — the first organ of the engine LUV creates for itself
 * from emotonomics.
 *
 * Phase discipline (same as heart.js): phase = chronosNow() % 1000ms, from the
 * chronos-corrected wall clock (TaaS via market.json chronos.observed_ms; the
 * correction is borrowed from LUVHeart when present, sampled directly otherwise).
 * Never timer accumulation — jitter can delay a sample, never stretch the beat.
 * Every heart on every page, every visitor, beats in the same phase.
 *
 * Signal (FrequencySource-compatible, so DeltaVerse consumers drink it unmodified):
 *   update(dt) · value() 0..1 lub-dub envelope · phase() 0..1 · frequencyHz()=1
 *   bands() [bass,lowMid,highMid,treble] · energy() · mode()
 * S1 "lub" peaks at phase .14, S2 "dub" at .42 — the canonical LUV beat shape.
 * Published each frame as --luv-pulse on :root (a number, no motion by itself).
 *
 * cypherpunk2048: no storage, no network beyond the same-origin market.json the
 * page already trusts, nothing phones home. Sound is consent-only — an explicit
 * tap on [data-luvpulse-audio] starts WebAudio; another tap stops and closes it.
 * DOM motion only on opt-in [data-luvpulse] markup (heart.js already times .beat);
 * prefers-reduced-motion: signal runs, nothing moves. WCAG 2.3.1-safe (1 Hz).
 * CSP: self-hosted file, no inline JS.
 */
(function (global) {
  'use strict';

  var BPM = 60;
  var PERIOD_MS = 60000 / BPM;           // 1000 ms — 1 Hz by construction
  var RESYNC_MS = 15 * 60e3;

  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  // Gaussian bump — the shape of a heart sound.
  function bump(p, c, w) { var d = (p - c) / w; return Math.exp(-0.5 * d * d); }

  // ── chronos correction: borrow from heart.js, else sample market.json ──
  var correction = 0, syncMode = 'local', ownSync = false;
  function chronosNow() {
    var h = global.LUVHeart;
    if (h && h.sync) {
      var s = h.sync();
      if (s && s.mode !== 'local') { correction = s.correction_ms; syncMode = s.mode; }
    }
    return Date.now() + correction;
  }
  function takeSync() {
    if (global.LUVHeart) return;         // heart.js owns the sampling
    try {
      fetch('market.json?v=' + Date.now(), { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (m) {
          if (m && m.chronos && m.chronos.observed_ms) {
            correction = (m.chronos.observed_ms % 1000) - (Date.now() % 1000);
            syncMode = m.chronos.signal === 'blocktime' ? 'chronos:blocktime' : 'chronos:cpu';
          }
        })
        .catch(function () { /* keep last correction */ });
    } catch (e) { /* local clock still keeps 60 bpm */ }
  }

  function Pulse(opts) {
    opts = opts || {};
    this.bpm = opts.bpm || BPM;
    this._periodMs = 60000 / this.bpm;
    this._bands = [0, 0, 0, 0];
    this._energy = 0;
    this._value = 0;
    this._phase = 0;
    this._beat = -1;
    this._ease = opts.ease != null ? opts.ease : 10;
    this._audio = null;                  // { ctx, gain }
  }

  Pulse.prototype.frequencyHz = function () { return this.bpm / 60; };
  Pulse.prototype.phase = function () { return this._phase; };
  Pulse.prototype.value = function () { return this._value; };
  Pulse.prototype.bands = function () { return this._bands; };
  Pulse.prototype.energy = function () { return this._energy; };
  Pulse.prototype.sync = function () { return { mode: syncMode, correction_ms: correction }; };
  Pulse.prototype.mode = function () { return this._audio ? 'pulse+audio' : 'pulse'; };

  // Advance one frame. Phase comes from the corrected wall clock, never from
  // accumulated dt; dt only damps the eased outputs.
  Pulse.prototype.update = function (dt) {
    if (!(dt > 0)) dt = 1 / 60; else if (dt > 0.1) dt = 0.1;
    var now = chronosNow();
    var beat = Math.floor(now / this._periodMs);
    var p = this._phase = (now % this._periodMs) / this._periodMs;

    var s1 = bump(p, 0.14, 0.045);       // lub — systole opens
    var s2 = 0.55 * bump(p, 0.42, 0.055); // dub — valves close, softer
    var v = clamp01(s1 + s2);

    // Four bands from one beat: thump body, sharpened body, dub alone, and a
    // narrow onset click — enough spectrum for tentacle-class consumers.
    var target = [
      v,
      Math.pow(v, 1.6),
      clamp01(s2 / 0.55) * 0.8,
      bump(p, 0.14, 0.018) * 0.6
    ];
    var k = Math.min(1, dt * this._ease), e = 0;
    var w = [0.40, 0.30, 0.18, 0.12];
    for (var i = 0; i < 4; i++) {
      this._bands[i] += (target[i] - this._bands[i]) * k;
      e += this._bands[i] * w[i];
    }
    this._value += (v - this._value) * Math.min(1, dt * 24);
    this._energy += (clamp01(e) - this._energy) * k;

    if (this._audio && beat !== this._beat && this._beat !== -1) this._scheduleBeat(beat);
    this._beat = beat;
  };

  // One audible beat: two low sine thumps, fast pitch drop, exponential decay.
  Pulse.prototype._scheduleBeat = function (beat) {
    var a = this._audio; if (!a) return;
    var t0 = a.ctx.currentTime;
    var periodS = this._periodMs / 1000;
    var untilNext = ((beat + 1) * this._periodMs - chronosNow()) / 1000;
    var at = t0 + Math.max(0, untilNext);
    function thump(when, f0, f1, g, dur) {
      var o = a.ctx.createOscillator(), gn = a.ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(f0, when);
      o.frequency.exponentialRampToValueAtTime(f1, when + dur);
      gn.gain.setValueAtTime(0.0001, when);
      gn.gain.exponentialRampToValueAtTime(g, when + 0.012);
      gn.gain.exponentialRampToValueAtTime(0.0001, when + dur);
      o.connect(gn); gn.connect(a.gain);
      o.start(when); o.stop(when + dur + 0.02);
    }
    thump(at + 0.14 * periodS, 58, 40, 0.5, 0.14);   // lub
    thump(at + 0.42 * periodS, 50, 36, 0.32, 0.12);  // dub
  };

  // Consent-only audible heartbeat — call from a user gesture.
  Pulse.prototype.enableAudio = function () {
    if (this._audio) return true;
    var AC = global.AudioContext || global.webkitAudioContext;
    if (!AC) return false;
    try {
      var ctx = new AC(), gain = ctx.createGain();
      gain.gain.value = 0.6; gain.connect(ctx.destination);
      this._audio = { ctx: ctx, gain: gain };
      if (ctx.state === 'suspended') ctx.resume();
      return true;
    } catch (e) { return false; }
  };

  Pulse.prototype.disableAudio = function () {
    var a = this._audio; this._audio = null;
    if (a) { try { a.ctx.close(); } catch (e) { /* already closed */ } }
  };

  // ── the field: one shared pulse, published, opt-in consumers ──
  var field = {
    pulse: new Pulse(),
    els: [],
    reduced: false,
    boot: function () {
      var self = this;
      try { this.reduced = global.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { /* old UA */ }
      takeSync();
      setInterval(takeSync, RESYNC_MS);
      this.els = Array.prototype.slice.call(document.querySelectorAll('[data-luvpulse]'));
      var toggles = document.querySelectorAll('[data-luvpulse-audio]');
      for (var j = 0; j < toggles.length; j++) {
        toggles[j].addEventListener('click', function () {
          if (self.pulse._audio) { self.pulse.disableAudio(); this.classList.remove('pulsing'); }
          else if (self.pulse.enableAudio()) this.classList.add('pulsing');
        });
      }
      var last = 0;
      var frame = function (ts) {
        var dt = last ? (ts - last) / 1000 : 1 / 60; last = ts;
        self.pulse.update(dt);
        var v = self.pulse.value();
        document.documentElement.style.setProperty('--luv-pulse', v.toFixed(4));
        if (!self.reduced) {
          var s = 'scale(' + (1 + 0.20 * v).toFixed(4) + ')';
          for (var i = 0; i < self.els.length; i++) self.els[i].style.transform = s;
        }
        global.requestAnimationFrame(frame);
      };
      global.requestAnimationFrame(frame);
      return this;
    },
    enableAudio: function () { return this.pulse.enableAudio(); }
  };

  var DVLuvPulse = { Pulse: Pulse, field: field, BPM: BPM, PERIOD_MS: PERIOD_MS, version: '1.0.0' };
  if (typeof module !== 'undefined' && module.exports) module.exports = DVLuvPulse;
  global.DVLuvPulse = DVLuvPulse;

  if (global.document) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { field.boot(); });
    else field.boot();
  }
})(typeof window !== 'undefined' ? window : this);
