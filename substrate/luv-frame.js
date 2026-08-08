/*!
 * SHAMBA LUV — frame substrate (DVLuvFrame): the outer boundary.
 *
 * A NEW substrate inspired by the DeltaVerse sane substrate (engine/sane-substrate.js)
 * but its own organ: where sane builds the world INSIDE (point → line → triangle →
 * bucket → stage), this draws the boundary AROUND — the octagon world's edge worn as
 * the page's frame. Sane axioms carried over: two triangles make a square (the corner
 * sigils); the octagon norm max(|x|,|y|,(|x|+|y|)/√2) is the world boundary (the
 * chamfered corners ARE that norm's unit ball meeting the viewport); powers of two
 * discipline the measures (inset 2³, chamfer 2⁵ — 2⁴ under 2⁹px). cypherpunk2048.
 *
 * Breath: the inner hairline breathes with the site's heart — it READS `--luv-pulse`
 * from :root (published by substrate/luv-pulse.js, a 0..1 lub-dub envelope at exactly
 * 1 Hz) and imports nothing. Absent the pulse organ it keeps its own 1 Hz time.
 * prefers-reduced-motion: the frame renders once, static — structure without motion.
 *
 * Zero dependencies · CSP-safe (external file, no fetch, no eval) · pointer-events
 * none (the boundary contains, never intercepts). Self-boots on DOMContentLoaded.
 *   var f = new DVLuvFrame.Frame(); f.start();   // or let it boot itself
 */
(function (global) {
  'use strict';

  var SEAM = '#4a1f30', ROSE = '#ff4d6d', GOLD = '#e3b25f', PINK = '#ff006e';
  // Candle mode (opt-in: <body data-luvframe="candles">). The boundary keeps the market's
  // own tempo — four green candles then one red, a five-beat cycle at the pulse's 1 Hz.
  // Not a prediction and not read from price: it is the rhythm of a market that mostly
  // rises and periodically doesn't. Phase comes from the wall clock, so every visitor's
  // frame turns red on the same second — the same shared-phase rule the pulse obeys.
  var CANDLE_GREEN = '#0ecb81', CANDLE_RED = '#ff2e4c';
  var CANDLE_CYCLE = 5, CANDLE_RED_AT = 4;
  var INSET = 8;            // 2^3 — the boundary stands off the true edge
  var CHAMFER_BIG = 32;     // 2^5 — corner cut on full viewports
  var CHAMFER_SMALL = 16;   // 2^4 — under 2^9 px
  var SMALL_W = 512;        // 2^9
  var FPS_MS = 33;          // draw gate ~30fps; the pulse is 1 Hz, this is plenty

  function Frame(opts) {
    this.canvas = null;
    this.ctx = null;
    this.raf = 0;
    this.last = 0;
    this.reduced = false;
    // Candle mode is opt-in per page: <body data-luvframe="candles">. Pages that say
    // nothing keep the rose hairline exactly as before.
    this.candles = !!(opts && opts.candles);
    if (!opts) {
      try {
        var host = document.body || document.documentElement;
        var want = host && host.getAttribute && host.getAttribute('data-luvframe');
        this.candles = /(^|\s)candles(\s|$)/i.test(want || '');
      } catch (e) { /* no DOM yet */ }
    }
    try {
      this.reduced = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (e) { /* older engines */ }
  }

  Frame.prototype.start = function () {
    if (this.canvas) return this;
    var c = document.createElement('canvas');
    c.setAttribute('aria-hidden', 'true');
    c.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:9999';
    document.body.appendChild(c);
    this.canvas = c;
    this.ctx = c.getContext('2d');
    var self = this;
    this._onResize = function () { self.fit(); self.draw(self.pulse()); };
    global.addEventListener('resize', this._onResize);
    this.fit();
    if (this.reduced) { this.draw(0); return this; }   // static boundary, no loop
    var tick = function (t) {
      self.raf = global.requestAnimationFrame(tick);
      if (t - self.last < FPS_MS) return;
      self.last = t;
      self.draw(self.pulse());
    };
    this.raf = global.requestAnimationFrame(tick);
    return this;
  };

  Frame.prototype.stop = function () {
    if (this.raf) global.cancelAnimationFrame(this.raf);
    if (this._onResize) global.removeEventListener('resize', this._onResize);
    if (this.canvas && this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
    this.canvas = this.ctx = null; this.raf = 0;
    return this;
  };

  // the heart if it beats here, else our own 1 Hz — same clock, same phase law
  Frame.prototype.pulse = function () {
    var v = NaN;
    try {
      v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--luv-pulse'));
    } catch (e) { /* no style engine */ }
    if (v >= 0 && v <= 1) return v;
    var ms = Date.now() % 1000;                        // 1 Hz, wall-clock phase
    return 0.5 - 0.5 * Math.cos(ms / 1000 * 2 * Math.PI);
  };

  Frame.prototype.fit = function () {
    var dpr = Math.min(global.devicePixelRatio || 1, 2);
    var w = global.innerWidth, h = global.innerHeight;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = w; this.h = h;
  };

  // the octagon boundary path: viewport rect, corners cut at 45° (the octagon norm)
  function octPath(ctx, x0, y0, x1, y1, ch) {
    ctx.beginPath();
    ctx.moveTo(x0 + ch, y0);
    ctx.lineTo(x1 - ch, y0); ctx.lineTo(x1, y0 + ch);
    ctx.lineTo(x1, y1 - ch); ctx.lineTo(x1 - ch, y1);
    ctx.lineTo(x0 + ch, y1); ctx.lineTo(x0, y1 - ch);
    ctx.lineTo(x0, y0 + ch);
    ctx.closePath();
  }

  Frame.prototype.draw = function (v) {
    var ctx = this.ctx; if (!ctx) return;
    var w = this.w, h = this.h;
    var ch = (w < SMALL_W ? CHAMFER_SMALL : CHAMFER_BIG);
    var m = INSET;
    ctx.clearRect(0, 0, w, h);

    // outer wall — the seam, structural, steady
    octPath(ctx, m, m, w - m, h - m, ch);
    ctx.lineWidth = 2;
    ctx.strokeStyle = SEAM;
    ctx.globalAlpha = 1;
    ctx.stroke();

    // inner hairline — the living edge, breathing with the pulse (2px standoff)
    var edge = ROSE, glow = PINK;
    if (this.candles) {
      // reduced motion: hold the resting colour rather than freeze on a random beat
      var red = !this.reduced && (Math.floor(Date.now() / 1000) % CANDLE_CYCLE) === CANDLE_RED_AT;
      edge = glow = red ? CANDLE_RED : CANDLE_GREEN;
    }
    octPath(ctx, m + 3, m + 3, w - m - 3, h - m - 3, Math.max(ch - 3, 4));
    ctx.lineWidth = 1;
    ctx.strokeStyle = edge;
    ctx.globalAlpha = 0.22 + 0.5 * v;
    ctx.shadowColor = glow;
    ctx.shadowBlur = 6 * v;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // corner sigils — two triangles make a square (sane axiom), one per chamfer:
    // the filled triangle is the cut itself; its mirror is drawn as outline inward.
    var s = ch / 2;                                    // sigil side = half the chamfer
    var corners = [
      { x: m, y: m, sx: 1, sy: 1 },                    // NW
      { x: w - m, y: m, sx: -1, sy: 1 },               // NE
      { x: w - m, y: h - m, sx: -1, sy: -1 },          // SE
      { x: m, y: h - m, sx: 1, sy: -1 }                // SW
    ];
    for (var i = 0; i < corners.length; i++) {
      var k = corners[i];
      // filled triangle riding the chamfer
      ctx.beginPath();
      ctx.moveTo(k.x + k.sx * ch, k.y);
      ctx.lineTo(k.x, k.y + k.sy * ch);
      ctx.lineTo(k.x + k.sx * ch, k.y + k.sy * ch);
      ctx.closePath();
      ctx.globalAlpha = 0.10 + 0.14 * v;
      ctx.fillStyle = GOLD;
      ctx.fill();
      // the mirror triangle, outlined — together: the square
      ctx.beginPath();
      ctx.moveTo(k.x + k.sx * ch, k.y);
      ctx.lineTo(k.x + k.sx * (ch + s), k.y + k.sy * s);
      ctx.lineTo(k.x + k.sx * ch, k.y + k.sy * ch);
      ctx.closePath();
      ctx.globalAlpha = 0.28;
      ctx.lineWidth = 1;
      ctx.strokeStyle = GOLD;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  };

  // self-boot: the boundary belongs to any page that includes this file
  function boot() {
    if (global.__luvFrame) return;
    global.__luvFrame = new Frame().start();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  global.DVLuvFrame = { Frame: Frame };
})(typeof window !== 'undefined' ? window : this);
