/*!
 * SHAMBA LUV — price expression substrate (LUV.html). luv.oracle surface.
 * The price is created by the liquidity pair and expressed on Uniswap.
 * Because ETH/LUV is measured (pair reserves) and ETH/USD is measured (median of
 * actual pairs + aggregators), USDC/LUV and LUV/USDC follow — all at 18 decimals.
 *   Ξ mode:  ETH → 1,000,000,000,000.000000000000000000 LUV · WEI/LUV (seed = 10 WEI)
 *   $ mode:  USDC → the same trillion · LUV per 1 USDC — the inverse measure
 * Same-origin market.json (CSP connect-src 'self'), written by luv-market-collector.mjs.
 */
(function (global) {
  'use strict';

  var REFRESH_MS = 15 * 60e3;
  var SEED_PRICE_NATIVE = 1e-17;      // ETH per LUV at the genesis seed = exactly 10 wei
  var ONE_TRILLION_LUV = '1,000,000,000,000.000000000000000000';

  var mode = 'eth';
  try { mode = global.localStorage.getItem('luv-price-mode') || 'eth'; } catch (e) { /* private mode */ }
  var lastMarket = null;

  function el(id) { return document.getElementById(id); }
  function set(id, txt) { var e = el(id); if (e) e.textContent = txt; }

  // 18 decimal places, no scientific notation, thousands-grouped integer part
  function fmt18(v) {
    if (!(v > 0)) return '—';
    var s = v.toFixed(18);
    var parts = s.split('.');
    return Number(parts[0]).toLocaleString('en-US') + '.' + parts[1];
  }
  // USDC's NATIVE precision is 6 decimals — settlement truth for dollar figures.
  // The 18-place accuracy is carried by the ETH/LUV side (WEI); see the notes.
  function fmt6(v) {
    if (!(v > 0)) return '—';
    var s = v.toFixed(6);
    var parts = s.split('.');
    return Number(parts[0]).toLocaleString('en-US') + '.' + parts[1];
  }
  function fmtWei(v) {
    if (!(v > 0)) return '—';
    return v >= 100 ? v.toFixed(1) : v.toFixed(2);
  }

  function render() {
    var mkt = lastMarket;
    if (!mkt) return;
    var pn = Number(mkt.priceNative);            // ETH per LUV (pair reserves)
    if (!(pn > 0)) return;
    var pu = Number(mkt.priceUsd);               // USD per LUV (via median ETH/USD)
    var ethPerTrillion = pn * 1e12;
    var usdcPerTrillion = pu > 0 ? pu * 1e12 : null;
    var weiPerLuv = pn * 1e18;
    var luvPerUsdc = pu > 0 ? 1 / pu : null;     // how much LUV one USDC gathers
    var priceX = pn / SEED_PRICE_NATIVE;

    if (mode === 'usdc') {
      set('lp-k1', 'USDC → one trillion LUV');
      set('lp-eth', usdcPerTrillion ? fmt6(usdcPerTrillion) + ' USDC' : '—');
      set('lp-usd', ethPerTrillion ? fmt18(ethPerTrillion) + ' ETH' : '—');
      var ul = el('lp-usdline'); if (ul) ul.lastChild.textContent = ' · the same trillion, in ETH (18dp)';
      set('lp-k2', 'LUV / USDC');
      set('lp-wei', luvPerUsdc ? fmt18(luvPerUsdc) + ' LUV' : '—');
      set('lp-wei-note', 'what one USDC gathers from the pool — LUV carries the eighteen decimals · ' +
        'price ' + priceX.toFixed(2) + '× from X' +
        (usdcPerTrillion ? ' · measured to 18 via WEI: ' + fmt18(usdcPerTrillion) + ' USDC / 1T' : ''));
      set('lp-wei-note2', 'USDC settles at its native 6 decimals; the accuracy extends to 18 through the ' +
        'ETH/LUV measure in WEI: ETH/LUV is read on the pair, ETH/USD on actual pairs — so USDC/LUV ' +
        'and LUV/USDC follow.');
    } else {
      set('lp-k1', 'ETH → one trillion LUV');
      set('lp-eth', fmt18(ethPerTrillion) + ' ETH');
      set('lp-usd', usdcPerTrillion ? fmt6(usdcPerTrillion) + ' USDC' : '—');
      var ul2 = el('lp-usdline'); if (ul2) ul2.lastChild.textContent = ' · the same trillion, in USDC';
      set('lp-k2', 'WEI / LUV');
      set('lp-wei', fmtWei(weiPerLuv) + ' WEI / LUV');
      set('lp-wei-note', 'the seed priced LUV at exactly 10 WEI · now ' + fmtWei(weiPerLuv) +
        ' WEI — price ' + priceX.toFixed(2) + '× from X');
      set('lp-wei-note2', 'wei — the smallest unit of ETH, 10⁻¹⁸. LUV entered the world at ' +
        'ten of them. Every wei above that is the market speaking.');
    }

    if (mkt.reserves && mkt.reserves.weth) {
      set('lp-depth', 'pool depth ' + Number(mkt.reserves.weth).toFixed(4) + ' ETH · price read from the pair reserves on-chain');
    }
    var tEl = el('lp-at');
    if (tEl && mkt.t) {
      var chron = mkt.chronos || {};
      tEl.textContent = 'measured ' + new Date(mkt.t).toLocaleString() +
        (chron.block_number ? ' · chronos anchor: block ' + chron.block_number : '');
    }

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
      ? 'Uniswap V2 pair getReserves() — 100% of circulating LUV lives in this pool; the pair creates the price, Uniswap expresses it'
      : String(mkt.source || '—')) + (mkt.rails && mkt.rails.reserves ? ' · rpc ' + mkt.rails.reserves.replace('https://', '') : ''));
    var liqX = (mkt.reserves && mkt.reserves.weth) ? Number(mkt.reserves.weth) / 0.051922968585348276 : null;
    set('lp-x', 'price ' + priceX.toFixed(2) + '× from X' + (liqX ? ' · liquidity ' + liqX.toFixed(2) + '×' : ''));
    var h24 = mkt.priceChange && mkt.priceChange.h24;
    set('lp-h24', h24 === undefined || h24 === null ? '—'
      : (Number(h24) > 0 ? '▲ +' : Number(h24) < 0 ? '▼ ' : '· ') + Number(h24).toFixed(2) + '%');
  }

  function setMode(m) {
    mode = m;
    try { global.localStorage.setItem('luv-price-mode', m); } catch (e) { /* private mode */ }
    var be = el('lp-mode-eth'), bu = el('lp-mode-usdc');
    if (be) { be.classList.toggle('active', m === 'eth'); be.setAttribute('aria-selected', m === 'eth'); }
    if (bu) { bu.classList.toggle('active', m === 'usdc'); bu.setAttribute('aria-selected', m === 'usdc'); }
    render();
  }

  function tick() {
    fetch('market.json?v=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (m) { if (m) { lastMarket = m; render(); } })
      .catch(function () { /* keep the last good frame */ });
  }

  function boot() {
    if (!el('lp-eth')) return;
    set('lp-luv', ONE_TRILLION_LUV + ' LUV');
    var be = el('lp-mode-eth'), bu = el('lp-mode-usdc');
    if (be) be.addEventListener('click', function () { setMode('eth'); });
    if (bu) bu.addEventListener('click', function () { setMode('usdc'); });
    setMode(mode);
    tick();
    setInterval(function () { if (!document.hidden) tick(); }, REFRESH_MS);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) tick(); });
  }

  if (global.document) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
  }
})(typeof window !== 'undefined' ? window : this);
