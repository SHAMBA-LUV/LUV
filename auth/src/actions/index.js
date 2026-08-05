'use strict';

/*
 * actions/index.js — the IncentiveDistributor tasks rail: earn LUV for social actions.
 *
 * FLOW: signed-in user submits a proof URL for an action (tweet/post/interaction) →
 * recorded in action_submissions ('queued'; light platform detection from the URL) →
 * approval (operator via `node src/actions/review.js`, or ACTIONS_AUTO_APPROVE=true) →
 * the payout worker signs the contract's own claimDigest with the VOUCHER signer and
 * relays claimWithSignature. Amounts/limits/cooldowns are ALWAYS the on-chain registry's —
 * the backend never chooses an amount. On-chain dedup by actionId; per-user daily limits
 * and cooldowns enforced by the contract (checked here first via canPerform to save gas).
 *
 * The reward lands on the user's smart account. The IncentiveDistributor is fee-exempt
 * (deploy wiring), so contract→account transfers arrive whole even after the account
 * materializes.
 */

const crypto = require('crypto');
const ethers = require('../ethers');
const { config } = require('../config');
const db = require('../db');

const DIST_ABI = [
  'function getAllActions() view returns (string[] names, address[] tokens, uint256[] rewards, uint32[] dailyLimits, uint32[] cooldowns, bool[] oneTimes, bool[] actives, uint256[] completions)',
  'function getUserActionStats(address user, string actionType) view returns (uint256 earned, uint64 count, uint32 countToday, uint64 lastAt)',
  'function canPerform(address user, string actionType) view returns (bool)',
  'function isActionClaimed(string actionId) view returns (bool)',
  'function claimDigest(address user, string actionType, string actionId, uint256 deadline) view returns (bytes32)',
  'function claimWithSignature(address user, string actionType, string actionId, uint256 deadline, bytes signature)',
];

// Landing fallback while the distributor isn't deployed/configured. Phase-3 policy
// (operator, 2026-08-03): tweet = 50 billion LUV, limit 3/day, 1h cooldown timer —
// the rail supports both the trigger (proof submission → review → relay) and the
// timer (canPerform cooldown clock in the widget). NOTE: when the on-chain registry
// is live it ALWAYS wins; retune it with setAction("tweet", LUV, 5e28, 3, 3600,
// false, true) from the owner so chain and policy agree.
const SEED_ACTIONS = [
  // welcome = the 1-billion signup bonus; return = the daily LUVdrop: 1 billion LUV every
  // day you come back (operator, 2026-08-05). Owner retunes for chain/policy agreement:
  // setAction("welcome", LUV, 1e27, 0, 0, true, true) + setAction("return", LUV, 1e27, 1, 86400, false, true).
  { name: 'welcome', reward: (10n ** 27n).toString(), dailyLimit: 0, cooldown: 0, oneTime: true, active: true, completions: 0 },
  { name: 'return', reward: (10n ** 27n).toString(), dailyLimit: 1, cooldown: 86400, oneTime: false, active: true, completions: 0 },
  { name: 'tweet', reward: (5n * 10n ** 28n).toString(), dailyLimit: 3, cooldown: 3600, oneTime: false, active: true, completions: 0 },
  { name: 'post', reward: (5n * 10n ** 29n).toString(), dailyLimit: 10, cooldown: 300, oneTime: false, active: true, completions: 0 },
  { name: 'interaction', reward: (5n * 10n ** 28n).toString(), dailyLimit: 20, cooldown: 60, oneTime: false, active: true, completions: 0 },
];

let _provider = null;
function provider() {
  if (!_provider) _provider = new ethers.JsonRpcProvider(config.rpcUrl, config.chainId);
  return _provider;
}
function distributor(runner) {
  if (!config.incentiveDistributorAddress) return null;
  return new ethers.Contract(config.incentiveDistributorAddress, DIST_ABI, runner || provider());
}

// ── registry (60s cache; on-chain when configured, seed fallback otherwise) ──
let _cache = { at: 0, live: false, actions: SEED_ACTIONS };
async function registry() {
  if (Date.now() - _cache.at < 60_000) return _cache;
  const d = distributor();
  if (d) {
    try {
      const r = await d.getAllActions();
      _cache = {
        at: Date.now(),
        live: true,
        actions: r.names.map((name, i) => ({
          name,
          reward: r.rewards[i].toString(),
          dailyLimit: Number(r.dailyLimits[i]),
          cooldown: Number(r.cooldowns[i]),
          oneTime: r.oneTimes[i],
          active: r.actives[i],
          completions: Number(r.completions[i]),
        })),
      };
      return _cache;
    } catch (e) { /* fall through to seed */ }
  }
  _cache = { at: Date.now(), live: false, actions: SEED_ACTIONS };
  return _cache;
}

// Per-user on-chain stats for the widget (countToday vs dailyLimit, cooldown clock).
async function userStats(walletAddress, actionNames) {
  const d = distributor();
  if (!d || !walletAddress) return {};
  const out = {};
  await Promise.all(actionNames.map(async (name) => {
    try {
      const s = await d.getUserActionStats(walletAddress, name);
      out[name] = { earned: s.earned.toString(), count: Number(s.count), countToday: Number(s.countToday), lastAt: Number(s.lastAt) };
    } catch (e) { /* omit on read failure */ }
  }));
  return out;
}

// ── submission ──
const PLATFORM_HOSTS = [
  [/(^|\.)x\.com$|(^|\.)twitter\.com$/, 'x'],
  [/(^|\.)linkedin\.com$/, 'linkedin'],
  [/(^|\.)t\.me$|(^|\.)telegram\.(me|org)$/, 'telegram'],
  [/(^|\.)github\.com$/, 'github'],
  [/(^|\.)instagram\.com$/, 'instagram'],
  [/(^|\.)tiktok\.com$/, 'tiktok'],
  [/(^|\.)facebook\.com$/, 'facebook'],
  [/(^|\.)youtube\.com$|(^|\.)youtu\.be$/, 'youtube'],
];
function detectPlatform(proofUrl) {
  try {
    const host = new URL(proofUrl).hostname.toLowerCase();
    for (const [re, p] of PLATFORM_HOSTS) if (re.test(host)) return p;
    return 'web';
  } catch (e) { return null; }
}

/**
 * Record a proof-of-action submission. The actionId (the on-chain dedup key) is derived
 * from identity + action + proof so the same proof can never pay twice, on-chain or off.
 */
async function submitAction(identityKey, action, proofUrl) {
  const { actions } = await registry();
  const a = actions.find((x) => x.name === action);
  if (!a) return { error: 'unknown_action' };
  if (!a.active) return { error: 'inactive_action' };
  if (a.oneTime) return { error: 'not_submittable' }; // 'welcome' is the gesture, not a task
  if (a.name === 'return') return { error: 'not_submittable' }; // presence claim — automatic, no proof
  if (typeof proofUrl !== 'string' || proofUrl.length > 500 || !/^https?:\/\//i.test(proofUrl)) {
    return { error: 'bad_proof_url' };
  }
  const platform = detectPlatform(proofUrl);
  if (!platform) return { error: 'bad_proof_url' };

  const digest = crypto.createHash('sha256')
    .update(`${identityKey}\n${action}\n${proofUrl.trim().toLowerCase()}`).digest('hex').slice(0, 32);
  const actionId = `luv:${action}:${digest}`;
  const status = config.actionsAutoApprove ? 'approved' : 'queued';

  try {
    const r = await db.query(
      `INSERT INTO action_submissions (identity_key, action, action_id, proof_url, platform, amount, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, action, proof_url, platform, status, created_at`,
      [identityKey, action, actionId, proofUrl.trim(), platform, a.reward, status]
    );
    return { submission: r.rows[0] };
  } catch (err) {
    if (err && err.code === '23505') return { error: 'already_submitted' };
    throw err;
  }
}

async function mySubmissions(identityKey) {
  const r = await db.query(
    `SELECT id, action, proof_url, platform, amount, status, tx_hash, error, created_at
       FROM action_submissions WHERE identity_key = $1 ORDER BY id DESC LIMIT 50`,
    [identityKey]
  );
  return r.rows;
}

// ── presence claims: the signup bonus + the daily LUVdrop ──────────────────────
// 'welcome' (once ever) and 'return' (1 billion LUV every day you come back) need no
// proof URL — being here IS the action. SOCIAL identities only (the Sybil unit: a wallet
// is free to mint endlessly, a social account is not). Rows enter 'approved' directly —
// presence needs no review — and the payout worker relays them; the on-chain registry
// still has the final word on amounts, cooldowns, and dedup.
const RETURN_SPACING_S = 86400; // the 24h drop clock; mirrors the on-chain 'return' cooldown

function presenceActionId(identityKey, action, dayBucket) {
  const digest = crypto.createHash('sha256')
    .update(`${identityKey}\n${action}\n${dayBucket || 'once'}`).digest('hex').slice(0, 32);
  return `luv:${action}:${digest}`;
}

// When is this identity's next return drop? max(signup + 24h, last drop + 24h), epoch seconds.
async function nextReturnAt(identityKey) {
  const r = await db.query(
    `SELECT EXTRACT(EPOCH FROM i.created_at)::bigint AS signup_at,
            (SELECT EXTRACT(EPOCH FROM MAX(s.created_at))::bigint
               FROM action_submissions s
              WHERE s.identity_key = i.identity_key AND s.action = 'return'
                AND s.status IN ('queued','approved','paid')) AS last_drop_at
       FROM identities i WHERE i.identity_key = $1`,
    [identityKey]
  );
  if (!r.rows[0]) return null;
  const signupAt = Number(r.rows[0].signup_at);
  const lastDropAt = r.rows[0].last_drop_at == null ? null : Number(r.rows[0].last_drop_at);
  return Math.max(signupAt + RETURN_SPACING_S, lastDropAt ? lastDropAt + RETURN_SPACING_S : 0);
}

/**
 * Record a presence claim ('welcome' | 'return') for a SOCIAL identity. Idempotent:
 * a duplicate resolves to { ok, dedup } — never a double payment (DB unique + on-chain
 * actionId dedup + the contract cooldown all agree).
 */
async function claimPresence(identityKey, provider, action) {
  if (provider === 'metamask') return { error: 'social_only' };
  if (action !== 'welcome' && action !== 'return') return { error: 'unknown_action' };
  const { actions: list } = await registry();
  const a = list.find((x) => x.name === action);
  if (!a) return { error: 'unknown_action' };
  if (!a.active) return { error: 'inactive_action' };

  let dayBucket = null;
  if (action === 'return') {
    const nextAt = await nextReturnAt(identityKey);
    if (nextAt == null) return { error: 'unknown_identity' };
    const now = Math.floor(Date.now() / 1000);
    if (now < nextAt) return { error: 'come_back_soon', nextAt };
    dayBucket = new Date().toISOString().slice(0, 10); // UTC day — one drop row per day
  }

  const actionId = presenceActionId(identityKey, action, dayBucket);
  const proofUrl = action === 'welcome' ? 'presence://welcome' : `presence://return/${dayBucket}`;
  try {
    const r = await db.query(
      `INSERT INTO action_submissions (identity_key, action, action_id, proof_url, platform, amount, status)
       VALUES ($1, $2, $3, $4, 'luv', $5, 'approved')
       RETURNING id, action, status, created_at`,
      [identityKey, action, actionId, proofUrl, a.reward]
    );
    return { ok: true, submission: r.rows[0] };
  } catch (err) {
    if (err && err.code === '23505') return { ok: true, dedup: true };
    throw err;
  }
}

// The dashboard's drop panel: reward, per-participant 24h clock, today's delivery state.
async function dropStatus(identityKey, provider) {
  if (provider === 'metamask') return { eligible: false };
  const { actions: list } = await registry();
  const ret = list.find((x) => x.name === 'return') || { reward: (10n ** 27n).toString(), active: true };
  const welcome = list.find((x) => x.name === 'welcome') || { reward: (10n ** 27n).toString() };
  const nextAt = await nextReturnAt(identityKey);
  if (nextAt == null) return { eligible: false };
  const now = Math.floor(Date.now() / 1000);
  const r = await db.query(
    `SELECT action, status, tx_hash, created_at FROM action_submissions
      WHERE identity_key = $1 AND action IN ('welcome','return')
      ORDER BY id DESC LIMIT 10`,
    [identityKey]
  );
  const lastReturn = r.rows.find((x) => x.action === 'return') || null;
  const welcomeRow = r.rows.find((x) => x.action === 'welcome') || null;
  return {
    eligible: !!ret.active,
    reward: ret.reward,
    welcomeReward: welcome.reward,
    nextAt,
    claimable: now >= nextAt,
    serverNow: now, // client clocks drift; count down against ours
    lastDrop: lastReturn ? { status: lastReturn.status, txHash: lastReturn.tx_hash || null } : null,
    welcome: welcomeRow ? { status: welcomeRow.status, txHash: welcomeRow.tx_hash || null } : null,
  };
}

// ── payout worker: approved → claimWithSignature (voucher signed in-house) ──
async function payoutOne(row) {
  const d = distributor(new ethers.Wallet(config.relayerPrivateKey, provider()));
  const w = await db.query('SELECT address, smart_account FROM wallets WHERE identity_key = $1', [row.identity_key]);
  let user = (w.rows[0] && (w.rows[0].smart_account || w.rows[0].address)) || null;
  // MetaMask identities bring their own wallet (identity_key = metamask:<address>).
  if (!user && row.identity_key.startsWith('metamask:')) user = ethers.getAddress(row.identity_key.split(':')[1]);
  if (!user) throw new Error('no_wallet');

  if (await d.isActionClaimed(row.action_id)) {
    await db.query("UPDATE action_submissions SET status='paid', error='already_claimed_onchain', updated_at=now() WHERE id=$1", [row.id]);
    return;
  }
  if (!(await d.canPerform(user, row.action))) {
    // daily limit / cooldown — leave approved; a later sweep retries when the window opens.
    return;
  }
  const deadline = Math.floor(Date.now() / 1000) + 3600;
  const digest = await d.claimDigest(user, row.action, row.action_id, deadline);
  // Raw-digest ECDSA with the voucher signer (must equal the contract's `signer`).
  const sig = new ethers.SigningKey(config.voucherSignerPrivateKey).sign(digest).serialized;
  // Preflight: if the claim would revert (signer not yet rotated, distributor unfunded,
  // action not registered on-chain…), leave the row APPROVED and retry on a later sweep —
  // a config-stage revert must never brand the submission 'failed' forever (or burn gas).
  try {
    await d.claimWithSignature.staticCall(user, row.action, row.action_id, deadline, sig);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(`[actions] payout #${row.id} not clearable yet (${e.shortMessage || e.message}) — will retry`);
    return;
  }
  const tx = await d.claimWithSignature(user, row.action, row.action_id, deadline, sig);
  const rc = await tx.wait();
  await db.query(
    "UPDATE action_submissions SET status='paid', tx_hash=$2, updated_at=now() WHERE id=$1",
    [row.id, rc.hash || tx.hash]
  );
}

async function payoutSweep() {
  if (!config.incentiveDistributorAddress) return;
  const r = await db.query("SELECT * FROM action_submissions WHERE status='approved' ORDER BY id LIMIT 20");
  for (const row of r.rows) {
    try {
      await payoutOne(row);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[actions] payout #${row.id} failed:`, err.shortMessage || err.message);
      await db.query(
        "UPDATE action_submissions SET status='failed', error=$2, updated_at=now() WHERE id=$1",
        [row.id, String(err.shortMessage || err.message).slice(0, 200)]
      );
    }
  }
}

let _timer = null;
function startPayoutWorker() {
  if (_timer) return;
  _timer = setInterval(() => { payoutSweep().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[actions] sweep error:', err.message);
  }); }, config.actionsPayoutIntervalMs);
  if (_timer.unref) _timer.unref();
}
function stopPayoutWorker() { if (_timer) { clearInterval(_timer); _timer = null; } }

module.exports = { registry, userStats, submitAction, mySubmissions, claimPresence, dropStatus, payoutSweep, startPayoutWorker, stopPayoutWorker, detectPlatform };
