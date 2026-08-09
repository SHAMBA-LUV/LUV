/*!
 * SHAMBA LUV — luv-rainbow.js: the rainbow substrate (DVLuvRainbow), a DeltaVerse organ.
 *
 * Draws the in-house Bitcoin rainbow as SVG, entirely in the browser, from the
 * published fit — the same regression printed on rainbow.html:
 *
 *     log10(price) = 5.380917 · log10(days since genesis) − 15.403007      R² = 0.936
 *
 * Nine bands span the fit's own residual range (−0.70 … +1.00 in log10; every
 * historical price falls inside), each 10^0.18889 ≈ 1.545× tall. Axes are log-log,
 * where the rainbow is a straight ruler — nothing hides in curvature, which is what
 * makes a long extrapolation honest to draw.
 *
 * THE SCALE OF THE ESTIMATE. This chart is the far-horizon instrument, so it carries a
 * MARKET CAP axis (price × 21,000,000, the terminal supply) and three magnitudes to
 * measure the trajectory against: total world debt (~$345T), the quadrillion mark, and
 * the derivatives economy above it. Where the fit crosses each is drawn, not asserted —
 * a log-log regression is a description of one era, and the crossing dates are
 * arithmetic, not forecast. What the chart can show is that the ARITHMETIC HAS ROOM:
 * 21 million units divide into a quadrillion without strain.
 *
 * THE KEY POINTS AT THE BANDS. The nine names sit in a vertical stack in the top-left —
 * dead space at every zoom, because a log-log ribbon rises left to right — and each one
 * runs a leader in its own colour to the band it names. The names used to sit in the
 * right margin, where the ribbon crowds them into a single overlapping clump.
 *
 * cypherpunk2048 / CSP-safe: external file, zero dependencies, zero network calls,
 * SVG built with createElementNS (no innerHTML). The fit is public arithmetic; the
 * measured price path stays where its own consent rail delivers it.
 *
 * Self-boot: <div data-luvrainbow data-from="2010" data-to="2140"
 *                 data-price="64482" data-date="2026-08-05"></div>
 * API: DVLuvRainbow.render(mount, opts) · .center(days) → USD · .FIT · .BANDS · .MACRO
 */
(function (global) {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  var FIT = { slope: 5.380917, intercept: -15.403007, r2: 0.936, fitted: '2026-08-05', n: 360 };
  var GENESIS = Date.UTC(2009, 0, 3);
  var STEP = (1.0 - (-0.7)) / 9; // 0.18889 in log10 — one band
  var TERMINAL_SUPPLY = 21e6;    // the market-cap axis basis
  var BANDS = [
    { name: 'basically a fire sale',     col: '#2f6fd0' },
    { name: 'BUY!',                      col: '#2fa3c9' },
    { name: 'accumulate',                col: '#2fbf71' },
    { name: 'still cheap',               col: '#8fd032' },
    { name: 'HODL!',                     col: '#e3d032' },
    { name: 'is this a bubble?',         col: '#e3a832' },
    { name: 'FOMO intensifies',          col: '#e07f2f' },
    { name: 'sell. seriously, SELL!',    col: '#d0522f' },
    { name: 'maximum bubble territory',  col: '#c22f4a' }
  ];

  // The magnitudes the estimate is measured against, in MARKET CAP. Figures are the ones
  // rainbow.html states; they are reference marks, not predictions, and each is drawn where
  // the fit would cross it rather than claimed to arrive there.
  // The two magnitudes that are NOT round decades — the decade ladder on the market-cap axis
  // carries the rest. Reference marks, not predictions: each is drawn where the fit would cross
  // it, which is arithmetic from the regression and nothing more.
  var MACRO = [
    { cap: 345e12, label: 'world debt \u00b7 $345T',    key: true },
    { cap: 1e15,   label: 'the quadrillion \u00b7 $1Q', key: true }
  ];

  // ── total world debt, as published and then carried forward ──
  // Approximate global debt from the IIF Global Debt Monitor, in USD trillions. These are
  // headline aggregates rounded to the trillion, not a reconstructed series — they are here to
  // give the trajectory something real to be measured against, and the overlay says so.
  // Past the record the line grows at the rate the record itself kept: 3.15%/yr compounded,
  // the 2010 -> 2026 CAGR.
  var WORLD_DEBT = [[2000, 87], [2005, 120], [2010, 210], [2013, 235], [2016, 245], [2019, 255],
                    [2020, 275], [2021, 303], [2022, 299], [2023, 313], [2024, 318], [2025, 338],
                    [2026, 345]];
  var DEBT_CAGR = Math.pow(345 / 210, 1 / 16) - 1;      // 3.15%/yr, measured not assumed

  /// Total world debt in USD at a decimal year — interpolated inside the record, compounded past it.
  function worldDebtAt(year) {
    var last = WORLD_DEBT[WORLD_DEBT.length - 1];
    if (year >= last[0]) return last[1] * 1e12 * Math.pow(1 + DEBT_CAGR, year - last[0]);
    if (year <= WORLD_DEBT[0][0]) return WORLD_DEBT[0][1] * 1e12;
    for (var i = 0; i < WORLD_DEBT.length - 1; i++) {
      var a = WORLD_DEBT[i], b = WORLD_DEBT[i + 1];
      if (year >= a[0] && year <= b[0]) {
        var t = (year - a[0]) / (b[0] - a[0]);
        return (a[1] + (b[1] - a[1]) * t) * 1e12;
      }
    }
    return last[1] * 1e12;
  }

  // the four actual halvings; the schedule then steps 210,000 blocks ≈ 1458.33 days
  var HALVINGS = [Date.UTC(2012, 10, 28), Date.UTC(2016, 6, 9), Date.UTC(2020, 4, 11), Date.UTC(2024, 3, 20)];
  var HALVING_STEP_MS = 1458.33 * 86400e3;

  // ── the end of mining, computed and then checked against the chain ──
  // The subsidy is 50 BTC = 5,000,000,000 sat, right-shifted once per halving. After 33 shifts it
  // is 0, so the last coin is mined at block 210,000 x 33 = 6,930,000.
  //
  // "2140" is that block at the protocol's 600-second target. The chain has never kept it: across
  // genesis to the fourth halving it has averaged 574.6 s/block, about 4% fast, and 600s is
  // already 247 days late against the halving that has actually happened. Carrying the observed
  // pace forward instead moves the end of mining to ~2135. Both are drawn, because the gap between
  // them IS the accuracy of the estimate — five years of it.
  var END_BLOCK = 210000 * 33;
  function observedSecPerBlock() { return (HALVINGS[HALVINGS.length - 1] - GENESIS) / 1000 / (210000 * HALVINGS.length); }
  function endOfMining() {
    var obs = observedSecPerBlock();
    return {
      block: END_BLOCK,
      targetMs: GENESIS + END_BLOCK * 600 * 1000,
      observedMs: GENESIS + END_BLOCK * obs * 1000,
      secPerBlock: obs,
      fastPct: (600 - obs) / 600 * 100
    };
  }

  function daysSinceGenesis(ms) { return (ms - GENESIS) / 86400e3; }
  function centerLog(days) { return FIT.slope * Math.log10(days) + FIT.intercept; }
  function el(name, attrs, text) {
    var n = document.createElementNS(NS, name);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (text != null) n.textContent = text;
    return n;
  }
  function trim(v) {
    var s = v >= 100 ? String(Math.round(v)) : v.toPrecision(3);
    return s.indexOf('.') < 0 ? s : s.replace(/0+$/, '').replace(/\.$/, '');
  }
  /// Compact USD, running past the trillion because the far end of this chart does.
  function usd(p) {
    if (p >= 1e18) return '$' + trim(p / 1e18) + 'e18';
    if (p >= 1e15) return '$' + trim(p / 1e15) + 'Q';
    if (p >= 1e12) return '$' + trim(p / 1e12) + 'T';
    if (p >= 1e9) return '$' + trim(p / 1e9) + 'B';
    if (p >= 1e6) return '$' + trim(p / 1e6) + 'M';
    if (p >= 1e3) return '$' + trim(p / 1e3) + 'k';
    if (p >= 1) return '$' + Math.round(p);
    return '$' + p.toFixed(2);
  }
  function priceLabel(log10usd) { return usd(Math.pow(10, log10usd)); }
  /// The year the fit reaches a given price — the crossing, as arithmetic.
  function yearAtPrice(p) {
    var days = Math.pow(10, (Math.log10(p) - FIT.intercept) / FIT.slope);
    return new Date(GENESIS + days * 86400e3).getUTCFullYear();
  }

  /// The measured close on a date, from the series the arc organ embeds — interpolated in log
  /// space between its weekly points. null once the record runs out, which is where the fitted
  /// curve takes over.
  function seriesPriceAt(ms) {
    var RC = global.DVLuvRainbowChart;
    if (!RC || !RC.SERIES || !RC.SERIES.length) return null;
    var x = RC.xOf(ms);
    if (x < 1 || x > RC.SERIES_LAST_X) return null;
    var i = Math.floor((x - 1) / RC.SERIES_STEP);
    if (i < 0) i = 0;
    if (i >= RC.SERIES.length - 1) return Math.pow(10, RC.SERIES[RC.SERIES.length - 1]);
    var xa = RC.seriesX(i), xb = RC.seriesX(i + 1);
    var t = xb === xa ? 0 : (x - xa) / (xb - xa);
    return Math.pow(10, RC.SERIES[i] + (RC.SERIES[i + 1] - RC.SERIES[i]) * t);
  }

  function render(mount, opts) {
    opts = opts || {};
    var fromYear = opts.from || 2010, toYear = opts.to || 2140;
    var W = opts.width || 1240, H = opts.height || 780;
    var L = 70, R = 122, T = 20, B = 48;                       // R carries the market-cap axis
    var x0 = Math.log10(daysSinceGenesis(Date.UTC(fromYear, 0, 1)));
    var x1 = Math.log10(daysSinceGenesis(Date.UTC(toYear, 0, 1)));
    var yLo = centerLog(Math.pow(10, x0)) - 0.7 - 0.15;
    // yMax (USD) pins the price ceiling — the zoom ladder hands in 1e4 … 1e14;
    // bands above the ceiling clip at the viewport edge, which IS the zoom.
    var yHi = opts.yMax > 0 ? Math.log10(opts.yMax) : centerLog(Math.pow(10, x1)) + 1.0 + 0.15;
    function X(lgDays) { return L + (lgDays - x0) / (x1 - x0) * (W - L - R); }
    function Y(lgUsd) { return T + (yHi - lgUsd) / (yHi - yLo) * (H - T - B); }
    function Xdate(ms) { return X(Math.log10(daysSinceGenesis(ms))); }

    var svg = el('svg', {
      viewBox: '0 0 ' + W + ' ' + H, xmlns: NS, role: 'img',
      'aria-label': 'The in-house Bitcoin rainbow on log-log axes, ' + fromYear + ' to ' + toYear +
        ', with a market-cap axis and reference marks at world debt and the quadrillion.'
    });
    svg.appendChild(el('rect', { width: W, height: H, fill: '#160a0f' }));

    var i, d;
    var fromMs0 = Date.UTC(fromYear, 0, 1), toMs0 = Date.UTC(toYear, 0, 1);

    // ── price decades on the left ──
    for (d = Math.ceil(yLo); d <= Math.floor(yHi); d++) {
      svg.appendChild(el('line', { x1: L, y1: Y(d), x2: W - R, y2: Y(d), stroke: '#4a1f30', 'stroke-width': 0.7 }));
      svg.appendChild(el('text', { x: L - 6, y: Y(d) + 4, fill: '#b98da0', 'font-size': 10.5, 'text-anchor': 'end', 'font-family': 'monospace' }, priceLabel(d)));
    }

    // ── the sub-decade lattice, all the way up ──
    // The unit you read a price in scales with the price: under $100k a thousand dollars is the
    // measure, over it ten thousand, past a million a hundred thousand, and so on. That is one
    // rule, not three — inside the decade 10^d the step is 10^(d-1) — so the lattice keeps the
    // same relative resolution at every magnitude instead of turning to mush at the top.
    // It thins itself by pixels: a line needs 5px of clearance, a label 15px.
    // Iteration runs DOWNWARD (high price to low), so ky increases and the trackers must start
    // at -Infinity. Seeding them at +Infinity makes the very first clearance test -Infinity < 5,
    // which skips every line and leaves the tracker untouched — the whole lattice silently absent.
    var lastLineY = -Infinity, lastLabelY = -Infinity;
    for (var dd = Math.floor(yHi); dd >= Math.floor(yLo); dd--) {
      var stepv = Math.pow(10, dd - 1);
      for (var mult = 99; mult >= 11; mult--) {          // 1.1x .. 9.9x of the decade
        var v = stepv * mult, lgK = Math.log10(v);
        if (lgK <= yLo || lgK >= yHi) continue;
        var ky = Y(lgK);
        if (ky < T || ky > H - B || ky - lastLineY < 5) continue;
        svg.appendChild(el('line', {
          x1: L, y1: ky, x2: W - R, y2: ky, stroke: '#4a1f30', 'stroke-width': 0.3, 'stroke-opacity': 0.7
        }));
        lastLineY = ky;
        // A sub-decade label 1.1x above a decade sits ~2px from it: close enough to overprint
        // "$1.1M" straight onto "$1M". Anything within 12px of its own decade is left unlabelled;
        // the line still draws, so the lattice keeps its resolution without the collision.
        // Below a cent the compact formatter rounds to "$0.00", which is a label that says
        // nothing; and anything in the top 14px runs into the axis title.
        var decY = Y(Math.round(lgK));
        if (ky - lastLabelY >= 22 && Math.abs(ky - decY) >= 12 && v >= 0.01 && ky > T + 14) {
          svg.appendChild(el('text', {
            x: L - 6, y: ky + 3.5, fill: '#7d5d6c', 'font-size': 8.5,
            'text-anchor': 'end', 'font-family': 'monospace'
          }, usd(v)));
          lastLabelY = ky;
        }
      }
    }

    // ── market cap on the right, on its OWN clean decades ──
    // Rescaling the price decades gives $2.1B, $21B, $210B — arithmetically right and useless to
    // read against. The magnitudes this chart is measured against are round: a billion, ten
    // billion, a hundred billion, a trillion. So the right axis gets its own ladder, stepping one
    // decade at a time, and each rung carries the year the fit reaches it.
    var lgSupply = Math.log10(TERMINAL_SUPPLY);
    var capLo = Math.ceil(yLo + lgSupply), capHi = Math.floor(yHi + lgSupply);
    for (var c = capLo; c <= capHi; c++) {
      var cy = Y(c - lgSupply);
      if (cy < T || cy > H - B) continue;
      svg.appendChild(el('line', {
        x1: L, y1: cy, x2: W - R, y2: cy, stroke: '#7d5d6c',
        'stroke-width': 0.5, 'stroke-dasharray': '1 6', 'stroke-opacity': 0.45
      }));
      svg.appendChild(el('text', {
        x: W - R + 8, y: cy + 3.5, fill: '#b98da0', 'font-size': 10, 'font-family': 'monospace'
      }, usd(Math.pow(10, c))));
      var cYr = yearAtPrice(Math.pow(10, c - lgSupply));
      if (cYr >= 2010 && cYr <= toYear) {
        svg.appendChild(el('text', {
          x: W - R + 8, y: cy + 14, fill: '#7d5d6c', 'font-size': 8.5, 'font-family': 'monospace'
        }, cYr));
      }
    }
    svg.appendChild(el('text', { x: L - 6, y: T - 7, fill: '#b98da0', 'font-size': 9.5, 'text-anchor': 'end', 'font-family': 'monospace', 'letter-spacing': '.08em' }, 'PRICE'));
    svg.appendChild(el('text', { x: W - R + 8, y: T - 7, fill: '#b98da0', 'font-size': 9.5, 'font-family': 'monospace', 'letter-spacing': '.08em' }, 'MARKET CAP'));

    // ── year ticks ──
    var yearTicks = [2010, 2011, 2012, 2014, 2016, 2020, 2024, 2028, 2032, 2040, 2050, 2060, 2070, 2080, 2100, 2140];
    for (var yi = 0; yi < yearTicks.length; yi++) {
      var yr = yearTicks[yi];
      if (yr < fromYear || yr > toYear) continue;
      var xx = Xdate(Date.UTC(yr, 0, 1));
      if (xx < L || xx > W - R) continue;
      svg.appendChild(el('line', { x1: xx, y1: T, x2: xx, y2: H - B, stroke: '#4a1f30', 'stroke-width': 0.6 }));
      svg.appendChild(el('text', { x: xx, y: H - B + 16, fill: '#b98da0', 'font-size': 10.5, 'text-anchor': 'middle', 'font-family': 'monospace' }, String(yr)));
    }

    // ── the nine bands (straight polygons in log-log; the viewport clips the rest) ──
    // Each band is painted solid and separated by a hairline of the background. At 0.42 opacity
    // over near-black the nine colours washed into one another and the ladder read as a single
    // smear; solid fills plus a dark seam give every colour its own edge, which is what makes the
    // ladder countable at a glance instead of merely coloured.
    var c0 = centerLog(Math.pow(10, x0)), c1 = centerLog(Math.pow(10, x1));
    for (var b = 0; b < 9; b++) {
      var lo = -0.7 + b * STEP, hi = lo + STEP;
      var pts = X(x0) + ',' + Y(c0 + lo) + ' ' + X(x1) + ',' + Y(c1 + lo) + ' ' +
                X(x1) + ',' + Y(c1 + hi) + ' ' + X(x0) + ',' + Y(c0 + hi);
      svg.appendChild(el('polygon', {
        points: pts, fill: BANDS[b].col, 'fill-opacity': 0.94,
        stroke: '#160a0f', 'stroke-opacity': 0.85, 'stroke-width': 1.1
      }));
    }

    // ── the center line ──
    svg.appendChild(el('line', {
      x1: X(x0), y1: Y(c0), x2: X(x1), y2: Y(c1),
      stroke: '#f6e7eb', 'stroke-width': 1.2, 'stroke-dasharray': '6 4', 'stroke-opacity': 0.85
    }));

    // ── the measured price path, inside the rainbow ──
    // The same embedded series the arc chart draws, borrowed from DVLuvRainbowChart rather than
    // duplicated here: one copy of the history, two renderers. Its x is a ROW INDEX from the first
    // priced day, so each point is converted through that organ's own calendar before being placed
    // on this chart's days-since-genesis axis. If the arc organ is not on the page, the ribbon and
    // the fit still draw and only the path is missing.
    var RC = global.DVLuvRainbowChart;
    if (RC && RC.SERIES && RC.SERIES.length) {
      var ppts = [], pi, plast = null;
      for (pi = 0; pi < RC.SERIES.length; pi++) {
        var pms = RC.msOf(RC.seriesX(pi));
        if (pms < fromMs0 || pms > toMs0) continue;
        var plg = Math.log10(daysSinceGenesis(pms));
        if (plg < x0 || plg > x1) continue;
        var pxx = X(plg), pyy = Y(RC.SERIES[pi]);
        ppts.push(pxx + ',' + pyy);
        plast = { x: pxx, y: pyy };
      }
      if (ppts.length > 1) {
        svg.appendChild(el('polyline', {
          points: ppts.join(' '), fill: 'none', stroke: '#ffffff',
          'stroke-width': 1.6, 'stroke-linejoin': 'round', 'stroke-linecap': 'round'
        }));
      }
    }

    // ── world debt, overlaid on the market-cap reading (opt-in) ──
    // Both quantities live on the same axis once price is read as market cap, so the comparison is
    // a single line rather than a second chart. Drawing debt as GROWING is the honest form: frozen
    // at today's $345T the fit appears to overtake it in 2052, but carried forward at the rate the
    // aggregate has actually kept, the crossing is later.
    if (opts.debt) {
      var dpts = [], dyr, dcross = null;
      for (dyr = fromYear; dyr <= toYear; dyr += 0.5) {
        var dms = Date.UTC(Math.floor(dyr), Math.round((dyr % 1) * 12), 1);
        var dlg = Math.log10(daysSinceGenesis(dms));
        if (dlg < x0 || dlg > x1) continue;
        var dEq = worldDebtAt(dyr) / TERMINAL_SUPPLY;          // debt as a price per coin
        dpts.push(X(dlg) + ',' + Y(Math.log10(dEq)));
        if (dcross === null && Math.pow(10, centerLog(daysSinceGenesis(dms))) >= dEq) dcross = Math.floor(dyr);
      }
      if (dpts.length > 1) {
        svg.appendChild(el('polyline', { points: dpts.join(' '), fill: 'none', stroke: '#7ad7ff', 'stroke-width': 7, 'stroke-opacity': 0.14, 'stroke-linecap': 'round' }));
        svg.appendChild(el('polyline', { points: dpts.join(' '), fill: 'none', stroke: '#7ad7ff', 'stroke-width': 1.8, 'stroke-dasharray': '8 4', 'stroke-opacity': 0.95 }));
        // Label the line where it runs through open space — about a third along, well left of the
        // milestone cards it would otherwise sit under at the right-hand end.
        // Pick the label anchor by X POSITION, not array index: the array is even in years but
        // the axis is log-time, so index 12% of the way through lands two thirds across the canvas
        // — right on the ribbon. Target a quarter of the plot width, where the debt line still runs
        // far above the rainbow.
        var dTargetX = L + 0.25 * (W - L - R), dBest = dpts[0], dBestD = Infinity;
        for (var dq = 0; dq < dpts.length; dq++) {
          var dqx = +dpts[dq].split(',')[0], dqd = Math.abs(dqx - dTargetX);
          if (dqd < dBestD) { dBestD = dqd; dBest = dpts[dq]; }
        }
        var dmid = dBest.split(',');
        var dlabel = 'total world debt' + (dcross ? '  \u00b7  the fit overtakes it ' + dcross : '');
        var dlw = dlabel.length * 6 + 12;
        // clear of the key block when the line runs level with it
        var dkb = keyBox(L, T);
        var dOverKey = +dmid[1] > dkb.y - 6 && +dmid[1] < dkb.y + dkb.h + 6;
        var dlx = Math.min(Math.max(+dmid[0], dOverKey ? dkb.x + dkb.w + 16 : L + 10), W - R - dlw - 8);
        svg.appendChild(el('rect', { x: dlx - 6, y: +dmid[1] - 23, width: dlw, height: 17, rx: 4, fill: '#160a0f', 'fill-opacity': 0.92, stroke: '#7ad7ff', 'stroke-opacity': 0.4 }));
        svg.appendChild(el('text', { x: dlx, y: +dmid[1] - 11, fill: '#7ad7ff', 'font-size': 10, 'font-family': 'monospace', 'font-weight': 'bold' }, dlabel));
      }
    }

    // ── the trajectory, made prominent ──
    // The centre line is drawn twice from the $30,000 mark onward: a wide soft underlay and a
    // bright line on top, so the forward run reads as the subject of the chart rather than as one
    // more dashed guide. $30k is where the last cycle's floor sat, which makes it the honest place
    // to start the eye — everything left of it is record, everything right of it is arithmetic.
    var lg30k = Math.log10(30000);
    var frac30 = (lg30k - c0) / (c1 - c0);
    if (frac30 > 0 && frac30 < 1) {
      var xa = X(x0 + (x1 - x0) * frac30), ya = Y(lg30k);
      var xb = X(x1), yb = Y(c1);
      svg.appendChild(el('line', { x1: xa, y1: ya, x2: xb, y2: yb, stroke: '#ffd479', 'stroke-width': 9, 'stroke-opacity': 0.16, 'stroke-linecap': 'round' }));
      svg.appendChild(el('line', { x1: xa, y1: ya, x2: xb, y2: yb, stroke: '#ffe9b0', 'stroke-width': 2.1, 'stroke-opacity': 0.95 }));
      svg.appendChild(el('circle', { cx: xa, cy: ya, r: 3.6, fill: '#ffe9b0' }));
      svg.appendChild(el('text', { x: xa, y: ya + 18, fill: '#ffd479', 'font-size': 9.5, 'text-anchor': 'middle', 'font-family': 'monospace' }, '$30k'));
    }

    // the milestones on that run — the last one is where the subsidy ends
    var eom = endOfMining();
    var eomY = new Date(eom.observedMs).getUTCFullYear();
    var tgtY = new Date(eom.targetMs).getUTCFullYear();
    var MILES = [
      { year: 2035, note: '' },
      { year: 2050, note: '' },
      { year: eomY, note: 'last coin mined \u00b7 miners on fees alone',
        note2: 'block ' + END_BLOCK.toLocaleString('en-US') + ' at the observed ' +
               eom.secPerBlock.toFixed(1) + 's/block \u00b7 ' + tgtY + ' at the 600s target' }
    ];
    for (i = 0; i < MILES.length; i++) {
      var mi = MILES[i];
      if (mi.year > toYear) continue;
      var mms = Date.UTC(mi.year, 0, 1);
      var mxp = Xdate(mms), mpr = Math.pow(10, centerLog(daysSinceGenesis(mms))), myp = Y(Math.log10(mpr));
      if (mxp < L || mxp > W - R) continue;
      var txt = mi.year + '  ' + usd(mpr) + '  \u00b7  ' + usd(mpr * TERMINAL_SUPPLY) + ' cap';
      var fs2 = 10, tw = Math.max(txt.length, mi.note.length, (mi.note2 || '').length) * fs2 * 0.6 + 16;
      var lx = Math.min(mxp + 10, W - R - tw), ly = myp + 46;
      svg.appendChild(el('line', { x1: mxp, y1: myp, x2: mxp, y2: ly - 12, stroke: '#ffd479', 'stroke-width': 0.9, 'stroke-dasharray': '2 3', 'stroke-opacity': 0.8 }));
      svg.appendChild(el('circle', { cx: mxp, cy: myp, r: 4, fill: '#ffd479', stroke: '#160a0f', 'stroke-width': 1.2 }));
      svg.appendChild(el('rect', { x: lx - 8, y: ly - 12 - fs2, width: tw, height: (mi.note2 ? fs2 * 3 + 24 : mi.note ? fs2 * 2 + 16 : fs2 + 14), rx: 5, fill: '#160a0f', 'fill-opacity': 0.92, stroke: '#ffd479', 'stroke-opacity': 0.45 }));
      svg.appendChild(el('text', { x: lx, y: ly - 2, fill: '#ffe9b0', 'font-size': fs2, 'font-family': 'monospace', 'font-weight': 'bold' }, txt));
      if (mi.note) svg.appendChild(el('text', { x: lx, y: ly + 12, fill: '#b98da0', 'font-size': 9, 'font-family': 'monospace' }, mi.note));
      if (mi.note2) svg.appendChild(el('text', { x: lx, y: ly + 24, fill: '#7d5d6c', 'font-size': 8.5, 'font-family': 'monospace' }, mi.note2));
    }

    // ── the magnitudes the estimate is measured against ──
    // Drawn on the MARKET-CAP reading of the price axis. Each is a horizontal mark with the year
    // the fit crosses it — arithmetic from the regression, printed so the scale of the claim is
    // legible rather than implied.
    var macroLabels = [];
    for (i = 0; i < MACRO.length; i++) {
      var m = MACRO[i], lgP = Math.log10(m.cap / TERMINAL_SUPPLY);
      if (lgP <= yLo || lgP >= yHi) continue;
      // With the overlay on, the frozen $345T mark is the same fact drawn worse — and its label
      // sits on the overlay's. The growing line replaces it.
      if (opts.debt && m.cap === 345e12) continue;
      var my = Y(lgP), cross = yearAtPrice(m.cap / TERMINAL_SUPPLY);
      svg.appendChild(el('line', {
        x1: L, y1: my, x2: W - R, y2: my, stroke: m.key ? '#e3b25f' : '#7d5d6c',
        'stroke-width': m.key ? 1.1 : 0.7, 'stroke-dasharray': m.key ? '7 4' : '2 5',
        'stroke-opacity': m.key ? 0.85 : 0.5
      }));
      // The key occupies the top-left, which is exactly where the big magnitudes land. Any
      // label whose line runs through that block is pushed out past its right edge. The text
      // itself is deferred to after the key is drawn, so the key's leaders cannot cross it.
      var kb = keyBox(L, T);
      var overKey = my > kb.y - 4 && my < kb.y + kb.h + 4;
      macroLabels.push({
        x: overKey ? kb.x + kb.w + 18 : L + 8, y: my, key: m.key,
        text: m.label + (cross <= toYear ? '  \u2014 the fit crosses ' + cross : '')
      });
      // where it crosses, a tick on the centre line
      if (cross <= toYear) {
        var cx = Xdate(Date.UTC(cross, 0, 1));
        if (cx > L && cx < W - R) {
          svg.appendChild(el('circle', { cx: cx, cy: my, r: 3, fill: m.key ? '#e3b25f' : '#7d5d6c' }));
        }
      }
    }

    // ── halvings: solid where actual, dashed where schedule, and legible ──
    var toMs = Date.UTC(toYear, 0, 1), fromMs = Date.UTC(fromYear, 0, 1), ms, n = 0;
    var all = HALVINGS.slice(), lastH = all[all.length - 1];
    while (lastH + HALVING_STEP_MS <= toMs && all.length < 33) { lastH += HALVING_STEP_MS; all.push(lastH); }
    var spacingOK = all.length > 1 ? Math.abs(Xdate(all[all.length - 1]) - Xdate(all[all.length - 2])) : 99;
    for (i = 0; i < all.length; i++) {
      ms = all[i];
      if (ms < fromMs || ms > toMs) continue;
      var actual = i < HALVINGS.length, hx = Xdate(ms);
      if (hx < L || hx > W - R) continue;
      svg.appendChild(el('line', {
        x1: hx, y1: T, x2: hx, y2: H - B, stroke: '#e3b25f',
        'stroke-width': actual ? 1.4 : 0.9,
        'stroke-opacity': actual ? 0.9 : 0.42,
        'stroke-dasharray': actual ? '' : '4 4'
      }));
      // the four that happened are named; the schedule is numbered where there is room
      if (actual) {
        svg.appendChild(el('text', {
          x: hx, y: H - B + 30, fill: '#e3b25f', 'font-size': 9,
          'text-anchor': 'middle', 'font-family': 'monospace', 'font-weight': 'bold'
        }, String(i + 1)));
      } else if (spacingOK >= 16 && i % 2 === 0) {
        svg.appendChild(el('text', {
          x: hx, y: H - B + 30, fill: '#8a6a3c', 'font-size': 8,
          'text-anchor': 'middle', 'font-family': 'monospace'
        }, String(i + 1)));
      }
      n++;
    }
    svg.appendChild(el('text', {
      x: L, y: H - B + 30, fill: '#8a6a3c', 'font-size': 9,
      'text-anchor': 'start', 'font-family': 'monospace'
    }, 'halvings — ' + HALVINGS.length + ' actual, ' + (n - HALVINGS.length) + ' scheduled'));

    // ── you are here — the origin of perspective ──
    if (opts.price > 0) {
      var dotMs = opts.dateMs || Date.now();
      var dx = Xdate(dotMs), dy = Y(Math.log10(opts.price));
      var priceTxt = '$' + Math.round(opts.price).toLocaleString('en-US');
      svg.appendChild(el('line', { x1: dx, y1: T, x2: dx, y2: H - B, stroke: '#ff4d6d', 'stroke-width': 0.9, 'stroke-dasharray': '2 3', 'stroke-opacity': 0.6 }));
      var inRange = dy >= T + 6 && dy <= H - B - 6;
      if (inRange) {
        svg.appendChild(el('line', { x1: L, y1: dy, x2: W - R, y2: dy, stroke: '#ff4d6d', 'stroke-width': 0.8, 'stroke-dasharray': '2 3', 'stroke-opacity': 0.5 }));
        svg.appendChild(el('circle', { cx: dx, cy: dy, r: 4.5, fill: '#ff4d6d', stroke: '#f6e7eb', 'stroke-width': 1.5 }));
        svg.appendChild(el('text', { x: dx + 9, y: dy + 15, fill: '#ffb3c1', 'font-size': 11, 'font-family': 'monospace', 'font-weight': 'bold' },
          'you are here · ' + priceTxt + ' · ' + usd(opts.price * TERMINAL_SUPPLY) + ' cap'));
      }
    }

    // ── the key: a vertical stack in the top-left, each name pointing at its own band ──
    // A log-log ribbon rises left to right, so the top-left is empty at every zoom. Each row
    // runs a leader in the band's own colour to that band's midline, so the name and the colour
    // are joined by a line instead of by the reader's guesswork.
    drawPointerKey(svg, X, Y, x0, x1, c0, c1, L, T, W, R, H, B);

    // ── the magnitude labels, last, on plates so nothing crosses them ──
    for (i = 0; i < macroLabels.length; i++) {
      var ml = macroLabels[i], fs = ml.key ? 10.5 : 9.5;
      svg.appendChild(el('rect', {
        x: ml.x - 5, y: ml.y - 5 - fs, width: ml.text.length * fs * 0.6 + 10, height: fs + 7, rx: 3,
        fill: '#160a0f', 'fill-opacity': 0.88
      }));
      svg.appendChild(el('text', {
        x: ml.x, y: ml.y - 5, fill: ml.key ? '#e3b25f' : '#9c7a5c',
        'font-size': fs, 'font-family': 'monospace', 'font-weight': ml.key ? 'bold' : 'normal'
      }, ml.text));
    }

    // ── the signature ──
    svg.appendChild(el('text', { x: W - R, y: H - B + 42, fill: '#7d5d6c', 'font-size': 8.5, 'text-anchor': 'end', 'font-family': 'monospace' },
      'DVLuvRainbow · fit ' + FIT.fitted + ' · market cap at the 21,000,000 terminal supply'));

    // ── the hover readout: the chart answers where the pointer is ──
    // A crosshair plus a plate that floats with the cursor, reading the price under the pointer,
    // what that is as market cap, what the fit says at that date, and which band the two put you
    // in. Everything is derived from the same scales the chart was drawn with, so the readout
    // cannot drift from the picture. Built as SVG inside the same document — no HTML overlay, no
    // inline style, nothing for the CSP to object to.
    if (svg.addEventListener) {
      var hg = el('g', { 'pointer-events': 'none', visibility: 'hidden' });
      var hvx = el('line', { stroke: '#f6e7eb', 'stroke-width': 0.7, 'stroke-dasharray': '3 3', 'stroke-opacity': 0.65 });
      var hvy = el('line', { stroke: '#f6e7eb', 'stroke-width': 0.7, 'stroke-dasharray': '3 3', 'stroke-opacity': 0.65 });
      var hdot = el('circle', { r: 4, fill: '#ff4d6d', stroke: '#f6e7eb', 'stroke-width': 1.2 });
      var hplate = el('rect', { rx: 6, fill: '#160a0f', 'fill-opacity': 0.95, stroke: '#ff4d6d', 'stroke-opacity': 0.55 });
      hg.appendChild(hvx); hg.appendChild(hvy); hg.appendChild(hplate); hg.appendChild(hdot);
      var HL = [], hli;
      for (hli = 0; hli < 5; hli++) {
        var t = el('text', { 'font-family': 'monospace', 'font-size': hli === 1 ? 13 : 10,
                             'font-weight': hli === 1 ? 'bold' : 'normal',
                             fill: hli === 1 ? '#f6e7eb' : '#b98da0' });
        HL.push(t); hg.appendChild(t);
      }
      svg.appendChild(hg);

      var PLW = 210, PLH = 92;
      svg.addEventListener('mousemove', function (ev) {
        var r = svg.getBoundingClientRect();
        if (!r.width) return;
        var sx = (ev.clientX - r.left) * (W / r.width);
        var sy = (ev.clientY - r.top) * (H / r.height);
        if (sx < L || sx > W - R || sy < T || sy > H - B) { hg.setAttribute('visibility', 'hidden'); return; }
        hg.setAttribute('visibility', 'visible');

        // The readout RIDES THE CHART: only the pointer's x is used. The price is the one the
        // chart actually holds at that date — the measured close where the record reaches, the
        // fitted curve beyond it — so the dot travels along the line inside the rainbow instead of
        // floating wherever the cursor happens to sit, and every reading is a real point.
        var lgD = x0 + (sx - L) / (W - L - R) * (x1 - x0);
        var days = Math.pow(10, lgD);
        var when = new Date(GENESIS + days * 86400e3);
        var fitP = Math.pow(10, centerLog(days));
        var measured = seriesPriceAt(when.getTime());
        var price = measured != null ? measured : fitP;
        // The series stores weekly closes; between two of them this is an interpolation, which is a
        // different claim from a close and is labelled as one.
        var RCq = global.DVLuvRainbowChart;
        var onPoint = !RCq || ((RCq.xOf(when.getTime()) - 1) % RCq.SERIES_STEP) === 0;
        var src = measured == null ? 'the fitted curve'
                : onPoint ? 'weekly close' : 'between weekly closes';
        var lgP = Math.log10(price);
        sy = Y(lgP);
        var resid = lgP - centerLog(days);
        var bi = Math.floor((resid + 0.7) / STEP);
        var bname = bi < 0 ? 'below the scale' : bi > 8 ? 'above the scale' : BANDS[bi].name;
        var bcol = bi < 0 || bi > 8 ? '#b98da0' : BANDS[bi].col;

        hvx.setAttribute('x1', sx); hvx.setAttribute('y1', T); hvx.setAttribute('x2', sx); hvx.setAttribute('y2', H - B);
        hvy.setAttribute('x1', L); hvy.setAttribute('y1', sy); hvy.setAttribute('x2', W - R); hvy.setAttribute('y2', sy);
        hdot.setAttribute('cx', sx); hdot.setAttribute('cy', sy);

        // the plate flips off whichever edge it would otherwise run past
        var px = sx + 16 + PLW > W - R ? sx - 16 - PLW : sx + 16;
        var py = sy + 12 + PLH > H - B ? sy - 12 - PLH : sy + 12;
        hplate.setAttribute('x', px); hplate.setAttribute('y', py);
        hplate.setAttribute('width', PLW); hplate.setAttribute('height', PLH);

        var rows = [
          when.getUTCFullYear() + '-' + ('0' + (when.getUTCMonth() + 1)).slice(-2),
          usd(price),
          usd(price * TERMINAL_SUPPLY) + ' market cap',
          src + (measured != null ? '  \u00b7 fit ' + usd(fitP) : ''),
          bname
        ];
        var ry = py + 18;
        for (hli = 0; hli < HL.length; hli++) {
          HL[hli].setAttribute('x', px + 11);
          HL[hli].setAttribute('y', ry);
          HL[hli].textContent = rows[hli];
          if (hli === 4) HL[hli].setAttribute('fill', bcol);
          ry += hli === 1 ? 19 : 15;
        }
      });
      svg.addEventListener('mouseleave', function () { hg.setAttribute('visibility', 'hidden'); });
    }

    mount.textContent = '';
    mount.appendChild(svg);
    return svg;
  }

  /// Geometry of the key block, so the macro labels can be placed clear of it.
  function keyBox(L, T) {
    var FS = 10.5, ROW = FS + 5, PAD = 10, SW = 9, GAP = 6, charW = FS * 0.6;
    var wide = 0;
    for (var i = 0; i < 9; i++) wide = Math.max(wide, BANDS[i].name.length * charW);
    return {
      FS: FS, ROW: ROW, PAD: PAD, SW: SW, GAP: GAP,
      x: L + 14, y: T + 12,
      w: PAD * 2 + SW + GAP + wide,
      h: PAD * 2 + 9 * ROW - 5
    };
  }

  function drawPointerKey(svg, X, Y, x0, x1, c0, c1, L, T, W, R, H, B) {
    var k = keyBox(L, T), i;

    // WHERE TO POINT. In log-log the ribbon is a straight diagonal: low on the left, high on the
    // right. Sampling it just beside the key — the obvious choice — aims every leader at the
    // bottom-left corner, and nine lines plunge across the whole chart. Instead the sample is
    // taken where the ribbon's CENTRE sits at the key's own height, so the leaders run almost
    // level, through the empty wedge above the ribbon, and land on the bands they name.
    var midY = k.y + k.h / 2;
    var lgAtMid = yHiLoInvert(Y, midY);                 // the log10 price at the key's height
    var frac = (lgAtMid - c0) / (c1 - c0);              // where the centre line reaches it
    frac = Math.max(0.30, Math.min(0.74, frac));        // keep the target on the canvas
    var lgDays = x0 + (x1 - x0) * frac;
    var cAt = c0 + (c1 - c0) * frac;
    var tx = X(lgDays);

    svg.appendChild(el('rect', {
      x: k.x, y: k.y, width: k.w, height: k.h, rx: 7,
      fill: '#160a0f', 'fill-opacity': 0.93, stroke: '#4a1f30', 'stroke-opacity': 0.7
    }));

    for (i = 8; i >= 0; i--) {
      var row = 8 - i;
      var ty = k.y + k.PAD + row * k.ROW + k.FS;
      var tyMid = Y(cAt + (-0.7 + i * STEP) + STEP / 2);

      // the pointer: a short stub out of the block, then a level run to the band it names
      svg.appendChild(el('polyline', {
        points: (k.x + k.w) + ',' + (ty - 3) + ' ' + (k.x + k.w + 16) + ',' + (ty - 3) + ' ' + tx + ',' + tyMid,
        fill: 'none', stroke: BANDS[i].col, 'stroke-width': 0.9, 'stroke-opacity': 0.75
      }));
      svg.appendChild(el('circle', { cx: tx, cy: tyMid, r: 2.4, fill: BANDS[i].col, stroke: '#160a0f', 'stroke-width': 0.6 }));

      svg.appendChild(el('rect', { x: k.x + k.PAD, y: ty - k.SW + 1, width: k.SW, height: k.SW, fill: BANDS[i].col, rx: 1.5 }));
      svg.appendChild(el('text', {
        x: k.x + k.PAD + k.SW + k.GAP, y: ty, fill: BANDS[i].col, 'font-size': k.FS,
        'font-family': 'monospace', 'font-weight': 'bold'
      }, BANDS[i].name));
    }
  }

  /// Invert the Y scale numerically — Y() is a closure over the current window, so rather than
  /// re-deriving its constants here, probe it. Two samples are enough: Y is affine in log price.
  function yHiLoInvert(Y, py) {
    var a = Y(0), b = Y(1);                 // Y(lg) = a + (b - a) * lg
    return (py - a) / (b - a);
  }

  // the zoom ladder: explicit price ceilings the +/− controls step through
  var SCALES = [1e4, 1e5, 1e6, 1e7, 1e8, 1e9, 2e9, 1e10, 1e11, 1e12, 2e12, 1e13, 1e14];
  var SCALE_LABELS = ['$10k', '$100k', '$1M', '$10M', '$100M', '$1B', '$2B', '$10B', '$100B', '$1T', '$2T', '$10T', '$100T'];

  var DVLuvRainbow = {
    FIT: FIT, BANDS: BANDS, GENESIS: GENESIS, MACRO: MACRO, TERMINAL_SUPPLY: TERMINAL_SUPPLY,
    version: '1.4.0', SCALES: SCALES, SCALE_LABELS: SCALE_LABELS,
    center: function (days) { return Math.pow(10, centerLog(days)); },
    yearAtPrice: yearAtPrice, usd: usd, worldDebtAt: worldDebtAt, WORLD_DEBT: WORLD_DEBT,
    render: render
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = DVLuvRainbow;
  global.DVLuvRainbow = DVLuvRainbow;

  // self-boot: any [data-luvrainbow] mount becomes a rainbow
  if (global.document) {
    var boot = function () {
      var els = document.querySelectorAll('[data-luvrainbow]');
      for (var i = 0; i < els.length; i++) {
        var m = els[i];
        if (m.dataset.rainbowBooted) continue; m.dataset.rainbowBooted = '1';
        var o = {
          from: m.dataset.from ? Number(m.dataset.from) : undefined,
          to: m.dataset.to ? Number(m.dataset.to) : undefined,
          height: m.dataset.height ? Number(m.dataset.height) : undefined,
          price: m.dataset.price ? Number(m.dataset.price) : undefined,
          dateMs: m.dataset.date ? Date.parse(m.dataset.date + 'T00:00:00Z') : undefined,
          yMax: m.dataset.ymax ? Number(m.dataset.ymax) : undefined,
          debt: m.dataset.debt === '1'
        };
        m._rainbowOpts = o;   // the zoom ladder re-renders from these
        render(m, o);
      }
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  }
})(typeof window !== 'undefined' ? window : this);
