/*!
 * SHAMBA LUV — the LUVchart substrate (DVLuvChart).
 *
 * The chart that carries the name. view.html measures the market in a card; this one
 * gives the price the whole page, marked with the LUV coin itself: the gold binary
 * heart is the live dot, the watermark, and the page's mark. Everything is drawn from
 * the same-origin mirror — market.json (live), market-history.json (48h at one point a
 * minute) and market-trades.json (the pair's own swap log, since the seed) — so the CSP
 * stays connect-src 'self' and the collector alone talks to the chain.
 *
 * Two series, because there are two truths at two clocks:
 *   • the minute series — 15M…48H, sampled once a minute by the collector;
 *   • the TRADE series — ALL, since the seed, built from the swap log itself. Price on a
 *     V2 pair only moves when someone trades, so between trades the honest curve is a
 *     step, and the step is what gets drawn.
 *
 * Rendered with the in-house d3 v7 (substrate/d3.min.js), loaded first. Nothing else:
 * no Chart.js, no CDN, no npm — cypherpunk4096 §2, vendor everything or do without.
 *
 * Self-boots into every [data-luvchart] mount, or drive it yourself:
 *   var c = new DVLuvChart.Chart('#luvchart', { height: 560 }); c.start();
 */
(function (global) {
  'use strict';

  var PAIR = '0x57D2085Aa859a145cB107845AD03c0eAAFBD8a31';
  var COIN = 'gfx/logo-transparent.png';        // the mark: the gold binary heart
  var SEED_PRICE_NATIVE = 1e-17;                 // the seed — exactly 10 wei per LUV
  // TRADINGVIEW CLASSIC (operator, 2026-08-17): up is the top of the screen, and an up bar — a
  // close above its open — is the classic candle green; a close below is the classic candle red.
  // The indicators wear TradingView's own defaults too, so a trader reads this chart on sight:
  // Bollinger basis orange over blue bands, MACD blue over signal orange, the four-shade histogram.
  var UP = '#26a69a', UPSOFT = '#4dd0c4', DOWN = '#ef5350', DOWNSOFT = '#ff8a80', FLAT = '#b98da0';
  var TV = {
    bbLine: '#2962FF', bbBasis: '#FF6D00', bbFill: 'rgba(41,98,255,.10)',
    macd: '#2962FF', signal: '#FF6D00',
    histGA: '#26A69A', histFA: '#B2DFDB', histGB: '#FFCDD2', histFB: '#FF5252'
  };
  var BB_N = 20, BB_K = 2, MACD_F = 12, MACD_S = 26, MACD_SIG = 9;
  var GOLD = '#e3b25f', SEAM = '#4a1f30', DIM = '#b98da0';
  var REFRESH_MS = 5 * 60e3;                     // full refresh from the mirror: 5 minutes
  var PRICE_MS = 60e3;                           // light price tick from the mirror: 1 minute

  // ── the zoom ladder ── the same gesture the rainbow uses: − and + step the rungs.
  var WINDOWS = [
    { k: '15m', lbl: '15M', ms: 15 * 60e3, bucket: 60e3 },
    { k: '1h', lbl: '1H', ms: 3600e3, bucket: 2 * 60e3 },
    { k: '4h', lbl: '4H', ms: 4 * 3600e3, bucket: 5 * 60e3 },
    { k: '12h', lbl: '12H', ms: 12 * 3600e3, bucket: 15 * 60e3 },
    { k: '24h', lbl: '24H', ms: 24 * 3600e3, bucket: 30 * 60e3 },
    { k: '48h', lbl: '48H', ms: 48 * 3600e3, bucket: 60 * 60e3 },
    { k: 'all', lbl: 'ALL', ms: 0, bucket: 24 * 3600e3 }
  ];
  function winIndex(k) { for (var i = 0; i < WINDOWS.length; i++) if (WINDOWS[i].k === k) return i; return 4; }

  function grp(s) { return s.replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function fmtNum(v, dec) {
    var p = Number(v).toFixed(dec).split('.');
    return grp(p[0]) + (p[1] ? '.' + p[1] : '');
  }
  function fmtPct(v) {
    if (v === null || v === undefined || isNaN(v)) return '—';
    return (v > 0 ? '+' : '') + Number(v).toFixed(2) + '%';
  }
  function pctClass(v) {
    if (v === null || v === undefined || isNaN(v) || Number(v) === 0) return 'flat';
    return v > 0 ? 'up' : 'down';
  }
  function fmtUsd(v) {
    var n = Number(v);
    if (!(n > 0)) return '—';
    if (n >= 1) return '$' + fmtNum(n, 2);
    return '$' + n.toFixed(n < 0.01 ? 6 : 4);
  }
  // enough decimals that neighbouring ticks stay distinct — approximation is display-only
  function decFor(span, base, cap) {
    if (!(span > 0)) return base;
    return Math.min(Math.max(Math.ceil(-Math.log10(span / 5)) + 1, base), cap);
  }
  function shortHash(h) { return h ? h.slice(0, 6) + '…' + h.slice(-4) : '—'; }

  // ── indicator math — plain arrays, index-aligned to their input, NaN where undefined ──
  // Computed over EVERY bar the series holds, not only the visible ones, so the first visible bar
  // already carries a settled reading — the way a charting terminal warms an indicator up on the
  // bars to the left of the screen.
  function smaSeries(v, n) {
    var out = new Array(v.length).fill(NaN), sum = 0;
    for (var i = 0; i < v.length; i++) {
      sum += v[i]; if (i >= n) sum -= v[i - n];
      if (i >= n - 1) out[i] = sum / n;
    }
    return out;
  }
  function stdevSeries(v, n, mean) {
    var out = new Array(v.length).fill(NaN);
    for (var i = n - 1; i < v.length; i++) {
      var ss = 0;
      for (var j = i - n + 1; j <= i; j++) { var d = v[j] - mean[i]; ss += d * d; }
      out[i] = Math.sqrt(ss / n);            // population σ — what TradingView's BB uses
    }
    return out;
  }
  function emaSeries(v, n) {
    var out = new Array(v.length).fill(NaN), k = 2 / (n + 1), prev = NaN, seed = 0, cnt = 0;
    for (var i = 0; i < v.length; i++) {
      if (isNaN(prev)) { seed += v[i]; cnt++; if (cnt === n) { prev = seed / n; out[i] = prev; } continue; }
      prev = v[i] * k + prev * (1 - k); out[i] = prev;
    }
    return out;
  }
  function macdSeries(v, f, sl, sg) {
    var ef = emaSeries(v, f), es = emaSeries(v, sl), line = v.map(function (_, i) { return ef[i] - es[i]; });
    // the signal EMA runs on the MACD line where it exists
    var start = -1; for (var i = 0; i < line.length; i++) if (!isNaN(line[i])) { start = i; break; }
    var sig = new Array(v.length).fill(NaN);
    if (start >= 0) { var sub = emaSeries(line.slice(start), sg); for (i = 0; i < sub.length; i++) sig[start + i] = sub[i]; }
    return { line: line, signal: sig, hist: line.map(function (x, i) { return x - sig[i]; }) };
  }
  function utc(ms, withSec) {
    var d = new Date(ms), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate()) + ' ' +
      p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()) + (withSec ? ':' + p(d.getUTCSeconds()) : '') + ' UTC';
  }
  function clock(ms) {
    var d = new Date(ms), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()) + ':' + p(d.getUTCSeconds()) + ' UTC';
  }

  // ── one price, three expressions ──
  // Each point is [ms, priceUsd, priceNative] whatever series it came from, so a unit is
  // just a projection plus the vocabulary to print it. Full precision rides in the data.
  var UNITS = {
    usdc: {
      btn: '$ 1T', title: 'one trillion LUV — a million millions — priced in USDC',
      head: '1T LUV', unitlbl: 'USDC',
      val: function (p) { return Number(p[1]); },
      big: function (v) { return '$' + Number(v * 1e12).toFixed(v * 1e12 < 1 ? 6 : 4); },
      axis: function (v, d) { return '$' + Number(v * 1e12).toFixed(d); },
      dec: function (span) { return decFor(span * 1e12, 3, 8); },
      tip: function (v, d) { return '$' + Number(v * 1e12).toFixed(Math.max(d, 6)); }
    },
    wei: {
      btn: 'WEI', title: 'wei per ONE LUV — the seed was exactly 10 wei',
      head: '1 LUV', unitlbl: 'WEI',
      val: function (p) { return Number(p[2]) * 1e18; },
      big: function (v) { return fmtNum(v, 6); },
      axis: function (v, d) { return Number(v).toFixed(d); },
      dec: function (span) { return decFor(span, 2, 6); },
      tip: function (v, d) { return fmtNum(v, Math.max(d, 4)) + ' wei'; }
    },
    ethluv: {
      btn: 'Ξ', title: 'LUV per ONE ETH, in trillions — the inverse measure',
      head: '1 ETH', unitlbl: 'T LUV',
      val: function (p) { var n = Number(p[2]); return n > 0 ? 1 / n : NaN; },
      big: function (v) { return fmtNum(v / 1e12, 4) + 'T'; },
      axis: function (v, d) { return Number(v / 1e12).toFixed(d) + 'T'; },
      dec: function (span) { return decFor(span / 1e12, 2, 6); },
      tip: function (v, d) { return fmtNum(v / 1e12, Math.max(d, 4)) + 'T LUV'; }
    }
  };
  var UNIT_ORDER = ['usdc', 'wei', 'ethluv'];

  function store(k, v) { try { global.localStorage.setItem(k, v); } catch (e) { /* private */ } }
  function recall(k, dflt, ok) {
    try { var v = global.localStorage.getItem(k); if (v !== null && (!ok || ok(v))) return v; } catch (e) { /* private */ }
    return dflt;
  }

  function Chart(sel, opts) {
    this.root = typeof sel === 'string' ? document.querySelector(sel) : sel;
    if (!this.root) throw new Error('DVLuvChart: no mount for ' + sel);
    opts = opts || {};
    this.height = Number(this.root.getAttribute('data-height')) || opts.height || 520;
    this.unit = recall('luvchart-unit', 'usdc', function (v) { return !!UNITS[v]; });
    this.win = recall('luvchart-win', '24h', function (v) { return winIndex(v) >= 0; });
    this.mode = recall('luvchart-mode', 'line', function (v) { return v === 'line' || v === 'candles'; });
    this.log = recall('luvchart-log', '0') === '1';
    this.trades = recall('luvchart-trades', '1') === '1';
    this.bb = recall('luvchart-bb', '1') === '1';
    this.macd = recall('luvchart-macd', '1') === '1';
    this.market = null; this.history = null; this.tape = null;
    this._lastTx = null;
    // claim the mount: a second chart built on the same element would rebuild the skeleton
    // under the first one's feet and leave it drawing into a detached tree
    if (this.root.__luvchart && this.root.__luvchart.stop) this.root.__luvchart.stop();
    this.root.__luvchart = this;
    this._skeleton();
  }

  Chart.prototype._skeleton = function () {
    this.root.classList.add('lc');
    this.root.innerHTML =
      '<div class="lc-head">' +
        '<img class="lc-mark" src="' + COIN + '" alt="SHAMBA LUV" width="46" height="46">' +
        '<div class="lc-id">' +
          '<div class="lc-name">LUV<b>chart</b></div>' +
          '<div class="lc-pair">LUV / WETH · Uniswap V2 · the pair creates the price</div>' +
        '</div>' +
        '<span class="lc-spacer"></span>' +
        '<div class="lc-readout">' +
          '<div class="lc-big"><span class="lc-amt">1T LUV</span> <span class="lc-price">—</span></div>' +
          '<div class="lc-sub"><span class="lc-pct flat">—</span><span class="lc-winlbl">24H</span>' +
          '<span class="lc-xs">×—<small> since the seed</small></span></div>' +
        '</div>' +
      '</div>' +
      '<div class="lc-ctl">' +
        '<div class="lc-zoom"><button type="button" data-zoom="out" title="zoom out — a longer window">−</button>' +
        '<span class="lc-zlbl">24H</span>' +
        '<button type="button" data-zoom="in" title="zoom in — a shorter window">+</button></div>' +
        '<div class="lc-pills lc-wins"></div>' +
        '<span class="lc-spacer"></span>' +
        '<div class="lc-pills lc-units"></div>' +
        '<div class="lc-pills lc-modes"></div>' +
      '</div>' +
      '<div class="lc-plot"><svg role="img" aria-label="the LUV price"></svg><div class="lc-tip" hidden></div></div>' +
      '<div class="lc-cap">reading the mirror…</div>';

    var self = this, q = function (s) { return self.root.querySelector(s); };
    this.el = {
      price: q('.lc-price'), amt: q('.lc-amt'), pct: q('.lc-pct'), winlbl: q('.lc-winlbl'),
      xs: q('.lc-xs'), zlbl: q('.lc-zlbl'), wins: q('.lc-wins'), units: q('.lc-units'),
      modes: q('.lc-modes'), plot: q('.lc-plot'), svg: q('.lc-plot svg'), tip: q('.lc-tip'),
      cap: q('.lc-cap')
    };

    WINDOWS.forEach(function (w) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'lc-pill'; b.textContent = w.lbl; b.setAttribute('data-win', w.k);
      b.title = w.k === 'all' ? 'every trade since the seed — the pair\'s own swap log' : 'the last ' + w.lbl;
      b.addEventListener('click', function () { self.setWin(w.k); });
      self.el.wins.appendChild(b);
    });
    UNIT_ORDER.forEach(function (k) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'lc-pill'; b.textContent = UNITS[k].btn;
      b.title = UNITS[k].title; b.setAttribute('data-unit', k);
      b.addEventListener('click', function () { self.unit = k; store('luvchart-unit', k); self._renderAll(); });
      self.el.units.appendChild(b);
    });
    [['mode', 'candles', 'candles — open, high, low, close per bucket'],
     ['log', 'LOG', 'logarithmic price axis — equal ratios take equal space'],
     ['trades', 'TRADES', 'the swap log itself, plotted: green buys, red sells'],
     ['bb', 'BB', 'Bollinger Bands (20, 2) — TradingView defaults: SMA basis, ±2σ bands'],
     ['macd', 'MACD', 'MACD (12, 26, 9) — TradingView defaults: MACD line, signal, histogram — in its own pane below']
    ].forEach(function (m) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'lc-pill'; b.textContent = m[1]; b.title = m[2];
      b.setAttribute('data-toggle', m[0]);
      b.addEventListener('click', function () {
        if (m[0] === 'mode') { self.mode = self.mode === 'line' ? 'candles' : 'line'; store('luvchart-mode', self.mode); }
        else if (m[0] === 'log') { self.log = !self.log; store('luvchart-log', self.log ? '1' : '0'); }
        else if (m[0] === 'bb') { self.bb = !self.bb; store('luvchart-bb', self.bb ? '1' : '0'); }
        else if (m[0] === 'macd') { self.macd = !self.macd; store('luvchart-macd', self.macd ? '1' : '0'); }
        else { self.trades = !self.trades; store('luvchart-trades', self.trades ? '1' : '0'); }
        self._renderAll();
      });
      self.el.modes.appendChild(b);
    });
    this.root.querySelectorAll('[data-zoom]').forEach(function (b) {
      b.addEventListener('click', function () {
        var i = winIndex(self.win) + (b.getAttribute('data-zoom') === 'in' ? -1 : 1);
        self.setWin(WINDOWS[Math.max(0, Math.min(WINDOWS.length - 1, i))].k);
      });
    });
  };

  Chart.prototype.setWin = function (k) {
    this.win = k; store('luvchart-win', k); this._renderAll();
  };

  // ── the mirror ── no-cache so a changed file is never missed; the vhost's own max-age
  // absorbs same-window refetches. Nothing here reaches past this origin.
  Chart.prototype._fetch = function () {
    var self = this;
    return Promise.all([
      fetch('market.json', { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
      fetch('market-history.json', { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
      fetch('market-trades.json', { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
    ]).then(function (r) {
      if (r[0]) self.market = r[0];
      if (r[1] && r[1].points) self.history = r[1].points;
      if (r[2] && r[2].trades) { self.tape = r[2]; self._flashNew(); }
      return self;
    });
  };
  Chart.prototype._fetchPrice = function () {
    var self = this;
    return fetch('market.json', { cache: 'no-cache' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (m) { if (m) self.market = m; return self; })
      .catch(function () { return self; });
  };
  // a swap the page has not seen yet paints the boundary — the frame never fetches, and
  // this reader already holds the log.
  Chart.prototype._flashNew = function () {
    var t = this.tape && this.tape.trades, n = t && t.length ? t[t.length - 1] : null;
    if (!n) return;
    var tx = n[8] + ':' + n[9];
    if (this._lastTx && this._lastTx !== tx && global.DVLuvFrame && global.DVLuvFrame.flash) global.DVLuvFrame.flash(n[2]);
    this._lastTx = tx;
  };

  // ── the two series ──
  // minute series: the collector's samples, [ms, priceUsd, priceNative].
  // trade series: the swap log, rebuilt into the same shape. A trade carries its own USD
  // value and its own LUV amount, so usd/luv IS the price that trade paid — no ETH/USD
  // history needed, and no number is invented.
  Chart.prototype._tradePoints = function () {
    var t = this.tape && this.tape.trades ? this.tape.trades : [], out = [];
    t.forEach(function (r) {
      var luv = Number(r[3]), usd = Number(r[5]), pn = Number(r[6]);
      if (!(pn > 0)) return;
      out.push([Number(r[0]), luv > 0 && usd > 0 ? usd / luv : NaN, pn]);
    });
    out.sort(function (a, b) { return a[0] - b[0]; });
    // the seed itself: price at creation was exactly 1e-17 ETH/LUV. Its USD leg is the one
    // derived number on this page — the first trade's own ETH/USD, applied to the seed —
    // and the caption says so rather than quietly printing it as measured.
    var created = this.tape && this.tape.pairCreatedAt;
    if (created && out.length) {
      var f = out[0], implied = f[1] > 0 && f[2] > 0 ? f[1] / f[2] : NaN;
      out.unshift([Number(created), implied > 0 ? SEED_PRICE_NATIVE * implied : NaN, SEED_PRICE_NATIVE]);
    }
    if (this.market && this.market.t) out.push([Number(this.market.t), Number(this.market.priceUsd), Number(this.market.priceNative)]);
    return out;
  };
  Chart.prototype._series = function () {
    var w = WINDOWS[winIndex(this.win)];
    if (w.k === 'all') { var tp = this._tradePoints(); return { pts: tp, full: tp, w: w, step: true, bucket: Math.max(3600e3, w.bucket) }; }
    var pts = (this.history || []).slice(), m = this.market;
    if (m && m.t && (!pts.length || Number(m.t) > pts[pts.length - 1][0])) pts.push([Number(m.t), Number(m.priceUsd), Number(m.priceNative)]);
    var t1 = pts.length ? pts[pts.length - 1][0] : Date.now(), t0 = t1 - w.ms;
    return { pts: pts.filter(function (p) { return p[0] >= t0; }), full: pts, w: w, step: false, bucket: w.bucket };
  };
  // buckets of the active series → OHLC. Same bucketing serves candles and nothing else;
  // the line draws the points themselves.
  Chart.prototype._candles = function (pts, U, bucket) {
    var by = {}, order = [];
    pts.forEach(function (p) {
      var v = U.val(p); if (!(v > 0) || isNaN(v)) return;
      var b = Math.floor(p[0] / bucket) * bucket, c = by[b];
      if (!c) { c = by[b] = { t: b, o: v, h: v, l: v, c: v, n: 0 }; order.push(b); }
      c.h = Math.max(c.h, v); c.l = Math.min(c.l, v); c.c = v; c.n++;
    });
    order.sort(function (a, b) { return a - b; });
    return order.map(function (b) { return by[b]; });
  };

  Chart.prototype._renderAll = function () { this._renderHead(); this._renderChart(); };

  Chart.prototype._renderHead = function () {
    var m = this.market, U = UNITS[this.unit], self = this;
    var s = this._series(), pts = s.pts;
    this.el.amt.textContent = U.head;
    if (m && m.priceNative > 0) {
      this.el.price.innerHTML = U.big(U.val([m.t, m.priceUsd, m.priceNative])) +
        ' <small>' + U.unitlbl + '</small>';
      this.el.xs.innerHTML = '×' + (Number(m.priceNative) / SEED_PRICE_NATIVE).toFixed(2) +
        '<small> since the seed</small>';
    }
    // the window's own change, computed from the window that is drawn — never quoted from
    // a field that measures something else
    var pct = null;
    if (pts.length > 1) {
      var a = U.val(pts[0]), b = U.val(pts[pts.length - 1]);
      if (a > 0 && b > 0) pct = (b - a) / a * 100;
    }
    this.el.pct.textContent = fmtPct(pct);
    this.el.pct.className = 'lc-pct ' + pctClass(pct);
    this.el.winlbl.textContent = s.w.k === 'all' ? 'SINCE THE SEED' : s.w.lbl;
    this.el.zlbl.textContent = s.w.lbl;
    this.root.querySelectorAll('[data-win]').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-win') === self.win);
    });
    this.root.querySelectorAll('[data-unit]').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-unit') === self.unit);
    });
    this.root.querySelectorAll('[data-toggle]').forEach(function (b) {
      var k = b.getAttribute('data-toggle');
      b.classList.toggle('on', k === 'mode' ? self.mode === 'candles' : k === 'log' ? self.log :
        k === 'bb' ? self.bb : k === 'macd' ? self.macd : self.trades);
    });
  };

  Chart.prototype._renderChart = function () {
    var d3 = global.d3; if (!d3) return;
    var U = UNITS[this.unit], s = this._series(), pts = s.pts, self = this;
    var svg = d3.select(this.el.svg);
    svg.selectAll('*').remove();
    var W = this.el.plot.clientWidth || 900, H = this.height;
    svg.attr('width', W).attr('height', H).attr('viewBox', '0 0 ' + W + ' ' + H);
    if (pts.length < 2) {
      svg.append('text').attr('x', W / 2).attr('y', H / 2).attr('text-anchor', 'middle')
        .attr('fill', DIM).attr('font-size', 12).text('the window holds no readings yet');
      return;
    }
    var m = { top: 18, right: 74, bottom: 26, left: 12 };
    var vals = pts.map(function (p) { return U.val(p); }).filter(function (v) { return v > 0 && !isNaN(v); });
    var lo = d3.min(vals), hi = d3.max(vals);
    if (!(lo > 0)) return;

    // ── the bars, over the WHOLE series, and the indicators on their closes ──
    // Bars are what candles, Bollinger and MACD all read; the visible slice is what gets drawn.
    var bars = this._candles(s.full, U, s.bucket), t0v = pts[0][0], t1v = pts[pts.length - 1][0];
    var closes = bars.map(function (b) { return b.c; });
    var bbOn = this.bb && bars.length >= BB_N, macdOn = this.macd && bars.length >= MACD_S + MACD_SIG;
    var bb = null, md = null;
    if (bbOn) { var basis = smaSeries(closes, BB_N), sd = stdevSeries(closes, BB_N, basis);
      bb = { basis: basis, up: basis.map(function (b, i) { return b + BB_K * sd[i]; }), lo: basis.map(function (b, i) { return b - BB_K * sd[i]; }) }; }
    if (macdOn) md = macdSeries(closes, MACD_F, MACD_S, MACD_SIG);
    var firstVis = 0; while (firstVis < bars.length && bars[firstVis].t + s.bucket <= t0v) firstVis++;
    var cs = bars.slice(firstVis);
    // the bands widen the price window when they run past it — a band off the top is no band
    if (bb) for (var bi = firstVis; bi < bars.length; bi++) {
      if (bb.up[bi] > 0 && !isNaN(bb.up[bi])) hi = Math.max(hi, bb.up[bi]);
      if (bb.lo[bi] > 0 && !isNaN(bb.lo[bi])) lo = Math.min(lo, bb.lo[bi]);
    }

    // ── layout: the main pane, then — when MACD is on — its own pane under it, TradingView-style,
    // sharing the time axis at the very bottom ──
    var macdH = md ? Math.round((H - m.top - m.bottom) * 0.26) : 0, gap = md ? 16 : 0;
    var mainBot = H - m.bottom - macdH - gap;
    var x = d3.scaleUtc().domain([t0v, t1v]).range([m.left, W - m.right]);
    var y, padF = 0.08;
    if (this.log) {
      var k = Math.pow(hi / lo || 1, padF) || 1.02;
      y = d3.scaleLog().domain([lo / k, hi * k]).range([mainBot, m.top]);
    } else {
      var pad = (hi - lo) * padF || hi * 0.02 || 1;
      y = d3.scaleLinear().domain([lo - pad, hi + pad]).range([mainBot, m.top]);
    }
    var dom = y.domain(), dec = U.dec(dom[1] - dom[0], dom[1]);
    var MONO = 'ui-monospace,Menlo,monospace';
    // bar geometry, shared by candles, Bollinger and the histogram
    var bw = cs.length > 1 ? Math.max(2, Math.min(22, (x(cs[1].t) - x(cs[0].t)) * .62)) : 8;
    var xb = function (b) { return x(b.t) + bw / 2; };

    // ── the mark, behind everything: the coin the chart is named for ──
    var wm = Math.min(W - m.left - m.right, mainBot - m.top) * 0.46;
    svg.append('image').attr('href', COIN).attr('x', (W - m.right + m.left - wm) / 2)
      .attr('y', m.top + (mainBot - m.top - wm) / 2).attr('width', wm).attr('height', wm)
      .attr('class', 'lc-watermark').attr('preserveAspectRatio', 'xMidYMid meet');

    // ── gridlines, then the axes on the outside ──
    // d3's log ticks hand back every 2,3,4…9 inside a decade — legible on a tall axis,
    // a wall of numbers on this one. Six rungs spaced evenly IN LOG SPACE say the same thing.
    var ticks = y.ticks(this.log ? 5 : 5);
    if (this.log && (ticks.length > 7 || ticks.length < 3)) {
      var l0 = Math.log10(dom[0]), l1 = Math.log10(dom[1]), n = 5;
      ticks = [];
      for (var ti = 0; ti <= n; ti++) ticks.push(Math.pow(10, l0 + (l1 - l0) * ti / n));
    }
    svg.append('g').selectAll('line').data(ticks).enter().append('line')
      .attr('x1', m.left).attr('x2', W - m.right).attr('y1', y).attr('y2', y)
      .attr('stroke', SEAM).attr('stroke-width', 1).attr('opacity', .55);
    svg.append('g').attr('transform', 'translate(0,' + (H - m.bottom) + ')')
      .attr('class', 'lc-axis')
      .call(d3.axisBottom(x).ticks(Math.max(3, Math.round(W / 150))).tickSize(0).tickPadding(8));
    // the pane seam under the main chart
    svg.append('line').attr('x1', m.left).attr('x2', W - m.right).attr('y1', mainBot + .5).attr('y2', mainBot + .5)
      .attr('stroke', SEAM).attr('stroke-width', 1).attr('opacity', md ? .9 : .55);
    svg.append('g').attr('transform', 'translate(' + (W - m.right) + ',0)')
      .attr('class', 'lc-axis')
      .call(d3.axisRight(y).tickValues(ticks).tickSize(0).tickPadding(8)
        .tickFormat(function (v) { return U.axis(v, dec); }));
    svg.selectAll('.lc-axis .domain').remove();
    svg.selectAll('.lc-axis text').attr('fill', DIM).attr('font-size', 10.5).attr('font-family', 'ui-monospace,Menlo,monospace');

    // ── the seed line — 10 wei, the price this market started from ──
    var seedVal = U.val([0, NaN, SEED_PRICE_NATIVE]);
    if (this.unit !== 'usdc' && seedVal >= dom[0] && seedVal <= dom[1]) {
      svg.append('line').attr('x1', m.left).attr('x2', W - m.right).attr('y1', y(seedVal)).attr('y2', y(seedVal))
        .attr('stroke', GOLD).attr('stroke-width', 1).attr('stroke-dasharray', '4 5').attr('opacity', .7);
      svg.append('text').attr('x', m.left + 6).attr('y', y(seedVal) - 6).attr('fill', GOLD)
        .attr('font-size', 10).attr('font-family', 'ui-monospace,Menlo,monospace')
        .attr('letter-spacing', '.14em').text('THE SEED · 10 WEI');
    }

    var curve = s.step ? d3.curveStepAfter : d3.curveLinear;
    var live = pts[pts.length - 1], liveV = U.val(live);
    var rising = vals.length > 1 && vals[vals.length - 1] >= vals[0];
    var stroke = rising ? UP : DOWN;

    // ── Bollinger Bands (20, 2): the blue envelope, the orange basis, the pale fill between ──
    if (bb) {
      var vis = [], vi;
      for (vi = firstVis; vi < bars.length; vi++) if (!isNaN(bb.basis[vi])) vis.push({ b: bars[vi], i: vi });
      if (vis.length > 1) {
        var bandArea = d3.area().x(function (d) { return xb(d.b); })
          .y0(function (d) { return y(bb.lo[d.i]); }).y1(function (d) { return y(bb.up[d.i]); }).curve(d3.curveMonotoneX)
          .defined(function (d) { return bb.lo[d.i] > 0; });
        svg.append('path').datum(vis).attr('d', bandArea).attr('fill', TV.bbFill);
        ['up', 'lo', 'basis'].forEach(function (key) {
          var ln = d3.line().x(function (d) { return xb(d.b); }).y(function (d) { return y(bb[key][d.i]); })
            .curve(d3.curveMonotoneX).defined(function (d) { return bb[key][d.i] > 0; });
          svg.append('path').datum(vis).attr('d', ln).attr('fill', 'none')
            .attr('stroke', key === 'basis' ? TV.bbBasis : TV.bbLine).attr('stroke-width', key === 'basis' ? 1.2 : 1)
            .attr('opacity', .9);
        });
        var lastB = vis[vis.length - 1].i;
        svg.append('text').attr('x', m.left + 6).attr('y', m.top + 12).attr('font-size', 10).attr('font-family', MONO)
          .attr('fill', TV.bbLine).text('BB 20 2  ')
          .append('tspan').attr('fill', TV.bbBasis).text(U.axis(bb.basis[lastB], dec) + ' ')
          .append('tspan').attr('fill', TV.bbLine).text(U.axis(bb.up[lastB], dec) + ' ' + U.axis(bb.lo[lastB], dec));
      }
    }

    if (this.mode === 'candles') {
      var g = svg.append('g');
      cs.forEach(function (c) {
        var col = c.c >= c.o ? UP : DOWN, cx = xb(c);
        g.append('line').attr('x1', cx).attr('x2', cx).attr('y1', y(c.h)).attr('y2', y(c.l))
          .attr('stroke', col).attr('stroke-width', 1);
        var top = y(Math.max(c.o, c.c)), bot = y(Math.min(c.o, c.c));
        g.append('rect').attr('x', x(c.t)).attr('y', top).attr('width', bw)
          .attr('height', Math.max(1, bot - top)).attr('fill', col).attr('opacity', .9);
      });
    } else {
      var area = d3.area().x(function (p) { return x(p[0]); })
        .y0(mainBot).y1(function (p) { return y(U.val(p)); }).curve(curve)
        .defined(function (p) { return U.val(p) > 0; });
      var line = d3.line().x(function (p) { return x(p[0]); })
        .y(function (p) { return y(U.val(p)); }).curve(curve)
        .defined(function (p) { return U.val(p) > 0; });
      var gid = 'lcfill-' + (rising ? 'up' : 'dn');
      var grad = svg.append('defs').append('linearGradient').attr('id', gid)
        .attr('x1', 0).attr('y1', 0).attr('x2', 0).attr('y2', 1);
      grad.append('stop').attr('offset', '0%').attr('stop-color', stroke).attr('stop-opacity', .30);
      grad.append('stop').attr('offset', '100%').attr('stop-color', stroke).attr('stop-opacity', 0);
      svg.append('path').datum(pts).attr('d', area).attr('fill', 'url(#' + gid + ')');
      svg.append('path').datum(pts).attr('d', line).attr('fill', 'none')
        .attr('stroke', stroke).attr('stroke-width', 1.8).attr('stroke-linejoin', 'round');
    }

    // ── the swap log, plotted ── every trade the pair has ever settled, in the window:
    // a buy is a green triangle up, a sell a red triangle down, sized by what it moved.
    var tapePts = [];
    if (this.trades && this.tape && this.tape.trades) {
      var t0 = pts[0][0], t1 = pts[pts.length - 1][0], gT = svg.append('g').attr('class', 'lc-tape');
      this.tape.trades.forEach(function (r) {
        var ts = Number(r[0]); if (ts < t0 || ts > t1) return;
        var pn = Number(r[6]); if (!(pn > 0)) return;
        var luv = Number(r[3]), usd = Number(r[5]);
        var v = U.val([ts, luv > 0 && usd > 0 ? usd / luv : NaN, pn]);
        if (!(v > 0) || isNaN(v)) return;
        var px = x(ts), py = y(v), buy = r[2] === 'b', col = buy ? UP : DOWN;
        var rr = Math.max(3.5, Math.min(11, 3.5 + Math.log10(1 + (usd > 0 ? usd : 1)) * 3));
        gT.append('path')
          .attr('d', buy ? 'M' + px + ',' + (py - rr) + 'L' + (px + rr) + ',' + (py + rr * .8) + 'L' + (px - rr) + ',' + (py + rr * .8) + 'Z'
                         : 'M' + px + ',' + (py + rr) + 'L' + (px + rr) + ',' + (py - rr * .8) + 'L' + (px - rr) + ',' + (py - rr * .8) + 'Z')
          .attr('fill', col).attr('fill-opacity', .8).attr('stroke', col).attr('stroke-width', 1);
        tapePts.push({ x: px, y: py, r: rr, rec: r, v: v });
      });
    }

    // ── the live reading: the coin itself, on the price, and its tag on the axis ──
    if (liveV > 0) {
      var lx = x(live[0]), ly = y(liveV), cr = 30;
      svg.append('line').attr('x1', m.left).attr('x2', W - m.right).attr('y1', ly).attr('y2', ly)
        .attr('stroke', stroke).attr('stroke-width', 1).attr('stroke-dasharray', '2 6').attr('opacity', .6);
      svg.append('rect').attr('x', W - m.right + 2).attr('y', ly - 9).attr('width', m.right - 6)
        .attr('height', 18).attr('rx', 5).attr('fill', stroke).attr('opacity', .95);
      svg.append('text').attr('x', W - m.right + m.right / 2 - 2).attr('y', ly + 4)
        .attr('text-anchor', 'middle').attr('fill', '#160a0f').attr('font-size', 10)
        .attr('font-weight', 700).attr('font-family', 'ui-monospace,Menlo,monospace')
        .text(U.axis(liveV, dec));
      svg.append('image').attr('href', COIN).attr('class', 'lc-coin')
        .attr('x', lx - cr / 2).attr('y', ly - cr / 2).attr('width', cr).attr('height', cr)
        .append('title').text('the live price · ' + U.tip(liveV, dec));
    }

    // ── MACD (12, 26, 9), in its own pane: the four-shade histogram, MACD blue, signal orange ──
    var y2 = null, mdVis = [];
    if (md) {
      var pTop = mainBot + gap, pBot = H - m.bottom, ext = [0, 0], mi;
      for (mi = firstVis; mi < bars.length; mi++) {
        if (isNaN(md.line[mi])) continue;
        mdVis.push({ b: bars[mi], i: mi });
        ext[0] = Math.min(ext[0], md.line[mi], isNaN(md.signal[mi]) ? 0 : md.signal[mi], isNaN(md.hist[mi]) ? 0 : md.hist[mi]);
        ext[1] = Math.max(ext[1], md.line[mi], isNaN(md.signal[mi]) ? 0 : md.signal[mi], isNaN(md.hist[mi]) ? 0 : md.hist[mi]);
      }
      var mpad = (ext[1] - ext[0]) * .12 || 1e-18;
      y2 = d3.scaleLinear().domain([ext[0] - mpad, ext[1] + mpad]).range([pBot, pTop]);
      var mdec = U.dec((ext[1] - ext[0]) || Math.abs(ext[1]) || 1, Math.max(Math.abs(ext[0]), Math.abs(ext[1])) || 1);
      var signed = function (v) { return (v < 0 ? '−' : '') + U.axis(Math.abs(v), mdec); };
      // zero line + a light axis
      svg.append('line').attr('x1', m.left).attr('x2', W - m.right).attr('y1', y2(0)).attr('y2', y2(0))
        .attr('stroke', SEAM).attr('stroke-width', 1).attr('opacity', .9);
      var mticks = [ext[0] + mpad * 0, 0, ext[1] - mpad * 0].filter(function (v, i, a) { return a.indexOf(v) === i; });
      svg.append('g').attr('transform', 'translate(' + (W - m.right) + ',0)').attr('class', 'lc-axis lc-axis2')
        .call(d3.axisRight(y2).tickValues(mticks).tickSize(0).tickPadding(8).tickFormat(signed));
      svg.selectAll('.lc-axis2 .domain').remove();
      svg.selectAll('.lc-axis2 text').attr('fill', DIM).attr('font-size', 9.5).attr('font-family', MONO);
      // the histogram: TradingView's four shades — grow above, fall above, grow below, fall below
      var hg = svg.append('g'), hw = Math.max(1.5, bw * .8);
      mdVis.forEach(function (d, j) {
        var h = md.hist[d.i]; if (isNaN(h)) return;
        var prev = j > 0 ? md.hist[mdVis[j - 1].i] : NaN, grow = isNaN(prev) ? true : Math.abs(h) >= Math.abs(prev);
        var col = h >= 0 ? (grow ? TV.histGA : TV.histFA) : (grow ? TV.histGB : TV.histFB);
        var yz = y2(0), yh = y2(h);
        hg.append('rect').attr('x', xb(d.b) - hw / 2).attr('y', Math.min(yz, yh)).attr('width', hw)
          .attr('height', Math.max(1, Math.abs(yh - yz))).attr('fill', col).attr('opacity', .95);
      });
      ['line', 'signal'].forEach(function (key) {
        var ln = d3.line().x(function (d) { return xb(d.b); }).y(function (d) { return y2(md[key][d.i]); })
          .curve(d3.curveMonotoneX).defined(function (d) { return !isNaN(md[key][d.i]); });
        svg.append('path').datum(mdVis).attr('d', ln).attr('fill', 'none')
          .attr('stroke', key === 'line' ? TV.macd : TV.signal).attr('stroke-width', 1.3);
      });
      var lastM = mdVis.length ? mdVis[mdVis.length - 1].i : -1;
      var lbl = svg.append('text').attr('x', m.left + 6).attr('y', pTop + 12).attr('font-size', 10).attr('font-family', MONO)
        .attr('fill', DIM).text('MACD 12 26 9  ');
      if (lastM >= 0) {
        var hcol = md.hist[lastM] >= 0 ? TV.histGA : TV.histFB;
        lbl.append('tspan').attr('fill', hcol).text(signed(md.hist[lastM]) + ' ');
        lbl.append('tspan').attr('fill', TV.macd).text(signed(md.line[lastM]) + ' ');
        lbl.append('tspan').attr('fill', TV.signal).text(signed(md.signal[lastM]));
      }
    }

    // ── the crosshair ──
    var xh = svg.append('g').attr('display', 'none');
    var xhv = xh.append('line').attr('y1', m.top).attr('y2', H - m.bottom).attr('stroke', FLAT).attr('stroke-width', .8).attr('stroke-dasharray', '3 4');
    var xhd = xh.append('circle').attr('r', 3.5).attr('fill', '#f6e7eb').attr('stroke', stroke).attr('stroke-width', 1.5);
    var tip = this.el.tip, bisect = d3.bisector(function (p) { return p[0]; }).left;
    svg.append('rect').attr('x', m.left).attr('y', m.top).attr('width', Math.max(1, W - m.right - m.left))
      .attr('height', Math.max(1, H - m.bottom - m.top)).attr('fill', 'transparent')
      .on('pointermove', function (ev) {
        var mx = d3.pointer(ev, this)[0] + m.left, near = null, best = 1e9;
        tapePts.forEach(function (t) {
          var d = Math.abs(t.x - mx); if (d < best && d < 14) { best = d; near = t; }
        });
        var html;
        if (near) {
          var r = near.rec, buy = r[2] === 'b';
          html = '<b style="color:' + (buy ? UPSOFT : DOWNSOFT) + '">' + (buy ? 'BUY' : 'SELL') + '</b> ' +
            fmtNum(Number(r[3]) / 1e12, 3) + 'T LUV<br>' + fmtUsd(r[5]) + ' · ' + U.tip(near.v, dec) +
            '<br><span style="color:' + DIM + '">' + utc(Number(r[0]), true) + ' · block ' + r[1] + '</span>' +
            '<br><span style="color:' + DIM + '">tx ' + shortHash(r[8]) + '</span>';
          xhv.attr('x1', near.x).attr('x2', near.x); xhd.attr('cx', near.x).attr('cy', near.y);
        } else {
          var i = Math.max(1, Math.min(pts.length - 1, bisect(pts, x.invert(mx))));
          var p = pts[i], v = U.val(p);
          if (!(v > 0)) return;
          html = '<b>' + U.tip(v, dec) + '</b><br><span style="color:' + DIM + '">' + utc(p[0], true) + '</span>';
          // the bar under the pointer, and what the indicators read on it
          var tms = x.invert(mx).getTime(), bidx = firstVis + Math.floor((tms - (cs.length ? cs[0].t : tms)) / s.bucket);
          if (cs.length && bidx >= firstVis && bidx < bars.length) {
            var B = bars[bidx], bcol = B.c >= B.o ? UPSOFT : DOWNSOFT;
            html += '<br><span style="color:' + bcol + '">O ' + U.axis(B.o, dec) + ' H ' + U.axis(B.h, dec) +
              ' L ' + U.axis(B.l, dec) + ' C ' + U.axis(B.c, dec) + '</span>';
            if (bb && !isNaN(bb.basis[bidx])) html += '<br><span style="color:' + TV.bbLine + '">BB ' + U.axis(bb.up[bidx], dec) +
              ' <span style="color:' + TV.bbBasis + '">' + U.axis(bb.basis[bidx], dec) + '</span> ' + U.axis(bb.lo[bidx], dec) + '</span>';
            if (md && !isNaN(md.line[bidx])) html += '<br><span style="color:' + TV.macd + '">MACD ' + signed(md.line[bidx]) +
              '</span> <span style="color:' + TV.signal + '">' + (isNaN(md.signal[bidx]) ? '—' : signed(md.signal[bidx])) +
              '</span> <span style="color:' + (md.hist[bidx] >= 0 ? TV.histGA : TV.histFB) + '">' + (isNaN(md.hist[bidx]) ? '—' : signed(md.hist[bidx])) + '</span>';
          }
          xhv.attr('x1', x(p[0])).attr('x2', x(p[0])); xhd.attr('cx', x(p[0])).attr('cy', y(v));
        }
        xh.attr('display', null);
        tip.innerHTML = html; tip.hidden = false;
        var box = tip.getBoundingClientRect(), px = (near ? near.x : mx) + 14;
        if (px + box.width > W) px = (near ? near.x : mx) - box.width - 14;
        tip.style.left = Math.max(2, px) + 'px';
        tip.style.top = Math.max(2, Math.min(H - box.height - 4, (near ? near.y : m.top + 10) - 10)) + 'px';
      })
      .on('pointerleave', function () { xh.attr('display', 'none'); tip.hidden = true; });

    // ── the caption: what was drawn, from what, read when ──
    var srcTxt = s.w.k === 'all'
      ? 'the pair\'s own swap log — ' + (this.tape && this.tape.trades ? this.tape.trades.length : 0) +
        ' trades since ' + (this.tape && this.tape.pairCreatedAt ? utc(this.tape.pairCreatedAt) : 'the seed') +
        ' · a step between trades, because that is what a V2 price does' +
        (this.unit === 'usdc' ? ' · the seed\'s USD leg is derived from the first trade\'s own ETH/USD' : '')
      : pts.length + ' readings, one a minute · ' + utc(pts[0][0]) + ' → now';
    this.el.cap.innerHTML = srcTxt + ' · <b>' + (this.mode === 'candles' ? 'candles' : 'line') + '</b> on a ' +
      (this.log ? 'logarithmic' : 'linear') + ' axis' +
      (bb ? ' · <b>BB(20, 2)</b>' : this.bb ? ' · BB needs 20 bars' : '') +
      (md ? ' · <b>MACD(12, 26, 9)</b>' : this.macd ? ' · MACD needs 35 bars' : '') +
      ' · TradingView classic: up bars green, down bars red · read at ' +
      (this.market && this.market.t ? clock(this.market.t) : '—') + ' · same-origin, no third party';
  };

  Chart.prototype.start = function () {
    var self = this;
    this._fetch().then(function () { self._renderAll(); });
    this._t1 = global.setInterval(function () {
      if (!document.hidden) self._fetch().then(function () { self._renderAll(); });
    }, REFRESH_MS);
    this._t2 = global.setInterval(function () {
      if (!document.hidden) self._fetchPrice().then(function () { self._renderAll(); });
    }, PRICE_MS);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) self._fetch().then(function () { self._renderAll(); });
    });
    var rt; global.addEventListener('resize', function () {
      global.clearTimeout(rt); rt = global.setTimeout(function () { self._renderChart(); }, 160);
    });
    return this;
  };
  Chart.prototype.stop = function () {
    global.clearInterval(this._t1); global.clearInterval(this._t2); return this;
  };

  var DVLuvChart = { Chart: Chart, UNITS: UNITS, WINDOWS: WINDOWS, UP: UP, DOWN: DOWN, TV: TV, version: '1.2.0',
    math: { sma: smaSeries, stdev: stdevSeries, ema: emaSeries, macd: macdSeries } };
  if (typeof module !== 'undefined' && module.exports) module.exports = DVLuvChart;
  global.DVLuvChart = DVLuvChart;

  function boot() {
    document.querySelectorAll('[data-luvchart]').forEach(function (el) {
      if (el.__luvchart) return;
      try { el.__luvchart = new Chart(el).start(); } catch (e) { /* a chart is not worth a page */ }
    });
  }
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
