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
    // accuracy: six decimals, grouped — approximation is display-only
    var parts = v.toFixed(6).split('.');
    return Number(parts[0]).toLocaleString('en-US') + '.' + parts[1];
  }
  function fmtGrp(v, dec) {
    if (!(v > 0)) return '—';
    var parts = v.toFixed(dec).split('.');
    return parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (parts[1] ? '.' + parts[1] : '');
  }
  var AMT_NOTE_DEFAULT = 'one trillion LUV — a million millions, to the last of its eighteen decimals. ' +
    'That is what the pool asks for it, right now.';

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
    var luvPerEth = 1 / pn;                      // the inverse measure
    var luvPerWei = luvPerEth / 1e18;            // what a single wei gathers
    var priceX = pn / SEED_PRICE_NATIVE;

    // the identities line — every expression at once, whatever the toggle says
    set('lp-conv', '⚖ 1 LUV = ' + fmtWei(weiPerLuv) + ' WEI = ' + pn.toExponential(4) +
      ' ETH · 1 ETH = ' + fmtGrp(luvPerEth / 1e12, 4) + 'T LUV');

    var amtNote = el('lp-amt-note');
    if (mode === 'wei') {
      set('lp-k1', 'WEI → one LUV');
      set('lp-eth', fmtWei(weiPerLuv) + ' WEI');
      set('lp-luv', '1.000000000000000000 LUV');
      if (amtNote) amtNote.textContent = 'one LUV exact — 1 LUV === 1 LUV, to the last of its eighteen ' +
        'decimals. This is its price in the atoms of ETH, right now.';
      set('lp-usd', fmt18(pn) + ' ETH');
      var ulw = el('lp-usdline'); if (ulw) ulw.lastChild.textContent = ' · the same LUV, in whole ETH (18dp)';
      set('lp-k2', 'ETH / LUV');
      set('lp-wei', pn.toExponential(6) + ' ETH / LUV');
      set('lp-wei-note', 'the native price at full precision · the seed was exactly 1.0000e-17 · now ' +
        pn.toExponential(4) + ' — price ' + priceX.toFixed(4) + '× from X');
      set('lp-wei-note2', 'one number, three units: 1 EB = 1 ETH = 1 LUV at 10¹⁸ — the byte ladder and the ' +
        'value ladder share one atomic geometry (the identity paper: exabyte.html).');
    } else if (mode === 'luveth') {
      set('lp-k1', 'one ETH → LUV');
      set('lp-eth', fmtGrp(luvPerEth, 0) + ' LUV');
      set('lp-luv', '1.000000000000000000 ETH');
      if (amtNote) amtNote.textContent = 'what one whole ETH gathers from the pool — the inverse measure, ' +
        'grouped to the last whole LUV.';
      set('lp-usd', fmtGrp(luvPerEth / 1e12, 4) + 'T LUV');
      var ull = el('lp-usdline'); if (ull) ull.lastChild.textContent = ' · the same, in trillions — millions of millions';
      set('lp-k2', 'LUV / WEI');
      set('lp-wei', fmt18(luvPerWei) + ' LUV');
      set('lp-wei-note', 'what a single wei gathers · at the seed one wei gathered exactly 0.1 LUV · ' +
        'price ' + priceX.toFixed(4) + '× from X');
      set('lp-wei-note2', 'the seed priced LUV at 10 wei, so one wei gathered a tenth of a LUV; every ' +
        'LUV-per-wei below that is the market speaking.');
    } else if (mode === 'usdc') {
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

    if (mode === 'usdc' || mode === 'eth') {
      set('lp-luv', ONE_TRILLION_LUV + ' LUV');
      if (amtNote) amtNote.textContent = AMT_NOTE_DEFAULT;
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

  var MODE_BTNS = [['lp-mode-eth', 'eth'], ['lp-mode-usdc', 'usdc'], ['lp-mode-wei', 'wei'], ['lp-mode-luveth', 'luveth']];

  // The big print is itself a toggle: a click rotates the denomination
  // ETH → USDC → WEI → ETH. The tab row still reaches every mode directly.
  var ROTATION = ['eth', 'usdc', 'wei'];
  function rotate() {
    var i = ROTATION.indexOf(mode);            // an off-rotation mode (luveth) lands on ETH
    setMode(ROTATION[(i + 1) % ROTATION.length]);
  }
  function armRotation() {
    ['lp-eth', 'lp-conv', 'lp-wei'].forEach(function (id) {
      var n = el(id);
      if (!n || n.getAttribute('data-rotates')) return;
      n.setAttribute('data-rotates', '1');
      n.style.cursor = 'pointer';
      n.title = 'click to rotate the denomination — ETH → USDC → WEI';
      n.addEventListener('click', rotate);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', armRotation);
  else armRotation();

  function setMode(m) {
    mode = m;
    try { global.localStorage.setItem('luv-price-mode', m); } catch (e) { /* private mode */ }
    MODE_BTNS.forEach(function (bm) {
      var b = el(bm[0]); if (!b) return;
      b.classList.toggle('active', m === bm[1]);
      b.setAttribute('aria-selected', String(m === bm[1]));
    });
    render();
  }

  // ── the daily summary ──────────────────────────────────────────────────────────
  // market.json is a SNAPSHOT: it carries the price now and a 24h change, but no
  // average. An average has to be computed from the samples, so the history file is
  // read once per full refresh and reduced over the trailing 24h. If history is
  // unavailable the averages simply say so rather than borrowing the spot price and
  // calling it a mean — a snapshot is not an average and must never be printed as one.
  var DAY_MS = 86400000;
  function fmtUsd(v, dp) {
    if (v === null || v === undefined || isNaN(v)) return '—';
    return '$' + Number(v).toFixed(dp === undefined ? 6 : dp);
  }
  function renderDaily(mkt, hist) {
    if (!el('lp-d-price')) return;
    var oneT = mkt && Number(mkt.oneTrillionUsd);
    set('lp-d-price', isFinite(oneT) ? fmtUsd(oneT) : '—');

    var h24 = mkt && mkt.priceChange && mkt.priceChange.h24;
    var chgEl = el('lp-d-chg');
    if (chgEl) {
      var n = Number(h24);
      chgEl.textContent = (h24 === undefined || h24 === null || isNaN(n)) ? '—'
        : (n > 0 ? '▲ +' : n < 0 ? '▼ ' : '· ') + n.toFixed(2) + '%';
      chgEl.style.color = !isFinite(n) || n === 0 ? 'var(--dim)' : (n > 0 ? '#7ee2a0' : 'var(--rose)');
    }

    // daily average + daily range, reduced over the trailing 24h of samples
    var avg = null, lo = null, hi = null, n = 0;
    if (hist && hist.points && hist.points.length) {
      var cut = hist.points[hist.points.length - 1][0] - DAY_MS, sum = 0;
      for (var i = hist.points.length - 1; i >= 0; i--) {
        var p = hist.points[i];
        if (p[0] < cut) break;
        var v = Number(p[1]);
        if (!isFinite(v)) continue;
        sum += v; n++;
        if (lo === null || v < lo) lo = v;
        if (hi === null || v > hi) hi = v;
      }
      if (n) avg = sum / n;
    }
    var T = 1e12;
    set('lp-d-avg', avg === null ? 'no samples' : fmtUsd(avg * T));
    set('lp-d-range', (lo === null || hi === null) ? '—' : fmtUsd(lo * T) + ' – ' + fmtUsd(hi * T));
    set('lp-d-samples', n ? n + ' samples · ' + (n >= 1400 ? 'full day' : '~' + Math.round(n / 60) + 'h') : '—');

    var vol = mkt && mkt.volume && mkt.volume.h24;
    set('lp-d-vol', (vol === undefined || vol === null) ? '—' : '$' + Number(vol).toFixed(2));
    var tx = (mkt && mkt.txns && mkt.txns.h24) || {};
    var buys = Number(tx.buys || 0), sells = Number(tx.sells || 0);
    set('lp-d-tx', (buys + sells) + ' (' + buys + ' buy / ' + sells + ' sell)');
    var liq = mkt && mkt.liquidity && mkt.liquidity.usd;
    set('lp-d-liq', (liq === undefined || liq === null) ? '—' : '$' + Number(liq).toFixed(2));
    set('lp-d-mcap', (mkt && isFinite(Number(mkt.marketCap))) ? '$' + Number(mkt.marketCap).toFixed(0) : '—');
    var blk = mkt && mkt.chronos && mkt.chronos.block_number;
    set('lp-d-block', blk ? 'block ' + blk : '—');
  }

  function tick() {
    fetch('market.json?v=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (m) { if (m) { lastMarket = m; render(); renderDaily(m, lastHistory); } })
      .catch(function () { /* keep the last good frame */ });
  }

  var lastHistory = null;
  function tickHistory() {
    // history is the biggest same-origin payload on this page, so it is read on the
    // FULL refresh only — never on the minute price tick.
    fetch('market-history.json', { cache: 'no-cache' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (h) { if (h) { lastHistory = h; renderDaily(lastMarket, h); } })
      .catch(function () { /* averages degrade to "no samples", nothing else breaks */ });
  }

  function boot() {
    if (!el('lp-eth')) return;
    tickHistory();
    try { global.setInterval(tickHistory, 5 * 60 * 1000); } catch (e) { /* no timers */ }
    set('lp-luv', ONE_TRILLION_LUV + ' LUV');
    MODE_BTNS.forEach(function (bm) {
      var b = el(bm[0]);
      if (b) b.addEventListener('click', function () { setMode(bm[1]); });
    });
    if (!MODE_BTNS.some(function (bm) { return bm[1] === mode; })) mode = 'eth';
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
