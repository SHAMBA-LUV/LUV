/*!
 * SHAMBA LUV — enter substrate: the actual door, rendered from sane geometry.
 *
 * The scene is the doctrine (substrate/sane.js — DVSane):
 *   the OCTAGON is the world floor · the door PANEL is two triangles (the
 *   diagonal is drawn — the quad never hides its tris) · the PENTAGRAM
 *   (inner + outer rings, z-stretch) is the lintel · the ACTOR pulses at
 *   60 bpm in the doorway · and the POINT CONTROLLER IN PERSPECTIVE is you.
 *
 * THE TRANSITION: ENTER (button, click, or the Enter key) swings the panel
 * on its hinge while the controller walks forward through the frame; the
 * fade completes and the verse receives you (verse.html — the hierarchy).
 * prefers-reduced-motion: the door stands open, one gentle fade, same arrival.
 */
(function (global) {
  'use strict';
  var S = global.DVSane;
  if (!S || !global.document) return;

  var DEST = 'verse.html';
  var HUE = 320;                       // rose-pink door in the violet-floor world
  var reduced = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ── the geometry ──
  // floor: octagon world in the ground plane (xy → xz), r=3
  var oct = S.octagon({ r: 3 });
  var floorPts = oct.points.map(function (p) { return [p[0], 0, p[1]]; });
  var floorEdges = oct.edges;
  // frame: two posts + lintel
  var framePts = [[-0.65, 0, 0], [-0.65, 2.15, 0], [0.65, 2.15, 0], [0.65, 0, 0]];
  var frameEdges = [[0, 1], [1, 2], [2, 3]];
  // panel: the door — a quad of two triangles, hinge on the left edge (x=-0.6)
  var HINGE = -0.6, PW = 1.2, PH = 2.05;
  var panelBase = [[HINGE, 0, 0], [HINGE + PW, 0, 0], [HINGE + PW, PH, 0], [HINGE, PH, 0]];
  var panelEdges = [[0, 1], [1, 2], [2, 3], [3, 0], [0, 2]];   // the diagonal shows the two tris
  // lintel: the pentagram, raised above the frame
  var pg = S.pentagram({ r: 0.3, stretch: 0.12 });
  var lintelPts = pg.points.map(function (p) { return [p[0], p[1] + 2.75, p[2]]; });

  function swing(p, theta) {          // rotate a panel point about the vertical hinge line
    var dx = p[0] - HINGE, x = HINGE + dx * Math.cos(theta), z = -dx * Math.sin(theta);
    return [x, p[1], z];
  }

  // ── the render ──
  var canvas = document.getElementById('door');
  var overlay = document.getElementById('doorfade');
  var btn = document.getElementById('enterbtn');
  if (!canvas) return;
  var entering = false, t0 = 0, DURATION = 2600;

  function draw(now) {
    var ctx = canvas.getContext('2d');
    var dpr = Math.min(global.devicePixelRatio || 1, 2);
    var W = canvas.clientWidth || global.innerWidth, H = canvas.clientHeight || global.innerHeight;
    if (canvas.width !== Math.floor(W * dpr)) { canvas.width = Math.floor(W * dpr); canvas.height = Math.floor(H * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    var t = entering ? Math.min(1, (now - t0) / DURATION) : 0;
    var ease = t * t * (3 - 2 * t);                               // smoothstep
    var theta = (reduced ? 1 : ease) * (110 * Math.PI / 180);     // the swing
    if (reduced && !entering) theta = 100 * Math.PI / 180;        // door stands open

    // the controller: idle sway → the walk through
    var sway = reduced ? 0 : Math.sin(now / 3800) * 0.35;
    var eye = [0.9 + sway - ease * (0.9 + sway), 1.35, 4.3 - ease * 5.4];
    var ctl = S.controller({ eye: eye, look: [0, 1.15, eye[2] - 4], up: [0, 1, 0], fov: 62, aspect: W / H });
    function px(p) {
      var q = S.project(p, ctl);
      return q && { x: (q.x + 1) / 2 * W, y: (1 - (q.y + 1) / 2) * H, d: q.depth };
    }
    function wire(pts, edges, stroke, width, dash) {
      var P = pts.map(px);
      ctx.strokeStyle = stroke; ctx.lineWidth = width;
      ctx.setLineDash(dash || []);
      edges.forEach(function (e) {
        var a = P[e[0]], b = P[e[1]];
        if (!a || !b) return;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      });
      ctx.setLineDash([]);
    }

    wire(floorPts, floorEdges, 'hsla(265,60%,58%,.4)', 1.2);                        // the world
    wire(framePts, frameEdges, 'hsla(' + HUE + ',75%,64%,.85)', 2.2);               // the frame
    wire(panelBase.map(function (p) { return swing(p, theta); }), panelEdges,
         'hsla(' + HUE + ',85%,68%,.9)', 2, null);                                  // the door
    wire(lintelPts, pg.edges, 'hsla(45,70%,62%,.7)', 1);                            // the lintel

    // the actor: pulsing at 60 bpm in the doorway (precisely 1s per pulsation)
    var beat = 1 + 0.3 * Math.max(0, Math.sin(((Date.now() % 1000) / 1000) * Math.PI * 2));
    var A = px([0, 1.05, -0.15]);
    if (A) {
      ctx.fillStyle = 'hsla(' + HUE + ',90%,72%,.95)';
      ctx.beginPath(); ctx.arc(A.x, A.y, (reduced ? 3.5 : 3.5 * beat), 0, Math.PI * 2); ctx.fill();
    }

    // the transition fade
    if (entering && overlay) {
      var f = Math.max(0, (t - 0.62) / 0.38);
      overlay.style.opacity = f * f;
      if (t >= 1) { global.location.href = DEST; return; }
    }
    global.requestAnimationFrame(draw);
  }

  function enter() {
    if (entering) return;
    entering = true; t0 = performance.now();
    if (btn) { btn.disabled = true; btn.textContent = '❤ entering…'; }
    if (reduced) {                                   // no walk — one gentle fade, same arrival
      if (overlay) { overlay.style.transition = 'opacity .6s'; overlay.style.opacity = 1; }
      setTimeout(function () { global.location.href = DEST; }, 650);
    }
  }
  if (btn) btn.addEventListener('click', enter);
  canvas.addEventListener('click', enter);
  document.addEventListener('keydown', function (e) { if (e.key === 'Enter') enter(); });

  global.requestAnimationFrame(draw);
})(typeof window !== 'undefined' ? window : this);
