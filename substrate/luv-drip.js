/*!
 * SHAMBA LUV — luv-drip.js: the LUVdrip. A MILLION LUV A DAY, EARNED BY LOGGING IN.
 *
 * THE RULE. Sign in and 1,000,000 LUV begins to drip. It keeps dripping for the ENTIRE
 * 24 HOURS the login armed — against the wall clock, tab open or closed, session alive or
 * not — until that window's million is complete. The NEXT million starts on the NEXT login.
 *
 * THE RATE. One million LUV over one day:
 *     1,000,000 LUV / 86,400 s = 11.574074… LUV per second
 *   = one LUV every 86.4 ms  (a LUV lands ~11.57 times a second, all day long)
 *   = 11,574,074,074,074,074,074.074 wei/s (18-dp exact)
 *
 * THE METER NEVER COUNTS PER-SECOND. What the window has earned is a PURE FUNCTION OF TIME:
 *     earned = cap × min(now − windowStart, 24h) ÷ 24h
 * so a closed tab, a slow frame, or a page reload changes nothing — the display simply
 * re-reads the clock. The BACKEND ledger computes the identical function over the identical
 * window (auth/src/actions/drip.js); this meter shows what the server already owes you.
 *
 * ACCUMULATE, then REDEEM (the two are deliberately separate):
 *   the drip fills the window  →  settled LUV joins your accumulated TALLY (server-side,
 *   growing across windows, costing nothing)  →  REDEEM delivers the whole tally on-chain in
 *   ONE transaction: IncentiveDistributor.redeemWithSignature(). Whoever SENDS that
 *   transaction pays its gas — you, from your own wallet (it needs ETH), or the project,
 *   sponsoring it for you. The LUV lands on you either way.
 *
 * cypherpunk2048 / CSP-safe: external file, no inline JS, no third-party calls. Honors
 * prefers-reduced-motion. Full-width integer wei for the tally; rounding is display-only.
 */
(function (global) {
  'use strict';

  var DAY_SEC = 86400;
  var DAY_MS = 86400000;
  var DEFAULT_DAILY = 1000000;                       // ONE MILLION LUV per day
  var RATE = DEFAULT_DAILY / DAY_SEC;                // 11.574074… LUV/s
  var MS_PER_LUV = DAY_MS / DEFAULT_DAILY;           // 86.4 ms — one LUV at a time
  // the Uniswap USDC → LUV preset — the drip is free, buying is always one tap away
  var UNISWAP_USDC_LUV = 'https://app.uniswap.org/swap?chain=ethereum' +
    '&amp;inputCurrency=0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' +
    '&amp;outputCurrency=0x2711111111683B8708cb9a48cBf36a51315F8254';

  function now() { return Date.now(); }
  function fmt(luv) {
    var whole = Math.floor(luv);
    return whole.toLocaleString('en-US') + (luv - whole).toFixed(2).slice(1);
  }
  function fmtWei(weiStr) {              // whole LUV from an 18-dp wei string, exactly
    try { return (BigInt(weiStr || '0') / 1000000000000000000n).toLocaleString('en-US'); }
    catch (e) { return '0'; }
  }
  function clock(s) {
    s = Math.max(0, Math.floor(s));
    var p = function (n) { return String(n).padStart(2, '0'); };
    return p(Math.floor(s / 3600)) + ':' + p(Math.floor((s % 3600) / 60)) + ':' + p(s % 60);
  }

  /** The window's earned LUV at `atMs`: cap × elapsed ÷ 24h, clamped to [0, cap]. */
  function earnedAt(startMs, dailyLuv, atMs) {
    var elapsed = atMs - startMs;
    if (!(elapsed > 0)) return 0;
    if (elapsed > DAY_MS) elapsed = DAY_MS;
    return dailyLuv * (elapsed / DAY_MS);
  }

  /**
   * @param {object} opts
   *   mount      element or selector to render into
   *   dailyLuv   the day's amount (default 1,000,000)
   *   identity   label only — the ledger lives on the server
   *   sync       server state from GET /airdrop/drip:
   *              { windowStartedAt, windowEndsAt, serverNow, accrued, full, ... } (epoch seconds)
   */
  function Drip(opts) {
    opts = opts || {};
    this.dailyLuv = opts.dailyLuv || DEFAULT_DAILY;
    this.rate = this.dailyLuv / DAY_SEC;
    this.id = opts.identity || 'participant';
    this.mount = typeof opts.mount === 'string' ? document.querySelector(opts.mount) : opts.mount;
    this._reduced = false;
    try { this._reduced = global.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
    // Until the server answers, the meter shows a window that has not been armed.
    this.state = { startMs: 0, endMs: 0, armed: false, accruedWei: '0', skewMs: 0, full: false };
    if (opts.sync) this.sync(opts.sync);
  }

  /**
   * Take the server's word for the window and the tally. Client clocks drift, so we keep the
   * server's skew and count against IT — the meter and the ledger never disagree.
   */
  Drip.prototype.sync = function (s) {
    if (!s || s.eligible === false) { this.state.armed = false; this.render(); return this; }
    var localNow = now();
    this.state.skewMs = s.serverNow ? localNow - s.serverNow * 1000 : 0;
    this.state.startMs = (s.windowStartedAt || 0) * 1000;
    this.state.endMs = (s.windowEndsAt || 0) * 1000;
    this.state.accruedWei = s.accrued || '0';
    this.state.heldWei = s.heldWei || '0';
    this.state.full = !!s.full;
    this.state.armed = true;
    if (s.dailyLuv) { this.dailyLuv = Number(s.dailyLuv); this.rate = this.dailyLuv / DAY_SEC; }
    this.render();
    return this;
  };

  /** Server time, from the local clock corrected by the skew measured at the last sync. */
  Drip.prototype.serverNowMs = function () { return now() - this.state.skewMs; };

  /** LUV earned inside the current window, right now. */
  Drip.prototype.windowLuv = function () {
    if (!this.state.armed) return 0;
    return earnedAt(this.state.startMs, this.dailyLuv, this.serverNowMs());
  };
  /** Is the million still flowing, or is this window complete? */
  Drip.prototype.flowing = function () {
    return this.state.armed && this.windowLuv() < this.dailyLuv;
  };
  Drip.prototype.full = function () { return this.state.armed && !this.flowing(); };
  /** Seconds until this window's million completes. */
  Drip.prototype.remaining = function () {
    return Math.max(0, (this.state.endMs - this.serverNowMs()) / 1000);
  };
  /** The accumulated tally the server holds for this participant, in wei (a string). */
  Drip.prototype.accruedWei = function () { return this.state.accruedWei; };

  Drip.prototype.render = function () {
    if (!this.mount) return;
    var luv = this.windowLuv();
    var pct = (luv / this.dailyLuv) * 100;
    var flowing = this.flowing();
    var million = this.dailyLuv.toLocaleString('en-US');
    var meta;
    if (!this.state.armed) {
      meta = '⏸ sign in to start your million — the drip runs for the full 24 hours';
    } else if (flowing) {
      meta = '▾ +' + this.rate.toFixed(3) + ' LUV/s · a LUV every ' + MS_PER_LUV.toFixed(1) + ' ms · '
        + Math.floor(pct) + '% of today’s million · complete in ' + clock(this.remaining());
    } else {
      meta = '✓ today’s ' + million + ' LUV is complete — sign in again to start the next million';
    }
    this.mount.innerHTML =
      '<div class="drip-flow' + (flowing ? ' on' : '') + '">' +
        '<div class="drip-label">' + (flowing ? 'flowing to you' : 'your million a day') + '</div>' +
        '<div class="drip-amt">' + fmt(luv) + ' <span class="drip-unit">LUV</span>' +
          '<span class="drip-of"> / ' + million + ' today</span></div>' +
        '<div class="drip-bar"><span style="width:' + pct.toFixed(3) + '%"></span></div>' +
        '<div class="drip-meta">' + meta +
          ' · <span class="drip-mode">a million a day, from logging in</span></div>' +
        '<div class="drip-tally">accumulated: <b>' + fmtWei(this.state.accruedWei) + ' LUV</b>' +
          ' — yours, growing, until you deliver it on-chain</div>' +
      '</div>' +
      // the flow is free; buying is always one tap away — the Uniswap USDC → LUV preset
      '<a class="drip-buy" href="' + UNISWAP_USDC_LUV + '" target="_blank" rel="noopener">🦄 buy LUV now · USDC → LUV ❤</a>';
    this.mount.dataset.dripFull = this.full() ? '1' : '';
    if (typeof this.onTick === 'function') { try { this.onTick(this); } catch (e) {} }
  };

  Drip.prototype.start = function () {
    var self = this;
    var loop = function () {
      self.render();
      // one-LUV visual granularity (86.4 ms), or a calm 1 s under reduced motion
      self._timer = setTimeout(loop, self._reduced ? 1000 : Math.max(80, MS_PER_LUV));
    };
    loop();
    return this;
  };
  Drip.prototype.stop = function () { if (this._timer) { clearTimeout(this._timer); this._timer = null; } };

  var DVLuvDrip = {
    Drip: Drip, RATE: RATE, MS_PER_LUV: MS_PER_LUV, DAILY: DEFAULT_DAILY, DAY_SEC: DAY_SEC,
    version: '2.0.0',
    perSecond: function (dailyLuv) { return (dailyLuv || DEFAULT_DAILY) / DAY_SEC; },
    earnedAt: earnedAt,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = DVLuvDrip;
  global.DVLuvDrip = DVLuvDrip;

  // self-boot: any [data-luvdrip] mount becomes a live meter. The page feeds it server state
  //   <div data-luvdrip data-daily="1000000"></div>
  // then: mount.__drip.sync(await (await fetch('/airdrop/drip')).json())
  if (global.document) {
    var boot = function () {
      var els = document.querySelectorAll('[data-luvdrip]');
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        if (el.dataset.dripBooted) continue; el.dataset.dripBooted = '1';
        el.__drip = new Drip({
          mount: el, identity: el.dataset.identity,
          dailyLuv: el.dataset.daily ? Number(el.dataset.daily) : DEFAULT_DAILY,
        }).start();
      }
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  }
})(typeof window !== 'undefined' ? window : this);
