'use strict';
/*
 * rainbow.js — gated delivery of the in-house Bitcoin rainbow chart.
 * The chart SVG is served by GET /auth/rainbow ONLY to a live session (wallet signature
 * or social login). Unauthenticated visitors see the gate; the prose stays public.
 * CSP-safe: external file, same-origin fetches only, no eval, no inline handlers.
 * Every .chartbox gets +/− zoom. Static charts widen inside their scrolling box;
 * the substrate rainbow ([data-luvrainbow]) instead steps a PRICE-SCALE LADDER —
 * the ceiling walks $10k → $100k → $1M → $10M → $100M → $1B → $2B → $10B → $100B
 * → $1T → $2T → $10T → $100T, re-rendered by DVLuvRainbow at every step.
 */
(function () {
  var MIN = 1, MAX = 4, STEP = 1.25;
  function makeRow(box) {
    var row = document.createElement('div');
    row.className = 'zoomrow';
    var minus = document.createElement('button');
    minus.type = 'button'; minus.textContent = '−'; minus.setAttribute('aria-label', 'zoom out');
    var lvl = document.createElement('span');
    lvl.className = 'zoomlvl';
    var plus = document.createElement('button');
    plus.type = 'button'; plus.textContent = '+'; plus.setAttribute('aria-label', 'zoom in');
    row.appendChild(minus); row.appendChild(lvl); row.appendChild(plus);
    box.parentNode.insertBefore(row, box);
    return { minus: minus, lvl: lvl, plus: plus };
  }
  // width zoom — the static SVGs can't re-render, so they widen
  function addWidthZoom(box) {
    var c = makeRow(box), z = 1;
    function apply() {
      var svg = box.querySelector('svg');
      if (svg) svg.style.width = (z * 100) + '%';
      c.lvl.textContent = Math.round(z * 100) + '%';
      c.minus.disabled = z <= MIN; c.plus.disabled = z >= MAX;
    }
    c.minus.addEventListener('click', function () { z = Math.max(MIN, z / STEP); apply(); });
    c.plus.addEventListener('click', function () { z = Math.min(MAX, z * STEP); apply(); });
    apply();
    box._applyZoom = apply; // re-apply after late SVG injection (the gated chart)
  }
  // scale-ladder zoom — the substrate rainbow re-renders at an explicit price ceiling
  function addScaleZoom(box, mount) {
    var RB = window.DVLuvRainbow;
    if (!RB) { addWidthZoom(box); return; }
    var c = makeRow(box);
    var idx = 4; // $100M — the whole 2010–2040 fit fits under it
    function apply() {
      var o = mount._rainbowOpts || {};
      o.yMax = RB.SCALES[idx];
      RB.render(mount, o);
      c.lvl.textContent = RB.SCALE_LABELS[idx];
      // + zooms IN (lower ceiling), − zooms OUT (higher ceiling)
      c.plus.disabled = idx <= 0; c.minus.disabled = idx >= RB.SCALES.length - 1;
    }
    c.plus.addEventListener('click', function () { if (idx > 0) { idx--; apply(); } });
    c.minus.addEventListener('click', function () { if (idx < RB.SCALES.length - 1) { idx++; apply(); } });
    apply();
  }
  // world-debt overlay toggle — only for the substrate rainbow, which carries the market-cap
  // reading the comparison needs. Re-renders through the organ from the mount's own options, so
  // the toggle can never disagree with what is drawn.
  function addDebtToggle(box, mount) {
    var RB = window.DVLuvRainbow;
    if (!RB) return;
    var row = box.previousSibling;
    if (!row || row.className !== 'zoomrow') return;
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'debtbtn';
    b.textContent = 'world debt';
    b.title = 'overlay total world debt on the market-cap scale (IIF aggregates, carried forward at 3.15%/yr)';
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', function () {
      var o = mount._rainbowOpts || {};
      o.debt = !o.debt;
      b.setAttribute('aria-pressed', o.debt ? 'true' : 'false');
      RB.render(mount, o);
    });
    row.insertBefore(b, row.firstChild);
  }

  function addZoom(box) {
    if (box.dataset.zoomed) return; box.dataset.zoomed = '1';
    var mount = box.querySelector('[data-luvrainbow]');
    if (mount) { addScaleZoom(box, mount); addDebtToggle(box, mount); } else addWidthZoom(box);
  }
  function boot() {
    var boxes = document.querySelectorAll('.chartbox');
    for (var i = 0; i < boxes.length; i++) addZoom(boxes[i]);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  window.__rainbowZoomBoot = boot;
})();
(async function () {
  var gate = document.getElementById('gate');
  var box = document.getElementById('chartbox');
  var gated = document.querySelectorAll('.gated');
  if (!gate || !box) return;
  try {
    var me = await fetch('/auth/me', { credentials: 'same-origin' });
    if (!me.ok) return; // no session — the gate stays
    var r = await fetch('/auth/rainbow', { credentials: 'same-origin' });
    if (!r.ok) return;
    var svg = await r.text();
    // defense in depth: only inject if the payload is the expected SVG document
    if (svg.indexOf('<svg') !== 0) return;
    box.innerHTML = svg;
    box.hidden = false;
    if (box._applyZoom) box._applyZoom();
    gate.hidden = true;
    for (var i = 0; i < gated.length; i++) gated[i].hidden = false;
  } catch (_) {
    /* network error — the gate stays; the prose is already visible */
  }
})();
