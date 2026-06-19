'use strict';

/*
 * provision.js — sovereign wallet provisioning (cypherpunk2048 standard).
 *
 * WALLET HOSTING (cypherpunk2048: sovereign · self-hosted · clean-room · no remote dependency):
 *   The user's EVM private key is generated in our OWN infrastructure and stored encrypted at
 *   rest with AES-256-GCM. The encryption key is derived per-user via scrypt from
 *   WALLET_ENCRYPTION_KEY (the master secret, env-only) + the user's identity key, so the DB
 *   ciphertext alone is inert without the master secret. This first cut keeps the master secret
 *   server-side only to make the gifted airdrop balance frictionless ("1 identity = 1 wallet").
 *   The cypherpunk2048 TARGET is operator-CANNOT-spend: split key custody via a passkey/WebAuthn
 *   or user-secret key-share (2-of-2), MPC/TSS, and/or ERC-4337 user-owned smart accounts (the
 *   DeltaVerse twengine/contracts/wallet stack) so no operator ever holds spend authority. The DB
 *   columns and this interface are shaped so the key material migrates out without schema changes.
 *
 * Idempotent: exactly one wallet per identity (enforced by the UNIQUE constraint in DB).
 */

const crypto = require('crypto');
const ethers = require('../ethers');
const { config } = require('../config');
const db = require('../db');

const ALG = 'aes-256-gcm';
const KEY_LEN = 32; // 256-bit
const IV_LEN = 12; // GCM standard nonce length

// Derive a per-user 256-bit key from the master key + identity key using scrypt.
function deriveKey(identityKey) {
  const master = Buffer.from(config.walletEncryptionKey, 'hex');
  if (master.length < 16) {
    throw new Error('WALLET_ENCRYPTION_KEY must be a strong hex key (>= 32 hex chars)');
  }
  // salt binds the derived key to this specific identity.
  const salt = crypto.createHash('sha256').update(`shambaluv:${identityKey}`).digest();
  return crypto.scryptSync(master, salt, KEY_LEN, { N: 16384, r: 8, p: 1 });
}

function encryptPrivateKey(identityKey, privateKeyHex) {
  const key = deriveKey(identityKey);
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALG, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(privateKeyHex.replace(/^0x/, ''), 'hex')),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
  };
}

function decryptPrivateKey(identityKey, enc) {
  const key = deriveKey(identityKey);
  const decipher = crypto.createDecipheriv(ALG, key, Buffer.from(enc.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(enc.tag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(enc.ciphertext, 'base64')),
    decipher.final(),
  ]);
  return '0x' + plaintext.toString('hex');
}

/**
 * Provision (or fetch) the embedded wallet for an identity. Idempotent.
 * @returns {Promise<{ address: string, created: boolean }>}
 */
async function provisionWallet(identityKey) {
  // Fast path: already provisioned.
  const existing = await db.query('SELECT address FROM wallets WHERE identity_key = $1', [
    identityKey,
  ]);
  if (existing.rowCount > 0) {
    return { address: existing.rows[0].address, created: false };
  }

  const wallet = ethers.Wallet.createRandom();
  const enc = encryptPrivateKey(identityKey, wallet.privateKey);

  try {
    await db.query(
      `INSERT INTO wallets (identity_key, address, enc_ciphertext, enc_iv, enc_tag, enc_alg)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [identityKey, wallet.address, enc.ciphertext, enc.iv, enc.tag, 'AES-256-GCM']
    );
  } catch (err) {
    // Unique-violation => a concurrent request provisioned first; return that wallet.
    if (err && err.code === '23505') {
      const row = await db.query('SELECT address FROM wallets WHERE identity_key = $1', [
        identityKey,
      ]);
      if (row.rowCount > 0) return { address: row.rows[0].address, created: false };
    }
    throw err;
  }

  return { address: wallet.address, created: true };
}

/**
 * Load and decrypt a user's signer (only if the backend ever needs to sign AS the user).
 * The airdrop flow does NOT need this — the recipient does not sign anything. Provided for
 * completeness / future on-chain actions on the user's behalf.
 * @returns {Promise<import('ethers').Wallet>}
 */
async function getUserSigner(identityKey, provider) {
  const row = await db.query(
    'SELECT enc_ciphertext, enc_iv, enc_tag FROM wallets WHERE identity_key = $1',
    [identityKey]
  );
  if (row.rowCount === 0) throw new Error('No wallet for identity');
  const pk = decryptPrivateKey(identityKey, {
    ciphertext: row.rows[0].enc_ciphertext,
    iv: row.rows[0].enc_iv,
    tag: row.rows[0].enc_tag,
  });
  return provider ? new ethers.Wallet(pk, provider) : new ethers.Wallet(pk);
}

async function getWalletAddress(identityKey) {
  const row = await db.query('SELECT address FROM wallets WHERE identity_key = $1', [identityKey]);
  return row.rowCount > 0 ? row.rows[0].address : null;
}

module.exports = {
  provisionWallet,
  getUserSigner,
  getWalletAddress,
  // exported for tests
  _encryptPrivateKey: encryptPrivateKey,
  _decryptPrivateKey: decryptPrivateKey,
};
