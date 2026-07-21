'use strict';
/*
 * luv.app.js — the luv.pythai.net doorway, the previous connection flow restored self-hosted.
 *
 * FLOW (the luvdat lineage, no wallet vendor): landing → LOGIN / "connect to collect" →
 * login modal (providers from the backend) → server-side OAuth (full-page redirect; immune
 * to the old mobile OAuth-state bug by construction — the session is a server cookie, no SPA
 * state survives the round-trip because none is needed) → back here with the session cookie →
 * the page swaps to the dashboard: your ERC-4337 smart wallet, balance, gesture status.
 *
 * CSP is `script-src 'self'; connect-src 'self'` — everything is same-origin:
 *   GET  luv.live.json      → launch state + contract addresses (updated post-deploy)
 *   GET  /health            → gesture desk heartbeat
 *   GET  /auth/providers    → which sign-in buttons to render
 *   GET  /auth/me           → session identity + wallet (smartAccount when the AA rail is on)
 *   GET  /airdrop/status    → gesture state + luvBalance (backend proxies all chain reads)
 *   GET  /airdrop/stats     → public landing stats
 *   POST /auth/logout
 */
(function () {
  const $ = (id) => document.getElementById(id);
  const j = async (url, opts) => {
    const r = await fetch(url, Object.assign({ credentials: 'same-origin' }, opts));
    if (!r.ok) throw new Error(url + ' → ' + r.status);
    return r.json();
  };
  const PROVIDER_LABEL = { google: 'Google', discord: 'Discord', github: 'GitHub', apple: 'Apple', x: 'X' };
  const PROVIDER_ICON = { google: 'G', discord: 'D', github: '⌥', apple: '', x: '𝕏' };
  const STEPS = ['queued', 'batching', 'submitted', 'confirmed'];

  let cfg = { status: 'imminent', chainId: 1, explorer: 'https://etherscan.io', contracts: {} };
  let luvAddr = '0x9b46ad18eb135cA8E90895E97fD79F9f7526041B';
  let myWallet = null;
  let balTimer = null;

  // ── format 18-decimal base units → "1,000,000,000,000.0" ──
  function fmtLuv(weiStr) {
    if (weiStr === null || weiStr === undefined) return null;
    try {
      const wei = BigInt(weiStr);
      const whole = wei / 10n ** 18n;
      const frac = ((wei % 10n ** 18n) / 10n ** 14n).toString().padStart(4, '0').replace(/0+$/, '');
      return whole.toLocaleString('en-US') + (frac ? '.' + frac : '');
    } catch (e) { return null; }
  }

  // ── launch state + contract ledger ─────────────────────────────────────────
  async function loadLive() {
    try { cfg = Object.assign(cfg, await j('luv.live.json', { cache: 'no-cache' })); } catch (e) { /* placeholder stands */ }

    const live = cfg.status === 'live';
    const badge = $('statebadge');
    badge.textContent = live ? 'live on ethereum' : 'launch imminent';
    badge.className = 'badge ' + (live ? 'live' : 'imminent');

    luvAddr = (cfg.contracts && cfg.contracts.ShambaLuv) || luvAddr;
    $('luvaddr').textContent = luvAddr;
    $('explorelink').href = cfg.explorer + '/address/' + luvAddr;

    document.querySelectorAll('#ledger .a[data-c]').forEach((el) => {
      const addr = cfg.contracts && cfg.contracts[el.dataset.c];
      if (addr) { el.textContent = addr; el.classList.remove('pending'); }
    });

    if (live && window.ethereum) {
      for (const id of ['addtoken', 'addtoken2']) {
        const btn = $(id);
        btn.hidden = false;
        btn.addEventListener('click', async () => {
          try {
            await window.ethereum.request({
              method: 'wallet_watchAsset',
              params: { type: 'ERC20', options: { address: luvAddr, symbol: 'LUV', decimals: 18 } },
            });
          } catch (e) { /* user closed the wallet prompt */ }
        });
      }
    }
  }

  // ── gesture desk heartbeat ─────────────────────────────────────────────────
  async function loadHealth() {
    try {
      await j('/health');
      $('healthdot').classList.add('up');
      $('healthtext').textContent = 'gesture desk open';
      return true;
    } catch (e) {
      $('healthtext').textContent = 'gesture desk opens at launch';
      return false;
    }
  }

  // ── landing live stats (the old LiveStats grid, via the backend) ───────────
  async function loadStats() {
    try {
      const s = await j('/airdrop/stats');
      if (typeof s.gesturesDelivered === 'number') $('stat-delivered').textContent = s.gesturesDelivered.toLocaleString('en-US');
      if (typeof s.gesturesAboard === 'number') $('stat-aboard').textContent = s.gesturesAboard.toLocaleString('en-US');
      if (typeof s.gesturesRemaining === 'number') $('stat-remaining').textContent = s.gesturesRemaining.toLocaleString('en-US');
    } catch (e) {
      $('stat-delivered').textContent = '0';
      $('stat-aboard').textContent = '0';
      $('stat-remaining').textContent = '1,000';
    }
  }

  // ── login modal ────────────────────────────────────────────────────────────
  function openModal() { $('loginmodal').classList.add('open'); }
  function closeModal() { $('loginmodal').classList.remove('open'); }

  async function loadProviders() {
    let providers = [];
    try { providers = (await j('/auth/providers')).providers || []; } catch (e) { /* desk closed */ }
    const box = $('modalproviders');
    if (providers.length) {
      box.replaceChildren(...providers.map((p) => {
        const a = document.createElement('a');
        a.href = '/auth/' + p;
        const icon = document.createElement('b');
        icon.textContent = PROVIDER_ICON[p] || '·';
        a.append(icon, ' Sign in with ' + (PROVIDER_LABEL[p] || p));
        return a;
      }));
      // mirror into the landing CTA card
      $('providers').replaceChildren(...providers.map((p) => {
        const a = document.createElement('a');
        a.href = '/auth/' + p;
        a.textContent = 'Sign in with ' + (PROVIDER_LABEL[p] || p);
        return a;
      }));
    }
  }

  // ── dashboard (signed in) ──────────────────────────────────────────────────
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
    } else if (state === 'failed') {
      line.textContent = 'The last delivery attempt failed — it retries automatically; check back soon.';
    } else if (s.queue && typeof s.queue.depth === 'number') {
      line.textContent = s.queue.depth + ' rider' + (s.queue.depth === 1 ? '' : 's') +
        ' waiting for the next luvbus — one transaction delivers everyone’s gesture at once.';
    } else {
      line.textContent = 'You’re aboard the next luvbus.';
    }

    const bal = fmtLuv(s.luvBalance);
    if (bal !== null) {
      $('balance').innerHTML = '';
      $('balance').append(bal, Object.assign(document.createElement('small'), { textContent: ' LUV' }));
    }
  }

  async function refreshStatus() {
    try { renderStatus(await j('/airdrop/status')); } catch (e) { /* keep last */ }
  }

  async function loadSession() {
    let me;
    try { me = await j('/auth/me'); } catch (e) { return false; } // not signed in
    document.body.classList.add('authed');
    $('youprovider').textContent = PROVIDER_LABEL[me.provider] || me.provider || '—';
    myWallet = me.walletAddress || null;
    $('youwallet').textContent = myWallet || 'provisioning…';
    if (myWallet) $('walletexplorer').href = cfg.explorer + '/address/' + myWallet;
    if (me.smartAccount) {
      $('aatag').hidden = false;
      if (me.ownerAddress) {
        $('ownerline').hidden = false;
        $('ownerline').textContent = 'owner key ' + me.ownerAddress + ' — encrypted at rest, migrating to your custody';
      }
    }
    await refreshStatus();
    // the old dashboard refreshed the balance every 30s while visible
    if (!balTimer) balTimer = setInterval(() => { if (!document.hidden) refreshStatus(); }, 30000);
    return true;
  }

  // ── wire the controls ──────────────────────────────────────────────────────
  for (const id of ['loginbtn', 'collectbtn']) $(id).addEventListener('click', openModal);
  document.querySelectorAll('[data-open-login]').forEach((el) => el.addEventListener('click', openModal));
  $('modalclose').addEventListener('click', closeModal);
  $('loginmodal').addEventListener('click', (e) => { if (e.target === $('loginmodal')) closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

  $('copyaddr').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(luvAddr);
      $('copyaddr').textContent = 'copied ❤';
      setTimeout(() => { $('copyaddr').textContent = 'copy'; }, 1600);
    } catch (e) { /* clipboard blocked */ }
  });
  $('copywallet').addEventListener('click', async () => {
    if (!myWallet) return;
    try {
      await navigator.clipboard.writeText(myWallet);
      $('copywallet').textContent = 'copied ❤';
      setTimeout(() => { $('copywallet').textContent = 'copy'; }, 1600);
    } catch (e) { /* clipboard blocked */ }
  });
  $('refreshbal').addEventListener('click', refreshStatus);
  $('logout').addEventListener('click', async () => {
    try { await j('/auth/logout', { method: 'POST' }); } catch (e) { /* cookie cleared anyway */ }
    location.reload();
  });

  // OAuth failure bounce (FRONTEND_FAILURE_URL = /?error=auth): reopen the modal so the
  // user can retry immediately.
  if (new URLSearchParams(location.search).get('error') === 'auth') openModal();

  // ── boot ───────────────────────────────────────────────────────────────────
  loadLive();
  loadHealth();
  loadStats();
  loadProviders();
  loadSession();
})();
