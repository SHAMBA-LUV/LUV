'use strict';
/*
 * rainbow.js — gated delivery of the in-house Bitcoin rainbow chart.
 * The chart SVG is served by GET /auth/rainbow ONLY to a live session (wallet signature
 * or social login). Unauthenticated visitors see the gate; the prose stays public.
 * CSP-safe: external file, same-origin fetches only, no eval, no inline handlers.
 */
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
    gate.hidden = true;
    for (var i = 0; i < gated.length; i++) gated[i].hidden = false;
  } catch (_) {
    /* network error — the gate stays; the prose is already visible */
  }
})();
