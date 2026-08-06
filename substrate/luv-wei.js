/*!
 * SHAMBA LUV — WEI/LUV expression substrate (DVLuvWei): the value of a LUV in wei.
 *
 * The smallest honest price statement the chain can make: wei per ONE LUV, six
 * decimals shown (display-only trim — the lattice carries eighteen). The seed
 * priced LUV at exactly 10 WEI; every wei above that is the market speaking,
 * and the market is attention.
 *
 * Fills every [data-weiperluv] mount with "1 LUV = N.NNNNNN WEI · N.NNx from X".
 * Same-origin market.json only (CSP connect-src 'self'), minute cadence,
 * zero dependencies, self-boots. Mount anywhere with one span.
 */
(function (global) {
  'use strict';

  var TICK_MS = 60e3;                 // the light minute tick — mirror-only
  var SEED_WEI = 10;                  // the genesis price: exactly 10 wei per LUV

  function paint(pn) {
    var weiPerLuv = pn * 1e18;
    var x = weiPerLuv / SEED_WEI;
    var parts = weiPerLuv.toFixed(6).split('.');
    var txt = '1 LUV = ' + Number(parts[0]).toLocaleString('en-US') + '.' + parts[1] +
      ' WEI · ' + x.toFixed(2) + '× from the 10-wei seed';
    document.querySelectorAll('[data-weiperluv]').forEach(function (m) {
      m.textContent = txt;
      m.title = 'wei per ONE LUV — read from the pair reserves on-chain · the seed was exactly 10 wei · full 18-decimal precision lives on the lattice; this line trims for display only';
    });
  }

  function tick() {
    fetch('market.json?v=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (m) {
        var pn = m && Number(m.priceNative);
        if (pn > 0) paint(pn);
      })
      .catch(function () { /* keep the last good frame */ });
  }

  function boot() {
    if (!document.querySelector('[data-weiperluv]')) return;
    tick();
    setInterval(function () { if (!document.hidden) tick(); }, TICK_MS);
  }
  if (global.document) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
  }

  global.DVLuvWei = { version: '1.0.0' };
})(typeof window !== 'undefined' ? window : this);
