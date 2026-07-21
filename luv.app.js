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
  const PROVIDER_LABEL = { google: 'Google', discord: 'Discord', github: 'GitHub', apple: 'Apple', x: 'X', metamask: 'MetaMask' };
  const PROVIDER_ICON = { google: 'G', discord: 'D', github: '⌥', apple: '', x: '𝕏' };
  let myProvider = null;
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

  // ── MetaMask sign-in: challenge → personal_sign → verify → session cookie ──
  async function metamaskLogin(msgEl) {
    try {
      if (!window.ethereum) {
        // no injected wallet (mobile browser) → reopen inside the MetaMask in-app browser
        location.href = 'https://metamask.app.link/dapp/' + location.host + location.pathname;
        return;
      }
      msgEl.textContent = 'open MetaMask to connect…';
      const [address] = await window.ethereum.request({ method: 'eth_requestAccounts' });
      const { message, challengeToken } = await j('/auth/wallet/challenge', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address }),
      });
      msgEl.textContent = 'sign the message to prove the wallet is yours…';
      const signature = await window.ethereum.request({ method: 'personal_sign', params: [message, address] });
      await j('/auth/wallet/verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, signature, challengeToken }),
      });
      location.reload(); // session cookie set — the page swaps to the dashboard
    } catch (e) {
      msgEl.textContent = String(e && e.code) === '4001'
        ? 'signature declined — nothing was sent'
        : 'that didn’t go through — try again';
    }
  }

  function socialButton(p, plain) {
    const a = document.createElement('a');
    a.href = '/auth/' + p;
    if (!plain) {
      const icon = document.createElement('b');
      icon.textContent = PROVIDER_ICON[p] || '·';
      a.append(icon, ' Sign in with ' + (PROVIDER_LABEL[p] || p));
    } else {
      a.textContent = 'Sign in with ' + (PROVIDER_LABEL[p] || p);
    }
    return a;
  }

  async function loadProviders() {
    // The live social providers; google+github are the shipped defaults if the desk is quiet.
    let providers = ['google', 'github'];
    try {
      const r = await j('/auth/providers');
      if (Array.isArray(r.providers) && r.providers.length) providers = r.providers;
    } catch (e) { /* fall back to the shipped pair */ }

    // The expanded connect dialog: social sign-ins, then the wallet path.
    const or = document.createElement('div');
    or.className = 'or';
    or.textContent = 'or connect a wallet';
    const mm = document.createElement('button');
    mm.type = 'button';
    const fox = document.createElement('b');
    fox.textContent = '🦊';
    mm.append(fox, ' Sign in with MetaMask');
    const msg = document.createElement('div');
    msg.className = 'taskmsg';
    mm.addEventListener('click', () => metamaskLogin(msg));
    $('modalproviders').replaceChildren(...providers.map((p) => socialButton(p)), or, mm, msg);

    // mirror the social options into the landing CTA card (the airdrop needs a social identity)
    $('providers').replaceChildren(...providers.map((p) => socialButton(p, true)));
  }

  // ── dashboard (signed in) ──────────────────────────────────────────────────
  function renderStatus(s) {
    // Wallet sign-ins have no gesture claim — the airdrop's Sybil unit is a social identity.
    if (!s.claim && !s.claimed && myProvider === 'metamask') {
      document.querySelectorAll('#timeline .step').forEach((el) => { el.className = 'step'; });
      $('statusline').textContent =
        'the free airdrop rides with social sign-ins — sign in with Google or GitHub to receive the gesture ❤';
      const bal0 = fmtLuv(s.luvBalance);
      if (bal0 !== null) {
        $('balance').innerHTML = '';
        $('balance').append(bal0, Object.assign(document.createElement('small'), { textContent: ' LUV' }));
      }
      return;
    }
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

  // ── the tasks widget (IncentiveDistributor actions) ────────────────────────
  // Human units for registry rewards: 1e30 → "1 Trillion".
  function fmtReward(weiStr) {
    try {
      const t = BigInt(weiStr) / 10n ** 18n;
      if (t >= 10n ** 12n && t % 10n ** 12n === 0n) return (t / 10n ** 12n).toString() + ' Trillion';
      if (t >= 10n ** 9n && t % 10n ** 9n === 0n) return (t / 10n ** 9n).toString() + ' Billion';
      return t.toLocaleString('en-US');
    } catch (e) { return '—'; }
  }
  const SUB_CHIP = {
    queued: 'under review', approved: 'approved', paid: 'paid ❤',
    failed: 'failed', rejected: 'rejected',
  };
  const SUBMIT_ERR = {
    already_submitted: 'that proof is already in — each link counts once',
    bad_proof_url: 'paste the full https:// link to your post',
    inactive_action: 'this action is paused right now',
    unknown_action: 'unknown action',
    not_submittable: 'this one is delivered automatically',
  };

  function renderSubs(subs) {
    const box = $('mysubs');
    if (!subs.length) return;
    box.replaceChildren(...subs.map((s) => {
      const row = document.createElement('div');
      row.className = 'sub';
      const act = Object.assign(document.createElement('span'), { className: 'act', textContent: s.action });
      const chip = Object.assign(document.createElement('span'), { className: 'chip ' + s.status, textContent: SUB_CHIP[s.status] || s.status });
      const amt = Object.assign(document.createElement('span'), { textContent: fmtReward(s.amount) + ' LUV' });
      row.append(act, chip, amt);
      if (s.tx_hash) {
        const a = document.createElement('a');
        a.href = cfg.explorer + '/tx/' + s.tx_hash; a.rel = 'noopener';
        a.textContent = s.tx_hash.slice(0, 10) + '…';
        row.append(a);
      }
      const proof = document.createElement('a');
      proof.href = s.proof_url; proof.rel = 'noopener';
      proof.textContent = (s.platform || 'proof') + ' ↗';
      row.append(proof);
      return row;
    }));
  }

  async function refreshMine() {
    try {
      const mine = await j('/airdrop/actions/mine');
      renderSubs(mine.submissions || []);
      return mine;
    } catch (e) { return { submissions: [], stats: {} }; }
  }

  async function loadTasks() {
    let reg;
    try { reg = await j('/airdrop/actions'); } catch (e) {
      $('tasklist').replaceChildren(Object.assign(document.createElement('div'),
        { className: 'taskmsg', textContent: 'the tasks desk opens at launch' }));
      return;
    }
    const mine = await refreshMine();
    const tasks = (reg.actions || []).filter((a) => a.active && !a.oneTime);
    const PROMPT = {
      tweet: 'tweet some LUV — paste the link to your tweet',
      post: 'post about LUV anywhere — paste the link to your post',
      interaction: 'engage with the community — paste the link (reply, share, star…)',
    };
    $('tasklist').replaceChildren(...tasks.map((a) => {
      const el = document.createElement('div');
      el.className = 'task';
      const head = document.createElement('div');
      head.className = 'taskhead';
      const stat = (mine.stats || {})[a.name];
      const today = stat ? stat.countToday : 0;
      head.append(
        Object.assign(document.createElement('span'), { className: 'name', textContent: a.name }),
        Object.assign(document.createElement('span'), { className: 'reward', textContent: fmtReward(a.reward) + ' LUV' }),
        Object.assign(document.createElement('span'), { className: 'lim', textContent: (a.dailyLimit ? today + '/' + a.dailyLimit + ' today' : 'unlimited') + (a.cooldown ? ' · ' + (a.cooldown >= 60 ? (a.cooldown / 60) + 'm' : a.cooldown + 's') + ' cooldown' : '') })
      );
      const form = document.createElement('div');
      form.className = 'taskform';
      const input = document.createElement('input');
      input.type = 'url'; input.placeholder = PROMPT[a.name] || 'paste the proof link';
      input.setAttribute('aria-label', 'proof link for ' + a.name);
      const btn = Object.assign(document.createElement('button'), { className: 'btn', type: 'button', textContent: 'submit ❤' });
      const msg = Object.assign(document.createElement('div'), { className: 'taskmsg', textContent: '' });
      btn.addEventListener('click', async () => {
        const proofUrl = input.value.trim();
        if (!proofUrl) { msg.textContent = SUBMIT_ERR.bad_proof_url; return; }
        btn.disabled = true; msg.className = 'taskmsg'; msg.textContent = 'submitting…';
        try {
          const r = await fetch('/airdrop/actions/submit', {
            method: 'POST', credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: a.name, proofUrl }),
          });
          const body = await r.json().catch(() => ({}));
          if (r.ok) {
            input.value = '';
            msg.className = 'taskmsg ok';
            msg.textContent = body.submission && body.submission.status === 'approved'
              ? 'in! approved — your LUV is on the way ❤'
              : 'in! under review — your LUV follows approval ❤';
            refreshMine();
          } else {
            msg.textContent = SUBMIT_ERR[body.error] || 'that didn’t go through — try again';
          }
        } catch (e) { msg.textContent = 'that didn’t go through — try again'; }
        btn.disabled = false;
      });
      form.append(input, btn);
      el.append(head, form, msg);
      return el;
    }));
  }

  async function loadSession() {
    let me;
    try { me = await j('/auth/me'); } catch (e) { return false; } // not signed in
    document.body.classList.add('authed');
    myProvider = me.provider || null;
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
    loadTasks();
    // the old dashboard refreshed the balance every 30s while visible
    if (!balTimer) balTimer = setInterval(() => { if (!document.hidden) refreshStatus(); }, 30000);
    return true;
  }

  // ── wire the controls ──────────────────────────────────────────────────────
  for (const id of ['connectbtn', 'collectword', 'collectbtn']) $(id).addEventListener('click', openModal);
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
