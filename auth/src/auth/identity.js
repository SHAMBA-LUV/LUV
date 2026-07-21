'use strict';

/*
 * identity.js — upsert a social identity and run first-login provisioning + airdrop.
 *
 * The identity key is the Sybil unit: `${provider}:${providerUserId}`. ONE identity =
 * ONE wallet = ONE claim. All three are upserts/idempotent so retries are safe.
 */

const db = require('../db');
const { config } = require('../config');
const { provisionWallet } = require('../wallet/provision');
// Primary gesture path: WALLET-TO-WALLET (0 fee). The signature-gated contract relay in
// airdrop/voucher.js remains an optional self-serve pull path (contract→EOA, fee-charged unless exempt).
// GESTURE_MODE=batch queues the delivery through LuvBatchGesture instead (one tx delivers N
// gestures — the Ethereum gas saver; each hop is still treasury EOA → signup EOA, 0 fee).
const { runGesture } = require('../airdrop/gesture');
const { enqueueGesture } = require('../airdrop/batch');

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
  const res = await db.query(
    `INSERT INTO identities (provider, provider_user_id, identity_key, email)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (identity_key) DO UPDATE SET email = COALESCE(EXCLUDED.email, identities.email)
     RETURNING (xmax = 0) AS inserted`,
    [profile.provider, profile.providerUserId, identityKey, profile.email || null]
  );
  const isNew = res.rows[0] && res.rows[0].inserted === true;
  return { identityKey, provider: profile.provider, isNew };
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
  // Both paths are idempotent (one claim row per identity); safe to call every login.
  const deliver = config.gestureMode === 'batch' ? enqueueGesture : runGesture;
  const airdrop = await deliver(identityKey, target).catch((err) => {
    // Never let an airdrop failure block login; surface via /airdrop/status.
    // eslint-disable-next-line no-console
    console.error('[identity] airdrop error (non-fatal):', err.message);
    return { status: 'failed', walletAddress: target, txHash: null };
  });
  return { walletAddress: target, ownerAddress: address, smartAccount, airdrop };
}

module.exports = { makeIdentityKey, upsertIdentity, ensureProvisionedAndAirdropped };
