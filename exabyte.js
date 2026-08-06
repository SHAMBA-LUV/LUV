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
  // USD per LUV as an exact rational un/ud (median ETH/USD via the collector) — $ mode only.
  var un = 0n, ud = 1n;
  var lastEdited = 'luv';
  // the rate-expression toggle: $ USDC · WEI/LUV · ETH/LUV · LUV/ETH
  var MODES = ['usdc', 'wei', 'ethluv', 'luveth'];
  var mode = 'wei';
  try { var m0 = localStorage.getItem('luv-conv-mode'); if (MODES.indexOf(m0) >= 0) mode = m0; } catch (e) { /* private */ }

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

  // parse a numeric field from the raw JSON text — exact, no float in the path
  function parseRational(text, field) {
    var m = new RegExp('"' + field + '"\\s*:\\s*([0-9]+)(?:\\.([0-9]+))?(?:[eE](-?[0-9]+))?').exec(text);
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

  function cut(dec18, places) {   // display-only trim of an 18-dp string
    var i = dec18.indexOf('.');
    return i < 0 ? dec18 : dec18.slice(0, i + 1 + places);
  }
  function paintRates() {
    var r1 = el('conv-r1'), r2 = el('conv-r2'), src = el('conv-src');
    if (!r1) return;
    var pnF = Number(num) / Number(den);                       // display-only floats
    var weiPerLuv = fromAtto((num * E18 * E18) / den);         // 18-dp exact strings
    var luvPerWei = fromAtto(den / num);
    var luvPerEth = fromAtto((den * E18) / num);
    var ethPerLuv = fromAtto((num * E18) / den);
    var luvPerEthT = fromAtto((den * E18) / (num * pow10(12)));
    if (mode === 'usdc') {
      if (un > 0n) {
        var usd1T = fromAtto((un * pow10(12) * E18) / ud);     // $ per 1T LUV, 18-dp exact
        r1.textContent = '1T LUV = $' + cut(usd1T, 6) + ' USDC · 1 LUV = $' + (Number(un) / Number(ud)).toExponential(4);
      } else {
        r1.textContent = '$ — the dollar expression rides the live feed (loading…)';
      }
    } else if (mode === 'ethluv') {
      r1.textContent = '1 LUV = ' + ethPerLuv + ' ETH · = ' + pnF.toExponential(6) + ' ETH (native, full precision)';
    } else if (mode === 'luveth') {
      r1.textContent = '1 ETH = ' + luvPerEth + ' LUV · = ' + cut(luvPerEthT, 4) + 'T LUV';
    } else {
      r1.textContent = '1 LUV = ' + weiPerLuv + ' WEI · 1 WEI = ' + luvPerWei + ' LUV';
    }
    // the identities, whatever the toggle says
    r2.textContent = '⚖ 1 LUV = ' + cut(weiPerLuv, 6) + ' WEI = ' + pnF.toExponential(4) +
      ' ETH · 1 ETH = ' + cut(luvPerEthT, 4) + 'T LUV';
    if (src) src.textContent = live
      ? 'live — the price is created by the liquidity pair · seed was exactly 10 WEI per LUV'
      : 'seed price — exactly 10 WEI per LUV (live pair loading…)';
  }
  function paintModes() {
    var btns = document.querySelectorAll('#conv-modes button');
    btns.forEach(function (b) {
      var on = b.getAttribute('data-m') === mode;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });
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
        var p = parseRational(text, 'priceNative');
        if (!p) return;
        num = p.n; den = p.d; live = true;
        var u = parseRational(text, 'priceUsd');
        if (u) { un = u.n; ud = u.d; }
        paintRates();
        recompute();
      })
      .catch(function () { /* seed price stands */ });
  }

  function boot() {
    var luv = el('conv-luv'), eth = el('conv-eth'), wei = el('conv-wei');
    if (!luv || !eth || !wei) return;
    document.querySelectorAll('#conv-modes button').forEach(function (b) {
      b.addEventListener('click', function () {
        mode = b.getAttribute('data-m');
        try { localStorage.setItem('luv-conv-mode', mode); } catch (e) { /* private */ }
        paintModes(); paintRates();
      });
    });
    paintModes();
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
