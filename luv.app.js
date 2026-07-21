'use strict';
/*
 * luv.app.js — the luv.pythai.net doorway, wired to the self-hosted backend.
 *
 * CSP is `script-src 'self'; connect-src 'self'` — everything here is same-origin:
 *   GET  luv.live.json      → launch state + contract addresses (updated post-deploy)
 *   GET  /health            → backend heartbeat
 *   GET  /auth/providers    → which sign-in buttons to render
 *   GET  /auth/me           → session identity + provisioned wallet
 *   GET  /airdrop/status    → gesture state: queued → batching → submitted → confirmed
 *   POST /auth/logout
 * The browser never talks to third-party RPCs from this origin; chain facts arrive
 * via luv.live.json, recorded from deploy/luv-create2.json at launch.
 */
(function () {
  const $ = (id) => document.getElementById(id);
  const j = async (url, opts) => {
    const r = await fetch(url, Object.assign({ credentials: 'same-origin' }, opts));
    if (!r.ok) throw new Error(url + ' → ' + r.status);
    return r.json();
  };
  const PROVIDER_LABEL = { google: 'Google', discord: 'Discord', github: 'GitHub' };
  const STEPS = ['queued', 'batching', 'submitted', 'confirmed'];

  let cfg = {
    status: 'imminent',
    chainId: 1,
    explorer: 'https://etherscan.io',
    contracts: {},
  };

  // ── launch state + contract ledger ─────────────────────────────────────────
  async function loadLive() {
    try {
      cfg = Object.assign(cfg, await j('luv.live.json', { cache: 'no-cache' }));
    } catch (e) { /* placeholder state stands */ }

    const live = cfg.status === 'live';
    const badge = $('statebadge');
    badge.textContent = live ? 'live on ethereum' : 'launch imminent';
    badge.className = 'badge ' + (live ? 'live' : 'imminent');

    const luv = (cfg.contracts && cfg.contracts.ShambaLuv) || $('luvaddr').textContent.trim();
    $('luvaddr').textContent = luv;
    $('explorelink').href = cfg.explorer + '/address/' + luv;

    document.querySelectorAll('#ledger .a[data-c]').forEach((el) => {
      const addr = cfg.contracts && cfg.contracts[el.dataset.c];
      if (addr) { el.textContent = addr; el.classList.remove('pending'); }
    });

    // Add-to-wallet only once LUV is really on-chain and a wallet is present.
    if (live && window.ethereum) {
      const btn = $('addtoken');
      btn.hidden = false;
      btn.addEventListener('click', async () => {
        try {
          await window.ethereum.request({
            method: 'wallet_watchAsset',
            params: { type: 'ERC20', options: { address: luv, symbol: 'LUV', decimals: 18 } },
          });
        } catch (e) { /* user closed the wallet prompt */ }
      });
    }
  }

  // ── backend heartbeat ──────────────────────────────────────────────────────
  async function loadHealth() {
    try {
      await j('/health');
      $('healthdot').classList.add('up');
      $('healthtext').textContent = 'gesture desk open';
    } catch (e) {
      $('healthtext').textContent = 'gesture desk opens at launch';
    }
  }

  // ── sign-in buttons from what the backend actually has enabled ─────────────
  async function loadProviders() {
    try {
      const { providers } = await j('/auth/providers');
      if (Array.isArray(providers) && providers.length) {
        $('providers').replaceChildren(...providers.map((p) => {
          const a = document.createElement('a');
          a.href = '/auth/' + p;
          a.textContent = 'Sign in with ' + (PROVIDER_LABEL[p] || p);
          return a;
        }));
      }
    } catch (e) { /* static defaults stand */ }
  }

  // ── session + gesture status ───────────────────────────────────────────────
  function renderStatus(s) {
    const state = (s.claim && s.claim.status) || (s.claimed ? 'confirmed' : 'queued');
    const at = Math.max(0, STEPS.indexOf(state));
    document.querySelectorAll('#timeline .step').forEach((el) => {
      const i = STEPS.indexOf(el.dataset.step);
      el.className = 'step' + (i < at ? ' done' : i === at ? (state === 'confirmed' ? ' done' : ' now') : '');
    });
    const line = $('statusline');
    if (state === 'confirmed') {
      line.innerHTML = '❤ Delivered — <b>1,000,000,000,000 LUV</b> is yours. Hold it and watch it grow.';
    } else if (state === 'submitted') {
      line.textContent = 'The luvbus is on-chain — your trillion arrives with the next confirmation.';
    } else if (s.queue && typeof s.queue.depth === 'number') {
      line.textContent = s.queue.depth + ' rider' + (s.queue.depth === 1 ? '' : 's') +
        ' waiting for the next luvbus — one transaction delivers everyone’s gesture at once.';
    } else {
      line.textContent = 'You’re aboard the next luvbus.';
    }
  }

  async function loadSession() {
    let me;
    try { me = await j('/auth/me'); } catch (e) { return; } // not signed in
    $('you').style.display = 'block';
    $('providers').style.display = 'none';
    $('youprovider').textContent = PROVIDER_LABEL[me.provider] || me.provider || '—';
    $('youwallet').textContent = me.walletAddress || 'provisioning…';
    try { renderStatus(await j('/airdrop/status')); } catch (e) { /* backend will catch up */ }
  }

  // ── wire the buttons ───────────────────────────────────────────────────────
  $('copyaddr').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText($('luvaddr').textContent.trim());
      $('copyaddr').textContent = 'copied ❤';
      setTimeout(() => { $('copyaddr').textContent = 'copy'; }, 1600);
    } catch (e) { /* clipboard blocked */ }
  });
  $('refreshstatus').addEventListener('click', async () => {
    try { renderStatus(await j('/airdrop/status')); } catch (e) { /* keep last */ }
  });
  $('logout').addEventListener('click', async () => {
    try { await j('/auth/logout', { method: 'POST' }); } catch (e) { /* cookie cleared anyway */ }
    location.reload();
  });

  loadLive();
  loadHealth();
  loadProviders();
  loadSession();
})();
