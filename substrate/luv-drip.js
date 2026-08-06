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
 * TWO ACTIONS — COLLECT then REDEEM (deliberately separate):
 *   COLLECT — the logged-in address banks the live flow. It moves the drip that has accrued this
 *             session into a `collected` balance keyed to that address, and resets the live meter.
 *             Off-chain, free, instant — the participant gathering their own flow. COLLECT is only
 *             available FROM THE LOGGED-IN ADDRESS (the meter is keyed to it).
 *   REDEEM  — the banked `collected` balance is delivered ON-CHAIN in one batched
 *             `distributeReward(user, collected)` through the IncentiveDistributor REDEEM rail
 *             (gas), then reset. A per-second on-chain mint is neither gas-sane nor necessary.
 * The flow drips → you COLLECT it to your address (free) → you REDEEM the pile to the chain (one tx).
 * `collected` persists across days until redeemed; only the live drip is daily-capped.
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
  // the Uniswap USDC → LUV preset — the drip is free, buying is always one tap away
  var UNISWAP_USDC_LUV = 'https://app.uniswap.org/swap?chain=ethereum' +
    '&amp;inputCurrency=0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' +
    '&amp;outputCurrency=0x2711111111683B8708cb9a48cBf36a51315F8254';

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

  // Persisted state: { accrued (live drip), collected (banked to the address), dayStart, lastTick }
  Drip.prototype._load = function () {
    var s = null;
    try { s = JSON.parse(global.localStorage.getItem(this.key)); } catch (e) {}
    var t = now();
    if (!s || typeof s.dayStart !== 'number') s = { accrued: 0, collected: 0, dayStart: t, lastTick: t };
    if (typeof s.collected !== 'number') s.collected = 0; // banked balance persists across days
    // daily roll: a fresh day resets only the live drip allotment — never the collected balance
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

  Drip.prototype.accrued = function () { return this.state.accrued; };   // the live-flowing drip
  Drip.prototype.collected = function () { return this.state.collected; }; // banked to the address, awaiting REDEEM
  Drip.prototype.full = function () { return this.state.accrued >= this.dailyLuv; };
  Drip.prototype.setSignedIn = function (v) { this._signedIn = !!v; this.state.lastTick = now(); this._save(); };

  // COLLECT — the logged-in address banks the live flow. Off-chain, free, instant: moves the
  // accrued drip into `collected` and resets the live meter. Returns the amount just collected.
  Drip.prototype.collect = function () {
    this.tick();
    var banked = this.state.accrued;
    this.state.collected += banked;
    this.state.accrued = 0; this.state.lastTick = now(); this._save();
    if (typeof this.onCollect === 'function') try { this.onCollect(banked, this.state.collected); } catch (e) {}
    return banked;
  };

  // REDEEM — deliver the banked `collected` balance ON-CHAIN (one distributeReward tx), then reset.
  // Returns the amount to redeem; the caller drives the backend /airdrop/redeem → distributeReward.
  Drip.prototype.redeem = function () {
    var owed = this.state.collected;
    this.state.collected = 0; this._save();
    if (typeof this.onRedeem === 'function') try { this.onRedeem(owed); } catch (e) {}
    return owed;
  };

  Drip.prototype.render = function () {
    if (!this.mount) return;
    var luv = this.accrued(), pct = (luv / this.dailyLuv) * 100;
    var flowing = this.mode === 'accrual' || (this._signedIn && (global.document ? !document.hidden : true));
    // the felt experience: LUV flowing IN to the participant — a live figure, a filling channel,
    // and the drop-cadence made visible. The arrow points inward (▾ into your balance).
    this.mount.innerHTML =
      '<div class="drip-flow' + (flowing ? ' on' : '') + '">' +
        '<div class="drip-label">flowing to you</div>' +
        '<div class="drip-amt">' + fmt(luv) + ' <span class="drip-unit">LUV</span></div>' +
        '<div class="drip-bar"><span style="width:' + pct.toFixed(3) + '%"></span></div>' +
        '<div class="drip-meta">' +
          (flowing ? '▾ +' + this.rate.toFixed(3) + ' LUV/s · a LUV every ' + MS_PER_LUV.toFixed(1) + ' ms · '
                     + Math.floor(pct) + '% of today’s million'
                   : '⏸ paused — sign in to resume the flow') +
          ' · <span class="drip-mode">' + (this.mode === 'login' ? 'reward from login' : 'reward from accrual') + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="drip-actions">' +
        '<button type="button" class="drip-collect" data-drip-collect' + (luv < 1 ? ' disabled' : '') + '>COLLECT ' + fmt(luv) + ' →</button>' +
        '<div class="drip-collected">collected: <b>' + fmt(this.collected()) + ' LUV</b>' +
          '<button type="button" class="drip-redeem" data-drip-redeem' + (this.collected() < 1 ? ' disabled' : '') + '>REDEEM on-chain →</button>' +
        '</div>' +
      '</div>' +
      // the flow is free; buying is always one tap away — the Uniswap USDC → LUV preset, front and centre
      '<a class="drip-buy" href="' + UNISWAP_USDC_LUV + '" target="_blank" rel="noopener">🦄 buy LUV now · USDC → LUV ❤</a>';
    var self = this;
    var cb = this.mount.querySelector('[data-drip-collect]');
    if (cb) cb.addEventListener('click', function () { self.collect(); self.render(); });
    var rb = this.mount.querySelector('[data-drip-redeem]');
    if (rb) rb.addEventListener('click', function () {
      var owed = self.collected();
      // hand the banked balance to the REDEEM rail; the page wires onRedeem to POST /airdrop/redeem
      if (typeof self.onRedeem !== 'function') { /* no rail wired — leave banked, do not reset */ return; }
      self.redeem(); self.render();
    });
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
