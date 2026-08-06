/*!
 * SHAMBA LUV — luv-lockgate.js: the OVERLORD gate for the LP-lock instructions.
 *
 * OVERLORD protocol. The LP-lock is bankon.eth's hand alone, so the instructions are
 * gated to bankon.eth alone. The "reads are public" posture is deliberately suspended
 * on this one page: connect to prove you are the OVERLORD, or be sent to the live market.
 *
 * Every wallet that is NOT the OVERLORD — and anyone who declines to connect or has no
 * wallet — is redirected to the live view (view.html), where the emphasized Uniswap
 * USDC → LUV preset waits. Only bankon.eth sees the instructions revealed.
 *
 * cypherpunk2048/CSP-safe: external file, no inline JS, no network fetch — it reads only
 * the injected window.ethereum and redirects with window.location.
 */
(function () {
  'use strict';
  var OVERLORD = '0x10f7ee226b16bea7f365dc1edef159fc1957d169'; // bankon.eth (lowercased for compare)
  var VIEW = 'view.html';

  function $(id) { return document.getElementById(id); }
  function toView(reason) {
    try { sessionStorage.setItem('lockgate', reason || 'redirect'); } catch (e) {}
    window.location.replace(VIEW);
  }
  function reveal() {
    var g = $('lock-gate'), i = $('lock-instructions');
    if (g) g.hidden = true;
    if (i) i.hidden = false;
    var who = $('lock-who'); if (who) who.textContent = 'OVERLORD verified · bankon.eth';
  }
  // Returns true if OVERLORD (revealed); otherwise redirects to the live view.
  function decide(accounts) {
    if (!accounts || !accounts.length) return false;
    if (String(accounts[0]).toLowerCase() === OVERLORD) { reveal(); return true; }
    toView('not-overlord');
    return false;
  }
  function connect() {
    var eth = window.ethereum, s = $('lock-status');
    if (!eth || !eth.request) {
      if (s) s.textContent = 'no wallet found — opening the live market…';
      setTimeout(function () { toView('no-wallet'); }, 1400);
      return;
    }
    if (s) s.textContent = 'verifying the hand…';
    eth.request({ method: 'eth_requestAccounts' })
      .then(decide)
      .catch(function () { if (s) s.textContent = 'connection declined — the gate stands.'; });
  }
  function boot() {
    var btn = $('lockgate-connect');
    if (btn) btn.addEventListener('click', connect);
    // Silent check: a wallet already connected is judged without a click.
    if (window.ethereum && window.ethereum.request) {
      window.ethereum.request({ method: 'eth_accounts' })
        .then(function (acc) { if (acc && acc.length) decide(acc); })
        .catch(function () {});
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
