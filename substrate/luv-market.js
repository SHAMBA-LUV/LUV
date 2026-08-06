/*!
 * SHAMBA LUV — market substrate (new substrate; existing DeltaVerse substrates untouched).
 *
 * The measure of LUV as one complete expression on a single line:
 *   ❤ 1T LUV = $0.1466 USDC ▕▁▁▁▂▄█▏ ▲ +653% 24H
 * — the price point (one trillion LUV, a million millions, in USDC), a signed 24-hour
 * bar, and the 24-hour percent change. Two cadences, both from the same-origin cache
 * (market.json + market-history.json, written server-side by luv-market-collector.mjs —
 * CSP connect-src 'self'): a FULL refresh (price + history + chart) every five minutes,
 * and a light PRICE tick every minute. The minute tick reads only the cached mirror —
 * it can never trigger limits on the actual price sources; the collector alone talks
 * to the chain, on its own cadence.
 *
 * Prototype lane (.js, UMD). Needs the in-house d3 v7 (substrate/d3.min.js) loaded first.
 * Self-boots on DOMContentLoaded when #luvmarket exists, or drive it yourself:
 *   var m = new DVLuvMarket.Market('#luvmarket'); m.start();
 */
(function (global) {
  'use strict';

  var PAIR = '0x57D2085Aa859a145cB107845AD03c0eAAFBD8a31';
  var UP = '#7ee2a8', DOWN = '#ff4d6d', FLAT = '#b98da0';
  var LINE = '#ff4d6d', FILL_TOP = 'rgba(255,0,110,.28)', FILL_BOT = 'rgba(255,0,110,0)';
  var REFRESH_MS = 5 * 60e3;           // FULL refresh from the cache: every five minutes
  var PRICE_MS = 60e3;                 // light price tick from the cache: every minute (mirror-only, no source limits)
  var WINDOW_MS = 4 * 3600e3;          // the chart shows the 4-hour view by default (the 24H % keeps its own field)
  // X — the seed (addLiquidityETH 0x9f8e0bf6…, block 25620950): price set at exactly 1e-17 ETH/LUV
  var SEED_PRICE_NATIVE = 1e-17;       // ETH per LUV at seed
  var SEED_WETH = 0.051922968585348276; // the ETH leg of the seed

  function fmtPct(v) {
    if (v === null || v === undefined || isNaN(v)) return '—';
    var n = Number(v);
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function pctColor(v) {
    if (v === null || v === undefined || isNaN(v) || Number(v) === 0) return FLAT;
    return Number(v) > 0 ? UP : DOWN;
  }
  function pctArrow(v) {
    if (v === null || v === undefined || isNaN(v) || Number(v) === 0) return '·';
    return Number(v) > 0 ? '▲' : '▼';
  }
  function fmtUsdc(v) {
    if (v === null || v === undefined || isNaN(v)) return '—';
    var n = Number(v);
    // accuracy: 6 decimals under a dollar, 4 above — approximation is display-only
    return '$' + n.toFixed(Math.abs(n) < 1 ? 6 : 4) + ' USDC';
  }
  function grp(s) { return s.replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function fmtNum(v, dec) {
    var parts = Number(v).toFixed(dec).split('.');
    return grp(parts[0]) + (parts[1] ? '.' + parts[1] : '');
  }
  // adaptive axis decimals: enough digits that neighbouring ticks stay distinct
  function decFor(span, base, cap) {
    if (!(span > 0)) return base;
    var d = Math.ceil(-Math.log10(span / 5)) + 1;
    return Math.min(Math.max(d, base), cap);
  }

  // ── the unit toggle: one price, three expressions ──
  //   $   — 1T LUV in USDC (the measure of value)
  //   WEI — wei per ONE LUV (the identity lattice; the seed was exactly 10 wei)
  //   Ξ   — LUV per ONE ETH (the inverse measure, in trillions)
  // val() maps a history point [ms, priceUsd, priceNative]; every series, axis,
  // candle and tooltip re-expresses through the active unit. Full precision is
  // carried by the data; decimals shown adapt to the visible span.
  var UNITS = {
    usdc: {
      btn: '$', title: 'one trillion LUV priced in USDC',
      amt: '1T LUV', aria: 'LUV price in USD',
      val: function (p) { return Number(p[1]); },
      line: function (m) { return fmtUsdc(m.oneTrillionUsd); },
      axis: function (v, dec) { return '$' + Number(v * 1e12).toFixed(dec); },
      axisDec: function (span) { return decFor(span * 1e12, 4, 8); },
      tip: function (v, dec) { return '$' + Number(v * 1e12).toFixed(Math.max(dec, 6)); },
      tipHead: '1T LUV'
    },
    wei: {
      btn: 'WEI', title: 'wei per ONE LUV — the seed was exactly 10 wei',
      amt: '1 LUV', aria: 'LUV price in wei per LUV',
      val: function (p) { return Number(p[2]) * 1e18; },
      line: function (m) {
        var pn = Number(m.priceNative);
        return pn > 0 ? fmtNum(pn * 1e18, 6) + ' WEI' : '—';
      },
      axis: function (v, dec) { return Number(v).toFixed(dec); },
      axisDec: function (span) { return decFor(span, 2, 6); },
      tip: function (v, dec) { return fmtNum(v, Math.max(dec, 4)) + ' wei'; },
      tipHead: 'WEI / LUV'
    },
    eth: {
      btn: '\u039E', title: 'LUV per ONE ETH, in trillions — the inverse measure',
      amt: '1 ETH', aria: 'LUV per ETH',
      val: function (p) { var pn = Number(p[2]); return pn > 0 ? 1 / pn : NaN; },
      line: function (m) {
        var pn = Number(m.priceNative);
        return pn > 0 ? fmtNum(1 / pn / 1e12, 4) + 'T LUV' : '—';
      },
      axis: function (v, dec) { return Number(v / 1e12).toFixed(dec) + 'T'; },
      axisDec: function (span) { return decFor(span / 1e12, 2, 6); },
      tip: function (v, dec) { return fmtNum(v / 1e12, Math.max(dec, 4)) + 'T LUV'; },
      tipHead: 'LUV / ETH'
    }
  };
  var UNIT_ORDER = ['usdc', 'wei', 'eth'];
  function loadUnit() {
    try { var u = global.localStorage.getItem('luv-market-unit'); if (UNITS[u]) return u; } catch (e) { /* private */ }
    return 'usdc';
  }

  // ── indicator math (plain arrays, index-aligned to their inputs) ──
  function emaSeries(vals, period) {
    var k = 2 / (period + 1), out = [], prev;
    vals.forEach(function (v, i) { prev = i ? v * k + prev * (1 - k) : v; out.push(prev); });
    return out;
  }
  function rsiSeries(vals, period) {
    var out = new Array(vals.length).fill(null), g = 0, l = 0;
    for (var i = 1; i < vals.length; i++) {
      var d = vals[i] - vals[i - 1], up = d > 0 ? d : 0, dn = d < 0 ? -d : 0;
      if (i <= period) {
        g += up; l += dn;
        if (i === period) { g /= period; l /= period; out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); }
      } else {
        g = (g * (period - 1) + up) / period; l = (l * (period - 1) + dn) / period;
        out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
      }
    }
    return out;
  }
  function macdSeries(vals) {
    var e12 = emaSeries(vals, 12), e26 = emaSeries(vals, 26);
    var macd = vals.map(function (_, i) { return i >= 25 ? e12[i] - e26[i] : null; });
    var valid = macd.filter(function (v) { return v !== null; });
    var sigValid = emaSeries(valid, 9);
    var signal = new Array(vals.length).fill(null);
    for (var i = 0, j = 0; i < vals.length; i++) if (macd[i] !== null) { signal[i] = j >= 8 ? sigValid[j] : null; j++; }
    return { macd: macd, signal: signal };
  }
  var RIBBON = [
    { p: 8,  col: '#ffb3c1' }, { p: 13, col: '#ff4d6d' }, { p: 21, col: '#ff006e' },
    { p: 34, col: '#b23bd6' }, { p: 55, col: '#8338ec' }
  ];
  var FIBS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

  function Market(mount) {
    this.root = typeof mount === 'string' ? document.querySelector(mount) : mount;
    this.market = null;
    this.points = [];   // [ms, priceUsd, priceNative]
    this._timer = 0;
    this.mode = loadUnit();
  }

  Market.prototype._skeleton = function () {
    this.root.innerHTML =
      '<div class="mkt-line" aria-live="polite">' +
      '<span class="beat">❤</span>' +
      '<b class="mkt-amt" title="one trillion LUV — a million millions, the measure of value">1T LUV</b>' +
      '<span class="mkt-eq">=</span>' +
      '<b class="mkt-usdc">…</b>' +
      '<span class="mkt-bar" role="img" aria-label="24 hour change bar"><span class="mkt-bar-zero"></span><span class="mkt-bar-fill"></span></span>' +
      '<span class="mkt-pct">…</span>' +
      '<span class="mkt-win">24H</span>' +
      '<span class="mkt-units" role="group" aria-label="unit toggle — USDC, wei per LUV, LUV per ETH"></span>' +
      '</div>' +
      '<div class="mkt-chart"><svg role="img" aria-label="LUV price in USD over the last 24 hours"></svg>' +
      '<div class="mkt-tip" hidden></div></div>' +
      '<div class="mkt-fine"><span class="mkt-delta"></span><span class="mkt-x" title="the X multiplier — measured from the liquidity seed (price X = 1.00e-17 ETH per LUV)"></span><span class="mkt-spacer"></span>' +
      '<span class="mkt-src">price every minute · full refresh every 5 min · read on-chain from the Uniswap pair (where 100% of circulating LUV lives) · ' +
      'EMA ribbon 8·13·21·34·55 · fib retracement · RSI 14 · MACD 12·26·9</span></div>';
  };

  Market.prototype._buildToggle = function () {
    var self = this;
    var wrap = this.root.querySelector('.mkt-units');
    if (!wrap) return;
    wrap.style.cssText = 'display:inline-flex;gap:4px;margin-left:10px;vertical-align:middle';
    UNIT_ORDER.forEach(function (key) {
      var u = UNITS[key];
      var b = document.createElement('button');
      b.type = 'button'; b.textContent = u.btn; b.title = u.title;
      b.setAttribute('data-u', key);
      b.setAttribute('aria-pressed', String(key === self.mode));
      b.style.cssText = 'font:11px ui-monospace,Menlo,monospace;letter-spacing:.06em;cursor:pointer;' +
        'padding:3px 9px;border-radius:999px;background:transparent;transition:color .15s,border-color .15s';
      b.addEventListener('click', function () {
        if (self.mode === key) return;
        self.mode = key;
        try { global.localStorage.setItem('luv-market-unit', key); } catch (e) { /* private */ }
        self._paintToggle(); self._renderAll();
      });
      wrap.appendChild(b);
    });
    this._paintToggle();
  };
  Market.prototype._paintToggle = function () {
    var self = this;
    var btns = this.root.querySelectorAll('.mkt-units button');
    btns.forEach(function (b) {
      var on = b.getAttribute('data-u') === self.mode;
      b.setAttribute('aria-pressed', String(on));
      b.style.border = '1px solid ' + (on ? '#e3b25f' : '#4a1f30');
      b.style.color = on ? '#e3b25f' : '#b98da0';
      b.style.fontWeight = on ? '700' : '400';
    });
  };

  Market.prototype._fetch = function () {
    var self = this, bust = 'v=' + Date.now();
    return Promise.all([
      fetch('market.json?' + bust, { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }),
      fetch('market-history.json?' + bust, { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; })
    ]).then(function (rs) {
      if (rs[0]) self.market = rs[0];
      if (rs[1] && rs[1].points) self.points = rs[1].points;
    }).catch(function () { /* keep the last good frame */ });
  };

  // The minute tick: market.json only — same-origin mirror, so the actual price
  // sources are never touched and no rate limit can trip.
  Market.prototype._fetchPrice = function () {
    var self = this;
    return fetch('market.json?v=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (m) { if (m) self.market = m; })
      .catch(function () { /* keep the last good frame */ });
  };

  Market.prototype._renderLine = function () {
    if (!this.market) return;
    var pc = this.market.priceChange || {};
    var h24 = pc.h24 === undefined ? null : Number(pc.h24);
    var U = UNITS[this.mode] || UNITS.usdc;
    var amtEl = this.root.querySelector('.mkt-amt');
    if (amtEl) amtEl.textContent = U.amt;
    this.root.querySelector('.mkt-usdc').textContent = U.line(this.market);
    var pctEl = this.root.querySelector('.mkt-pct');
    pctEl.textContent = pctArrow(h24) + ' ' + fmtPct(h24);
    pctEl.style.color = pctColor(h24);
    // the bar: zero at centre, fill grows right for gains, left for losses; |100%| fills the half
    var fill = this.root.querySelector('.mkt-bar-fill');
    var mag = h24 === null ? 0 : Math.min(Math.abs(h24), 100) / 100 * 50;   // % of track width
    fill.style.width = mag + '%';
    fill.style.background = pctColor(h24);
    if (h24 !== null && h24 < 0) { fill.style.right = '50%'; fill.style.left = 'auto'; }
    else { fill.style.left = '50%'; fill.style.right = 'auto'; }
    this.root.querySelector('.mkt-bar').title =
      '24H change ' + fmtPct(h24) + (Math.abs(h24) > 100 ? ' (bar capped at ±100%)' : '');
    // X multiplier — the growth from the seed, measured live
    var xEl = this.root.querySelector('.mkt-x');
    var pn = Number(this.market.priceNative);
    var lq = this.market.liquidity && Number(this.market.liquidity.quote);
    if (xEl && pn) {
      var priceX = pn / SEED_PRICE_NATIVE;
      var liqX = lq ? lq / SEED_WETH : null;
      xEl.textContent = 'price ' + priceX.toFixed(4) + '× from X' +
        (liqX ? ' · liquidity ' + liqX.toFixed(4) + '×' : '');
      xEl.style.color = '#e3b25f';
      // the page-level statement: how many times the price has X'd from the seed
      var xLine = document.getElementById('luv-xcount');
      if (xLine) xLine.textContent = priceX.toFixed(2) + '×';
    }
  };

  Market.prototype._renderChart = function () {
    var d3 = global.d3; if (!d3) return;
    var box = this.root.querySelector('.mkt-chart'), svg = d3.select(box).select('svg');
    var W = box.clientWidth || 600, HM = Math.max(180, Math.min(260, W * 0.32));
    svg.selectAll('*').remove();

    var now = Date.now();
    var U = UNITS[this.mode] || UNITS.usdc;
    var V = U.val;
    var svgEl = this.root.querySelector('.mkt-chart svg');
    if (svgEl) svgEl.setAttribute('aria-label', U.aria + ' — 4-hour view in 5-minute candles with EMA ribbon, Fibonacci retracement, RSI and MACD panes; flat stretches between trades stay level');
    var pts = this.points.filter(function (p) { return p[0] >= now - WINDOW_MS && isFinite(V(p)) && V(p) > 0; });
    if (pts.length < 2) pts = this.points.filter(function (p) { return isFinite(V(p)) && V(p) > 0; });
    var deltaEl = this.root.querySelector('.mkt-delta');
    if (pts.length < 2) {
      svg.attr('viewBox', '0 0 ' + W + ' ' + HM).attr('width', '100%').attr('height', HM);
      svg.append('text').attr('x', W / 2).attr('y', HM / 2).attr('text-anchor', 'middle')
        .attr('fill', FLAT).attr('font-size', 13)
        .text('collecting samples — the line grows from here ❤');
      deltaEl.textContent = '';
      return;
    }

    var m = { top: 12, right: 16, bottom: 24, left: 58 };
    var plotW = W - m.left - m.right;

    // ── 5-minute OHLC candles from our minute samples ──
    var BUCKET = 5 * 60e3;
    var buckets = {};
    pts.forEach(function (p) {
      var k = Math.floor(p[0] / BUCKET) * BUCKET;
      var v = V(p);
      var b = buckets[k] || (buckets[k] = { t: k, o: v, h: v, l: v, c: v });
      b.h = Math.max(b.h, v); b.l = Math.min(b.l, v); b.c = v;
    });
    var candles = Object.keys(buckets).sort().map(function (k) { return buckets[k]; });
    // keep the candles thick and defined: show the most recent ones that fit at full width
    var maxN = Math.max(2, Math.floor(plotW / 9));
    if (candles.length > maxN) candles = candles.slice(-maxN);
    var candleMode = candles.length >= 2;

    var x, ext;
    if (candleMode) {
      x = d3.scaleUtc().domain([candles[0].t, candles[candles.length - 1].t + BUCKET]).range([m.left, W - m.right]);
      ext = [d3.min(candles, function (c) { return c.l; }), d3.max(candles, function (c) { return c.h; })];
    } else {
      x = d3.scaleUtc().domain(d3.extent(pts, function (p) { return p[0]; })).range([m.left, W - m.right]);
      ext = d3.extent(pts, function (p) { return V(p); });
    }
    // sub-panes (RSI + MACD) render once there are enough 5m closes to mean anything
    var closes = candles.map(function (c) { return c.c; });
    var showPanes = candleMode && closes.length >= 16;
    var PANE_GAP = 10, RSI_H = 54, MACD_H = 66;
    var H = HM + (showPanes ? PANE_GAP + RSI_H + PANE_GAP + MACD_H : 0);
    svg.attr('viewBox', '0 0 ' + W + ' ' + H).attr('width', '100%').attr('height', H);

    var pad = (ext[1] - ext[0]) * 0.15 || ext[1] * 0.05 || 1e-15;
    var y = d3.scaleLinear().domain([ext[0] - pad, ext[1] + pad]).range([HM - m.bottom, m.top]);

    var axDec = U.axisDec(ext[1] - ext[0] + 2 * pad);
    svg.append('g').call(function (g) {
      y.ticks(5).forEach(function (t) {
        g.append('line').attr('x1', m.left).attr('x2', W - m.right).attr('y1', y(t)).attr('y2', y(t))
          .attr('stroke', 'rgba(246,231,235,.07)');
      });
    });
    var ax = svg.append('g').attr('transform', 'translate(0,' + (HM - m.bottom) + ')')
      .call(d3.axisBottom(x).ticks(5).tickSize(0).tickPadding(8));
    var ay = svg.append('g').attr('transform', 'translate(' + m.left + ',0)')
      .call(d3.axisLeft(y).ticks(5).tickSize(0).tickPadding(6).tickFormat(function (v) { return U.axis(v, axDec); }));
    [ax, ay].forEach(function (g) {
      g.select('.domain').remove();
      g.selectAll('text').attr('fill', '#b98da0').attr('font-size', 10)
        .attr('font-family', "ui-monospace,'SF Mono',Menlo,monospace");
    });

    // ── Fibonacci retracement — levels of the window's high→low, under everything ──
    var fibSpan = ext[1] - ext[0];
    if (fibSpan > 0) {
      FIBS.forEach(function (f) {
        var lvl = ext[0] + fibSpan * f, yy = y(lvl);   // 0 = window low, 1 = window high
        var edge = f === 0 || f === 1;
        svg.append('line').attr('x1', m.left).attr('x2', W - m.right).attr('y1', yy).attr('y2', yy)
          .attr('stroke', '#e3b25f').attr('stroke-opacity', edge ? 0.35 : 0.22)
          .attr('stroke-dasharray', edge ? null : '3,4').attr('stroke-width', 1);
        svg.append('text').attr('x', W - m.right - 2).attr('y', yy - 3).attr('text-anchor', 'end')
          .attr('fill', '#e3b25f').attr('fill-opacity', 0.6).attr('font-size', 8.5)
          .attr('font-family', "ui-monospace,'SF Mono',Menlo,monospace")
          .text('fib ' + f.toFixed(3).replace(/0+$/, '').replace(/\.$/, '.0'));
      });
    }

    // ── EMA ribbon — Fibonacci periods 8·13·21·34·55 (5m-equivalent) on minute closes ──
    var ribbonLine = d3.line()
      .x(function (d) { return x(d[0]); }).y(function (d) { return y(d[1]); })
      .defined(function (d) { return d[0] >= x.domain()[0] && d[0] <= x.domain()[1]; });
    RIBBON.forEach(function (r) {
      var e = emaSeries(pts.map(function (p) { return V(p); }), r.p * 5); // minute samples → ×5
      var series = pts.map(function (p, i) { return [p[0], e[i]]; });
      svg.append('path').datum(series).attr('d', ribbonLine).attr('fill', 'none')
        .attr('stroke', r.col).attr('stroke-opacity', 0.5).attr('stroke-width', 1.3);
    });

    if (candleMode) {
      var slot = plotW / Math.max(candles.length, 1);
      var bodyW = Math.max(5, Math.min(22, slot * 0.7));
      candles.forEach(function (c) {
        var cx = x(c.t + BUCKET / 2);
        var col = c.c >= c.o ? UP : DOWN;
        // wick — full high→low, same hue as the body
        svg.append('line').attr('x1', cx).attr('x2', cx)
          .attr('y1', y(c.h)).attr('y2', y(c.l))
          .attr('stroke', col).attr('stroke-width', 2);
        // body — thick, ringed with the surface for definition, dojis kept visible
        var yTop = y(Math.max(c.o, c.c)), yBot = y(Math.min(c.o, c.c));
        var hgt = Math.max(3, yBot - yTop);
        svg.append('rect').attr('x', cx - bodyW / 2).attr('y', yTop)
          .attr('width', bodyW).attr('height', hgt).attr('rx', 1.5)
          .attr('fill', col).attr('stroke', '#2b111c').attr('stroke-width', 1);
      });
    } else {
      // too young for two candles — fall back to the growing line
      var area = d3.area().x(function (p) { return x(p[0]); }).y0(HM - m.bottom).y1(function (p) { return y(V(p)); });
      var line = d3.line().x(function (p) { return x(p[0]); }).y(function (p) { return y(V(p)); });
      var grad = svg.append('defs').append('linearGradient').attr('id', 'luvfill')
        .attr('x1', 0).attr('y1', 0).attr('x2', 0).attr('y2', 1);
      grad.append('stop').attr('offset', '0%').attr('stop-color', FILL_TOP);
      grad.append('stop').attr('offset', '100%').attr('stop-color', FILL_BOT);
      svg.append('path').datum(pts).attr('d', area).attr('fill', 'url(#luvfill)');
      svg.append('path').datum(pts).attr('d', line).attr('fill', 'none')
        .attr('stroke', LINE).attr('stroke-width', 2).attr('stroke-linejoin', 'round').attr('stroke-linecap', 'round');
    }

    var chg = (V(pts[pts.length - 1]) / V(pts[0]) - 1) * 100;
    deltaEl.innerHTML = 'Δ across our samples: <b style="color:' + pctColor(chg) + '">' +
      pctArrow(chg) + ' ' + fmtPct(chg) + '</b>';

    // ── RSI(14) + MACD(12,26,9) sub-panes on the 5-minute closes ──
    if (showPanes) {
      var cxOf = function (i) { return x(candles[i].t + BUCKET / 2); };
      var paneLabel = function (top, txt) {
        svg.append('text').attr('x', m.left + 2).attr('y', top + 9).attr('fill', '#b98da0')
          .attr('font-size', 8.5).attr('font-family', "ui-monospace,'SF Mono',Menlo,monospace").text(txt);
      };
      var paneBox = function (top, h) {
        svg.append('rect').attr('x', m.left).attr('y', top).attr('width', plotW).attr('height', h)
          .attr('fill', 'rgba(43,17,28,.45)').attr('stroke', 'rgba(74,31,48,.8)').attr('rx', 3);
      };

      // RSI
      var rsiTop = HM + PANE_GAP;
      paneBox(rsiTop, RSI_H);
      var rsi = rsiSeries(closes, 14);
      var ry = d3.scaleLinear().domain([0, 100]).range([rsiTop + RSI_H - 4, rsiTop + 4]);
      [30, 50, 70].forEach(function (g) {
        svg.append('line').attr('x1', m.left).attr('x2', W - m.right).attr('y1', ry(g)).attr('y2', ry(g))
          .attr('stroke', g === 50 ? 'rgba(246,231,235,.10)' : 'rgba(227,178,95,.28)')
          .attr('stroke-dasharray', '3,4').attr('stroke-width', 1);
        svg.append('text').attr('x', W - m.right - 2).attr('y', ry(g) - 2).attr('text-anchor', 'end')
          .attr('fill', '#b98da0').attr('fill-opacity', 0.7).attr('font-size', 8).text(g);
      });
      var rsiPts = [];
      rsi.forEach(function (v, i) { if (v !== null) rsiPts.push([cxOf(i), ry(v)]); });
      if (rsiPts.length > 1) {
        svg.append('path').datum(rsiPts)
          .attr('d', d3.line().x(function (d) { return d[0]; }).y(function (d) { return d[1]; }))
          .attr('fill', 'none').attr('stroke', '#e3b25f').attr('stroke-width', 1.6);
      }
      var rsiNow = rsi[rsi.length - 1];
      paneLabel(rsiTop, 'RSI 14 · 5m' + (rsiNow !== null ? ' · ' + rsiNow.toFixed(1) : ''));

      // MACD
      var mcTop = rsiTop + RSI_H + PANE_GAP;
      paneBox(mcTop, MACD_H);
      var mc = macdSeries(closes);
      var mvals = [];
      mc.macd.forEach(function (v, i) {
        if (v !== null) { mvals.push(Math.abs(v)); if (mc.signal[i] !== null) mvals.push(Math.abs(v - mc.signal[i])); }
      });
      var mmax = d3.max(mvals) || 1e-18;
      var my = d3.scaleLinear().domain([-mmax, mmax]).range([mcTop + MACD_H - 4, mcTop + 4]);
      svg.append('line').attr('x1', m.left).attr('x2', W - m.right).attr('y1', my(0)).attr('y2', my(0))
        .attr('stroke', 'rgba(246,231,235,.12)');
      var slotW = plotW / Math.max(candles.length, 1), histW = Math.max(2, Math.min(10, slotW * 0.5));
      mc.macd.forEach(function (v, i) {
        if (v === null || mc.signal[i] === null) return;
        var h = v - mc.signal[i];
        svg.append('rect').attr('x', cxOf(i) - histW / 2)
          .attr('y', h >= 0 ? my(h) : my(0)).attr('width', histW)
          .attr('height', Math.max(1, Math.abs(my(h) - my(0))))
          .attr('fill', h >= 0 ? UP : DOWN).attr('fill-opacity', 0.55);
      });
      [['macd', '#ff006e'], ['signal', '#ffb3c1']].forEach(function (s) {
        var line = [];
        mc[s[0]].forEach(function (v, i) { if (v !== null) line.push([cxOf(i), my(v)]); });
        if (line.length > 1) {
          svg.append('path').datum(line)
            .attr('d', d3.line().x(function (d) { return d[0]; }).y(function (d) { return d[1]; }))
            .attr('fill', 'none').attr('stroke', s[1]).attr('stroke-width', 1.5);
        }
      });
      var mNow = mc.macd[mc.macd.length - 1], sNow = mc.signal[mc.signal.length - 1];
      paneLabel(mcTop, 'MACD 12·26·9 · 5m' +
        (mNow !== null && sNow !== null ? (mNow >= sNow ? ' · bullish cross' : ' · bearish cross') : ' · warming up'));
    }

    var tip = this.root.querySelector('.mkt-tip');
    var xhair = svg.append('line').attr('y1', m.top).attr('y2', HM - m.bottom)
      .attr('stroke', 'rgba(246,231,235,.35)').attr('stroke-dasharray', '2,3').attr('display', 'none');
    var dot = svg.append('circle').attr('r', 4).attr('fill', LINE)
      .attr('stroke', '#2b111c').attr('stroke-width', 2).attr('display', 'none');
    var bis = d3.bisector(function (p) { return p[0]; }).center;
    svg.append('rect').attr('x', m.left).attr('y', m.top)
      .attr('width', W - m.left - m.right).attr('height', HM - m.top - m.bottom)
      .attr('fill', 'transparent')
      .on('pointermove', function (ev) {
        var px = d3.pointer(ev, this)[0], t = x.invert(px), cx, cy;
        if (candleMode) {
          var k = Math.floor(t / BUCKET) * BUCKET, c = buckets[k];
          if (!c || k < candles[0].t) return;
          cx = x(c.t + BUCKET / 2); cy = y(c.c);
          tip.innerHTML = '<b>' + new Date(c.t).toLocaleTimeString() + ' · 5m candle · ' + U.tipHead + '</b><br>' +
            'O ' + U.tip(c.o, axDec) + ' · C ' + U.tip(c.c, axDec) + '<br>' +
            'H ' + U.tip(c.h, axDec) + ' · L ' + U.tip(c.l, axDec);
        } else {
          var p = pts[bis(pts, t)];
          if (!p) return;
          cx = x(p[0]); cy = y(V(p));
          tip.innerHTML = '<b>' + new Date(p[0]).toLocaleTimeString() + '</b><br>' +
            U.amt + ' = ' + U.tip(V(p), axDec);
        }
        xhair.attr('x1', cx).attr('x2', cx).attr('display', null);
        dot.attr('cx', cx).attr('cy', cy).attr('display', null);
        tip.hidden = false;
        var bw = box.clientWidth, tw = tip.offsetWidth;
        var lx = (cx / W) * bw;
        tip.style.left = Math.min(Math.max(lx - tw / 2, 4), bw - tw - 4) + 'px';
        tip.style.top = ((cy / H) * box.clientHeight - tip.offsetHeight - 14) + 'px';
      })
      .on('pointerleave', function () {
        xhair.attr('display', 'none'); dot.attr('display', 'none'); tip.hidden = true;
      });
  };

  // ── internal diagnostics — the raw measures (incl. the scientific-notation ONE LUV
  //    figures removed from the visible chart) for widgets and debugging. Read it with
  //    DVLuvMarket.diag() or filter the console on [LUVMarket].
  Market.prototype.diag = function () {
    var mkt = this.market || {};
    var pn = Number(mkt.priceNative), pu = Number(mkt.priceUsd);
    var lq = mkt.liquidity && Number(mkt.liquidity.quote);
    return {
      at: mkt.t ? new Date(mkt.t).toISOString() : null,
      oneLuvUsd: pu ? '$' + pu.toExponential(4) : null,       // e.g. $1.4660e-13
      oneLuvEth: pn ? pn.toExponential(4) + ' ETH' : null,    // e.g. 7.5360e-17 ETH
      oneTrillionUsd: mkt.oneTrillionUsd ?? null,
      priceChange: mkt.priceChange || {},
      priceXfromSeed: pn ? +(pn / SEED_PRICE_NATIVE).toFixed(4) : null,
      liquidityXfromSeed: lq ? +(lq / SEED_WETH).toFixed(4) : null,
      seed: { priceNative: SEED_PRICE_NATIVE, weth: SEED_WETH },
      liquidity: mkt.liquidity || {}, volume: mkt.volume || {}, txns: mkt.txns || {},
      samples: this.points.length,
      refreshMs: REFRESH_MS, windowMs: WINDOW_MS, pair: PAIR, version: DVLuvMarket.version
    };
  };

  Market.prototype._renderAll = function () {
    this._renderLine(); this._renderChart();
    try { console.log('[LUVMarket]', this.diag()); } catch (e) { /* diagnostics never break the page */ }
  };

  Market.prototype.start = function () {
    if (!this.root) return this;
    var self = this;
    this._skeleton();
    this._buildToggle();
    var tick = function () {
      if (!document.hidden) self._fetch().then(function () { self._renderAll(); });
      self._timer = setTimeout(tick, REFRESH_MS);
    };
    tick();
    var priceTick = function () {
      if (!document.hidden) self._fetchPrice().then(function () { self._renderLine(); });
      self._priceTimer = setTimeout(priceTick, PRICE_MS);
    };
    self._priceTimer = setTimeout(priceTick, PRICE_MS);
    global.addEventListener('resize', function () { self._renderChart(); });
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) self._fetch().then(function () { self._renderAll(); });
    });
    return this;
  };
  Market.prototype.stop = function () { clearTimeout(this._timer); this._timer = 0; return this; };

  var DVLuvMarket = { Market: Market, PAIR: PAIR, REFRESH_MS: REFRESH_MS, version: '2.5.0' };
  // DVLuvMarket.diag() — diagnostics of the auto-booted instance, for widgets and internals
  DVLuvMarket.diag = function () { return DVLuvMarket._booted ? DVLuvMarket._booted.diag() : null; };
  if (typeof module !== 'undefined' && module.exports) module.exports = DVLuvMarket;
  global.DVLuvMarket = DVLuvMarket;

  if (global.document) {
    var boot = function () {
      var el = document.getElementById('luvmarket');
      if (el && !el.dataset.booted) { el.dataset.booted = '1'; DVLuvMarket._booted = new Market(el).start(); }
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
  }
})(typeof window !== 'undefined' ? window : this);
