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
  // Null-safe wiring: a missing element must never crash the whole app (the lesson of the
  // stale-cache loginbtn incident — old JS + new HTML has to degrade, not die).
  const on = (id, evt, fn) => { const el = $(id); if (el) el.addEventListener(evt, fn); };
  const j = async (url, opts) => {
    const r = await fetch(url, Object.assign({ credentials: 'same-origin' }, opts));
    if (!r.ok) throw new Error(url + ' → ' + r.status);
    return r.json();
  };
  // Ensure the injected wallet is on the launch chain (Ethereum mainnet) before any write — a
  // claim sent from the wrong network wastes gas and never lands. Tries to switch; returns false
  // if the user declines or the wallet can't switch.
  async function ensureChain() {
    if (!window.ethereum) return false;
    const want = '0x' + Number(cfg.chainId || 1).toString(16);
    try {
      const cur = await window.ethereum.request({ method: 'eth_chainId' });
      if (String(cur).toLowerCase() === want) return true;
      await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: want }] });
      return true;
    } catch (e) { return false; }
  }
  const PROVIDER_LABEL = { google: 'Google', discord: 'Discord', github: 'GitHub', apple: 'Apple', x: 'X', metamask: 'MetaMask' };
  const PROVIDER_ICON = { google: 'G', discord: 'D', github: '⌥', apple: '', x: '𝕏' };
  let myProvider = null;
  const STEPS = ['reserved', 'submitted', 'confirmed'];

  let cfg = { status: 'imminent', chainId: 1, explorer: 'https://etherscan.io', contracts: {} };
  let luvAddr = '0x2711111111683B8708cb9a48cBf36a51315F8254';
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

  // ── landing progress counters — shown ONLY once non-zero ───────────────────
  // While the campaign is at 0 the landing stays clean (circulating supply only); the moment
  // claims begin, the relevant counters appear. No zero-value clutter.
  async function loadStats() {
    let s;
    try { s = await j('/airdrop/stats'); } catch (e) { return; }
    const show = (cardId, valId, n) => {
      if (typeof n === 'number' && n > 0) {
        const v = $(valId); if (v) v.textContent = n.toLocaleString('en-US');
        const c = $(cardId); if (c) c.hidden = false;
      }
    };
    show('card-delivered', 'stat-delivered', s.gesturesDelivered);
    show('card-aboard', 'stat-aboard', s.gesturesAboard);
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
    // The live social providers. The static pair is ONLY a fallback for when the desk is
    // unreachable — when it answers, its list is authoritative (even empty), so we never
    // render a button whose provider would 404.
    let providers = ['google', 'github'];
    try {
      const r = await j('/auth/providers');
      if (Array.isArray(r.providers)) providers = r.providers;
    } catch (e) { /* desk unreachable — show the shipped pair */ }

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
    const raw = (s.claim && s.claim.status) || (s.claimed ? 'confirmed' : 'reserved');
    const delivered = raw === 'confirmed';
    const inFlight = raw === 'submitted';
    // Claimable = reserved and waiting (pending/queued/failed/reserved) — the gesture is yours to
    // claim whenever you like; it never expires.
    const claimable = !delivered && !inFlight;
    // Banner shows until delivered; the claim panel shows while claimable + contract live + wallet.
    for (const id of ['congrats', 'congratssub']) { const el = $(id); if (el) el.hidden = delivered; }
    const er = $('ethclaimrow');
    if (er) er.hidden = !(claimable && cfg.status === 'live' && cfg.contracts && cfg.contracts.ShambaLuvAirdrop && window.ethereum);
    const step = delivered ? 'confirmed' : inFlight ? 'submitted' : 'reserved';
    const at = Math.max(0, STEPS.indexOf(step));
    document.querySelectorAll('#timeline .step').forEach((el) => {
      const i = STEPS.indexOf(el.dataset.step);
      el.className = 'step' + (i < at ? ' done' : i === at ? (delivered ? ' done' : ' now') : '');
    });
    const line = $('statusline');
    if (delivered) {
      line.innerHTML = '❤ Delivered — <b>1,000,000,000,000 LUV</b> is yours. Hold it and watch it grow.';
    } else if (inFlight) {
      line.textContent = 'Your claim is on-chain — your trillion arrives with the next confirmation.';
    } else if (raw === 'failed') {
      line.textContent = 'That attempt didn’t go through — no harm done; claim again whenever you’re ready.';
    } else {
      line.textContent = 'Your 1 trillion LUV is reserved and waiting — claim it whenever you like. No rush.';
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

  // After a claim tx, poll status until it confirms on-chain (the backend reconciles via
  // usedNonce/hasClaimed) — so the dashboard flips to "delivered" without a manual refresh.
  async function pollConfirm(tries, ms) {
    for (let i = 0; i < tries; i++) {
      await new Promise((r) => setTimeout(r, ms));
      let s;
      try { s = await j('/airdrop/status'); } catch (e) { continue; }
      renderStatus(s);
      if (s && s.claim && s.claim.status === 'confirmed') return;
    }
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
      const btn = Object.assign(document.createElement('button'), { className: 'btn', type: 'button', textContent: 'EARN ❤' });
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
  for (const id of ['connectbtn', 'collectword', 'collectbtn', 'loginbtn']) on(id, 'click', openModal);
  document.querySelectorAll('[data-open-login]').forEach((el) => el.addEventListener('click', openModal));
  on('modalclose', 'click', closeModal);
  on('loginmodal', 'click', (e) => { if (e.target === $('loginmodal')) closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

  on('copyaddr', 'click', async () => {
    try {
      await navigator.clipboard.writeText(luvAddr);
      $('copyaddr').textContent = 'copied ❤';
      setTimeout(() => { $('copyaddr').textContent = 'copy'; }, 1600);
    } catch (e) { /* clipboard blocked */ }
  });
  on('copywallet', 'click', async () => {
    if (!myWallet) return;
    try {
      await navigator.clipboard.writeText(myWallet);
      $('copywallet').textContent = 'copied ❤';
      setTimeout(() => { $('copywallet').textContent = 'copy'; }, 1600);
    } catch (e) { /* clipboard blocked */ }
  });
  on('refreshbal', 'click', refreshStatus);
  on('ethclaim', 'click', async () => {
    const msg = $('ethclaimmsg');
    const btn = $('ethclaim');
    try {
      const [from] = await window.ethereum.request({ method: 'eth_requestAccounts' });
      // Optional custom receive address — defaults to your created wallet if blank/invalid input.
      const ri = $('recipientinput');
      const wanted = ri && ri.value ? ri.value.trim() : '';
      if (wanted && !/^0x[0-9a-fA-F]{40}$/.test(wanted)) {
        msg.textContent = 'that receive address doesn’t look right — check it, or leave it blank to use your wallet.';
        return;
      }
      btn.disabled = true;
      // Must claim on Ethereum mainnet — switch the wallet if it's on another network.
      if (!(await ensureChain())) {
        msg.textContent = 'switch your wallet to Ethereum mainnet to claim (your gesture stays reserved).';
        btn.disabled = false; return;
      }
      msg.textContent = 'preparing your signed voucher…';
      const v = await j('/airdrop/voucher', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(wanted ? { recipient: wanted } : {}),
      });
      msg.textContent = 'confirm the claim in your wallet (you pay the gas)…';
      const txHash = await window.ethereum.request({
        method: 'eth_sendTransaction',
        params: [{ from, to: v.to, data: v.data }],
      });
      msg.textContent = 'claim submitted — ' + txHash.slice(0, 10) + '… · your 1 trillion LUV arrives to ' +
        (v.recipient ? v.recipient.slice(0, 8) + '…' + v.recipient.slice(-4) : 'your wallet') + ' with the next confirmation ❤';
      pollConfirm(8, 8000); // ~1 min of polling; flips the timeline to "delivered" on confirmation
    } catch (e) {
      msg.textContent = String(e && e.code) === '4001'
        ? 'claim declined — no rush, your gesture stays reserved. Claim whenever you like.'
        : 'that didn’t go through — your gesture is still reserved; try again anytime.';
      refreshStatus();
    } finally { btn.disabled = false; }
  });
  on('logout', 'click', async () => {
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
