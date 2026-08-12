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
        if (line) line.innerHTML = '❤ Stage one complete — your LUV is home. Stage two: <b>thanks a million LUV</b>. '
          + 'Log in daily to collect a million LUV for the next <b>100 days</b>.';
      } else {
        setBal(bal || '0');
        if (balState) { balState.className = 'balstate'; balState.innerHTML = '🎉 <b>stage one complete</b> — thank you'; }
        if (balLine) balLine.textContent = 'stage two: thanks a million LUV — log in daily to collect a million, for the next 100 days';
        if (line) line.innerHTML = '🎉 Stage one — the LUV drop — is <b>complete</b>; thank you for being part of it. '
          + 'Stage two: <b>thanks a million LUV</b>. Log in daily to collect a million LUV for the next <b>100 days</b>. ❤';
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
    accrued: 'accumulating ❤', redeeming: 'redeeming…',
    failed: 'failed', rejected: 'rejected',
  };
  const SUBMIT_ERR = {
    login_required_today: 'sign in again today to start your timer — the day begins when you do ❤',
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

  // ── the LUVdrip: A MILLION LUV A DAY, EARNED BY LOGGING IN ─────────────────
  // Signing in armed a 24-hour window, and 1,000,000 LUV drips across ALL of it — wall-clock,
  // so it keeps flowing with this tab closed and this session expired. When the million is
  // complete the next one waits for the next login. GET /airdrop/drip is the ledger; the meter
  // only re-reads the clock. The tally accumulates until it is delivered on-chain, and THAT
  // step costs gas: send it yourself from a wallet holding ETH, or let the project sponsor it.
  let dripMeter = null; let dripTick = null; let dripState = null;
  function fmtClock(s) {
    s = Math.max(0, Math.floor(s));
    const p = (n) => String(n).padStart(2, '0');
    return p(Math.floor(s / 3600)) + ':' + p(Math.floor((s % 3600) / 60)) + ':' + p(s % 60);
  }
  function bootDrip(identity) {
    if (dripMeter || !window.DVLuvDrip) return;
    const mount = $('luvdripmeter'); if (!mount) return;
    dripMeter = new DVLuvDrip.Drip({ mount, identity: identity || 'participant' }).start();
  }
  // Express LUV amounts in USD via the oracle (market.json, same-origin): the participant
  // must SEE what the accumulated LUV is worth next to what the redeem transaction costs.
  function fmtUsd(v) {
    if (v == null || !isFinite(v)) return '';
    if (v >= 1) return '$' + v.toFixed(2);
    if (v < 1e-6) return '<$0.000001';
    return '$' + v.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  }
  function luvWeiToUsd(weiStr, mkt) {
    if (!mkt || mkt.oneTrillionUsd == null) return null;
    try { return Number(BigInt(weiStr) / 10n ** 18n) / 1e12 * mkt.oneTrillionUsd; } catch (e) { return null; }
  }
  const COLLECT_ERR = {
    nothing_to_collect: 'nothing has dripped yet — give it a moment ❤',
    no_drip: 'sign in to start your million',
    drip_paused: 'the drip is paused right now — your tally is safe',
    collect_failed: 'that didn’t go through — your LUV is safe, try again',
  };
  const REDEEM_ERR = {
    nothing_to_redeem: 'not a full day yet — your million is still dripping ❤',
    no_drip: 'sign in to start your million',
    gas_too_high: 'gas is spiking, so the bus is waiting it out — your LUV keeps accumulating',
    relayer_empty: 'the LUVbus is refuelling — try again soon, or send it yourself',
    sponsor_off: 'the LUVbus is between runs — your LUV is safe; ride it shortly, or send it yourself',
    no_relayer: 'the LUVbus is between runs — your LUV is safe; ride it shortly, or send it yourself',
    redeem_not_open: 'the redeem desk opens shortly — your LUV keeps accumulating ❤',
    voucher_failed: 'that didn’t go through — your LUV is safe, try again',
    redeem_failed: 'that didn’t go through — your LUV is safe, try again',
  };
  async function loadDrip() {
    const panel = $('droppanel'); if (!panel) return;
    let d; try { d = await j('/airdrop/drip'); } catch (e) { return; }
    if (!d || d.eligible === false) { panel.hidden = true; return; }
    panel.hidden = false;
    dripState = d;
    bootDrip(($('youwallet') || {}).textContent || 'participant');
    if (dripMeter) dripMeter.sync(d);

    // Value + gas expression (both best-effort; the meter never waits on them).
    let mkt = null; let gas = null;
    try { mkt = await (await fetch('/market.json', { cache: 'no-store' })).json(); } catch (e) { /* oracle offline */ }
    try { gas = await j('/airdrop/gas'); } catch (e) { /* estimate unavailable */ }

    // The day's figure is stated in LUV and nothing else. Pricing the million at sign-in
    // invites a comparison that is not the point: the drip is an acknowledgement, and a
    // fiat figure beside it measures the wrong thing. The USD readout stays where it is
    // actually a decision — the accumulated tally against the gas to deliver it.
    $('dropreward').textContent = Number(d.dailyLuv).toLocaleString('en-US');

    // ── the accumulated tally + the two ways to deliver it ──
    const accWei = d.accrued || '0';
    const accUsd = luvWeiToUsd(accWei, mkt);
    $('accluv').textContent = fmtReward(accWei);
    $('accusd').textContent = accUsd != null ? 'worth ≈ ' + fmtUsd(accUsd) : '';
    // the OTHER half of what they hold: the LUV already on chain, in their own wallet
    try {
      const st = await j('/airdrop/status');
      const held = st && st.luvBalance;
      $('holdluv').textContent = held ? fmtReward(held) : '0';
      const heldUsd = held ? luvWeiToUsd(held, mkt) : null;
      $('holdsub').textContent = heldUsd != null ? 'worth ≈ ' + fmtUsd(heldUsd) + ' · reflections accrue while you hold'
        : 'reflections accrue automatically while you hold';
    } catch (e) { /* the tally is the headline; a status hiccup must not blank the panel */ }
    const held = $('accheld');
    if (held) {
      const hasHeld = (() => { try { return BigInt(d.heldWei || '0') > 0n; } catch (e) { return false; } })();
      held.hidden = !hasHeld;
      if (hasHeld) held.textContent = '📝 ' + fmtReward(d.heldWei) + ' LUV is waiting inside a signed redemption — '
        + 'send it from your wallet to deliver it, or leave it and it returns to your tally.';
    }
    const gasUsd = gas && gas.redeemFeeUsd != null ? gas.redeemFeeUsd : null;
    const accEl = $('accgas');
    if (gasUsd != null && accUsd != null) {
      if (accUsd >= gasUsd) {
        accEl.textContent = 'worth it ✓ — value ' + fmtUsd(accUsd) + ' ≥ redeem gas ~' + fmtUsd(gasUsd)
          + ' (' + Number(gas.redeemFeeEth).toFixed(6) + ' ETH)';
      } else {
        const pct = Math.max(0.1, Math.round(accUsd / gasUsd * 1000) / 10);
        accEl.textContent = 'redeeming now costs ~' + fmtUsd(gasUsd) + ' in gas — your pile covers ' + pct
          + '% of that. keep logging in and stack more LUV ❤';
      }
    } else if (gasUsd != null) {
      accEl.textContent = 'redeem gas right now: ~' + fmtUsd(gasUsd) + ' (' + Number(gas.redeemFeeEth).toFixed(6) + ' ETH)';
    } else {
      accEl.textContent = 'gas estimate unavailable — the chain still awaits your call';
    }

    // COLLECT — what the live meter would bank this instant, and the clock restarts with it
    const collectBtn = $('dripcollectbtn');
    if (collectBtn) {
      let collectable = 0n;
      try { collectable = BigInt(d.collectable || '0'); } catch (e) { collectable = 0n; }
      collectBtn.disabled = collectable < 10n ** 18n; // less than 1 LUV is not worth a press
      // the live figure lives BESIDE the button now, so the button stays the size of its words
      const hint = $('collecthint');
      if (hint) {
        hint.textContent = collectable >= 10n ** 18n
          ? 'press it to bank ' + fmtReward(d.collectable) + ' LUV — free, and your million restarts from that moment'
          : 'free, and your million restarts the moment you press it';
      }
      collectBtn.title = collectable >= 10n ** 18n
        ? 'bank ' + fmtReward(d.collectable) + ' LUV and restart the 24-hour million'
        : 'a LUV has to have dripped before there is anything to bank';
    }

    let enough = false;
    try { enough = BigInt(accWei) >= BigInt(d.minRedeemWei || '0'); } catch (e) { enough = false; }
    // The redeem desk opens when the distributor carrying the rail is live; until then LUV keeps
    // accruing and nothing is lost — the panel says so rather than offering a button that can't pay.
    const open = d.redeemOpen !== false;
    const selfBtn = $('redeemselfbtn'); const sponsorBtn = $('redeemsponsorbtn');
    if (selfBtn) {
      // the self-sovereign path, and the ONLY place ETH is ever mentioned to a participant
      selfBtn.disabled = !enough || !open;
      selfBtn.title = !open ? 'the redeem desk opens shortly — your LUV keeps accumulating'
        : !enough ? 'a full day of drip unlocks this'
          : window.ethereum ? 'you send the transaction and pay its gas in ETH'
            : 'connect a wallet holding ETH to send it yourself';
    }
    if (sponsorBtn) {
      // THE LUVbus: nobody is asked for ETH to ride it. The bus pays for everyone aboard.
      const running = !!(gas && gas.sponsorActive);
      sponsorBtn.disabled = !enough || !open || !running;
      const bsub = sponsorBtn.querySelector('small');
      if (bsub) {
        bsub.textContent = !open ? 'the depot opens shortly — your LUV keeps accumulating'
          : !enough ? 'a full day of drip buys your seat'
            : running ? 'moves your LUV into your wallet · no ETH needed · the bus pays the gas'
              : 'the bus is between runs — try shortly, or send it yourself below';
      }
    }

    // ── the window clock: how long until this million is complete ──
    const skew = Math.floor(Date.now() / 1000) - (d.serverNow || Math.floor(Date.now() / 1000));
    const msg = $('dropmsg');
    const df = $('dropfull');
    const tick = () => {
      const remain = (d.windowEndsAt || 0) - (Math.floor(Date.now() / 1000) - skew);
      const row = $('dropclockrow');
      if (row) row.hidden = remain <= 0;
      const el = $('dropcount'); if (el) el.textContent = fmtClock(remain);
      if (remain <= 0) {
        if (dripTick) { clearInterval(dripTick); dripTick = null; }
        if (df) df.hidden = false;
        if (msg) msg.textContent = 'today’s million is complete ❤ sign in again to start your next 1,000,000';
        loadDrip();
      }
    };
    if (df) {
      df.hidden = !d.full;
      if (d.full) { try { localStorage.setItem('luv-maxdrops', JSON.stringify({ t: Date.now() })); } catch (e) {} }
    }
    // the season: how much earning time is left, and that honouring outlives it
    const seasonEl = $('dropseason');
    if (seasonEl && d.seasonEndsAt) {
      const ends = new Date(d.seasonEndsAt * 1000).toISOString().slice(0, 10);
      seasonEl.hidden = false;
      seasonEl.innerHTML = d.seasonOver
        ? '🏁 <b>the 100 days are complete</b> — no new millions start, and <b>every LUV you collected is still yours</b>, redeemable whenever you like ❤'
        : '⏳ <b>' + d.seasonDaysLeft + ' day' + (d.seasonDaysLeft === 1 ? '' : 's') + '</b> of the 100 left — log in daily until <b>' + ends + '</b>. Whatever you collect stays yours after it ends ❤';
    }
    if (msg && !open) {
      msg.textContent = 'your million is dripping and your tally is safe — the redeem desk opens shortly ❤';
    } else if (msg) {
      msg.textContent = d.full
        ? 'today’s million is complete ❤ sign in again to start your next 1,000,000'
        : 'your million is dripping — all day, whether or not you’re watching ❤';
    }
    if (dripTick) { clearInterval(dripTick); dripTick = null; }
    if (!d.full) { tick(); dripTick = setInterval(tick, 1000); }
  }

  // COLLECT — the participant's own act, off-chain and free: bank whatever has dripped into
  // the accumulated tally, and start the million over from this moment. The rate is unchanged
  // by pressing it, so this is control of the clock rather than a way to earn faster.
  on('dripcollectbtn', 'click', async () => {
    const btn = $('dripcollectbtn'); const msg = $('redeemmsg');
    btn.disabled = true;
    msg.className = 'taskmsg'; msg.textContent = 'collecting — banking your flow…';
    try {
      const r = await fetch('/airdrop/drip/collect', { method: 'POST', credentials: 'same-origin' });
      const body = await r.json().catch(() => ({}));
      if (r.ok) {
        msg.className = 'taskmsg ok';
        msg.textContent = 'collected ' + fmtReward(body.collected || '0') + ' LUV ❤ your tally is '
          + fmtReward(body.accrued || '0') + ' LUV, and a fresh million is dripping from right now — '
          + 'REDEEM below when you want it moved into your wallet';
        if (dripMeter) dripMeter.stop();
        dripMeter = null; // re-sync the meter against the restarted window
        const mount = $('luvdripmeter'); if (mount) { mount.dataset.dripBooted = ''; mount.__drip = null; }
      } else {
        msg.textContent = COLLECT_ERR[body.error] || COLLECT_ERR.collect_failed;
      }
    } catch (e) { msg.textContent = COLLECT_ERR.collect_failed; }
    loadDrip();
  });

  // REDEEM, self-paid: the participant's OWN wallet sends the transaction and spends its ETH.
  // The backend signs the redemption; the wallet pays the gas. The LUV lands on the wallet the
  // voucher names, so paying from any wallet still delivers to the participant.
  on('redeemselfbtn', 'click', async () => {
    const btn = $('redeemselfbtn'); const msg = $('redeemmsg');
    msg.className = 'taskmsg';
    if (!window.ethereum) {
      msg.textContent = 'sending it yourself needs a connected wallet holding ETH — '
        + 'or ride the LUVbus above and pay nothing at all ❤';
      return;
    }
    btn.disabled = true;
    try {
      const [from] = await window.ethereum.request({ method: 'eth_requestAccounts' });
      if (!(await ensureChain())) {
        msg.textContent = 'switch your wallet to Ethereum mainnet to redeem (your LUV stays accumulated).';
        btn.disabled = false; return;
      }
      msg.textContent = 'preparing your signed redemption…';
      const v = await j('/airdrop/drip/voucher', { method: 'POST' });
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
      } catch (e) { /* best-effort; the wallet shows the exact fee anyway */ }
      msg.textContent = 'confirm in your wallet' + feeNote + ' — the gas is paid in ETH, the LUV is yours…';
      const txHash = await window.ethereum.request({
        method: 'eth_sendTransaction', params: [{ from, to: v.to, data: v.data }],
      });
      msg.className = 'taskmsg ok';
      msg.replaceChildren(
        document.createTextNode('sent ❤ ' + fmtReward(v.amount || '0') + ' LUV on its way — '),
        Object.assign(document.createElement('a'), { href: cfg.explorer + '/tx/' + txHash, rel: 'noopener', target: '_blank', textContent: 'view the tx ↗' })
      );
      setTimeout(() => { loadDrip(); refreshStatus(); }, 6000);
    } catch (e) {
      const code = String(e && e.code);
      const m = String((e && e.message) || '');
      msg.textContent = code === '4001'
        ? 'redeem declined — no rush, your LUV stays accumulated ❤'
        : /insufficient funds/i.test(m)
          ? 'that wallet has no ETH for the gas — ride the LUVbus instead, it costs you nothing ❤'
          : (REDEEM_ERR[(e && e.error) || ''] || 'that didn’t go through — your LUV is safe, try again');
    } finally { btn.disabled = false; loadDrip(); }
  });

  // REDEEM, sponsored: the LUV project sends the SAME redemption and pays the gas, so the
  // participant needs no ETH at all. Subject to sponsorship being on and gas being sane.
  on('redeemsponsorbtn', 'click', async () => {
    const btn = $('redeemsponsorbtn'); const msg = $('redeemmsg');
    btn.disabled = true;
    msg.className = 'taskmsg'; msg.textContent = 'boarding the LUVbus — the gas is on the bus…';
    try {
      const r = await fetch('/airdrop/redeem', { method: 'POST', credentials: 'same-origin' });
      const body = await r.json().catch(() => ({}));
      if (r.ok) {
        msg.className = 'taskmsg ok';
        msg.replaceChildren(
          document.createTextNode('delivered ❤ ' + fmtReward(body.redeemed || '0') + ' LUV on-chain, and it cost you nothing — '),
          Object.assign(document.createElement('a'), { href: cfg.explorer + '/tx/' + body.txHash, rel: 'noopener', target: '_blank', textContent: 'view the tx ↗' })
        );
        refreshStatus();
      } else {
        msg.textContent = REDEEM_ERR[body.error] || REDEEM_ERR.redeem_failed;
      }
    } catch (e) { msg.textContent = REDEEM_ERR.redeem_failed; }
    loadDrip();
  });

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
    loadDrip(); // the LUVdrip meter + the accumulated tally
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
