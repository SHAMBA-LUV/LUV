'use strict';
/*
 * rbfaq.js — the words page of the rainbow. Two `.gated` blocks (the band prices today and the
 * forward window) unlock to a live session exactly as they do on rainbow.html: one same-origin
 * GET /auth/me decides. CSP-safe: external file, no inline handlers, no eval.
 */
(async function () {
  var gated = document.querySelectorAll('.gated');
  if (!gated.length) return;
  try {
    var me = await fetch('/auth/me', { credentials: 'same-origin' });
    if (!me.ok) return;                                   // no session — the gate stays
    for (var i = 0; i < gated.length; i++) gated[i].hidden = false;
  } catch (_) { /* offline: the gate stays; the prose is already visible */ }
})();
