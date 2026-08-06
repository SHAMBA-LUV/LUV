/*!
 * SHAMBA LUV — LUVbus operator console (luvbus.html).
 * Diagnostics + ABI interaction for contracts/LUVbus.sol, zero dependencies:
 * hand-rolled ABI encoding over window.ethereum only (CSP connect-src 'self' —
 * no third-party RPC ever leaves this page; the wallet's provider is the rail).
 * Selectors are compiler truth (solc --hashes on LUVbus.sol).
 */
(function () {
  'use strict';

  var LUV = '0x2711111111683B8708cb9a48cBf36a51315F8254';
  var E18 = 1000000000000000000n;

  var SEL = {
    owner: '0x8da5cb5b', pendingOwner: '0xe30c3978', paused: '0x5c975abb',
    retired: '0x2eb38ae0', maxBatchSize: '0x2913daa0', defaultAmount: '0x38129062',
    balanceOf: '0x70a08231',
    msVar: '0x82d15ac7', msUniform: '0x32c49072', msDefault: '0xad7403c8', msSplit: '0xc953b55b',
    msNatVar: '0xccddee3d', msNatUniform: '0xb7c6c1e2', msNatSplit: '0x39e7368f',
    setMax: '0x2b26a6bf', setDefault: '0x038a5233', setPaused: '0x16c38b3c',
    retire: '0xa4874d77', renounce: '0x715018a6',
    transferOwnership: '0xf2fde38b', transferDirect: '0xcc6644cc',
    withdrawERC20: '0x44004cc1'
  };

  function el(id) { return document.getElementById(id); }
  var eth = function () { return window.ethereum || null; };
  var account = null;
  var ownerAddr = null;

  // ── encoding ──────────────────────────────────────────────────────────────
  function isAddr(s) { return /^0x[0-9a-fA-F]{40}$/.test((s || '').trim()); }
  function word(hexNo0x) { return hexNo0x.padStart(64, '0'); }
  function encAddr(a) { return word(a.trim().slice(2).toLowerCase()); }
  function encUint(v) { return word(BigInt(v).toString(16)); }
  function encAddrArray(list) {
    var out = encUint(list.length);
    for (var i = 0; i < list.length; i++) out += encAddr(list[i]);
    return out;
  }
  function encUintArray(list) {
    var out = encUint(list.length);
    for (var i = 0; i < list.length; i++) out += encUint(list[i]);
    return out;
  }
  // decimal string (18dp) → BigInt base units
  function toAtto(s) {
    s = (s || '').replace(/[,\s_]/g, '');
    if (s === '' || s === '.' || !/^\d*\.?\d*$/.test(s)) return null;
    var p = s.split('.');
    var frac = (p[1] || '').slice(0, 18);
    while (frac.length < 18) frac += '0';
    return BigInt(p[0] || '0') * E18 + BigInt(frac);
  }
  function group(s) { return s.replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function fromAtto(a) { return group((a / E18).toString()) + '.' + (a % E18).toString().padStart(18, '0'); }

  // ── provider plumbing ─────────────────────────────────────────────────────
  function call(to, data) {
    return eth().request({ method: 'eth_call', params: [{ to: to, data: data }, 'latest'] });
  }
  function send(to, data, valueAtto) {
    var tx = { from: account, to: to, data: data };
    if (valueAtto && valueAtto > 0n) tx.value = '0x' + valueAtto.toString(16);
    return eth().request({ method: 'eth_sendTransaction', params: [tx] });
  }
  function hexAddr(res) { return '0x' + res.slice(-40); }
  function hexUint(res) { return BigInt(res === '0x' ? '0x0' : res); }

  function busAddr() {
    var a = el('bus-addr').value.trim();
    return isAddr(a) ? a : null;
  }
  function status(id, msg, cls) {
    var e = el(id); if (!e) return;
    e.textContent = msg; e.className = 'status' + (cls ? ' ' + cls : '');
  }

  // ── diagnostics ───────────────────────────────────────────────────────────
  function refreshLinks() {
    var bus = busAddr();
    var base = 'https://etherscan.io/address/' + (bus || LUV);
    el('l-code').href = base + (bus ? '#code' : '');
    el('l-read').href = base + '#readContract';
    el('l-write').href = base + '#writeContract';
  }
  var CHAINS = { 1: 'Ethereum', 137: 'Polygon (POL)', 42161: 'Arbitrum One', 10: 'OP Mainnet' };
  function showChain() {
    if (!eth()) return;
    eth().request({ method: 'eth_chainId' }).then(function (r) {
      var id = Number(BigInt(r));
      var v = el('d-chain');
      v.textContent = (CHAINS[id] || 'chain id ' + id) +
        (id === 1 ? '' : ' — the rail is chain-aware (chainId()); Etherscan links here point at Ethereum mainnet');
      v.className = 'v' + (id === 1 ? ' ok' : '');
    }).catch(function () { /* provider quiet */ });
  }

  function refresh() {
    refreshLinks();
    showChain();
    var bus = busAddr();
    if (!eth()) { status('s-admin', 'no wallet provider found — install a wallet to drive the bus', 'err'); return; }
    if (!bus) { status('s-admin', 'set the LUVbus contract address first (deploy contracts/LUVbus.sol)', ''); return; }
    try { localStorage.setItem('luvbus-address', bus); } catch (e) { /* private mode */ }
    call(bus, SEL.owner).then(function (r) {
      ownerAddr = hexAddr(r);
      el('d-owner').textContent = ownerAddr;
      gate();
    }).catch(fail);
    call(bus, SEL.pendingOwner).then(function (r) { el('d-pending').textContent = hexAddr(r); }).catch(fail);
    call(bus, SEL.paused).then(function (r) {
      var p = hexUint(r) !== 0n;
      var v = el('d-paused'); v.textContent = p ? 'YES — sending blocked' : 'no';
      v.className = 'v' + (p ? ' warn' : ' ok');
    }).catch(fail);
    call(bus, SEL.retired).then(function (r) {
      var p = hexUint(r) !== 0n;
      var v = el('d-retired'); v.textContent = p ? 'RETIRED FOREVER' : 'no';
      v.className = 'v' + (p ? ' warn' : ' ok');
    }).catch(fail);
    call(bus, SEL.maxBatchSize).then(function (r) { el('d-max').textContent = hexUint(r).toString(); }).catch(fail);
    call(bus, SEL.defaultAmount + encAddr(LUV)).then(function (r) {
      el('d-default').textContent = fromAtto(hexUint(r)) + ' LUV';
    }).catch(fail);
    call(LUV, SEL.balanceOf + encAddr(bus)).then(function (r) {
      el('d-luv').textContent = fromAtto(hexUint(r)) + ' LUV';
    }).catch(fail);
    eth().request({ method: 'eth_getBalance', params: [bus, 'latest'] }).then(function (r) {
      el('d-eth').textContent = fromAtto(hexUint(r)) + ' ETH';
    }).catch(fail);
  }
  function fail(e) { status('s-admin', 'read failed: ' + (e && e.message ? e.message : e), 'err'); }
  function gate() {
    var g = el('d-gate');
    if (!account || !ownerAddr) { g.textContent = '—'; g.className = 'v'; return; }
    var isOwner = account.toLowerCase() === ownerAddr.toLowerCase();
    g.textContent = isOwner ? 'OPERATOR ✓ — you are the owner' : 'read-only — connected wallet is not the owner';
    g.className = 'v' + (isOwner ? ' ok' : ' warn');
  }

  function connect() {
    if (!eth()) { status('s-admin', 'no wallet provider found', 'err'); return; }
    eth().request({ method: 'eth_requestAccounts' }).then(function (accts) {
      account = accts && accts[0];
      el('d-acct').textContent = account || '—';
      gate(); refresh();
    }).catch(function (e) { status('s-admin', 'connect rejected: ' + (e && e.message), 'err'); });
  }

  // ── recipients parsing ────────────────────────────────────────────────────
  function parseRecipients(text, withAmounts) {
    var lines = (text || '').split(/[\n;]+/).map(function (l) { return l.trim(); }).filter(Boolean);
    var addrs = [], amts = [];
    for (var i = 0; i < lines.length; i++) {
      var parts = lines[i].split(/[,\t ]+/).filter(Boolean);
      if (!isAddr(parts[0])) return { err: 'line ' + (i + 1) + ': bad address' };
      addrs.push(parts[0]);
      if (withAmounts) {
        var a = toAtto(parts[1]);
        if (a === null || a === 0n) return { err: 'line ' + (i + 1) + ': bad amount' };
        amts.push(a);
      }
    }
    if (!addrs.length) return { err: 'no recipients' };
    return { addrs: addrs, amts: amts };
  }

  // ── ERC20 batch ───────────────────────────────────────────────────────────
  function sendERC20() {
    var bus = busAddr();
    if (!bus || !account) { status('s-erc20', 'connect and set the bus address first', 'err'); return; }
    var token = el('b-token').value.trim();
    if (!isAddr(token)) { status('s-erc20', 'bad token address', 'err'); return; }
    var mode = el('b-mode').value;
    var r = parseRecipients(el('b-recipients').value, mode === 'variable');
    if (r.err) { status('s-erc20', r.err, 'err'); return; }
    var data, amount;
    if (mode === 'variable') {
      // head: token, off1(0x60), off2 · tails: addr[], uint[]
      var off2 = 0x60 + 32 + r.addrs.length * 32;
      data = SEL.msVar + encAddr(token) + encUint(0x60) + encUint(off2) +
             encAddrArray(r.addrs) + encUintArray(r.amts);
    } else if (mode === 'default') {
      data = SEL.msDefault + encAddr(token) + encUint(0x40) + encAddrArray(r.addrs);
    } else {
      amount = toAtto(el('b-amount').value);
      if (amount === null || amount === 0n) { status('s-erc20', 'bad amount', 'err'); return; }
      var sel = mode === 'uniform' ? SEL.msUniform : SEL.msSplit;
      data = sel + encAddr(token) + encUint(0x60) + encUint(amount) + encAddrArray(r.addrs);
    }
    status('s-erc20', 'bus of ' + r.addrs.length + ' seats — confirm in wallet…', '');
    send(bus, data).then(function (h) { status('s-erc20', 'sent · tx ' + h, 'ok'); })
      .catch(function (e) { status('s-erc20', 'failed: ' + (e && e.message), 'err'); });
  }

  // ── native batch ──────────────────────────────────────────────────────────
  function sendNative() {
    var bus = busAddr();
    if (!bus || !account) { status('s-native', 'connect and set the bus address first', 'err'); return; }
    var mode = el('n-mode').value;
    var r = parseRecipients(el('n-recipients').value, mode === 'variable');
    if (r.err) { status('s-native', r.err, 'err'); return; }
    var value = toAtto(el('n-value').value || '0') || 0n;
    var data;
    if (mode === 'variable') {
      var off2 = 0x40 + 32 + r.addrs.length * 32;
      data = SEL.msNatVar + encUint(0x40) + encUint(off2) + encAddrArray(r.addrs) + encUintArray(r.amts);
    } else {
      var amount = toAtto(el('n-amount').value);
      if (amount === null || amount === 0n) { status('s-native', 'bad amount', 'err'); return; }
      var sel = mode === 'uniform' ? SEL.msNatUniform : SEL.msNatSplit;
      data = sel + encUint(0x40) + encUint(amount) + encAddrArray(r.addrs);
    }
    status('s-native', 'confirm in wallet…', '');
    send(bus, data, value).then(function (h) { status('s-native', 'sent · tx ' + h, 'ok'); })
      .catch(function (e) { status('s-native', 'failed: ' + (e && e.message), 'err'); });
  }

  // ── admin ─────────────────────────────────────────────────────────────────
  function admin(data, label, value) {
    var bus = busAddr();
    if (!bus || !account) { status('s-admin', 'connect and set the bus address first', 'err'); return; }
    status('s-admin', label + ' — confirm in wallet…', '');
    send(bus, data, value).then(function (h) { status('s-admin', label + ' sent · tx ' + h, 'ok'); refresh(); })
      .catch(function (e) { status('s-admin', label + ' failed: ' + (e && e.message), 'err'); });
  }

  function boot() {
    try {
      var saved = localStorage.getItem('luvbus-address');
      if (saved && isAddr(saved)) el('bus-addr').value = saved;
    } catch (e) { /* private mode */ }
    refreshLinks();

    el('btn-connect').addEventListener('click', connect);
    el('btn-refresh').addEventListener('click', refresh);
    el('bus-addr').addEventListener('change', refresh);
    el('btn-send-erc20').addEventListener('click', sendERC20);
    el('btn-send-native').addEventListener('click', sendNative);

    el('btn-max').addEventListener('click', function () {
      var v = (el('a-max').value || '').replace(/[,\s]/g, '');
      if (!/^\d+$/.test(v) || v === '0') { status('s-admin', 'bad maxBatchSize', 'err'); return; }
      admin(SEL.setMax + encUint(BigInt(v)), 'setMaxBatchSize');
    });
    el('btn-default').addEventListener('click', function () {
      var a = toAtto(el('a-default').value);
      if (a === null) { status('s-admin', 'bad default amount', 'err'); return; }
      admin(SEL.setDefault + encAddr(el('b-token').value.trim()) + encUint(a), 'setDefaultERC20Amount');
    });
    el('btn-pause').addEventListener('click', function () { admin(SEL.setPaused + encUint(1n), 'pause'); });
    el('btn-unpause').addEventListener('click', function () { admin(SEL.setPaused + encUint(0n), 'unpause'); });
    el('btn-transfer').addEventListener('click', function () {
      var a = el('a-newowner').value.trim();
      if (!isAddr(a)) { status('s-admin', 'bad new-owner address', 'err'); return; }
      admin(SEL.transferOwnership + encAddr(a), 'transferOwnership (2-step)');
    });
    el('btn-transfer-direct').addEventListener('click', function () {
      var a = el('a-newowner').value.trim();
      if (!isAddr(a)) { status('s-admin', 'bad new-owner address', 'err'); return; }
      admin(SEL.transferDirect + encAddr(a), 'transferOwnershipToAddress (direct)');
    });
    el('btn-withdraw').addEventListener('click', function () {
      var to = el('a-wto').value.trim(); var a = toAtto(el('a-wamt').value);
      if (!isAddr(to) || a === null || a === 0n) { status('s-admin', 'bad withdraw to/amount', 'err'); return; }
      admin(SEL.withdrawERC20 + encAddr(LUV) + encAddr(to) + encUint(a), 'withdrawERC20');
    });
    el('btn-sweep').addEventListener('click', function () {
      if (!ownerAddr) { status('s-admin', 'refresh diagnostics first', 'err'); return; }
      var bus = busAddr(); if (!bus) return;
      call(LUV, SEL.balanceOf + encAddr(bus)).then(function (r) {
        var bal = hexUint(r);
        if (bal === 0n) { status('s-admin', 'bus LUV balance is zero', ''); return; }
        admin(SEL.withdrawERC20 + encAddr(LUV) + encAddr(ownerAddr) + encUint(bal), 'sweep all LUV to owner');
      });
    });

    // one-way switches arm only on the typed word — no browser dialogs (CSP + UX)
    el('a-danger').addEventListener('input', function () {
      var w = el('a-danger').value.trim().toUpperCase();
      el('btn-retire').disabled = w !== 'RETIRE';
      el('btn-renounce').disabled = w !== 'RENOUNCE';
    });
    el('btn-retire').addEventListener('click', function () { admin(SEL.retire, 'RETIRE (one-way, pause forever)'); });
    el('btn-renounce').addEventListener('click', function () { admin(SEL.renounce, 'RENOUNCE OWNERSHIP (one-way)'); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
