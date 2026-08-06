/*!
 * DeltaVerse — emotonomic substrate (DVEmotonomic): the dial of measured feeling.
 *
 * The measurement organ of the emotonomics program ("form follows field"): sentiment
 * is what the community verifiably DOES on-chain — never self-report. This substrate
 * implements the implementable-today components of the LUV sentiment composite
 * (the sentiment paper, §IV.3, components 1–3 + revealed flow) from the same-origin
 * market mirror (market.json + market-history.json — CSP connect-src 'self'; the
 * collector alone talks to the chain):
 *
 *   momentum — price against the trailing mean of the sampled window (revealed)
 *   24H      — the percent-change field (revealed)
 *   depth    — the liquidity multiplier from the seed (the hodler stabilizer:
 *              every trade deepens the pool; depth defends what you hold)
 *   flow     — the buys share of 24H transactions (entries vs exits)
 *
 * Composite = the mean of available components on a 0..100 dial from FEAR to LUV
 * (the emotonomic relabeling matters: the far end of greed is warmth). Weights are
 * deliberately equal and published — estimated-against-outcomes is future work, and
 * the honest label for this instrument is PROPOSED (see sentiment.html §IV–V).
 *
 * Zero dependencies · CSP-safe · self-boots into [data-emotonomic] mounts.
 * Reduced motion: the needle draws at its value without animation.
 */
(function (global) {
  'use strict';

  var REFRESH_MS = 5 * 60e3;             // mirror-only cadence
  var SEED_WETH = 0.051922968585348276;  // the ETH leg of the seed — depth X baseline
  var INK = '#160a0f', WINE = '#2b111c', SEAM = '#4a1f30', DIM = '#b98da0',
      CREAM = '#f6e7eb', GOLD = '#e3b25f', ROSE = '#ff4d6d', PINK = '#ff006e', UP = '#7ee2a8';
  var BANDS = [
    { max: 20, label: 'DEEP FEAR', col: '#3fa9ff' },
    { max: 40, label: 'FEAR', col: '#8fc6ff' },
    { max: 60, label: 'NEUTRAL', col: DIM },
    { max: 80, label: 'WARM', col: GOLD },
    { max: 101, label: 'LUV', col: PINK }
  ];

  function clamp(v, lo, hi) { return Math.min(Math.max(v, lo), hi); }
  function band(v) { for (var i = 0; i < BANDS.length; i++) if (v < BANDS[i].max) return BANDS[i]; return BANDS[BANDS.length - 1]; }

  function Dial(mount) {
    this.mount = mount;
    this.value = null;
    this.parts = {};
    this.reduced = false;
    try { this.reduced = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { /* older engines */ }
  }

  // ── the components — each 0..100, 50 = neutral ──────────────────────────────
  Dial.prototype.compute = function (mkt, points) {
    var parts = {};
    // momentum: deviation of the last price from the window's mean, ±20% saturates
    if (points && points.length > 8) {
      var sum = 0, n = 0;
      points.forEach(function (p) { if (p[1] > 0) { sum += p[1]; n++; } });
      var mean = n ? sum / n : 0, last = points[points.length - 1][1];
      if (mean > 0 && last > 0) parts.momentum = clamp(50 + (last / mean - 1) / 0.20 * 50, 0, 100);
    }
    // 24H change: ±50% saturates
    var pc = mkt.priceChange && mkt.priceChange.h24;
    if (pc !== undefined && pc !== null && !isNaN(pc)) parts.h24 = clamp(50 + Number(pc) / 50 * 50, 0, 100);
    // depth: the liquidity multiplier from the seed — 1× = 50, 4× saturates, log2 scaled
    var lq = mkt.liquidity && Number(mkt.liquidity.quote);
    if (lq > 0) parts.depth = clamp(50 + Math.log(lq / SEED_WETH) / Math.log(2) / 2 * 50, 0, 100);
    // flow: buys share of the 24H transactions — no txns reads neutral, not warm
    var tx = mkt.txns && mkt.txns.h24;
    if (tx) {
      var total = (tx.buys || 0) + (tx.sells || 0);
      if (total > 0) parts.flow = clamp((tx.buys || 0) / total * 100, 0, 100);
      else parts.flow = 50;
    }
    var keys = Object.keys(parts);
    this.parts = parts;
    this.value = keys.length
      ? keys.reduce(function (a, k) { return a + parts[k]; }, 0) / keys.length
      : null;
    return this.value;
  };

  // ── render: a semicircle gauge + the component line ─────────────────────────
  Dial.prototype.render = function () {
    var m = this.mount;
    if (!m.__built) {
      m.__built = true;
      m.style.cssText += ';max-width:340px;margin:0 auto;text-align:center;font-family:ui-monospace,Menlo,monospace';
      var cv = document.createElement('canvas');
      cv.width = 640; cv.height = 360;
      cv.style.cssText = 'width:100%;max-width:320px;height:auto;display:block;margin:0 auto';
      cv.setAttribute('role', 'img');
      m.appendChild(cv);
      var lab = document.createElement('div');
      lab.className = 'emoto-label';
      lab.style.cssText = 'font-size:13px;letter-spacing:.18em;margin-top:2px;font-weight:700';
      m.appendChild(lab);
      var comps = document.createElement('div');
      comps.className = 'emoto-comps';
      comps.style.cssText = 'font-size:10.5px;color:' + DIM + ';margin-top:6px;letter-spacing:.04em;overflow-wrap:anywhere';
      m.appendChild(comps);
      var doc = document.createElement('div');
      doc.style.cssText = 'font-size:10px;color:' + DIM + ';margin-top:4px;font-style:italic';
      doc.textContent = 'sentiment is what the community verifiably does on-chain — a proposed instrument (the sentiment paper §IV)';
      m.appendChild(doc);
    }
    var cv = m.querySelector('canvas'), ctx = cv.getContext('2d');
    var W = cv.width, H = cv.height, cx = W / 2, cy = H - 40, R = 240;
    ctx.clearRect(0, 0, W, H);

    // the arc, banded fear → LUV
    var segs = [['#3fa9ff', 0, .2], ['#8fc6ff', .2, .4], ['#6b5560', .4, .6], [GOLD, .6, .8], [PINK, .8, 1]];
    segs.forEach(function (sg) {
      ctx.beginPath();
      ctx.arc(cx, cy, R, Math.PI * (1 + sg[1]), Math.PI * (1 + sg[2]));
      ctx.strokeStyle = sg[0]; ctx.lineWidth = 26; ctx.globalAlpha = 0.85; ctx.stroke();
    });
    ctx.globalAlpha = 1;
    // ticks at the band edges
    for (var i = 0; i <= 5; i++) {
      var a = Math.PI * (1 + i / 5);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * (R - 20), cy + Math.sin(a) * (R - 20));
      ctx.lineTo(cx + Math.cos(a) * (R + 20), cy + Math.sin(a) * (R + 20));
      ctx.strokeStyle = SEAM; ctx.lineWidth = 3; ctx.stroke();
    }
    var lab = m.querySelector('.emoto-label'), comps = m.querySelector('.emoto-comps');
    if (this.value === null) {
      lab.textContent = 'measuring…'; lab.style.color = DIM;
      cv.setAttribute('aria-label', 'emotonomic dial — measuring');
      return;
    }
    var v = this.value, b = band(v);
    // the needle
    var na = Math.PI * (1 + v / 100);
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(na + Math.PI / 2) * 8, cy + Math.sin(na + Math.PI / 2) * 8);
    ctx.lineTo(cx + Math.cos(na) * (R - 34), cy + Math.sin(na) * (R - 34));
    ctx.lineTo(cx + Math.cos(na - Math.PI / 2) * 8, cy + Math.sin(na - Math.PI / 2) * 8);
    ctx.closePath();
    ctx.fillStyle = CREAM; ctx.fill();
    ctx.beginPath(); ctx.arc(cx, cy, 14, 0, 2 * Math.PI); ctx.fillStyle = b.col; ctx.fill();
    ctx.beginPath(); ctx.arc(cx, cy, 6, 0, 2 * Math.PI); ctx.fillStyle = INK; ctx.fill();
    // the number
    ctx.font = '700 44px ui-monospace,Menlo,monospace';
    ctx.fillStyle = b.col; ctx.textAlign = 'center';
    ctx.fillText(Math.round(v), cx, cy - 60);
    ctx.font = '20px ui-monospace,Menlo,monospace';
    ctx.fillStyle = DIM;
    ctx.fillText('FEAR', cx - R, cy + 30); ctx.fillText('LUV ❤', cx + R, cy + 30);
    cv.setAttribute('aria-label', 'emotonomic dial — ' + Math.round(v) + ' of 100, ' + b.label);

    lab.textContent = '☯ ' + Math.round(v) + ' — ' + b.label;
    lab.style.color = b.col;
    var p = this.parts, names = { momentum: 'momentum', h24: '24H', depth: 'depth', flow: 'flow' };
    comps.textContent = 'equal-weight of ' + Object.keys(p).map(function (k) {
      return names[k] + ' ' + Math.round(p[k]);
    }).join(' · ') + ' — revealed acts only';
  };

  Dial.prototype.tick = function () {
    var self = this, bust = 'v=' + Date.now();
    Promise.all([
      fetch('market.json?' + bust, { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }),
      fetch('market-history.json?' + bust, { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
    ]).then(function (rs) {
      if (!rs[0]) return;
      self.compute(rs[0], rs[1] && rs[1].points ? rs[1].points : null);
      self.render();
    }).catch(function () { /* keep the last good frame */ });
  };

  Dial.prototype.start = function () {
    var self = this;
    this.render();
    this.tick();
    setInterval(function () { if (!document.hidden) self.tick(); }, REFRESH_MS);
    return this;
  };

  function boot() {
    var mounts = document.querySelectorAll('[data-emotonomic]');
    mounts.forEach(function (m) {
      if (!m.__emoto) m.__emoto = new Dial(m).start();
    });
  }
  if (global.document) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
  }

  global.DVEmotonomic = { Dial: Dial, version: '1.0.0' };
})(typeof window !== 'undefined' ? window : this);
