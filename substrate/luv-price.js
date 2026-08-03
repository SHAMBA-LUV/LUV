/*!
 * SHAMBA LUV — price expression substrate (LUV.html).
 * Both directions of the same truth, read from the pair reserves (kairos.oracle):
 *   ETH → 1,000,000,000,000.000000000000000000 LUV   (what one trillion costs)
 *   WEI / LUV                                         (what one LUV costs, in wei —
 *                                                      the seed set it at exactly 10 wei)
 * Same-origin market.json (CSP connect-src 'self'), written by luv-market-collector.mjs.
 */
(function (global) {
  'use strict';

  var REFRESH_MS = 15 * 60e3;
  var SEED_PRICE_NATIVE = 1e-17;      // ETH per LUV at the genesis seed = exactly 10 wei
  var ONE_TRILLION_LUV = '1,000,000,000,000.000000000000000000';

  function el(id) { return document.getElementById(id); }
  function set(id, txt) { var e = el(id); if (e) e.textContent = txt; }

  function fmtEth(v) {
    if (!(v > 0)) return '—';
    // 1T LUV costs ~1e-4..1e-3 ETH at current depth — show full precision without sci-notation
    var s = v.toFixed(18).replace(/0+$/, '');
    if (s.endsWith('.')) s += '0';
    return s;
  }
  function fmtWei(v) {
    if (!(v > 0)) return '—';
    return v >= 100 ? v.toFixed(1) : v.toFixed(2);
  }

  function render(mkt) {
    if (!mkt) return;
    var pn = Number(mkt.priceNative);            // ETH per LUV
    if (!(pn > 0)) return;
    var ethPerTrillion = pn * 1e12;              // ETH per 1T LUV
    var weiPerLuv = pn * 1e18;                   // wei per whole LUV
    var priceX = pn / SEED_PRICE_NATIVE;

    set('lp-eth', fmtEth(ethPerTrillion) + ' ETH');
    set('lp-wei', fmtWei(weiPerLuv) + ' WEI / LUV');
    set('lp-wei-note', 'the seed priced LUV at exactly 10 WEI · now ' + fmtWei(weiPerLuv) +
      ' WEI — price ' + priceX.toFixed(2) + '× from X');
    if (mkt.oneTrillionUsd) set('lp-usd', '$' + Number(mkt.oneTrillionUsd).toFixed(4) + ' USDC');
    if (mkt.reserves && mkt.reserves.weth) {
      set('lp-depth', 'pool depth ' + Number(mkt.reserves.weth).toFixed(4) + ' ETH · price read from the pair reserves on-chain');
    }
    var tEl = el('lp-at');
    if (tEl && mkt.t) tEl.textContent = 'measured ' + new Date(mkt.t).toLocaleString();

    // ── the actuals — diagnostics straight from the pair ──
    if (mkt.reserves) {
      set('lp-r', Number(mkt.reserves.luv).toLocaleString('en-US', { maximumFractionDigits: 0 }) +
        ' LUV ↔ ' + Number(mkt.reserves.weth).toFixed(6) + ' WETH');
    }
    if (mkt.ethUsd) {
      var names = mkt.ethUsdInputs ? Object.keys(mkt.ethUsdInputs) : [];
      set('lp-ethusd', '$' + Number(mkt.ethUsd).toFixed(2) +
        (names.length ? ' — median of ' + names.length + ' inputs: ' + names.join(', ') : ''));
    }
    set('lp-src', (mkt.source === 'reserves'
      ? 'getReserves() on the pair — the price is created by the liquidity pair, expressed on Uniswap'
      : String(mkt.source || '—')) + (mkt.rails && mkt.rails.reserves ? ' · rpc ' + mkt.rails.reserves.replace('https://', '') : ''));
    var liqX = (mkt.reserves && mkt.reserves.weth) ? Number(mkt.reserves.weth) / 0.051922968585348276 : null;
    set('lp-x', 'price ' + priceX.toFixed(2) + '× from X' + (liqX ? ' · liquidity ' + liqX.toFixed(2) + '×' : ''));
    var h24 = mkt.priceChange && mkt.priceChange.h24;
    set('lp-h24', h24 === undefined || h24 === null ? '—'
      : (Number(h24) > 0 ? '▲ +' : Number(h24) < 0 ? '▼ ' : '· ') + Number(h24).toFixed(2) + '%');
  }

  function tick() {
    fetch('market.json?v=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(render)
      .catch(function () { /* keep the last good frame */ });
  }

  function boot() {
    if (!el('lp-eth')) return;
    set('lp-luv', ONE_TRILLION_LUV + ' LUV');
    tick();
    setInterval(function () { if (!document.hidden) tick(); }, REFRESH_MS);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) tick(); });
  }

  if (global.document) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
  }
})(typeof window !== 'undefined' ? window : this);
