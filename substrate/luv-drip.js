/*!
 * SHAMBA LUV — luv-drip.js: the LUVdrip. A million LUV a day, delivered as a steady flow.
 *
 * THE RATE. One million LUV over one day:
 *     1,000,000 LUV / 86,400 s = 11.574074… LUV per second
 *   = one LUV every 86.4 ms  (a LUV lands ~11.57 times a second, all day long)
 *   = 1,000,000 × 1e18 wei / 86,400 = 11,574,074,074,074,074,074.074 wei/s (18-dp exact)
 * The flow is capped at 1,000,000 LUV per day — the drip fills the day and no more.
 *
 * TWO REWARD MODES (operator-settable via data-mode / opts.mode):
 *   login   — reward FROM LOGIN (presence). The drip only advances while you are signed in
 *             and the page is live. Log out and the flow stops; what you already earned is
 *             kept. This is the "stay logged in to keep receiving" model.
 *   accrual — reward FROM ACCRUAL (time). The drip advances against the wall clock since your
 *             last collection, whether or not you were watching; you return and collect the
 *             pile. Presence is not required, only coming back to collect.
 *
 * DELIVERY. This substrate is the METER, not the mint. It computes and displays what is owed
 * and persists it per identity; on-chain delivery is one batched `distributeReward(user,total)`
 * through the IncentiveDistributor REDEEM rail when the participant collects — a per-second
 * on-chain mint is neither gas-sane nor necessary. Client-side, the counter flows continuously.
 *
 * cypherpunk2048 / CSP-safe: external file, no inline JS, no network fetch. State lives in the
 * participant's own localStorage — your folder belongs to you. Honors prefers-reduced-motion.
 */
(function (global) {
  'use strict';

  var DAY_SEC = 86400;
  var DEFAULT_DAILY = 1000000;                 // one million LUV per day
  var RATE = DEFAULT_DAILY / DAY_SEC;          // 11.574074… LUV/s
  var MS_PER_LUV = (DAY_SEC * 1000) / DEFAULT_DAILY; // 86.4 ms — one LUV at a time

  function now() { return Date.now(); }
  function clampCap(v, cap) { return v < 0 ? 0 : v > cap ? cap : v; }
  function fmt(luv) {
    // whole-LUV with grouping + 2 decimals of the live sub-LUV flow
    var whole = Math.floor(luv);
    return whole.toLocaleString('en-US') + (luv - whole).toFixed(2).slice(1);
  }

  function Drip(opts) {
    opts = opts || {};
    this.mode = opts.mode === 'accrual' ? 'accrual' : 'login';
    this.dailyLuv = opts.dailyLuv || DEFAULT_DAILY;
    this.rate = this.dailyLuv / DAY_SEC;
    this.id = opts.identity || 'anon';
    this.key = 'luv-drip-' + this.mode + '-' + this.id;
    this.mount = typeof opts.mount === 'string' ? document.querySelector(opts.mount) : opts.mount;
    this._signedIn = opts.signedIn !== false;  // login mode gates on this
    this._reduced = false;
    try { this._reduced = global.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
    this._load();
  }

  // Persisted state: { accrued, dayStart, lastTick }
  Drip.prototype._load = function () {
    var s = null;
    try { s = JSON.parse(global.localStorage.getItem(this.key)); } catch (e) {}
    var t = now();
    if (!s || typeof s.dayStart !== 'number') s = { accrued: 0, dayStart: t, lastTick: t };
    // daily roll: a fresh day resets the allotment
    if (t - s.dayStart >= DAY_SEC * 1000) { s.accrued = 0; s.dayStart = t; s.lastTick = t; }
    // accrual mode credits the offline gap; login mode does not (presence required)
    if (this.mode === 'accrual') {
      var dt = (t - s.lastTick) / 1000;
      if (dt > 0) s.accrued = clampCap(s.accrued + dt * this.rate, this.dailyLuv);
    }
    s.lastTick = t;
    this.state = s; this._save();
  };
  Drip.prototype._save = function () {
    try { global.localStorage.setItem(this.key, JSON.stringify(this.state)); } catch (e) {}
  };

  // advance the meter; returns current accrued LUV
  Drip.prototype.tick = function () {
    var t = now(), s = this.state;
    if (t - s.dayStart >= DAY_SEC * 1000) { s.accrued = 0; s.dayStart = t; }
    var active = this.mode === 'accrual' || (this._signedIn && (global.document ? !document.hidden : true));
    if (active) {
      var dt = (t - s.lastTick) / 1000;
      if (dt > 0) s.accrued = clampCap(s.accrued + dt * this.rate, this.dailyLuv);
    }
    s.lastTick = t;
    return s.accrued;
  };

  Drip.prototype.accrued = function () { return this.state.accrued; };
  Drip.prototype.full = function () { return this.state.accrued >= this.dailyLuv; };
  Drip.prototype.setSignedIn = function (v) { this._signedIn = !!v; this.state.lastTick = now(); this._save(); };

  // collect: hand the accrued pile to a callback (the on-chain REDEEM), then reset the meter
  Drip.prototype.collect = function () {
    var owed = this.state.accrued;
    this.state.accrued = 0; this.state.lastTick = now(); this._save();
    return owed;
  };

  Drip.prototype.render = function () {
    if (!this.mount) return;
    var luv = this.accrued(), pct = (luv / this.dailyLuv) * 100;
    var flowing = this.mode === 'accrual' || (this._signedIn && (global.document ? !document.hidden : true));
    this.mount.innerHTML =
      '<div class="drip-amt">' + fmt(luv) + ' <span class="drip-unit">LUV</span></div>' +
      '<div class="drip-bar"><span style="width:' + pct.toFixed(3) + '%"></span></div>' +
      '<div class="drip-meta">' +
        (flowing ? '▾ +' + this.rate.toFixed(3) + ' LUV/s · one every ' + MS_PER_LUV.toFixed(1) + ' ms'
                 : '⏸ paused — sign in to resume the flow') +
        ' · ' + Math.floor(pct) + '% of today’s million' +
        ' · <span class="drip-mode">' + (this.mode === 'login' ? 'reward from login' : 'reward from accrual') + '</span>' +
      '</div>';
    this.mount.dataset.dripFull = this.full() ? '1' : '';
  };

  Drip.prototype.start = function () {
    var self = this;
    var loop = function () {
      self.tick(); self.render(); self._save();
      // save cadence is light; visual cadence follows one-LUV granularity (or slower if reduced)
      self._timer = setTimeout(loop, self._reduced ? 1000 : Math.max(80, MS_PER_LUV));
    };
    loop();
    if (global.document) document.addEventListener('visibilitychange', function () { if (!document.hidden) { self.state.lastTick = now(); } });
    return this;
  };

  var DVLuvDrip = {
    Drip: Drip, RATE: RATE, MS_PER_LUV: MS_PER_LUV, DAILY: DEFAULT_DAILY, version: '1.0.0',
    perSecond: function (dailyLuv) { return (dailyLuv || DEFAULT_DAILY) / DAY_SEC; }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = DVLuvDrip;
  global.DVLuvDrip = DVLuvDrip;

  // self-boot: any [data-luvdrip] mount becomes a live meter.
  //   <div data-luvdrip data-mode="login" data-identity="0x…" data-daily="1000000"></div>
  if (global.document) {
    var boot = function () {
      var els = document.querySelectorAll('[data-luvdrip]');
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        if (el.dataset.dripBooted) continue; el.dataset.dripBooted = '1';
        new Drip({
          mount: el, mode: el.dataset.mode,
          identity: el.dataset.identity, dailyLuv: el.dataset.daily ? Number(el.dataset.daily) : DEFAULT_DAILY,
          signedIn: el.dataset.signedin !== 'false'
        }).start();
      }
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  }
})(typeof window !== 'undefined' ? window : this);
