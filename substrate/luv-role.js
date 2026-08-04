/*!
 * SHAMBA LUV — role substrate: each tier of the OVERLORD hierarchy wears its
 * own sane geometry (substrate/sane.js — DVSane), suitable as to role:
 *
 *   free      → the POINT        (you exist — that is enough to begin)
 *   sovereign → the LINE         (you and your key: the first relation)
 *   expired   → the CIRCLE, remembered (dashed — motion the verse remembers)
 *   agent     → the TRIANGLE     (the first object that acts)
 *   member    → the SQUARE       (two triangles joined — the name is the bond)
 *   model     → the PYRAMID      (the apex raised over the square)
 *   overseer  → the OCTAGON      (the world bound — a governed domain)
 *   overlord  → the CUBE + the POINT CONTROLLER (the eye that owns the view)
 *
 * Reads document.body.dataset.role, renders on #rolegfx. Reduced-motion: still frame.
 */
(function (global) {
  'use strict';
  var S = global.DVSane;
  if (!S || !global.document) return;

  var reduced = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function shape(role) {
    switch (role) {
      case 'free':      return { pts: [[0, 0, 0]], edges: [], dot: true, hue: 340 };
      case 'sovereign': return { pts: [[-0.9, -0.5, 0], [0.9, 0.5, 0]], edges: [[0, 1]], dot: true, hue: 45 };
      case 'expired': {
        var c = S.spinCircle({ r: 1, steps: 16 });
        return { pts: c.points, edges: c.edges.filter(function (_, i) { return i % 2 === 0; }), hue: 340, dim: true };
      }
      case 'agent':     return { pts: [[0, 1, 0], [-0.95, -0.6, 0], [0.95, -0.6, 0]], edges: [[0, 1], [1, 2], [2, 0]], hue: 265 };
      case 'member': {
        var q = S.square({ r: 1 });
        return { pts: q.points, edges: q.edges.concat([[0, 2]]), hue: 325 };   // the diagonal: two triangles
      }
      case 'model': {
        var p = S.pyramid({ r: 0.9, h: 1.15 });
        return { pts: p.points.map(function (v) { return [v[0], v[2] - 0.45, v[1]]; }), edges: p.edges, hue: 300 };
      }
      case 'overseer': {
        var o = S.octagon({ r: 1.05 });
        return { pts: o.points, edges: o.edges, hue: 265 };
      }
      case 'overlord': {
        var cu = S.cube({ s: 1.5 });
        return { pts: cu.points, edges: cu.edges, hue: 315, heart: true };
      }
      default: return null;
    }
  }

  function boot() {
    var canvas = document.getElementById('rolegfx');
    var role = document.body.dataset.role;
    var g = canvas && shape(role);
    if (!g) return;
    function draw(now) {
      var ctx = canvas.getContext('2d');
      var dpr = Math.min(global.devicePixelRatio || 1, 2);
      var W = canvas.clientWidth || 280, H = canvas.clientHeight || 280;
      if (canvas.width !== Math.floor(W * dpr)) { canvas.width = Math.floor(W * dpr); canvas.height = Math.floor(H * dpr); }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      var ang = reduced ? 0.65 : now / 5200;
      var ctl = S.controller({ eye: [3 * Math.cos(ang), 1.5, 3 * Math.sin(ang)], look: [0, 0, 0], fov: 55, aspect: W / H });
      function px(p) {
        var q = S.project(p, ctl);
        return q && { x: (q.x + 1) / 2 * W, y: (1 - (q.y + 1) / 2) * H };
      }
      var P = g.pts.map(px);
      ctx.strokeStyle = 'hsla(' + g.hue + ',75%,65%,' + (g.dim ? '.45' : '.8') + ')';
      ctx.lineWidth = 1.6;
      if (g.dim) ctx.setLineDash([4, 6]);
      g.edges.forEach(function (e) {
        var a = P[e[0]], b = P[e[1]];
        if (!a || !b) return;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      });
      ctx.setLineDash([]);
      // the beat: every role keeps the heart — 60 bpm, precisely 1s per pulsation
      var beat = reduced ? 1 : 1 + 0.3 * Math.max(0, Math.sin(((Date.now() % 1000) / 1000) * Math.PI * 2));
      if (g.dot || g.heart) {
        var c0 = px([0, 0, 0]) || { x: W / 2, y: H / 2 };
        ctx.fillStyle = 'hsla(' + g.hue + ',90%,72%,.95)';
        ctx.beginPath(); ctx.arc(c0.x, c0.y, 3.5 * beat, 0, Math.PI * 2); ctx.fill();
      }
      if (!reduced) global.requestAnimationFrame(draw);
    }
    global.requestAnimationFrame(draw);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(typeof window !== 'undefined' ? window : this);
