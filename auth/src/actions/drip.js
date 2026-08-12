'use strict';

/*
 * actions/drip.js — the LUVdrip: A MILLION LUV A DAY, EARNED BY LOGGING IN.
 *
 * THE RULE (operator, 2026-08-11):
 *   Sign in and 1,000,000 LUV begins to drip. It keeps dripping for the ENTIRE 24 HOURS —
 *   against the wall clock, whether or not the tab is open, whether or not the session is
 *   still alive — until that window's million is complete. The NEXT million starts on the
 *   NEXT login. Log in once a day and the drip never stops; stay away and the last million
 *   simply finishes and waits.
 *
 * THE RATE
 *   1,000,000 LUV / 86,400 s = 11.574074… LUV per second = one LUV every 86.4 ms
 *   = 11,574,074,074,074,074,074.074 wei/s — but nothing here is ever computed per-second:
 *   `window_wei` is a PURE FUNCTION OF ELAPSED TIME,
 *       window_wei = cap × min(now − window_started_at, 24h) ÷ 24h      (integer, floored)
 *   so settlement is idempotent and drift-free. Ticking often, rarely, or never gives the
 *   same number, and no schedule/cron is needed for LUV to accrue. Full 18-dp integer wei
 *   throughout — approximation is display-only (cypherpunk4096, precision without approximation).
 *
 * THE TALLY
 *   Settled LUV accumulates in `banked_wei` and KEEPS accumulating across windows. It is a
 *   value, not a queue of drops: one number that grows until the participant delivers it.
 *
 * DELIVERY — one transaction, two possible payers (the on-chain rail is one function):
 *   SELF-PAID   the backend signs a redemption voucher; the PARTICIPANT submits
 *               IncentiveDistributor.redeemWithSignature() from their own wallet and SPENDS
 *               THEIR OWN ETH. Their wallet requires ETH — that is the ordinary path.
 *   SPONSORED   the project submits the SAME voucher (redeemWithSignature) or a whole pass of
 *               them (redeemBatch) and pays the gas itself. The participant needs no ETH.
 *               Used periodically, for everyone or for a selected set (e.g. activity rewards).
 *   The voucher names the recipient, so the LUV lands on the participant either way.
 *
 * The amount leaves `banked_wei` for `held_wei` while a voucher is live and returns if the
 * voucher expires unspent — the same LUV can never be redeemed twice, and nothing is lost
 * when a participant walks away from a voucher they never sent.
 */

const crypto = require('crypto');
const ethers = require('../ethers');
const { config } = require('../config');
const { getVoucherSigner } = require('../signer-vault');
const db = require('../db');

const DAY_MS = 86_400_000n;
const DAY_SEC = 86400;

/** The day's million, in wei. 1,000,000 LUV × 1e18. */
const DAILY_WEI = BigInt(config.dripDailyLuv) * 10n ** 18n;

const DIST_ABI = [
  // the drip's rate and asset are ON-CHAIN VARIABLES the owner retunes live — the chain is the
  // final word, this backend only reads them (setDrip(token, perDay))
  'function dripPerDay() view returns (uint256)',
  'function dripToken() view returns (address)',
  'function isAsset(address token) view returns (bool)',
  'function redeemDigest(address user, address token, uint256 amount, bytes32 redemptionId, uint256 deadline) view returns (bytes32)',
  'function redeemWithSignature(address user, address token, uint256 amount, bytes32 redemptionId, uint256 deadline, bytes signature)',
  'function redeemBatch((address user,address token,uint256 amount,bytes32 redemptionId,uint256 deadline,bytes signature)[] rs) returns (uint256)',
  'function isRedeemed(bytes32 redemptionId) view returns (bool)',
  'function maxRewardPerTx() view returns (uint256)',
  'function redeemBudgetRemaining() view returns (uint256)',
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

// ── the rate: an on-chain variable, read live ────────────────────────────────
//
// `setDrip(token, perDay)` on the distributor is the authority: the owner retunes the day's
// amount (and the asset it pays in) without a deploy or a restart. This backend caches the
// read for a minute and falls back to DRIP_DAILY_LUV when no distributor is configured.
// A window keeps the cap it was armed with, so a retune never rewrites a day already flowing —
// it takes effect on the next window a login arms.

let _rate = { at: 0, wei: null, token: null };
async function chainRate() {
  if (_rate.wei !== null && Date.now() - _rate.at < 60_000) return _rate;
  const fallback = { at: Date.now(), wei: BigInt(config.dripDailyLuv) * 10n ** 18n, token: config.luvTokenAddress };
  const d = distributor();
  if (d) {
    try {
      const [perDay, token] = await Promise.all([d.getFunction('dripPerDay')(), d.getFunction('dripToken')()]);
      _rate = { at: Date.now(), wei: BigInt(perDay), token };
      return _rate;
    } catch (e) { /* pre-drip distributor or RPC hiccup — the configured rate stands */ }
  }
  _rate = fallback;
  return _rate;
}
/** The day's amount for a NEW window, in wei. 0 ⇒ the owner has paused the drip on-chain. */
async function dailyWei() { return (await chainRate()).wei; }
/** The asset the drip pays in (must be a registered asset on the distributor). */
async function dripToken() { return (await chainRate()).token || config.luvTokenAddress; }

/**
 * Does the configured distributor carry the REDEEM rail? A deployment made before the drip has
 * no redeemDigest, so no voucher it issued could ever be signed or submitted. Cached with the
 * rate read: while this is false the drip still ACCRUES for everyone — only delivery waits.
 */
let _rail = { at: 0, ok: null };
async function railPresent() {
  if (_rail.ok !== null && Date.now() - _rail.at < 60_000) return _rail.ok;
  const d = distributor();
  if (!d) { _rail = { at: Date.now(), ok: false }; return false; }
  try {
    await d.getFunction('redeemDigest')(
      '0x0000000000000000000000000000000000000001', config.luvTokenAddress, 1n, ethers.ZeroHash, 1n
    );
    _rail = { at: Date.now(), ok: true };
  } catch (e) {
    _rail = { at: Date.now(), ok: false };
  }
  return _rail.ok;
}

// ── the meter ────────────────────────────────────────────────────────────────

/** LUV/s as a display number (11.574074…). The ledger never uses it. */
function perSecond(dailyLuvWei) {
  const wei = dailyLuvWei === undefined ? BigInt(config.dripDailyLuv) * 10n ** 18n : BigInt(dailyLuvWei);
  return Number(wei / 10n ** 18n) / DAY_SEC;
}

/** What the window has earned by `nowMs`: cap × elapsed ÷ 24h, floored, capped. */
function windowEarned(startedAtMs, capWei, nowMs) {
  let elapsed = BigInt(nowMs) - BigInt(startedAtMs);
  if (elapsed <= 0n) return 0n;
  if (elapsed > DAY_MS) elapsed = DAY_MS;
  return (capWei * elapsed) / DAY_MS;
}

const SELECT_STATE = `SELECT identity_key,
         (EXTRACT(EPOCH FROM window_started_at) * 1000)::bigint AS started_ms,
         (EXTRACT(EPOCH FROM window_ends_at) * 1000)::bigint    AS ends_ms,
         window_wei::text, cap_wei::text, banked_wei::text, held_wei::text,
         redeemed_wei::text, windows
    FROM drip_state WHERE identity_key = $1`;

function shape(row, nowMs) {
  const capWei = BigInt(row.cap_wei);
  const windowWei = BigInt(row.window_wei);
  return {
    identityKey: row.identity_key,
    windowStartedAt: Math.floor(Number(row.started_ms) / 1000),
    windowEndsAt: Math.floor(Number(row.ends_ms) / 1000),
    windowWei,
    capWei,
    windowRemainingWei: capWei > windowWei ? capWei - windowWei : 0n,
    bankedWei: BigInt(row.banked_wei),
    heldWei: BigInt(row.held_wei),
    redeemedWei: BigInt(row.redeemed_wei),
    windows: Number(row.windows),
    full: windowWei >= capWei,
    flowing: windowWei < capWei && nowMs < Number(row.ends_ms),
  };
}

/**
 * Settle the drip up to now (inside an open transaction), crediting whatever the clock owes.
 * Idempotent. Returns the settled row, or null when the identity has no drip yet.
 */
async function settleIn(client, identityKey, nowMs) {
  const r = await client.query(`${SELECT_STATE} FOR UPDATE`, [identityKey]);
  if (!r.rows[0]) return null;
  const row = r.rows[0];
  const capWei = BigInt(row.cap_wei);
  const earned = windowEarned(Number(row.started_ms), capWei, nowMs);
  const already = BigInt(row.window_wei);
  const delta = earned > already ? earned - already : 0n;
  if (delta > 0n) {
    const u = await client.query(
      `UPDATE drip_state
          SET window_wei = $2::numeric, banked_wei = banked_wei + $3::numeric,
              settled_at = now(), updated_at = now()
        WHERE identity_key = $1
        RETURNING (EXTRACT(EPOCH FROM window_started_at) * 1000)::bigint AS started_ms,
                  (EXTRACT(EPOCH FROM window_ends_at) * 1000)::bigint    AS ends_ms,
                  window_wei::text, cap_wei::text, banked_wei::text, held_wei::text,
                  redeemed_wei::text, windows, identity_key`,
      [identityKey, earned.toString(), delta.toString()]
    );
    return u.rows[0];
  }
  return row;
}

/**
 * A REAL sign-in arms a million. Called from upsertIdentity on every genuine login
 * (consent click / wallet signature) — never from a lingering session cookie.
 *
 * Settles first, then arms a FRESH 24-hour window only if the current one is finished
 * (its million is complete, or its 24 hours have run out). A login in the middle of a
 * live window changes nothing: that million is already flowing and keeps its own clock.
 */
async function armOnLogin(identityKey) {
  const nowMs = Date.now();
  const cap = await dailyWei();
  if (cap === 0n) return { armed: false, paused: true }; // the owner paused the drip on-chain
  return db.withTransaction(async (client) => {
    const settled = await settleIn(client, identityKey, nowMs);
    if (!settled) {
      // first ever sign-in: open the first window
      const ins = await client.query(
        `INSERT INTO drip_state (identity_key, window_started_at, window_ends_at, window_wei, cap_wei, settled_at, windows)
         VALUES ($1, now(), now() + make_interval(secs => $2), 0, $3::numeric, now(), 1)
         ON CONFLICT (identity_key) DO NOTHING
         RETURNING identity_key`,
        [identityKey, DAY_SEC, cap.toString()]
      );
      return { armed: !!ins.rows[0], firstWindow: true };
    }
    const capWei = BigInt(settled.cap_wei);
    const complete = BigInt(settled.window_wei) >= capWei || nowMs >= Number(settled.ends_ms);
    if (!complete) return { armed: false, firstWindow: false }; // this million is still flowing
    await client.query(
      `UPDATE drip_state
          SET window_started_at = now(), window_ends_at = now() + make_interval(secs => $2),
              window_wei = 0, cap_wei = $3::numeric, settled_at = now(),
              windows = windows + 1, updated_at = now()
        WHERE identity_key = $1`,
      [identityKey, DAY_SEC, cap.toString()]
    );
    return { armed: true, firstWindow: false };
  });
}

/**
 * COLLECT — bank what has flowed, and start the million over from this moment.
 *
 * The participant's own act. Whatever the window has dripped so far is settled into the
 * accumulated tally (where it waits for REDEEM), and a FRESH 24-hour million begins
 * immediately — the clock restarts on the press, not on the next login.
 *
 * It cannot be farmed, because the rate never changes: a window always pays 1,000,000 LUV
 * across 24 hours, so collecting hourly and collecting daily earn exactly the same LUV per
 * day. What COLLECT buys is not more LUV, it is CONTROL — the flow no longer stops at the
 * cap waiting for a login, and the participant decides when the meter turns over.
 */
async function collect(identityKey) {
  const nowMs = Date.now();
  const cap = await dailyWei(); // read the chain BEFORE opening the transaction
  if (cap === 0n) return { error: 'drip_paused' };
  return db.withTransaction(async (client) => {
    // settleIn has already moved everything this window owes into banked_wei; what it
    // credited is exactly this window's meter, which is what we report as collected.
    const row = await settleIn(client, identityKey, nowMs);
    if (!row) return { error: 'no_drip' };
    const collected = BigInt(row.window_wei);
    // A press must bank something worth a write. The meter is never truly empty — a
    // millisecond after the last collect it already holds wei — so the floor is ONE LUV,
    // which is also where the dashboard's button unlocks. Below that, pressing again is
    // refused rather than restarting the clock for dust and costing the participant the
    // fraction they had already earned.
    if (collected < MIN_COLLECT_WEI) return { error: 'nothing_to_collect', collectable: collected.toString() };

    await client.query(
      `UPDATE drip_state
          SET window_started_at = now(), window_ends_at = now() + make_interval(secs => $2),
              window_wei = 0, cap_wei = $3::numeric, settled_at = now(),
              windows = windows + 1, updated_at = now()
        WHERE identity_key = $1`,
      [identityKey, DAY_SEC, cap.toString()]
    );
    return {
      ok: true,
      // What THIS window had dripped when the button was pressed. It was already banked as
      // it flowed — settlement is continuous — so this is a report of the window's
      // contribution, never a second credit of the same LUV.
      collected: collected.toString(),
      accrued: row.banked_wei, // the whole tally, which already contains the above
      restarted: true,
      note: 'the clock restarts from this moment — a fresh million begins dripping',
    };
  });
}

/** Settle and read the meter. Safe to call on every dashboard poll. */
async function status(identityKey) {
  const nowMs = Date.now();
  const row = await db.withTransaction((client) => settleIn(client, identityKey, nowMs));
  const now = Math.floor(nowMs / 1000);
  if (!row) {
    const rate = await dailyWei();
    return {
      eligible: false, dailyLuv: (rate / 10n ** 18n).toString(), perSecond: perSecond(rate),
      serverNow: now, needsLogin: true, paused: rate === 0n,
    };
  }
  const s = shape(row, nowMs);
  const live = await liveVoucher(identityKey);
  return {
    eligible: true,
    // the figure for THIS window is the cap it was armed with; a mid-window retune never
    // rewrites a day already flowing (`nextDailyWei` is what the next login will arm)
    dailyLuv: (s.capWei / 10n ** 18n).toString(),
    dailyWei: s.capWei.toString(),
    nextDailyWei: (await dailyWei()).toString(),
    perSecond: perSecond(s.capWei),
    perSecondWei: (s.capWei / BigInt(DAY_SEC)).toString(), // display; the ledger uses elapsed×cap÷24h
    serverNow: now,
    // this window's million
    windowStartedAt: s.windowStartedAt,
    windowEndsAt: s.windowEndsAt,
    windowWei: s.windowWei.toString(),
    // what pressing COLLECT would bank this instant — the live meter, to the wei
    collectable: s.windowWei.toString(),
    windowRemainingWei: s.windowRemainingWei.toString(),
    capWei: s.capWei.toString(),
    flowing: s.flowing,
    full: s.full,
    // the accumulated tally
    accrued: s.bankedWei.toString(),        // what REDEEM would deliver
    heldWei: s.heldWei.toString(),          // inside a live voucher right now
    redeemedWei: s.redeemedWei.toString(),  // lifetime delivered on-chain
    windows: s.windows,
    // when the next million needs a login: the moment this one completes
    needsLogin: s.full || now >= s.windowEndsAt,
    minRedeemWei: MIN_REDEEM_WEI.toString(),
    minCollectWei: MIN_COLLECT_WEI.toString(),
    // false while the configured distributor predates the REDEEM rail: the drip still accrues,
    // only delivery waits on the deployment — the dashboard says exactly that.
    redeemOpen: await railPresent(),
    voucher: live,
  };
}

// ── redemption: the voucher, and who pays for it ─────────────────────────────

/** The smallest press worth a database write, and the button's unlock point: one LUV. */
const MIN_COLLECT_WEI = 10n ** 18n;

/** Never spend a transaction on less than this (default: one day's drip). */
const MIN_REDEEM_WEI = BigInt(config.dripMinRedeemLuv) * 10n ** 18n;

function newRedemptionId(identityKey) {
  return ethers.hexlify(
    crypto.createHash('sha256')
      .update(`${identityKey}\n${Date.now()}\n${crypto.randomBytes(16).toString('hex')}`)
      .digest()
  );
}

/** The participant's wallet: the smart account when the AA rail is on, else the EOA. */
async function walletFor(identityKey, client) {
  const q = client || db;
  const w = await q.query('SELECT address, smart_account FROM wallets WHERE identity_key = $1', [identityKey]);
  const row = w.rows[0] || {};
  if (row.smart_account || row.address) return row.smart_account || row.address;
  if (identityKey.startsWith('metamask:')) return ethers.getAddress(identityKey.split(':')[1]);
  return null;
}

/** A still-valid, unsent voucher for this identity (so a retry re-offers the same one). */
async function liveVoucher(identityKey) {
  const now = Math.floor(Date.now() / 1000);
  const r = await db.query(
    `SELECT redemption_id, wallet, token, amount_wei::text, deadline, payer, tx_hash, status
       FROM drip_redemptions
      WHERE identity_key = $1 AND status = 'pending' AND deadline > $2
      ORDER BY id DESC LIMIT 1`,
    [identityKey, now]
  );
  if (!r.rows[0]) return null;
  const v = r.rows[0];
  return {
    redemptionId: v.redemption_id, recipient: v.wallet, token: v.token,
    amount: v.amount_wei, deadline: Number(v.deadline), payer: v.payer,
  };
}

async function signVoucher(v) {
  const d = distributor();
  const digest = await d.getFunction('redeemDigest')(v.recipient, v.token, BigInt(v.amount), v.redemptionId, BigInt(v.deadline));
  const wallet = await getVoucherSigner();
  return wallet.signingKey.sign(digest).serialized;
}

/** Pre-encoded calldata so the browser needs no ABI library (CSP: no CDNs). */
function encodeRedeem(v, signature) {
  const iface = new ethers.Interface(DIST_ABI);
  return iface.encodeFunctionData('redeemWithSignature', [
    v.recipient, v.token, BigInt(v.amount), v.redemptionId, BigInt(v.deadline), signature,
  ]);
}

/**
 * Issue (or re-offer) a redemption voucher for the accumulated tally.
 *
 * The amount is held out of `banked_wei` for the life of the voucher. Whoever submits the
 * returned transaction pays its gas: hand it to the participant's wallet and THEY pay the
 * ETH; hand it to the relayer and the project sponsors it.
 *
 * @param {string} identityKey
 * @param {{ payer?: 'self'|'sponsor' }} opts
 */
async function issueVoucher(identityKey, opts) {
  const payer = (opts && opts.payer) === 'sponsor' ? 'sponsor' : 'self';
  if (!config.incentiveDistributorAddress) return { error: 'redeem_not_open' };

  // Is the REDEEM rail actually there? A distributor deployed before the drip carries no
  // redeemDigest, so a voucher could never be signed — say so BEFORE holding anyone's LUV.
  // The drip keeps accruing meanwhile; only delivery waits on the deployment.
  if (!(await railPresent())) return { error: 'redeem_not_open' };

  // Re-offer a live voucher rather than stranding its LUV in a second one.
  const existing = await liveVoucher(identityKey);
  if (existing) {
    let signature;
    try { signature = await signVoucher(existing); }
    catch (e) {
      // eslint-disable-next-line no-console
      console.warn(`[drip] could not sign the live voucher for ${identityKey}: ${e.shortMessage || e.message}`);
      return { error: 'redeem_not_open' };
    }
    return {
      ok: true, reoffered: true, payer: existing.payer,
      to: config.incentiveDistributorAddress, data: encodeRedeem(existing, signature), chainId: config.chainId,
      voucher: { ...existing, signature },
      amount: existing.amount,
    };
  }

  const nowMs = Date.now();
  const wallet = await walletFor(identityKey);
  if (!wallet) return { error: 'no_wallet' };

  // The per-transaction ceiling the contract itself enforces; anything above stays banked
  // and rides the next redemption.
  let cap = 0n;
  try { cap = BigInt(await distributor().getFunction('maxRewardPerTx')()); } catch (e) { cap = 0n; }

  const token = await dripToken();
  const deadline = Math.floor(nowMs / 1000) + config.dripVoucherTtlSeconds;
  const redemptionId = newRedemptionId(identityKey);

  const held = await db.withTransaction(async (client) => {
    const row = await settleIn(client, identityKey, nowMs);
    if (!row) return { error: 'no_drip' };
    let amount = BigInt(row.banked_wei);
    if (cap !== 0n && amount > cap) amount = cap;
    if (amount < MIN_REDEEM_WEI) return { error: 'nothing_to_redeem', accrued: row.banked_wei };
    await client.query(
      `UPDATE drip_state
          SET banked_wei = banked_wei - $2::numeric, held_wei = held_wei + $2::numeric, updated_at = now()
        WHERE identity_key = $1`,
      [identityKey, amount.toString()]
    );
    await client.query(
      `INSERT INTO drip_redemptions (identity_key, redemption_id, wallet, token, amount_wei, deadline, payer)
       VALUES ($1, $2, $3, $4, $5::numeric, $6, $7)`,
      [identityKey, redemptionId, wallet, token, amount.toString(), deadline, payer]
    );
    return { amount };
  });
  if (held.error) return held;

  const voucher = {
    redemptionId, recipient: wallet, token,
    amount: held.amount.toString(), deadline, payer,
  };
  let signature;
  try {
    signature = await signVoucher(voucher);
  } catch (e) {
    // The hold must never outlive the failure that caused it: hand the LUV straight back.
    await releaseExpired(redemptionId);
    // eslint-disable-next-line no-console
    console.warn(`[drip] voucher signing failed for ${identityKey} (${e.shortMessage || e.message}) — tally restored`);
    return { error: 'redeem_not_open' };
  }
  return {
    ok: true, payer,
    to: config.incentiveDistributorAddress,
    data: encodeRedeem(voucher, signature),
    chainId: config.chainId,
    voucher: { ...voucher, signature },
    amount: voucher.amount,
  };
}

/** Mark a voucher delivered (idempotent) and move its amount into the lifetime total. */
async function markPaid(redemptionId, txHash) {
  await db.withTransaction(async (client) => {
    const r = await client.query(
      `UPDATE drip_redemptions SET status='paid', tx_hash=COALESCE($2, tx_hash), updated_at=now()
        WHERE redemption_id=$1 AND status='pending'
        RETURNING identity_key, amount_wei::text`,
      [redemptionId, txHash || null]
    );
    if (!r.rows[0]) return;
    await client.query(
      `UPDATE drip_state
          SET held_wei = GREATEST(held_wei - $2::numeric, 0), redeemed_wei = redeemed_wei + $2::numeric,
              updated_at = now()
        WHERE identity_key = $1`,
      [r.rows[0].identity_key, r.rows[0].amount_wei]
    );
  });
}

/** Return an expired-unsent voucher's LUV to the tally — nothing is ever lost by not sending. */
async function releaseExpired(redemptionId) {
  await db.withTransaction(async (client) => {
    const r = await client.query(
      `UPDATE drip_redemptions SET status='expired', updated_at=now()
        WHERE redemption_id=$1 AND status='pending'
        RETURNING identity_key, amount_wei::text`,
      [redemptionId]
    );
    if (!r.rows[0]) return;
    await client.query(
      `UPDATE drip_state
          SET held_wei = GREATEST(held_wei - $2::numeric, 0), banked_wei = banked_wei + $2::numeric,
              updated_at = now()
        WHERE identity_key = $1`,
      [r.rows[0].identity_key, r.rows[0].amount_wei]
    );
  });
}

/**
 * Reconcile pending vouchers against the chain: delivered ones become 'paid', expired ones
 * hand their LUV back to the tally. The chain is the source of truth — a participant who
 * submits a voucher from their own wallet never tells us they did.
 */
async function reconcile() {
  const d = distributor();
  if (!d) return { checked: 0 };
  const now = Math.floor(Date.now() / 1000);
  const r = await db.query(
    `SELECT redemption_id, deadline FROM drip_redemptions WHERE status='pending' ORDER BY id LIMIT 200`
  );
  let paid = 0; let expired = 0;
  for (const row of r.rows) {
    let delivered = false;
    try { delivered = await d.getFunction('isRedeemed')(row.redemption_id); } catch (e) { continue; }
    if (delivered) { await markPaid(row.redemption_id, null); paid++; }
    else if (Number(row.deadline) <= now) { await releaseExpired(row.redemption_id); expired++; }
  }
  return { checked: r.rows.length, paid, expired };
}

// ── sponsorship: the project pays the gas and redeems on their behalf ────────
//
// Same voucher, same contract function — only the sender (and so the gas payer) differs.
// Periodic, and selectable: everyone with a redeemable tally, or a chosen set (activity
// rewards). Guardrails mirror the sponsored-claim path: gas ceiling + relayer balance.

/** Identities holding at least `min` accrued LUV — the candidate list for a sponsored pass. */
async function sponsorCandidates(limit) {
  const r = await db.query(
    `SELECT identity_key, banked_wei::text FROM drip_state
      WHERE banked_wei >= $1::numeric
      ORDER BY banked_wei DESC LIMIT $2`,
    [MIN_REDEEM_WEI.toString(), limit || 200]
  );
  return r.rows.map((x) => ({ identityKey: x.identity_key, accrued: x.banked_wei }));
}

/**
 * Sponsor a redemption pass: the project sends the transaction(s) and pays the gas for the
 * listed participants. Pass identity keys to sponsor a SELECTED set (e.g. the most active),
 * or omit them to sponsor EVERYONE currently holding a redeemable tally.
 *
 * Batches of up to 200 clear in a single redeemBatch() — one transaction for the whole set.
 */
async function sponsorRedeem(identityKeys, opts) {
  const o = opts || {};
  if (!config.incentiveDistributorAddress) return { error: 'redeem_not_open' };
  if (!config.relayerPrivateKey) return { error: 'no_relayer' };
  if (!config.dripSponsor && !o.force) return { error: 'sponsor_off' };

  const keys = identityKeys && identityKeys.length
    ? identityKeys
    : (await sponsorCandidates(o.limit || config.dripSponsorBatchSize)).map((c) => c.identityKey);
  if (!keys.length) return { ok: true, sponsored: 0, note: 'nobody has a redeemable tally' };

  // Gas guardrails: the ceiling first, then the tank.
  const fee = await provider().getFeeData();
  const gp = fee.maxFeePerGas || fee.gasPrice || 0n;
  const gwei = Number(gp) / 1e9;
  if (!o.force && gwei > config.sponsorMaxGwei) {
    return { error: 'gas_too_high', gwei: Math.round(gwei * 1000) / 1000, ceiling: config.sponsorMaxGwei };
  }
  const relayer = new ethers.Wallet(config.relayerPrivateKey, provider());
  const bal = await provider().getBalance(relayer.address);
  if (bal < gp * 200000n) return { error: 'relayer_empty' };

  const vouchers = [];
  for (const key of keys.slice(0, config.dripSponsorBatchSize)) {
    const v = await issueVoucher(key, { payer: 'sponsor' });
    if (v.ok) vouchers.push(v.voucher);
  }
  if (!vouchers.length) return { ok: true, sponsored: 0, note: 'no redeemable tallies in the selection' };

  const d = distributor(relayer);
  const rs = vouchers.map((v) => [v.recipient, v.token, BigInt(v.amount), v.redemptionId, BigInt(v.deadline), v.signature]);
  try {
    await d.getFunction('redeemBatch').staticCall(rs);
    const tx = await d.getFunction('redeemBatch')(rs);
    const rc = await tx.wait();
    const hash = rc.hash || tx.hash;
    // redeemBatch SKIPS unusable entries rather than reverting, so confirm each against the
    // chain instead of assuming the whole batch landed.
    let sponsored = 0;
    for (const v of vouchers) {
      let delivered = false;
      try { delivered = await distributor().getFunction('isRedeemed')(v.redemptionId); } catch (e) { /* recheck next reconcile */ }
      if (delivered) { await markPaid(v.redemptionId, hash); sponsored++; }
    }
    return { ok: true, txHash: hash, sponsored, offered: vouchers.length };
  } catch (err) {
    // Nothing landed — hand every held amount straight back to its tally.
    for (const v of vouchers) await releaseExpired(v.redemptionId);
    const m = String((err && (err.shortMessage || err.message)) || err);
    // eslint-disable-next-line no-console
    console.warn(`[drip] sponsored redeem not clearable (${m})`);
    return { error: /NotDistributor|Paused|transfer|budget/i.test(m) ? 'redeem_not_open' : 'sponsor_failed' };
  }
}

/**
 * Sponsor ONE participant (the project pays their gas). The single-voucher form of the pass
 * above — used by POST /airdrop/redeem, the gas-free rail the dashboard falls back to.
 */
async function sponsorOne(identityKey, opts) {
  const o = opts || {};
  if (!config.incentiveDistributorAddress) return { error: 'redeem_not_open' };
  if (!config.relayerPrivateKey) return { error: 'no_relayer' };
  if (!config.dripSponsor && !o.force) return { error: 'sponsor_off' };

  const fee = await provider().getFeeData();
  const gp = fee.maxFeePerGas || fee.gasPrice || 0n;
  const gwei = Number(gp) / 1e9;
  if (!o.force && gwei > config.sponsorMaxGwei) {
    return { error: 'gas_too_high', gwei: Math.round(gwei * 1000) / 1000, ceiling: config.sponsorMaxGwei };
  }
  const relayer = new ethers.Wallet(config.relayerPrivateKey, provider());
  if ((await provider().getBalance(relayer.address)) < gp * 200000n) return { error: 'relayer_empty' };

  const v = await issueVoucher(identityKey, { payer: 'sponsor' });
  if (!v.ok) return v;
  const d = distributor(relayer);
  const args = [v.voucher.recipient, v.voucher.token, BigInt(v.voucher.amount), v.voucher.redemptionId,
    BigInt(v.voucher.deadline), v.voucher.signature];
  try {
    await d.getFunction('redeemWithSignature').staticCall(...args);
    const tx = await d.getFunction('redeemWithSignature')(...args);
    const rc = await tx.wait();
    const hash = rc.hash || tx.hash;
    await markPaid(v.voucher.redemptionId, hash);
    return { ok: true, txHash: hash, redeemed: v.voucher.amount, payer: 'sponsor' };
  } catch (err) {
    await releaseExpired(v.voucher.redemptionId); // straight back to the tally
    const m = String((err && (err.shortMessage || err.message)) || err);
    // eslint-disable-next-line no-console
    console.warn(`[drip] sponsored redeem for ${identityKey} not clearable (${m})`);
    return { error: /NotDistributor|Paused|transfer|Budget/i.test(m) ? 'redeem_not_open' : 'redeem_failed' };
  }
}

// ── the workers ──────────────────────────────────────────────────────────────

let _timer = null;
function startReconciler() {
  if (_timer || !config.incentiveDistributorAddress) return;
  _timer = setInterval(() => {
    reconcile().catch((err) => {
      // eslint-disable-next-line no-console
      console.error('[drip] reconcile error:', err.message);
    });
  }, config.dripReconcileIntervalMs);
  if (_timer.unref) _timer.unref();
}
function stopReconciler() { if (_timer) { clearInterval(_timer); _timer = null; } }

/**
 * The PERIODIC SPONSORED PASS: every DRIP_SPONSOR_AUTO_INTERVAL_MS the project redeems on
 * behalf of everyone holding a redeemable tally, paying the gas itself. OFF by default (0) —
 * sponsorship is a decision the operator makes, never a standing spend that starts by itself.
 * The gas ceiling and the relayer's balance still gate every pass.
 */
let _sponsorTimer = null;
function startSponsorPass() {
  if (_sponsorTimer || !config.dripSponsorAutoIntervalMs || !config.dripSponsor) return;
  _sponsorTimer = setInterval(() => {
    sponsorRedeem(null, {}).then((r) => {
      if (r && r.sponsored) {
        // eslint-disable-next-line no-console
        console.log(`[drip] sponsored pass: ${r.sponsored} redeemed in ${r.txHash}`);
      }
    }).catch((err) => {
      // eslint-disable-next-line no-console
      console.error('[drip] sponsored pass error:', err.message);
    });
  }, config.dripSponsorAutoIntervalMs);
  if (_sponsorTimer.unref) _sponsorTimer.unref();
}
function stopSponsorPass() { if (_sponsorTimer) { clearInterval(_sponsorTimer); _sponsorTimer = null; } }

module.exports = {
  DAILY_WEI, MIN_REDEEM_WEI, MIN_COLLECT_WEI, perSecond, windowEarned, dailyWei, dripToken, railPresent,
  armOnLogin, status, collect, issueVoucher, liveVoucher,
  markPaid, releaseExpired, reconcile,
  sponsorCandidates, sponsorRedeem, sponsorOne,
  startReconciler, stopReconciler, startSponsorPass, stopSponsorPass,
};
