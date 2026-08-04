/*!
 * DeltaVerse — sane substrate (v1): sane geometry, the point ladder.
 *
 * Clean-house / clean-room — an ORIGINAL, self-contained geometry substrate (no external
 * libs, no CDN, no WebGL). The doctrine, one point at a time:
 *
 *   1 POINT       — a position. Nothing to see yet.
 *   2 LINE        — the first relation: two points, an edge, a distance.
 *   3 TRIANGLE    — three points is an OBJECT: the first polygon, the plane.
 *                   Everything rendered decomposes to triangles.
 *   4 BUCKET      — the fourth point closes the first VOLUME: the tetrahedron —
 *                   a container. It can hold.
 *   5 STAGE       — the bucket is a stage: the fifth point is the first that can
 *                   stand INSIDE the volume (barycentric interior — the actor).
 *   6 CONTROLLER  — the point controller in PERSPECTIVE: the eye. The sixth role
 *                   is not on the stage — it owns the view of it. Perspective is
 *                   a point with authority: move the controller, the world turns.
 *
 * COMPOSITION — the ladder builds upward:
 *   TWO TRIANGLES IS A SQUARE   — the quad is always two tris underneath (GPU truth);
 *   A SPINNING SQUARE IS A CIRCLE — rotation completes the polygon into the curve:
 *                   the corners of a square spinning about its centre trace exactly
 *                   its circumscribed circle. The curve is motion remembered.
 *   TWO SQUARES IS AN OCTAGON — the world: the hull of a square and its 45° twin.
 *                   8 = 2^3 sides (the POW2 ladder), the classic arena bound —
 *                   octagon math for the world: max(|x|, |y|, (|x|+|y|)/√2) ≤ apothem.
 *   A POINT OVER THE SQUARE IS A PYRAMID — from the four corners of a square,
 *                   another single point creates another triangle on every edge:
 *                   4 corners + 1 apex = 4 side triangles over the 2 beneath.
 *                   The ladder never leaves the triangle; it only raises it.
 *   FROM THE SQUARE, THE SQUARE AGAIN — duplicate the square into its four
 *                   corners: the quadtree. 4^depth children, each half the size —
 *                   resolution is recursion, and recursion rides the POW2 ladder.
 *   SIX SQUARES IS A CUBE — and the cube is triangulation twice over: twelve
 *                   triangles wear the surface (six squares × two tris), five
 *                   buckets fill the solid (four corner tetrahedra around one
 *                   regular heart). The pyramid likewise: six triangles on the
 *                   surface, two buckets beneath the apex. Surface or solid,
 *                   it is triangles all the way down.
 *
 * Powers-of-two discipline for raster targets (see artist.agent POW2), Decimal-grade
 * constants upstream; here the math is exact in form: cross, triple product, barycentric,
 * look-at + perspective divide — no approximation beyond IEEE-754.
 *
 *   var S = DVSane;
 *   S.triArea(a, b, c)                    // the object's measure
 *   S.bucketVolume(a, b, c, d)            // the container's capacity
 *   S.onStage(p, a, b, c, d)              // is the actor inside the bucket?
 *   var ctl = S.controller({ eye:[3,2,4], look:[0,0,0], up:[0,1,0], fov:60, aspect:1 });
 *   S.project(p, ctl)                     // → { x, y, depth } in NDC — the controller's view
 *
 * Prototype lane (.js, UMD). Demo: new DVSane.Stage('#sane').start() — a slowly turning
 * bucket with the actor inside, drawn from the controller's perspective (2D canvas,
 * reduced-motion aware, violet DeltaVerse signature).
 */
(function (global) {
  'use strict';

  // ── the ladder ──
  var POINT = 1, LINE = 2, TRIANGLE = 3, BUCKET = 4, STAGE = 5, CONTROLLER = 6;

  // ── vector primitives (3D, plain arrays) ──
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
  function scale(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function cross(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  }
  function norm(a) { var l = Math.sqrt(dot(a, a)) || 1; return scale(a, 1 / l); }
  function dist(a, b) { var d = sub(a, b); return Math.sqrt(dot(d, d)); }

  // ── 2: the line ──
  function lineLength(a, b) { return dist(a, b); }

  // ── 3: the object ──
  function triArea(a, b, c) {
    var n = cross(sub(b, a), sub(c, a));
    return Math.sqrt(dot(n, n)) / 2;
  }
  function triNormal(a, b, c) { return norm(cross(sub(b, a), sub(c, a))); }

  // ── 4: the bucket ──
  function bucketVolume(a, b, c, d) {
    return Math.abs(dot(sub(b, a), cross(sub(c, a), sub(d, a)))) / 6;
  }

  // ── 5: the stage — barycentric interior ──
  function barycentric(p, a, b, c, d) {
    var vT = dot(sub(b, a), cross(sub(c, a), sub(d, a)));  // signed 6×volume
    if (vT === 0) return null;                              // degenerate bucket
    var w1 = dot(sub(b, p), cross(sub(c, p), sub(d, p))) / vT;
    var w2 = dot(sub(p, a), cross(sub(c, a), sub(d, a))) / vT;
    var w3 = dot(sub(b, a), cross(sub(p, a), sub(d, a))) / vT;
    var w4 = dot(sub(b, a), cross(sub(c, a), sub(p, a))) / vT;
    return [w1, w2, w3, w4];
  }
  function onStage(p, a, b, c, d) {
    var w = barycentric(p, a, b, c, d);
    if (!w) return false;
    return w[0] >= 0 && w[1] >= 0 && w[2] >= 0 && w[3] >= 0;   // the actor stands inside
  }

  // ── 6: the point controller in perspective ──
  function controller(opts) {
    opts = opts || {};
    var eye = opts.eye || [3, 2, 4];
    var look = opts.look || [0, 0, 0];
    var up = opts.up || [0, 1, 0];
    var fov = (opts.fov || 60) * Math.PI / 180;
    var aspect = opts.aspect || 1;
    var f = sub(look, eye);                 // forward
    var zc = norm(scale(f, -1));            // camera z (right-handed, looks down -z)
    var xc = norm(cross(up, zc));           // camera x
    var yc = cross(zc, xc);                 // camera y
    return { eye: eye, x: xc, y: yc, z: zc, t: Math.tan(fov / 2), aspect: aspect };
  }
  function project(p, ctl) {
    var v = sub(p, ctl.eye);
    var cx = dot(v, ctl.x), cy = dot(v, ctl.y), cz = dot(v, ctl.z);
    if (cz >= 0) return null;               // behind the controller — no view without the eye
    var d = -cz;
    return { x: (cx / d) / (ctl.t * ctl.aspect), y: (cy / d) / ctl.t, depth: d };
  }

  // ── composition: two triangles is a square; a spinning square is a circle ──
  function square(opts) {
    opts = opts || {};
    var r = opts.r || 1, z = opts.z || 0;       // r = circumradius: corners ON the circle-to-be
    var pts = [];
    for (var k = 0; k < 4; k++) {
      var a = Math.PI / 4 + k * Math.PI / 2;
      pts.push([r * Math.cos(a), r * Math.sin(a), z]);
    }
    return {
      points: pts,
      tris: [[0, 1, 2], [0, 2, 3]],             // two triangles IS the square
      edges: [[0, 1], [1, 2], [2, 3], [3, 0]],
      r: r
    };
  }
  function spinCircle(opts) {
    // the circle as the trace of the spinning square: rotate the square through
    // `steps` positions; its corners sample exactly the circumscribed circle.
    opts = opts || {};
    var r = opts.r || 1, z = opts.z || 0;
    var steps = opts.steps || 16;               // 16 spins × 4 corners = 64 points on the curve
    var pts = [], edges = [];
    var n = steps * 4;
    for (var i = 0; i < n; i++) {
      var a = Math.PI / 4 + i * (Math.PI / 2) / steps;   // each corner advanced 1/steps of a quarter-turn
      pts.push([r * Math.cos(a), r * Math.sin(a), z]);
      edges.push([i, (i + 1) % n]);
    }
    return { points: pts, edges: edges, r: r, steps: steps, from: 'square' };
  }

  // ── the quadtree: duplicate the square into its four corners ──
  function subdivide(opts) {
    opts = opts || {};
    var r = opts.r || 1, z = opts.z || 0;
    var depth = opts.depth === undefined ? 1 : Math.max(0, opts.depth | 0);
    var cx = opts.cx || 0, cy = opts.cy || 0;
    if (depth === 0) {
      var sq = square({ r: r, z: z });
      sq.points = sq.points.map(function (p) { return [p[0] + cx, p[1] + cy, p[2]]; });
      sq.cx = cx; sq.cy = cy;
      return { squares: [sq], count: 1, depth: 0 };
    }
    var off = r * Math.SQRT2 / 4;               // toward each corner: quarter of the side
    var out = [];
    [[1, 1], [-1, 1], [-1, -1], [1, -1]].forEach(function (q) {
      var child = subdivide({ r: r / 2, z: z, depth: depth - 1, cx: cx + q[0] * off, cy: cy + q[1] * off });
      out = out.concat(child.squares);
    });
    return { squares: out, count: out.length, depth: depth };   // 4^depth children
  }

  // ── the pyramid: from the four corners of a square, one point raises triangles ──
  function pyramid(opts) {
    opts = opts || {};
    var base = square({ r: opts.r || 1, z: opts.z || 0 });
    var h = opts.h === undefined ? (opts.r || 1) : opts.h;
    var apex = [0, 0, (opts.z || 0) + h];       // the single point over the square
    var pts = base.points.concat([apex]);       // 0..3 corners, 4 apex
    var tris = base.tris.slice();               // the two triangles beneath
    var edges = base.edges.slice();
    for (var k = 0; k < 4; k++) {
      tris.push([k, (k + 1) % 4, 4]);           // every edge + apex = another triangle
      edges.push([k, 4]);
    }
    // solid triangulation: split the base diagonal — two buckets beneath the apex
    var tets = [[0, 1, 2, 4], [0, 2, 3, 4]];
    return { points: pts, edges: edges, tris: tris, tets: tets, apex: apex, h: h, r: base.r };
  }

  // ── the cube from triangulation: six squares → twelve tris; five buckets inside ──
  function cube(opts) {
    opts = opts || {};
    var s = opts.s || (opts.r ? opts.r * 2 / Math.sqrt(3) : 1);  // side (r = circumradius)
    var z = opts.z || 0, h = s / 2;
    // 0..3 bottom ring, 4..7 top ring (same winding)
    var pts = [
      [-h, -h, z - h], [h, -h, z - h], [h, h, z - h], [-h, h, z - h],
      [-h, -h, z + h], [h, -h, z + h], [h, h, z + h], [-h, h, z + h]
    ];
    var edges = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
    // surface: six squares, each two triangles — twelve in all
    var faces = [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
    var tris = [];
    faces.forEach(function (f) { tris.push([f[0], f[1], f[2]], [f[0], f[2], f[3]]); });
    // solid: five buckets — four corner tetrahedra around one regular heart
    var tets = [[0, 1, 2, 5], [0, 2, 3, 7], [0, 4, 5, 7], [2, 5, 6, 7], [0, 2, 5, 7]];
    return { points: pts, edges: edges, tris: tris, tets: tets, faces: faces, s: s };
  }

  // ── octagon math for the world: two squares is an octagon ──
  var SQRT2 = Math.sqrt(2);
  function octagon(opts) {
    opts = opts || {};
    var r = opts.r || 1, z = opts.z || 0;       // circumradius; apothem = r·cos(π/8)
    var pts = [], edges = [], tris = [];
    for (var k = 0; k < 8; k++) {               // 8 = 2^3 sides — a square and its 45° twin
      var a = Math.PI / 8 + k * Math.PI / 4;
      pts.push([r * Math.cos(a), r * Math.sin(a), z]);
      edges.push([k, (k + 1) % 8]);
    }
    pts.push([0, 0, z]);                        // centre — the fan pivot
    for (var t = 0; t < 8; t++) tris.push([8, t, (t + 1) % 8]);  // 8 triangles make the world floor
    return { points: pts, edges: edges, tris: tris, r: r, apothem: r * Math.cos(Math.PI / 8) };
  }
  function inWorld(p, apothem) {
    // the octagon arena bound (2D in the xy-plane): inside all 8 half-planes
    var x = Math.abs(p[0]), y = Math.abs(p[1]);
    return Math.max(x, y, (x + y) / SQRT2) <= apothem;
  }

  // ── the pentagram: inner and outer rings, stretched along z ──
  // Outer ring: 5 points on radius r. The star {5/2} joins every second point.
  // Inner ring: the star's self-intersections — radius r/φ² (the golden section
  // squared; φ from the same Decimal doctrine as artist.agent's PHI_D), rotated
  // half a step. Both rings live at z = ±stretch/2: a wireframe the z-axis pulls.
  var PHI = (1 + Math.sqrt(5)) / 2;
  function pentagram(opts) {
    opts = opts || {};
    var r = opts.r || 1;
    var ri = r / (PHI * PHI);                   // inner radius — 1/φ² of the outer
    var stretch = opts.stretch === undefined ? 1 : opts.stretch;
    var pts = [], edges = [];
    [-stretch / 2, stretch / 2].forEach(function (z, layer) {
      var base = layer * 10;
      for (var k = 0; k < 5; k++) {             // outer ring 0..4
        var a = Math.PI / 2 + k * 2 * Math.PI / 5;
        pts.push([r * Math.cos(a), r * Math.sin(a), z]);
      }
      for (var j = 0; j < 5; j++) {             // inner ring 5..9
        var b = Math.PI / 2 + (j + 0.5) * 2 * Math.PI / 5;
        pts.push([ri * Math.cos(b), ri * Math.sin(b), z]);
      }
      for (var e = 0; e < 5; e++) {
        edges.push([base + e, base + ((e + 2) % 5)]);          // the star {5/2}
        edges.push([base + 5 + e, base + 5 + ((e + 1) % 5)]);  // the inner pentagon
      }
    });
    for (var v = 0; v < 10; v++) edges.push([v, v + 10]);      // the stretch: z verticals
    return { points: pts, edges: edges, r: r, ri: ri, stretch: stretch };
  }

  // ── the demo: bucket + actor (or any wireframe), seen by the controller (2D canvas) ──
  function Stage(sel, opts) {
    opts = opts || {};
    this.canvas = typeof sel === 'string' ? global.document.querySelector(sel) : sel;
    this.hue = opts.hue || 265;                                // violet, DeltaVerse signature
    this.reduce = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this._raf = 0;
    // the bucket: a unit-ish tetrahedron; the actor: barycentric centre, breathing.
    // Pass opts.wire = pentagram({stretch: 1.2}) (or any {points, edges}) to stage
    // a different wireframe; setStretch() re-pulls a pentagram along z live.
    this.bucket = [[1, 1, 1], [-1, -1, 1], [-1, 1, -1], [1, -1, -1]].map(function (p) { return scale(p, 0.8); });
    this.wire = opts.wire || null;
  }
  Stage.prototype.setStretch = function (s) {
    if (this.wire && this.wire.r !== undefined) this.wire = pentagram({ r: this.wire.r, stretch: s });
    return this;
  };
  Stage.prototype._frame = function (t) {
    var c = this.canvas; if (!c) return;
    var ctx = c.getContext('2d');
    var dpr = Math.min(global.devicePixelRatio || 1, 2);
    var W = c.clientWidth || 300, H = c.clientHeight || 300;
    if (c.width !== W * dpr) { c.width = W * dpr; c.height = H * dpr; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    var ang = this.reduce ? 0.7 : t / 4000;                    // still image under reduced-motion
    var ctl = controller({ eye: [4 * Math.cos(ang), 2.2, 4 * Math.sin(ang)], look: [0, 0, 0], aspect: W / H });
    var self = this;
    function toPx(p) { var q = project(p, ctl); return q && { x: (q.x + 1) / 2 * W, y: (1 - (q.y + 1) / 2) * H, d: q.depth }; }
    var pts = this.wire ? this.wire.points : this.bucket;
    var E = this.wire ? this.wire.edges : [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]];
    var P = pts.map(toPx);
    if (P.some(function (p) { return !p; })) { self._loop(); return; }
    ctx.strokeStyle = 'hsla(' + this.hue + ',70%,62%,.55)';
    ctx.lineWidth = 1.25;
    E.forEach(function (e) {
      ctx.beginPath(); ctx.moveTo(P[e[0]].x, P[e[0]].y); ctx.lineTo(P[e[1]].x, P[e[1]].y); ctx.stroke();
    });
    // the actor: centre of the stage, breathing at 60 bpm (one beat per second)
    var breathe = this.reduce ? 1 : 1 + 0.25 * Math.max(0, Math.sin((t % 1000) / 1000 * Math.PI * 2));
    var centre = scale(this.bucket.reduce(add, [0, 0, 0]), 0.25);
    var A = toPx(centre);
    if (A) {
      ctx.fillStyle = 'hsla(' + this.hue + ',85%,72%,.95)';
      ctx.beginPath(); ctx.arc(A.x, A.y, 3.5 * breathe, 0, Math.PI * 2); ctx.fill();
    }
    this._loop();
  };
  Stage.prototype._loop = function () {
    if (this.reduce) return;                                    // one still frame is enough
    var self = this;
    this._raf = global.requestAnimationFrame(function (t) { self._frame(t); });
  };
  Stage.prototype.start = function () {
    var self = this;
    this._raf = global.requestAnimationFrame(function (t) { self._frame(t); });
    return this;
  };
  Stage.prototype.stop = function () { global.cancelAnimationFrame(this._raf); this._raf = 0; return this; };

  // ── the pulse widget: a blinking square dot, rate and size under your hand ──
  // A square (the ladder's own object: two triangles) blinking at `bpm` — one
  // pulsation per 60000/bpm ms, phase from the wall clock modulo the period
  // (precise by construction, never timer accumulation). Two sliders:
  //   bpm    — increase/decrease the blinking rate (default 60 = 1s/pulse)
  //   size   — resize between min and max, snapped to the POW2 ladder (8..64)
  // Reduced-motion: the dot stands steady at full opacity; sliders still set state.
  function Pulse(mount, opts) {
    opts = opts || {};
    this.root = typeof mount === 'string' ? global.document.querySelector(mount) : mount;
    this.bpm = opts.bpm || 60;
    this.minBpm = opts.minBpm || 30;
    this.maxBpm = opts.maxBpm || 240;
    this.sizes = opts.sizes || [8, 16, 32, 64];      // the POW2 ladder for the dot
    this.size = opts.size || 32;
    this.hue = opts.hue || 265;
    this.reduce = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this._raf = 0;
  }
  Pulse.prototype._snap = function (n) {
    var s = this.sizes;
    return s.reduce(function (best, v) { return Math.abs(v - n) < Math.abs(best - n) ? v : best; }, s[0]);
  };
  Pulse.prototype.periodMs = function () { return 60000 / this.bpm; };
  Pulse.prototype.start = function () {
    if (!this.root) return this;
    var self = this;
    var mono = "ui-monospace,'SF Mono',Menlo,monospace";
    this.root.innerHTML = '';
    var box = global.document.createElement('div');
    box.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:10px;font-family:' + mono + ';font-size:11px;color:hsla(' + this.hue + ',30%,70%,.9)';
    var stagebox = global.document.createElement('div');
    stagebox.style.cssText = 'display:flex;align-items:center;justify-content:center;width:' + (this.sizes[this.sizes.length - 1] + 16) + 'px;height:' + (this.sizes[this.sizes.length - 1] + 16) + 'px';
    var dot = global.document.createElement('div');
    dot.setAttribute('role', 'img');
    dot.setAttribute('aria-label', 'square pulse dot');
    dot.style.cssText = 'background:hsla(' + this.hue + ',85%,68%,1);border-radius:2px';
    stagebox.appendChild(dot);
    function slider(min, max, step, value, label, oninput) {
      var wrap = global.document.createElement('label');
      wrap.style.cssText = 'display:flex;align-items:center;gap:8px';
      var txt = global.document.createElement('span');
      var inp = global.document.createElement('input');
      inp.type = 'range'; inp.min = min; inp.max = max; inp.step = step; inp.value = value;
      inp.style.accentColor = 'hsl(' + self.hue + ',70%,62%)';
      inp.addEventListener('input', function () { oninput(Number(inp.value), txt); });
      wrap.appendChild(inp); wrap.appendChild(txt);
      oninput(Number(inp.value), txt);
      return wrap;
    }
    box.appendChild(stagebox);
    box.appendChild(slider(this.minBpm, this.maxBpm, 1, this.bpm, 'bpm', function (v, txt) {
      self.bpm = v; txt.textContent = v + ' bpm · ' + (60000 / v / 1000).toFixed(3) + 's/pulse';
    }));
    box.appendChild(slider(this.sizes[0], this.sizes[this.sizes.length - 1], 1, this.size, 'size', function (v, txt) {
      self.size = self._snap(v); txt.textContent = 'size ' + self.size + 'px (2^' + Math.round(Math.log2(self.size)) + ')';
    }));
    this.root.appendChild(box);
    function frame(t) {
      var P = self.periodMs();
      var phase = (Date.now() % P) / P;                 // wall-clock modulo — the period is exact
      var lit = self.reduce ? 1 : (phase < 0.5 ? 1 : 0.25);   // the blink: on-half, dim-half
      var breathe = self.reduce ? 1 : 1 + 0.08 * Math.sin(phase * Math.PI * 2);
      var s = self.size * breathe;
      dot.style.width = s + 'px'; dot.style.height = s + 'px';
      dot.style.opacity = lit;
      self._raf = global.requestAnimationFrame(frame);
    }
    this._raf = global.requestAnimationFrame(frame);
    return this;
  };
  Pulse.prototype.stop = function () { global.cancelAnimationFrame(this._raf); this._raf = 0; return this; };

  var DVSane = {
    POINT: POINT, LINE: LINE, TRIANGLE: TRIANGLE, BUCKET: BUCKET, STAGE: STAGE, CONTROLLER: CONTROLLER,
    lineLength: lineLength, triArea: triArea, triNormal: triNormal,
    bucketVolume: bucketVolume, barycentric: barycentric, onStage: onStage,
    controller: controller, project: project, pentagram: pentagram, PHI: PHI,
    square: square, spinCircle: spinCircle, pyramid: pyramid, cube: cube, subdivide: subdivide,
    octagon: octagon, inWorld: inWorld,
    Stage: Stage, Pulse: Pulse,
    version: '1.1.0'
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = DVSane;
  global.DVSane = DVSane;
})(typeof window !== 'undefined' ? window : this);
