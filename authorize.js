'use strict';
/*
 * authorize.js — one-click owner action: point ShambaLuvAirdrop.signer at the platform signer so
 * claims deliver. Only bankon.eth (owner) succeeds; anyone else's tx reverts (onlyOwner). No libs
 * (CSP script-src 'self'): a raw eth_sendTransaction with the fixed setSigner calldata.
 */
(function () {
  var AIRDROP = '0xdf2C1836550c5711EF9c021cB0de86241dc1DEf3';
  var OWNER = '0x10f7Ee226B16bea7f365Dc1eDEF159Fc1957D169';
  // setSigner(0xD7c34d28c748ceF3F83539268C07b417B86543Ff)
  var DATA = '0x6c19e783000000000000000000000000d7c34d28c748cef3f83539268c07b417b86543ff';
  var btn = document.getElementById('go');
  var msg = document.getElementById('msg');
  function set(t, cls) { msg.className = cls || ''; msg.textContent = t; }

  btn.addEventListener('click', async function () {
    if (!window.ethereum) {
      set('No wallet detected. Open this page in the MetaMask app browser, or install MetaMask on desktop, using the bankon.eth wallet.', 'err');
      return;
    }
    btn.disabled = true;
    try {
      try { await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x1' }] }); } catch (e) {}
      var accs = await window.ethereum.request({ method: 'eth_requestAccounts' });
      var from = accs[0];
      if (from && from.toLowerCase() !== OWNER.toLowerCase()) {
        set('This wallet (' + from.slice(0, 8) + '…' + from.slice(-4) + ') is NOT bankon.eth. Switch to the owner account ' + OWNER.slice(0, 8) + '…' + OWNER.slice(-4) + ' and try again.', 'err');
        btn.disabled = false; return;
      }
      set('confirm the transaction in your wallet…');
      var tx = await window.ethereum.request({ method: 'eth_sendTransaction', params: [{ from: from, to: AIRDROP, data: DATA }] });
      set('✓ authorized — tx ' + tx.slice(0, 12) + '… Once it confirms, every claim will deliver automatically (gas paid by the gas tank). You can close this page.', 'ok');
    } catch (e) {
      set(String(e && e.code) === '4001'
        ? 'cancelled — nothing was sent.'
        : 'failed: ' + ((e && (e.shortMessage || e.message)) || e) + '  (only bankon.eth, the owner, can authorize)', 'err');
      btn.disabled = false;
    }
  });
})();
