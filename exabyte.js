/*!
 * SHAMBA LUV — the identity converter (exabyte.html).
 * WEI ⇄ LUV · LUV ⇄ WEI · ETH ⇄ LUV · LUV ⇄ ETH at the live pair price.
 * All arithmetic is BigInt on the 10¹⁸ lattice — the price is carried as an exact
 * rational (numerator/denominator) parsed from the market.json TEXT, never a float;
 * approximation is a display decision, never a storage decision.
 * The byte ladder places the wei count on the rungs from the byte to the exabyte:
 * 10¹⁸ atoms = 1 EB = 1 whole ETH = 1 whole LUV — one number, three units.
 * Same-origin market.json only (CSP connect-src 'self'); the collector alone talks
 * to the chain. Seed fallback: exactly 10 wei per LUV (the genesis price).
 */
(function () {
  'use strict';

  var REFRESH_MS = 5 * 60e3;          // mirror-only cadence — never touches price sources
  var E18 = 1000000000000000000n;     // 10^18 — the lattice
  var pow10 = function (n) { var r = 1n, t = 10n; n = BigInt(n); while (n > 0n) { if (n & 1n) r *= t; t *= t; n >>= 1n; } return r; };

  // ETH per LUV as an exact rational num/den. Seed: 1e-17 ETH = exactly 10 wei per LUV.
  var num = 1n, den = pow10(17), live = false;
  var lastEdited = 'luv';

  function el(id) { return document.getElementById(id); }
  function group(s) { return s.replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

  // decimal string → atto (18-dp BigInt); null on non-numeric input
  function toAtto(s) {
    s = (s || '').replace(/[,\s_]/g, '');
    if (s === '' || s === '.' || !/^\d*\.?\d*$/.test(s)) return null;
    var p = s.split('.');
    var frac = (p[1] || '').slice(0, 18);
    while (frac.length < 18) frac += '0';
    return BigInt(p[0] || '0') * E18 + BigInt(frac);
  }
  // atto BigInt → full 18-dp decimal string, thousands-grouped integer part
  function fromAtto(a) {
    return group((a / E18).toString()) + '.' + (a % E18).toString().padStart(18, '0');
  }
  function toWei(s) {
    s = (s || '').replace(/[,\s_]/g, '');
    if (s === '' || !/^\d+$/.test(s)) return null;
    return BigInt(s);
  }

  // parse priceNative from the raw JSON text — exact, no float in the path
  function parsePriceNative(text) {
    var m = /"priceNative"\s*:\s*([0-9]+)(?:\.([0-9]+))?(?:[eE](-?[0-9]+))?/.exec(text);
    if (!m) return null;
    var digits = m[1] + (m[2] || '');
    var e = (m[3] ? parseInt(m[3], 10) : 0) - (m[2] ? m[2].length : 0);
    var n = BigInt(digits), d = 1n;
    if (e >= 0) n *= pow10(e); else d = pow10(-e);
    if (n <= 0n) return null;
    return { n: n, d: d };
  }

  // ── conversions on the lattice ────────────────────────────────────────────
  // luvAtto → ethAtto: × num/den.  ethAtto IS the wei count (1 ETH = 10¹⁸ wei).
  function luvToEthAtto(luvAtto) { return (luvAtto * num) / den; }
  function ethAttoToLuv(ethAtto) { return (ethAtto * den) / num; }

  var RUNGS = [
    { u: 'B',  p: 0,  note: 'the atom' },
    { u: 'KB', p: 3,  note: 'the thousand' },
    { u: 'MB', p: 6,  note: 'the million' },
    { u: 'GB', p: 9,  note: 'the billion' },
    { u: 'TB', p: 12, note: 'the present moment' },
    { u: 'PB', p: 15, note: 'the quadrillion' },
    { u: 'EB', p: 18, note: 'the whole coin' }
  ];

  function paintLadder(wei) {
    var lad = el('conv-ladder'), cap = el('conv-scale');
    if (!lad || !cap) return;
    var cells = lad.children, i;
    if (wei === null || wei <= 0n) {
      for (i = 0; i < cells.length; i++) cells[i].className = '';
      cap.textContent = 'enter an amount — the ladder places its wei on the rungs from the byte to the exabyte';
      return;
    }
    var s = wei.toString();
    var exp = s.length - 1;                                   // floor(log10)
    var rung = Math.min(Math.floor(exp / 3), 6);
    for (i = 0; i < cells.length; i++) {
      cells[i].className = i < rung ? 'lit' : (i === rung ? 'on' : '');
    }
    var mant = s.charAt(0) + (s.length > 1 ? '.' + s.slice(1, 4) : '');
    var r = RUNGS[rung];
    var line = '≈ ' + mant + ' × 10^' + exp + ' wei — the ' + (rung === 6 && exp > 18 ? 'beyond-exabyte reach' : r.u + ' rung (' + r.note + ')');
    cap.textContent = line + ' · 10¹⁸ wei = 1 EB = 1 whole ETH';
  }

  function paintRates() {
    var r1 = el('conv-r1'), r2 = el('conv-r2'), src = el('conv-src');
    if (!r1) return;
    // 1 LUV in wei (18-dp): num·10³⁶/den atto-wei · 1 WEI in LUV: den/num atto-LUV
    r1.textContent = '1 LUV = ' + fromAtto((num * E18 * E18) / den) + ' WEI · 1 WEI = ' + fromAtto(den / num) + ' LUV';
    // 1 ETH in LUV: den·10¹⁸/num atto · 1 LUV in ETH: num·10¹⁸/den atto
    r2.textContent = '1 ETH = ' + fromAtto((den * E18) / num) + ' LUV · 1 LUV = ' + fromAtto((num * E18) / den) + ' ETH';
    if (src) src.textContent = live
      ? 'live — the price is created by the liquidity pair · seed was exactly 10 WEI per LUV'
      : 'seed price — exactly 10 WEI per LUV (live pair loading…)';
  }

  function recompute() {
    var luv = el('conv-luv'), eth = el('conv-eth'), wei = el('conv-wei');
    if (!luv) return;
    var luvAtto = null, ethAtto = null;
    if (lastEdited === 'luv') {
      luvAtto = toAtto(luv.value);
      if (luvAtto !== null) {
        ethAtto = luvToEthAtto(luvAtto);
        eth.value = fromAtto(ethAtto);
        wei.value = group(ethAtto.toString());
      } else { eth.value = ''; wei.value = ''; }
    } else if (lastEdited === 'eth') {
      ethAtto = toAtto(eth.value);
      if (ethAtto !== null) {
        luv.value = fromAtto(ethAttoToLuv(ethAtto));
        wei.value = group(ethAtto.toString());
      } else { luv.value = ''; wei.value = ''; }
    } else {
      ethAtto = toWei(wei.value);
      if (ethAtto !== null) {
        eth.value = fromAtto(ethAtto);
        luv.value = fromAtto(ethAttoToLuv(ethAtto));
      } else { luv.value = ''; eth.value = ''; }
    }
    paintLadder(ethAtto);
  }

  function refresh() {
    fetch('market.json', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.text() : null; })
      .then(function (text) {
        if (!text) return;
        var p = parsePriceNative(text);
        if (!p) return;
        num = p.n; den = p.d; live = true;
        paintRates();
        recompute();
      })
      .catch(function () { /* seed price stands */ });
  }

  function boot() {
    var luv = el('conv-luv'), eth = el('conv-eth'), wei = el('conv-wei');
    if (!luv || !eth || !wei) return;
    luv.addEventListener('input', function () { lastEdited = 'luv'; recompute(); });
    eth.addEventListener('input', function () { lastEdited = 'eth'; recompute(); });
    wei.addEventListener('input', function () { lastEdited = 'wei'; recompute(); });
    // default: one trillion LUV — a million millions, the measure of value
    luv.value = '1,000,000,000,000';
    paintRates();
    recompute();
    refresh();
    setInterval(refresh, REFRESH_MS);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
