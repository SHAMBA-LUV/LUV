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
 * where the rainbow is a straight ruler — nothing hides in curvature.
 *
 * cypherpunk2048 / CSP-safe: external file, zero dependencies, zero network calls,
 * SVG built with createElementNS (no innerHTML). The fit is public arithmetic; the
 * measured price path stays where its own consent rail delivers it.
 *
 * Self-boot: <div data-luvrainbow data-from="2010" data-to="2040"
 *                 data-price="64482" data-date="2026-08-05"></div>
 * API: DVLuvRainbow.render(mount, opts) · .center(days) → USD · .FIT · .BANDS
 */
(function (global) {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  var FIT = { slope: 5.380917, intercept: -15.403007, r2: 0.936, fitted: '2026-08-05', n: 360 };
  var GENESIS = Date.UTC(2009, 0, 3);
  var STEP = (1.0 - (-0.7)) / 9; // 0.18889 in log10 — one band
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
  // the four actual halvings; the schedule then steps 210,000 blocks ≈ 1458.33 days
  var HALVINGS = [Date.UTC(2012, 10, 28), Date.UTC(2016, 6, 9), Date.UTC(2020, 4, 11), Date.UTC(2024, 3, 20)];
  var HALVING_STEP_MS = 1458.33 * 86400e3;

  function daysSinceGenesis(ms) { return (ms - GENESIS) / 86400e3; }
  function centerLog(days) { return FIT.slope * Math.log10(days) + FIT.intercept; }
  function el(name, attrs, text) {
    var n = document.createElementNS(NS, name);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (text != null) n.textContent = text;
    return n;
  }
  function priceLabel(log10usd) {
    var p = Math.pow(10, log10usd);
    if (p >= 1e12) return '$' + (p / 1e12) + 'T';
    if (p >= 1e9) return '$' + (p / 1e9) + 'B';
    if (p >= 1e6) return '$' + (p / 1e6) + 'M';
    if (p >= 1e3) return '$' + (p / 1e3) + 'k';
    if (p >= 1) return '$' + p;
    return '$' + p.toFixed(2).replace(/0$/, '');
  }

  function render(mount, opts) {
    opts = opts || {};
    var fromYear = opts.from || 2010, toYear = opts.to || 2040;
    var W = 960, H = opts.height || 560;
    var L = 70, R = 150, T = 18, B = 42;                       // margins; R carries band labels
    var x0 = Math.log10(daysSinceGenesis(Date.UTC(fromYear, 0, 1)));
    var x1 = Math.log10(daysSinceGenesis(Date.UTC(toYear, 0, 1)));
    var yLo = centerLog(Math.pow(10, x0)) - 0.7 - 0.15;
    // yMax (USD) pins the price ceiling — the zoom ladder hands in 1e4 … 1e11;
    // bands above the ceiling clip at the viewport edge, which IS the zoom.
    var yHi = opts.yMax > 0 ? Math.log10(opts.yMax) : centerLog(Math.pow(10, x1)) + 1.0 + 0.15;
    function X(lgDays) { return L + (lgDays - x0) / (x1 - x0) * (W - L - R); }
    function Y(lgUsd) { return T + (yHi - lgUsd) / (yHi - yLo) * (H - T - B); }
    function Xdate(ms) { return X(Math.log10(daysSinceGenesis(ms))); }

    var svg = el('svg', {
      viewBox: '0 0 ' + W + ' ' + H, xmlns: NS, role: 'img',
      'aria-label': 'The in-house Bitcoin rainbow, drawn live by the rainbow substrate from the published fit: nine bands on log-log axes, ' + fromYear + ' to ' + toYear
    });
    svg.appendChild(el('rect', { width: W, height: H, fill: '#160a0f' }));

    // ── price decades ──
    for (var d = Math.ceil(yLo); d <= Math.floor(yHi); d++) {
      svg.appendChild(el('line', { x1: L, y1: Y(d), x2: W - R, y2: Y(d), stroke: '#4a1f30', 'stroke-width': 0.7 }));
      svg.appendChild(el('text', { x: L - 6, y: Y(d) + 4, fill: '#b98da0', 'font-size': 10.5, 'text-anchor': 'end', 'font-family': 'monospace' }, priceLabel(d)));
    }

    // ── the $1,000 lattice — BTC accurate to 1k increments wherever the view holds them ──
    // Every $1,000 multiple gets a gridline when it stays distinguishable (≥5px from
    // the last drawn) and a label when there's room (≥15px) — zoomed in, the read is
    // exact to the thousand; zoomed out, the lattice thins itself instead of smearing.
    var lastLineY = Infinity, lastLabelY = Infinity;
    for (var kUsd = 1000; kUsd <= 1e6; kUsd += 1000) {
      var lg = Math.log10(kUsd);
      if (lg <= yLo || lg >= yHi || lg === Math.floor(lg)) continue; // decades already drawn
      var ky = Y(lg);
      if (lastLineY - ky < 5) continue;
      svg.appendChild(el('line', { x1: L, y1: ky, x2: W - R, y2: ky, stroke: '#4a1f30', 'stroke-width': 0.3, 'stroke-opacity': 0.7 }));
      lastLineY = ky;
      if (lastLabelY - ky >= 15) {
        svg.appendChild(el('text', { x: L - 6, y: ky + 3.5, fill: '#7d5d6c', 'font-size': 8.5, 'text-anchor': 'end', 'font-family': 'monospace' }, '$' + (kUsd / 1000) + 'k'));
        lastLabelY = ky;
      }
    }

    // ── year ticks ──
    var yearTicks = [2010, 2011, 2012, 2014, 2016, 2020, 2024, 2028, 2032, 2036, 2040, 2050, 2070, 2100, 2140];
    for (var yi = 0; yi < yearTicks.length; yi++) {
      var yr = yearTicks[yi];
      if (yr < fromYear || yr > toYear) continue;
      var xx = Xdate(Date.UTC(yr, 0, 1));
      svg.appendChild(el('line', { x1: xx, y1: T, x2: xx, y2: H - B, stroke: '#4a1f30', 'stroke-width': 0.6 }));
      svg.appendChild(el('text', { x: xx, y: H - B + 16, fill: '#b98da0', 'font-size': 10.5, 'text-anchor': 'middle', 'font-family': 'monospace' }, String(yr)));
    }

    // ── the nine bands (straight polygons in log-log; the viewport clips the rest) ──
    var c0 = centerLog(Math.pow(10, x0)), c1 = centerLog(Math.pow(10, x1));
    for (var b = 0; b < 9; b++) {
      var lo = -0.7 + b * STEP, hi = lo + STEP;
      var pts = X(x0) + ',' + Y(c0 + lo) + ' ' + X(x1) + ',' + Y(c1 + lo) + ' ' +
                X(x1) + ',' + Y(c1 + hi) + ' ' + X(x0) + ',' + Y(c0 + hi);
      svg.appendChild(el('polygon', { points: pts, fill: BANDS[b].col, 'fill-opacity': 0.30, stroke: BANDS[b].col, 'stroke-opacity': 0.5, 'stroke-width': 0.5 }));
      var ly = Y(c1 + lo) - 2;
      if (ly > T + 8 && ly < H - B) svg.appendChild(el('text', { x: W - R + 6, y: ly, fill: BANDS[b].col, 'font-size': 10.5, 'font-family': 'monospace' }, BANDS[b].name));
    }

    // ── the center line ──
    svg.appendChild(el('line', {
      x1: X(x0), y1: Y(c0), x2: X(x1), y2: Y(c1),
      stroke: '#f6e7eb', 'stroke-width': 1.2, 'stroke-dasharray': '6 4', 'stroke-opacity': 0.85
    }));

    // ── halvings: solid where actual, dashed where schedule ──
    var toMs = Date.UTC(toYear, 0, 1), n = 0, ms;
    for (var h = 0; h < HALVINGS.length; h++) {
      ms = HALVINGS[h];
      if (ms < Date.UTC(fromYear, 0, 1) || ms > toMs) continue;
      svg.appendChild(el('line', { x1: Xdate(ms), y1: T, x2: Xdate(ms), y2: H - B, stroke: '#e3b25f', 'stroke-width': 1, 'stroke-opacity': 0.8 }));
    }
    for (ms = HALVINGS[3] + HALVING_STEP_MS; ms <= toMs; ms += HALVING_STEP_MS) {
      svg.appendChild(el('line', { x1: Xdate(ms), y1: T, x2: Xdate(ms), y2: H - B, stroke: '#e3b25f', 'stroke-width': 0.8, 'stroke-dasharray': '4 3', 'stroke-opacity': 0.4 }));
      if (++n > 40) break; // schedule guard
    }
    svg.appendChild(el('text', { x: Xdate(HALVINGS[0]) - 4, y: T + 13, fill: '#e3b25f', 'font-size': 10.5, 'text-anchor': 'end', 'font-family': 'monospace', 'font-weight': 'bold' }, 'halvings ↓'));

    // ── you are here — the origin of perspective ──
    // The dot anchors the read at every zoom: a vertical now-line splits past from
    // future, a horizontal line carries today's price across both, and when the
    // scale pushes the dot outside the window it pins to the edge with an arrow —
    // the reference point never leaves the chart.
    if (opts.price > 0) {
      var dotMs = opts.dateMs || Date.now();
      var dx = Xdate(dotMs), dy = Y(Math.log10(opts.price));
      var priceTxt = '$' + Math.round(opts.price).toLocaleString('en-US');
      svg.appendChild(el('line', { x1: dx, y1: T, x2: dx, y2: H - B, stroke: '#ff4d6d', 'stroke-width': 0.8, 'stroke-dasharray': '2 3', 'stroke-opacity': 0.55 }));
      svg.appendChild(el('text', { x: dx - 5, y: H - B - 8, fill: '#7d5d6c', 'font-size': 9, 'text-anchor': 'end', 'font-family': 'monospace' }, '← past'));
      svg.appendChild(el('text', { x: dx + 5, y: H - B - 8, fill: '#7d5d6c', 'font-size': 9, 'font-family': 'monospace' }, 'future →'));
      var inRange = dy >= T + 6 && dy <= H - B - 6;
      if (inRange) {
        svg.appendChild(el('line', { x1: L, y1: dy, x2: W - R, y2: dy, stroke: '#ff4d6d', 'stroke-width': 0.8, 'stroke-dasharray': '2 3', 'stroke-opacity': 0.55 }));
        svg.appendChild(el('circle', { cx: dx, cy: dy, r: 4.5, fill: '#ff4d6d', stroke: '#f6e7eb', 'stroke-width': 1.5 }));
        svg.appendChild(el('text', { x: dx + 9, y: dy - 6, fill: '#ffb3c1', 'font-size': 12, 'font-family': 'monospace', 'font-weight': 'bold' }, 'you are here · ' + priceTxt));
      } else {
        var py = dy < T + 6 ? T + 14 : H - B - 10;
        var arrow = dy < T + 6 ? '↑' : '↓';
        svg.appendChild(el('text', { x: dx + 9, y: py + 4, fill: '#ffb3c1', 'font-size': 12, 'font-family': 'monospace', 'font-weight': 'bold' }, arrow + ' you are here · ' + priceTxt));
        svg.appendChild(el('circle', { cx: dx, cy: py, r: 4, fill: '#ff4d6d', 'fill-opacity': 0.6, stroke: '#f6e7eb', 'stroke-width': 1, 'stroke-dasharray': '2 2' }));
      }
    }

    // ── the signature ──
    svg.appendChild(el('text', { x: W - R + 6, y: H - B - 6, fill: '#7d5d6c', 'font-size': 9, 'font-family': 'monospace' }, 'DVLuvRainbow · fit ' + FIT.fitted));

    mount.textContent = '';
    mount.appendChild(svg);
    return svg;
  }

  // the zoom ladder: explicit price ceilings the +/− controls step through
  var SCALES = [1e4, 1e5, 1e6, 1e7, 1e8, 1e9, 2e9, 1e10, 1e11, 1e12, 2e12, 1e13, 1e14];
  var SCALE_LABELS = ['$10k', '$100k', '$1M', '$10M', '$100M', '$1B', '$2B', '$10B', '$100B', '$1T', '$2T', '$10T', '$100T'];

  var DVLuvRainbow = {
    FIT: FIT, BANDS: BANDS, GENESIS: GENESIS, version: '1.3.0',
    SCALES: SCALES, SCALE_LABELS: SCALE_LABELS,
    center: function (days) { return Math.pow(10, centerLog(days)); },
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
          yMax: m.dataset.ymax ? Number(m.dataset.ymax) : undefined
        };
        m._rainbowOpts = o;   // the zoom ladder re-renders from these
        render(m, o);
      }
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  }
})(typeof window !== 'undefined' ? window : this);
