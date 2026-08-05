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
  let airdropClosed = false; // set from luv.live.json (airdrop:"closed") — the campaign has concluded
  let luvAddr = '0x2711111111683B8708cb9a48cBf36a51315F8254';
  let myWallet = null;
  let balTimer = null;
  let gasInfo = null; // { gasPriceWei, claimGas, claimFeeEth, ethUsd, claimFeeUsd } from /airdrop/gas

  // Up-front network-fee estimate for a claim (ETH + USD), so the ETH cost is never a surprise.
  function fmtEth(n) { return (Math.round(n * 1e6) / 1e6).toString(); }
  async function showGasEstimate() {
    const el = document.getElementById('gasest');
    if (!el) return;
    try {
      gasInfo = await j('/airdrop/gas');
      const eth = fmtEth(Number(gasInfo.claimFeeEth));
      const usd = gasInfo.claimFeeUsd != null ? ' (~$' + gasInfo.claimFeeUsd.toFixed(2) + ')' : '';
      el.innerHTML = '⛽ estimated network fee to claim: <b>≈ ' + eth + ' ETH</b>' + usd + ' — paid in ETH, not LUV';
    } catch (e) { el.textContent = '⛽ network fee shown in your wallet at signing'; }
  }

  // Header GAS TANK — the community sponsorship pool: how many free claims the relayer can cover
  // at current gas. Shown top-right; updates periodically.
  async function loadGasTank() {
    const el = document.getElementById('gastank'); const val = document.getElementById('gastankval');
    if (!el || !val) return;
    try {
      const g = await j('/airdrop/gas');
      if (g.sponsorsLeft == null || !g.relayerAddress) { el.hidden = true; return; }
      const n = g.sponsorsLeft;
      val.textContent = n.toLocaleString('en-US') + (n === 1 ? ' claim' : ' claims');
      el.hidden = false;
      el.className = 'gastank' + (!g.sponsorActive ? ' off' : (n < 20 ? ' low' : ''));
      el.title = 'community gas tank: ' + (g.relayerEth ? (+g.relayerEth).toFixed(4) + ' ETH' : '') +
        ' — sponsors ' + n.toLocaleString('en-US') + ' free claims at ' + g.gwei + ' gwei' +
        (g.sponsorActive ? '' : ' · PAUSED (gas over ' + g.maxGwei + ' gwei or tank empty → claim yourself)');
    } catch (e) { el.hidden = true; }
  }

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
    airdropClosed = cfg.airdrop === 'closed';

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
    // Airdrops-claimed count at the bottom of the landing — appears once any claim has happened.
    if (typeof s.gesturesDelivered === 'number' && s.gesturesDelivered > 0) {
      const n = $('claimed-n'); if (n) n.textContent = s.gesturesDelivered.toLocaleString('en-US');
      const c = $('claimed-count'); if (c) c.hidden = false;
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
    // ── Airdrop concluded (Phase 2) ── no more claiming. Show delivered balances (redeemed is
    // redeemed) and point everyone to live Uniswap trading. No claim button, ever.
    if (airdropClosed) {
      const er = $('ethclaimrow'); if (er) er.hidden = true;
      for (const id of ['congrats', 'congratssub']) { const el = $(id); if (el) el.hidden = true; }
      document.querySelectorAll('#timeline .step').forEach((el) => { el.className = 'step'; });
      const bal = fmtLuv(s.luvBalance);
      const hasLuv = bal !== null && !/^0(\.0*)?$/.test(bal);
      const delivered = ((s.claim && s.claim.status) === 'confirmed') || s.claimed || hasLuv;
      const balEl = $('balance'); const balLine = $('balline'); const balState = $('balstate');
      const line = $('statusline');
      const setBal = (amt) => { balEl.innerHTML = ''; balEl.append(amt, Object.assign(document.createElement('small'), { textContent: ' LUV' })); };
      if (balState) balState.hidden = false;
      if (delivered) {
        setBal(bal || fmtLuv(s.claim && s.claim.amount) || '1,000,000,000,000');
        if (balState) { balState.className = 'balstate claimed'; balState.innerHTML = '✅ <b>redeemed</b> — thank you ❤'; }
        if (balLine) balLine.textContent = 'hold LUV, earn LUV — reflections accrue automatically';
        if (line) line.innerHTML = '❤ The airdrop has concluded — your LUV is home. <b>Thank you.</b> LUV now trades live on Uniswap.';
      } else {
        setBal(bal || '0');
        if (balState) { balState.className = 'balstate'; balState.innerHTML = '🎉 <b>airdrop concluded</b> — thank you'; }
        if (balLine) balLine.textContent = 'the free airdrop has ended — LUV is now live on Uniswap';
        if (line) line.innerHTML = '🎉 The one-year airdrop is <b>sold out</b> — thank you for being part of it. LUV now trades live on Uniswap. ❤';
      }
      return;
    }
    // Wallet sign-ins have no gesture claim — the airdrop's Sybil unit is a social identity.
    if (!s.claim && !s.claimed && myProvider === 'metamask') {
      document.querySelectorAll('#timeline .step').forEach((el) => { el.className = 'step'; });
      $('statusline').textContent =
        'the free airdrop rides with social sign-ins — sign in with Google or GitHub to receive the gesture ❤';
      const bs = $('balstate'); if (bs) bs.hidden = true; // no reserved gesture for a wallet sign-in
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
    // The claim panel shows for ANY claimable user — sponsored (gasless) needs no wallet.
    const er = $('ethclaimrow');
    // Show whenever a gesture is claimable — the FREE claim goes through the backend, so it does
    // not depend on cfg being loaded (avoids any config-load race hiding the button).
    if (er) er.hidden = !claimable;
    // Self-serve + the gas estimate only apply when an injected wallet is present.
    const self = $('ethclaim'); if (self) self.hidden = !window.ethereum;
    const gEl = $('gasest'); if (gEl) gEl.hidden = !window.ethereum;
    if (er && !er.hidden && window.ethereum && !gasInfo) showGasEstimate();
    const step = delivered ? 'confirmed' : inFlight ? 'submitted' : 'reserved';
    const at = Math.max(0, STEPS.indexOf(step));
    document.querySelectorAll('#timeline .step').forEach((el) => {
      const i = STEPS.indexOf(el.dataset.step);
      el.className = 'step' + (i < at ? ' done' : i === at ? (delivered ? ' done' : ' now') : '');
    });
    const line = $('statusline');
    if (delivered) {
      line.innerHTML = '❤ Delivered — <b>1,000,000,000,000 LUV</b> is yours. Welcome home — we’re proud of you.';
    } else if (inFlight) {
      line.textContent = 'Your claim is on-chain — your trillion arrives with the next confirmation.';
    } else if (raw === 'failed') {
      line.textContent = 'That attempt didn’t go through — no harm done; claim again whenever you’re ready.';
    } else {
      line.innerHTML = 'Welcome home ❤ Your <b>1,000,000,000,000 LUV</b> is reserved and waiting — claim it whenever you like. No rush.';
    }

    // The balance panel reflects the GESTURE STATE — never a bare "0 LUV".
    const bal = fmtLuv(s.luvBalance);
    const hasLuv = bal !== null && !/^0(\.0*)?$/.test(bal);
    const reservedAmt = (s.claim && s.claim.amount && fmtLuv(s.claim.amount)) || '1,000,000,000,000';
    const balEl = $('balance'); const balLine = $('balline'); const balState = $('balstate');
    if (balState) balState.hidden = false;
    const setBal = (amt) => { balEl.innerHTML = ''; balEl.append(amt, Object.assign(document.createElement('small'), { textContent: ' LUV' })); };
    if (delivered || hasLuv) {
      setBal(bal || reservedAmt);
      if (balState) { balState.className = 'balstate claimed'; balState.innerHTML = '✅ <b>claimed</b> — we’re proud of you ❤'; }
      if (balLine) balLine.textContent = 'hold LUV, earn LUV — reflections accrue automatically';
    } else if (inFlight) {
      setBal(reservedAmt);
      if (balState) { balState.className = 'balstate claiming'; balState.innerHTML = '⏳ <b>claiming…</b> on-chain'; }
      if (balLine) balLine.textContent = 'arriving with the next confirmation ❤';
    } else {
      setBal(reservedAmt);
      if (balState) { balState.className = 'balstate'; balState.innerHTML = '🎁 <b>reserved</b> for you — welcome home ❤'; }
      if (balLine) balLine.textContent = 'we’re proud of you — claim it whenever you like';
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

  // ── the daily LUVdrop (presence claims — 1B every day you return) ──────────
  // GET /airdrop/drop gives nextAt + serverNow; we count down against the SERVER clock
  // (client clocks drift) and collect automatically the moment the 24h window opens.
  let dropTick = null; let dropNextAt = 0; let dropSkew = 0; let dropClaiming = false; let dropTriedAt = -1;
  function fmtClock(s) {
    s = Math.max(0, Math.floor(s));
    const p = (n) => String(n).padStart(2, '0');
    return p(Math.floor(s / 3600)) + ':' + p(Math.floor((s % 3600) / 60)) + ':' + p(s % 60);
  }
  async function collectDrop() {
    if (dropClaiming) return; dropClaiming = true;
    const msg = $('dropmsg');
    if (msg) msg.textContent = 'your LUVdrop is ready — collecting… ❤';
    try { await j('/airdrop/return', { method: 'POST' }); } catch (e) { /* clock not open / offline — loadDrop resyncs */ }
    dropClaiming = false;
    loadDrop();
  }
  async function loadDrop() {
    const panel = $('droppanel'); if (!panel) return;
    let d; try { d = await j('/airdrop/drop'); } catch (e) { return; }
    if (!d || d.eligible === false) { panel.hidden = true; return; }
    panel.hidden = false;
    $('dropreward').textContent = fmtReward(d.reward);
    const nowS = Math.floor(Date.now() / 1000);
    dropSkew = nowS - (d.serverNow || nowS);
    dropNextAt = d.nextAt || 0;
    const msg = $('dropmsg');
    const st = d.lastDrop && d.lastDrop.status;
    if (d.claimable) {
      // Auto-collect ONCE per window: a failed collect leaves nextAt unchanged, so we
      // don't hammer the desk — a reload or the next visit tries again.
      if (dropTriedAt !== dropNextAt) { dropTriedAt = dropNextAt; collectDrop(); return; }
      msg.textContent = 'your LUVdrop is ready — it will be collected on your next visit ❤';
    } else if (st === 'paid') {
      msg.textContent = 'today’s LUVdrop is delivered ❤ come back tomorrow';
    } else if (st === 'approved' || st === 'queued') {
      msg.textContent = 'today’s LUVdrop is on its way ❤';
    } else {
      msg.textContent = 'come back tomorrow — your next billion is already counting down';
    }
    if (!dropTick) {
      dropTick = setInterval(() => {
        const remain = dropNextAt - (Math.floor(Date.now() / 1000) - dropSkew);
        $('dropclockrow').hidden = remain <= 0;
        $('dropcount').textContent = fmtClock(remain);
        if (remain <= 0) { clearInterval(dropTick); dropTick = null; if (dropTriedAt !== dropNextAt) { dropTriedAt = dropNextAt; collectDrop(); } }
      }, 1000);
    }
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
    // Private-key self-custody export exists only for the wallet we created (custodial). MetaMask
    // brings its own key — nothing to reveal.
    if (myProvider !== 'metamask') { const pk = $('pkrow'); if (pk) pk.hidden = false; }
    await refreshStatus();
    loadDrop(); // the daily LUVdrop clock (presence claims)
    // loadTasks() disabled — the earn/IncentiveDistributor rail is "coming soon" (Phase 3).
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
  // Sponsored (gasless) claim — the relayer pays; the user needs no ETH and no wallet.
  on('claimsponsored', 'click', async () => {
    const btn = $('claimsponsored'); const msg = $('ethclaimmsg');
    const ri = $('recipientinput');
    const wanted = ri && ri.value ? ri.value.trim() : '';
    if (wanted && !/^0x[0-9a-fA-F]{40}$/.test(wanted)) {
      msg.textContent = 'that receive address doesn’t look right — check it, or leave it blank to use your wallet.';
      return;
    }
    btn.disabled = true; msg.textContent = 'delivering your trillion — gas is on us…';
    try {
      const r = await fetch('/airdrop/claim-sponsored', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(wanted ? { recipient: wanted } : {}),
      });
      const body = await r.json().catch(() => ({}));
      if (r.ok) {
        msg.textContent = body.status === 'confirmed'
          ? '❤ delivered — your 1,000,000,000,000 LUV is in your wallet.'
          : '🎁 on its way — gas covered by us. Your trillion arrives with the next confirmation ❤';
        setTimeout(() => { pollConfirm(8, 8000); }, 1000);
      } else if (body.error === 'gas_too_high') {
        msg.textContent = 'the network is busy (' + body.gwei + ' gwei, over our ' + body.ceiling + ' gwei cap) — try again when it eases, or claim it yourself below.';
      } else if (body.error === 'relayer_empty' || body.error === 'sponsor_off') {
        msg.textContent = 'free claims are paused right now — you can claim it yourself below (a little ETH gas).';
      } else if (body.error === 'already_claimed' || body.status === 'confirmed') {
        msg.textContent = '❤ already delivered — your trillion is in your wallet.';
      } else {
        msg.textContent = 'that didn’t go through — try again, or claim it yourself below.';
      }
    } catch (e) { msg.textContent = 'network hiccup — try again, or claim it yourself below.'; }
    finally { btn.disabled = false; refreshStatus(); }
  });
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
      // Precise fee: the wallet's own gas estimate for THIS tx × the live gas price.
      let feeNote = '';
      try {
        const est = await window.ethereum.request({ method: 'eth_estimateGas', params: [{ from, to: v.to, data: v.data }] });
        const gp = gasInfo && gasInfo.gasPriceWei ? BigInt(gasInfo.gasPriceWei) : null;
        if (gp) {
          const eth = Number(BigInt(est) * gp) / 1e18;
          const usd = gasInfo.ethUsd ? ' (~$' + (eth * gasInfo.ethUsd).toFixed(2) + ')' : '';
          feeNote = ' — network fee ≈ ' + fmtEth(eth) + ' ETH' + usd;
        }
      } catch (e) { /* estimate best-effort; the wallet shows the exact fee anyway */ }
      msg.textContent = 'confirm the claim in your wallet' + feeNote + ' (paid in ETH)…';
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

  // ── LUV wallet: Send / Receive (MetaMask-style) ─────────────────────────────
  const openW = (id) => { const m = $(id); if (m) m.classList.add('open'); };
  const closeW = (id) => { const m = $(id); if (m) m.classList.remove('open'); };
  ['recvmodal', 'sendmodal'].forEach((id) => on(id, 'click', (e) => { if (e.target === $(id)) closeW(id); }));
  on('recv-close', 'click', () => closeW('recvmodal'));
  on('send-close', 'click', () => closeW('sendmodal'));
  on('recvbtn', 'click', () => {
    const a = $('recv-addr'); if (a) a.textContent = myWallet || '(no wallet yet)';
    const ex = $('recv-explorer'); if (ex && myWallet) ex.href = (cfg.explorer || 'https://etherscan.io') + '/address/' + myWallet;
    openW('recvmodal');
  });
  on('recv-copy', 'click', async () => {
    if (!myWallet) return;
    try { await navigator.clipboard.writeText(myWallet); $('recv-copy').textContent = 'copied ❤'; setTimeout(() => { $('recv-copy').textContent = 'copy address'; }, 1500); } catch (e) { /* blocked */ }
  });
  on('sendbtn', 'click', () => { const m = $('send-msg'); if (m) { m.className = 'taskmsg'; m.textContent = ''; } openW('sendmodal'); });
  on('send-go', 'click', async () => {
    const msg = $('send-msg'); const btn = $('send-go');
    const to = ($('send-to').value || '').trim();
    const amt = ($('send-amt').value || '').trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(to)) { msg.className = 'taskmsg'; msg.textContent = 'enter a valid 0x… address'; return; }
    if (!/^[0-9][0-9,_\s]*(\.[0-9]+)?$/.test(amt)) { msg.className = 'taskmsg'; msg.textContent = 'enter an amount in LUV'; return; }
    btn.disabled = true; msg.className = 'taskmsg'; msg.textContent = 'sending…';
    try {
      if (myProvider === 'metamask') {
        // self-custody: send from MetaMask itself
        if (!window.ethereum) { msg.textContent = 'open MetaMask to send'; btn.disabled = false; return; }
        await ensureChain();
        const [from] = await window.ethereum.request({ method: 'eth_requestAccounts' });
        const clean = amt.replace(/[_,\s]/g, '');
        if (clean.indexOf('.') >= 0) { msg.textContent = 'whole-LUV amounts only from MetaMask'; btn.disabled = false; return; }
        const wei = (BigInt(clean) * (10n ** 18n)).toString(16);
        const data = '0xa9059cbb' + to.replace(/^0x/, '').toLowerCase().padStart(64, '0') + wei.padStart(64, '0');
        const tx = await window.ethereum.request({ method: 'eth_sendTransaction', params: [{ from, to: luvAddr, data }] });
        msg.className = 'taskmsg ok'; msg.textContent = 'sent — ' + tx.slice(0, 12) + '… ❤';
      } else {
        const r = await fetch('/auth/wallet/send', {
          method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to: to, amount: amt }),
        });
        const body = await r.json().catch(() => ({}));
        if (r.ok) {
          msg.className = 'taskmsg ok';
          msg.textContent = 'sent — ' + String(body.txHash || '').slice(0, 12) + '… ❤ (gas on us)';
          setTimeout(refreshStatus, 12000);
        } else {
          msg.textContent = body.error === 'insufficient_luv' ? 'not enough LUV in your wallet'
            : body.error === 'sponsor_unavailable' ? 'send is briefly unavailable — try again shortly'
              : body.error === 'invalid_to' ? 'that address doesn’t look right'
                : body.error === 'invalid_amount' ? 'check the amount'
                  : 'that didn’t go through — try again';
        }
      }
    } catch (e) { msg.textContent = String(e && e.code) === '4001' ? 'cancelled.' : 'that didn’t go through — try again'; }
    finally { btn.disabled = false; }
  });

  // ── private key: revealed ONLY while the button is pressed and held ──────────
  // Fetch on hold, show while held, mask the instant it's released / the tab loses focus.
  // The key is never rendered unless actively held, and never persisted.
  (function wirePkReveal() {
    const btn = $('revealpk'); const field = $('pkfield');
    if (!btn || !field) return;
    const MASK = '•••• hidden — press & hold to reveal ••••';
    let holding = false; let reqId = 0;
    async function reveal(e) {
      if (e && e.preventDefault) e.preventDefault();
      holding = true; btn.classList.add('holding');
      const myReq = ++reqId;
      field.textContent = 'unlocking…';
      let pk;
      try {
        pk = (await j('/auth/wallet/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).privateKey;
      } catch (err) { if (holding && myReq === reqId) field.textContent = 'could not unlock — release and try again'; return; }
      if (holding && myReq === reqId) { field.textContent = pk; field.classList.add('shown'); }
    }
    function hide() { holding = false; reqId++; field.textContent = MASK; field.classList.remove('shown'); btn.classList.remove('holding'); }
    btn.addEventListener('pointerdown', reveal);
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => btn.addEventListener(ev, hide));
    window.addEventListener('blur', hide);
    document.addEventListener('visibilitychange', () => { if (document.hidden) hide(); });
  })();

  // OAuth failure bounce (FRONTEND_FAILURE_URL = /?error=auth): reopen the modal so the
  // user can retry immediately.
  if (new URLSearchParams(location.search).get('error') === 'auth') openModal();

  // ?logout — hard escape hatch to clear the session cookie and return to a fresh landing.
  if (new URLSearchParams(location.search).get('logout') !== null) {
    fetch('/auth/logout', { method: 'POST', credentials: 'same-origin' }).finally(() => { location.href = '/'; });
  }

  // ── boot ───────────────────────────────────────────────────────────────────
  // Load the live config FIRST (contract addresses), then render the dashboard — otherwise a fast
  // /airdrop/status can render before cfg.contracts is set and the claim panel stays hidden.
  loadLive().then(loadSession).catch(loadSession);
  loadHealth();
  loadStats();
  loadGasTank();
  setInterval(loadGasTank, 60000);
  loadProviders();
})();
