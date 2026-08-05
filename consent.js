'use strict';

/*
 * consent.js — the consent gate behind /consent.html (cypherpunk2048: consent over default).
 *
 * A social OAuth callback parks the verified identity in a 5-minute pending cookie and lands
 * here. GET /auth/pending shows WHO is about to enter; only the explicit ❤ enter click
 * (POST /auth/enter) provisions the wallet and mints the session. cancel (or walking away)
 * enters nothing.
 */
(() => {
  const $ = (id) => document.getElementById(id);
  const msg = (text, cls) => { const m = $('msg'); m.textContent = text; m.className = cls || ''; };

  const j = async (url, opts) => {
    const r = await fetch(url, Object.assign({ credentials: 'same-origin' }, opts));
    let body = {};
    try { body = await r.json(); } catch (e) { /* non-JSON error body */ }
    if (!r.ok) throw new Error(body.error || ('http_' + r.status));
    return body;
  };

  const home = () => { location.href = '/'; };

  $('enter').addEventListener('click', async () => {
    $('enter').disabled = true;
    $('cancel').disabled = true;
    msg('entering…');
    try {
      await j('/auth/enter', { method: 'POST' });
      msg('welcome ❤ taking you in…', 'ok');
      home();
    } catch (e) {
      msg('entry failed: ' + e.message + ' — sign in again from the landing page.', 'err');
      $('cancel').disabled = false;
    }
  });

  $('cancel').addEventListener('click', async () => {
    $('cancel').disabled = true;
    try { await j('/auth/cancel', { method: 'POST' }); } catch (e) { /* cookie expires anyway */ }
    home();
  });

  (async () => {
    try {
      const p = await j('/auth/pending');
      $('prov').textContent = p.provider;
      $('email').textContent = p.email || '(no email shared)';
      $('enter').disabled = false;
      msg('nothing has been created yet — enter or cancel. this choice expires in 5 minutes.');
    } catch (e) {
      $('prov').textContent = '—';
      $('email').textContent = '—';
      msg('no pending entry. this page is reached from a sign-in — head back to the landing page.', 'err');
    }
  })();
})();
