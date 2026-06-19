'use strict';

/*
 * identity.js — upsert a social identity and run first-login provisioning + airdrop.
 *
 * The identity key is the Sybil unit: `${provider}:${providerUserId}`. ONE identity =
 * ONE wallet = ONE claim. All three are upserts/idempotent so retries are safe.
 */

const db = require('../db');
const { provisionWallet } = require('../wallet/provision');
// Primary gesture path: WALLET-TO-WALLET (0 fee). The signature-gated contract relay in
// airdrop/voucher.js remains an optional self-serve pull path (contract→EOA, fee-charged unless exempt).
const { runGesture } = require('../airdrop/gesture');

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
  const { address } = await provisionWallet(identityKey);
  // runGesture is idempotent (one claim row per identity); safe to call every login.
  // Wallet-to-wallet: treasury EOA → this EOA, 0 fee, full trillion.
  const airdrop = await runGesture(identityKey, address).catch((err) => {
    // Never let an airdrop failure block login; surface via /airdrop/status.
    // eslint-disable-next-line no-console
    console.error('[identity] airdrop error (non-fatal):', err.message);
    return { status: 'failed', walletAddress: address, txHash: null };
  });
  return { walletAddress: address, airdrop };
}

module.exports = { makeIdentityKey, upsertIdentity, ensureProvisionedAndAirdropped };
