'use strict';
/*
 * rainbow.js — gated delivery of the in-house Bitcoin rainbow chart.
 * The chart SVG is served by GET /auth/rainbow ONLY to a live session (wallet signature
 * or social login). Unauthenticated visitors see the gate; the prose stays public.
 * CSP-safe: external file, same-origin fetches only, no eval, no inline handlers.
 * Every .chartbox gets +/− zoom: the svg widens inside its own scrolling box.
 */
(function () {
  var MIN = 1, MAX = 4, STEP = 1.25;
  function addZoom(box) {
    if (box.dataset.zoomed) return; box.dataset.zoomed = '1';
    var z = 1;
    var row = document.createElement('div');
    row.className = 'zoomrow';
    var minus = document.createElement('button');
    minus.type = 'button'; minus.textContent = '−'; minus.setAttribute('aria-label', 'zoom out');
    var lvl = document.createElement('span');
    lvl.className = 'zoomlvl'; lvl.textContent = '100%';
    var plus = document.createElement('button');
    plus.type = 'button'; plus.textContent = '+'; plus.setAttribute('aria-label', 'zoom in');
    row.appendChild(minus); row.appendChild(lvl); row.appendChild(plus);
    box.parentNode.insertBefore(row, box);
    function apply() {
      var svg = box.querySelector('svg');
      if (svg) svg.style.width = (z * 100) + '%';
      lvl.textContent = Math.round(z * 100) + '%';
      minus.disabled = z <= MIN; plus.disabled = z >= MAX;
    }
    minus.addEventListener('click', function () { z = Math.max(MIN, z / STEP); apply(); });
    plus.addEventListener('click', function () { z = Math.min(MAX, z * STEP); apply(); });
    apply();
    box._applyZoom = apply; // re-apply after late SVG injection (the gated chart)
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
