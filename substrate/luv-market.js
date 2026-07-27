/*!
 * SHAMBA LUV — market substrate (new substrate; existing DeltaVerse substrates untouched).
 *
 * The measure of LUV as one complete expression on a single line:
 *   ❤ 1T LUV = $0.1466 USDC ▕▁▁▁▂▄█▏ ▲ +653% 24H
 * — the price point (one trillion LUV, a million millions, in USDC), a signed 24-hour
 * bar, and the 24-hour percent change, refreshed every 15 minutes. Beneath it the d3
 * history line grows from the same-origin mirror (market.json + market-history.json,
 * written server-side by luv-market-collector.mjs — CSP connect-src 'self').
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
  var REFRESH_MS = 15 * 60e3;          // the actual update cadence: every 15 minutes
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
    return '$' + Number(v).toFixed(4) + ' USDC';
  }

  function Market(mount) {
    this.root = typeof mount === 'string' ? document.querySelector(mount) : mount;
    this.market = null;
    this.points = [];   // [ms, priceUsd, priceNative]
    this._timer = 0;
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
      '</div>' +
      '<div class="mkt-chart"><svg role="img" aria-label="LUV price in USD over the last 24 hours"></svg>' +
      '<div class="mkt-tip" hidden></div></div>' +
      '<div class="mkt-fine"><span class="mkt-delta"></span><span class="mkt-x" title="the X multiplier — measured from the liquidity seed (price X = 1.00e-17 ETH per LUV)"></span><span class="mkt-spacer"></span>' +
      '<span class="mkt-src">updates every 15 min · pair mirrored server-side · ' +
      'correlate against the DEX Screener embed below</span></div>';
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

  Market.prototype._renderLine = function () {
    if (!this.market) return;
    var pc = this.market.priceChange || {};
    var h24 = pc.h24 === undefined ? null : Number(pc.h24);
    this.root.querySelector('.mkt-usdc').textContent = fmtUsdc(this.market.oneTrillionUsd);
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
      xEl.textContent = 'price ' + priceX.toFixed(2) + '× from X' +
        (liqX ? ' · liquidity ' + liqX.toFixed(2) + '×' : '');
      xEl.style.color = '#e3b25f';
    }
  };

  Market.prototype._renderChart = function () {
    var d3 = global.d3; if (!d3) return;
    var box = this.root.querySelector('.mkt-chart'), svg = d3.select(box).select('svg');
    var W = box.clientWidth || 600, H = Math.max(180, Math.min(260, W * 0.32));
    svg.attr('viewBox', '0 0 ' + W + ' ' + H).attr('width', '100%').attr('height', H);
    svg.selectAll('*').remove();

    var now = Date.now();
    var svgEl = this.root.querySelector('.mkt-chart svg');
    if (svgEl) svgEl.setAttribute('aria-label', 'LUV price in USD — the 4-hour view in 5-minute candles; flat stretches between trades stay level');
    var pts = this.points.filter(function (p) { return p[0] >= now - WINDOW_MS; });
    if (pts.length < 2) pts = this.points.slice();
    var deltaEl = this.root.querySelector('.mkt-delta');
    if (pts.length < 2) {
      svg.append('text').attr('x', W / 2).attr('y', H / 2).attr('text-anchor', 'middle')
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
      var b = buckets[k] || (buckets[k] = { t: k, o: p[1], h: p[1], l: p[1], c: p[1] });
      b.h = Math.max(b.h, p[1]); b.l = Math.min(b.l, p[1]); b.c = p[1];
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
      ext = d3.extent(pts, function (p) { return p[1]; });
    }
    var pad = (ext[1] - ext[0]) * 0.15 || ext[1] * 0.05 || 1e-15;
    var y = d3.scaleLinear().domain([ext[0] - pad, ext[1] + pad]).range([H - m.bottom, m.top]);

    svg.append('g').call(function (g) {
      y.ticks(4).forEach(function (t) {
        g.append('line').attr('x1', m.left).attr('x2', W - m.right).attr('y1', y(t)).attr('y2', y(t))
          .attr('stroke', 'rgba(246,231,235,.07)');
      });
    });
    var ax = svg.append('g').attr('transform', 'translate(0,' + (H - m.bottom) + ')')
      .call(d3.axisBottom(x).ticks(5).tickSize(0).tickPadding(8));
    var ay = svg.append('g').attr('transform', 'translate(' + m.left + ',0)')
      .call(d3.axisLeft(y).ticks(4).tickSize(0).tickPadding(6).tickFormat(function (v) { return '$' + (Number(v) * 1e12).toFixed(4); }));
    [ax, ay].forEach(function (g) {
      g.select('.domain').remove();
      g.selectAll('text').attr('fill', '#b98da0').attr('font-size', 10)
        .attr('font-family', "ui-monospace,'SF Mono',Menlo,monospace");
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
      var area = d3.area().x(function (p) { return x(p[0]); }).y0(H - m.bottom).y1(function (p) { return y(p[1]); });
      var line = d3.line().x(function (p) { return x(p[0]); }).y(function (p) { return y(p[1]); });
      var grad = svg.append('defs').append('linearGradient').attr('id', 'luvfill')
        .attr('x1', 0).attr('y1', 0).attr('x2', 0).attr('y2', 1);
      grad.append('stop').attr('offset', '0%').attr('stop-color', FILL_TOP);
      grad.append('stop').attr('offset', '100%').attr('stop-color', FILL_BOT);
      svg.append('path').datum(pts).attr('d', area).attr('fill', 'url(#luvfill)');
      svg.append('path').datum(pts).attr('d', line).attr('fill', 'none')
        .attr('stroke', LINE).attr('stroke-width', 2).attr('stroke-linejoin', 'round').attr('stroke-linecap', 'round');
    }

    var chg = (pts[pts.length - 1][1] / pts[0][1] - 1) * 100;
    deltaEl.innerHTML = 'Δ across our samples: <b style="color:' + pctColor(chg) + '">' +
      pctArrow(chg) + ' ' + fmtPct(chg) + '</b>';

    var tip = this.root.querySelector('.mkt-tip');
    var xhair = svg.append('line').attr('y1', m.top).attr('y2', H - m.bottom)
      .attr('stroke', 'rgba(246,231,235,.35)').attr('stroke-dasharray', '2,3').attr('display', 'none');
    var dot = svg.append('circle').attr('r', 4).attr('fill', LINE)
      .attr('stroke', '#2b111c').attr('stroke-width', 2).attr('display', 'none');
    var bis = d3.bisector(function (p) { return p[0]; }).center;
    svg.append('rect').attr('x', m.left).attr('y', m.top)
      .attr('width', W - m.left - m.right).attr('height', H - m.top - m.bottom)
      .attr('fill', 'transparent')
      .on('pointermove', function (ev) {
        var px = d3.pointer(ev, this)[0], t = x.invert(px), cx, cy;
        if (candleMode) {
          var k = Math.floor(t / BUCKET) * BUCKET, c = buckets[k];
          if (!c || k < candles[0].t) return;
          cx = x(c.t + BUCKET / 2); cy = y(c.c);
          tip.innerHTML = '<b>' + new Date(c.t).toLocaleTimeString() + ' · 5m candle · 1T LUV</b><br>' +
            'O ' + fmtUsdc(c.o * 1e12) + ' · C ' + fmtUsdc(c.c * 1e12) + '<br>' +
            'H ' + fmtUsdc(c.h * 1e12) + ' · L ' + fmtUsdc(c.l * 1e12);
        } else {
          var p = pts[bis(pts, t)];
          if (!p) return;
          cx = x(p[0]); cy = y(p[1]);
          tip.innerHTML = '<b>' + new Date(p[0]).toLocaleTimeString() + '</b><br>' +
            '1T LUV = ' + fmtUsdc(p[1] * 1e12);
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
    var tick = function () {
      if (!document.hidden) self._fetch().then(function () { self._renderAll(); });
      self._timer = setTimeout(tick, REFRESH_MS);
    };
    tick();
    global.addEventListener('resize', function () { self._renderChart(); });
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) self._fetch().then(function () { self._renderAll(); });
    });
    return this;
  };
  Market.prototype.stop = function () { clearTimeout(this._timer); this._timer = 0; return this; };

  var DVLuvMarket = { Market: Market, PAIR: PAIR, REFRESH_MS: REFRESH_MS, version: '2.2.0' };
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
