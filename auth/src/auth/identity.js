'use strict';

/*
 * identity.js — upsert a social identity and run first-login provisioning + airdrop.
 *
 * The identity key is the Sybil unit: `${provider}:${providerUserId}`. ONE identity =
 * ONE wallet = ONE claim. All three are upserts/idempotent so retries are safe.
 */

const db = require('../db');
const internalCalc = require('../internal/calculation');
const drip = require('../actions/drip');
const { config } = require('../config');
const { provisionWallet } = require('../wallet/provision');
// Primary gesture path: WALLET-TO-WALLET (0 fee). The signature-gated contract relay in
// airdrop/voucher.js remains an optional self-serve pull path (contract→EOA, fee-charged unless exempt).
// GESTURE_MODE=batch queues the delivery through LuvBatchGesture instead (one tx delivers N
// gestures — the Ethereum gas saver; each hop is still treasury EOA → signup EOA, 0 fee).
const { runGesture } = require('../airdrop/gesture');
const { enqueueGesture } = require('../airdrop/batch');
// GESTURE_MODE=voucher (self-serve / LUVbus): on login just SIGN + STORE a claim voucher and
// board the rider onto the bus — NO relay. The rider submits claim() themselves (pays own gas),
// or anyone sweeps all waiting riders in one Multicall3 tx (GET /airdrop/bus). Source = the
// funded ShambaLuvAirdrop pool. Nothing is auto-spent by the backend in this mode.
const { boardBus } = require('../airdrop/voucher');

function makeIdentityKey(provider, providerUserId) {
  return `${provider}:${providerUserId}`;
}

/**
 * Upsert an identity from a normalized social profile.
 * @param {{ provider: string, providerUserId: string, email?: string }} profile
 * @returns {Promise<{ identityKey: string, provider: string, isNew: boolean }>}
 */
async function upsertIdentity(profile) {
  const identityKey = makeIdentityKey(profile.provider, profile.providerUserId);
  // last_login_at stamps every REAL sign-in (consent click / wallet signature) — the
  // daily-login timer gate reads it; a lingering session cookie never updates it.
  const res = await db.query(
    `INSERT INTO identities (provider, provider_user_id, identity_key, email, last_login_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (identity_key) DO UPDATE
        SET email = COALESCE(EXCLUDED.email, identities.email), last_login_at = now()
     RETURNING (xmax = 0) AS inserted`,
    [profile.provider, profile.providerUserId, identityKey, profile.email || null]
  );
  const isNew = res.rows[0] && res.rows[0].inserted === true;
  // THE LOGIN ARMS A MILLION. This is the one place a REAL sign-in is known, so it is where
  // the LUVdrip's 24-hour window opens: 1,000,000 LUV then drips for the full day, wall-clock,
  // whether or not the tab stays open, and the next million waits for the next login. A login
  // inside a still-flowing window changes nothing (armOnLogin settles and leaves it running).
  // Social identities only — the Sybil unit is a social account, not a free-to-mint wallet.
  // Never throws: a login must not fail because the drip ledger did.
  if (profile.provider !== 'metamask') {
    await drip.armOnLogin(identityKey).catch((err) => {
      // eslint-disable-next-line no-console
      console.error('[identity] drip arm error (non-fatal):', err.message);
    });
  }
  // internal.calculation — record LUV earned in the trailing 24h for this identity at the
  // moment of a real sign-in. recordOnLogin never throws: a login must not fail because
  // bookkeeping did.
  const calculation = await internalCalc.recordOnLogin(identityKey, 'login');
  return { identityKey, provider: profile.provider, isNew, calculation };
}

/**
 * Ensure the identity has a wallet, and (on first login) trigger the airdrop. Idempotent.
 * Returns a summary used to issue the session and (optionally) report status.
 */
async function ensureProvisionedAndAirdropped(identityKey) {
  const { address, smartAccount } = await provisionWallet(identityKey);
  // ERC-4337 rail: the gesture targets the COUNTERFACTUAL LuvAccount — no code there yet,
  // so the hop is wallet-to-wallet (0 fee, full trillion) exactly like the EOA path. The
  // account materializes on the user's first UserOperation. Without the AA rail configured,
  // the owner EOA remains the target (legacy behavior).
  const target = smartAccount || address;
  // Airdrop concluded (one-year campaign closed): provision the wallet so login/send/receive keep
  // working, but deliver NOTHING new. Existing balances are already on-chain and untouched.
  if (config.airdropClosed) {
    return { walletAddress: target, ownerAddress: address, smartAccount, airdrop: { status: 'closed', walletAddress: target, txHash: null } };
  }
  // All paths are idempotent (one claim row per identity); safe to call every login.
  const deliver = config.gestureMode === 'batch' ? enqueueGesture
    : config.gestureMode === 'voucher' ? boardBus
      : runGesture;
  const airdrop = await deliver(identityKey, target).catch((err) => {
    // Never let an airdrop failure block login; surface via /airdrop/status.
    // eslint-disable-next-line no-console
    console.error('[identity] airdrop error (non-fatal):', err.message);
    return { status: 'failed', walletAddress: target, txHash: null };
  });
  return { walletAddress: target, ownerAddress: address, smartAccount, airdrop };
}

module.exports = { makeIdentityKey, upsertIdentity, ensureProvisionedAndAirdropped };
