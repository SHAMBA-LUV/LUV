'use strict';

/*
 * routes/auth.js — OAuth login redirects + callbacks, /me, /logout.
 *
 * On the FIRST login for an identity we provision the embedded wallet and trigger the airdrop;
 * on every login we (idempotently) ensure both exist, then issue a signed JWT session.
 */

const express = require('express');
const passport = require('passport');
const { enabledProviders } = require('../config');
const { config } = require('../config');
const db = require('../db');
const { upsertIdentity, ensureProvisionedAndAirdropped } = require('../auth/identity');
const { issueToken, setSessionCookie, clearSessionCookie, requireAuth } = require('../auth/session');

const router = express.Router();
const ENABLED = enabledProviders();

// Build a login + callback pair for each enabled provider.
function wireProvider(provider, scope) {
  // Kick off the OAuth dance.
  router.get(`/${provider}`, passport.authenticate(provider, { session: false, scope }));

  // Provider redirects back here.
  router.get(
    `/${provider}/callback`,
    passport.authenticate(provider, {
      session: false,
      failureRedirect: config.frontendFailureUrl,
    }),
    async (req, res) => {
      try {
        // req.user is the normalized profile from the strategy verify callback.
        const profile = req.user;
        const { identityKey, provider: prov } = await upsertIdentity(profile);

        // First-login (idempotent) provisioning + airdrop.
        await ensureProvisionedAndAirdropped(identityKey);

        const token = issueToken({ identityKey, provider: prov });
        setSessionCookie(res, token);
        return res.redirect(config.frontendSuccessUrl);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[auth] callback error:', err.message);
        return res.redirect(config.frontendFailureUrl);
      }
    }
  );
}

if (ENABLED.includes('google')) wireProvider('google', ['profile', 'email']);
if (ENABLED.includes('discord')) wireProvider('discord', ['identify', 'email']);
if (ENABLED.includes('github')) wireProvider('github', ['read:user', 'user:email']);

// List which providers are live (handy for the frontend to render buttons).
router.get('/providers', (req, res) => {
  res.json({ providers: ENABLED, wallet: true });
});

// ── MetaMask / wallet sign-in (challenge → personal_sign → verify) ──────────────
// Identity: `metamask:<address>` — a session like any other, BUT the 1T gesture stays
// gated to SOCIAL identities (a wallet is free to mint endlessly; social accounts are the
// Sybil unit — the lesson from the luvdrop audit). Wallet users get the dashboard, balance
// and the tasks rail on their OWN address; no custodial wallet is provisioned.
const jwt = require('jsonwebtoken');
const ethers = require('../ethers');

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

router.post('/wallet/challenge', (req, res) => {
  const { address } = req.body || {};
  if (typeof address !== 'string' || !ADDR_RE.test(address)) {
    return res.status(400).json({ error: 'bad_address' });
  }
  const checksummed = ethers.getAddress(address);
  const nonce = require('crypto').randomBytes(16).toString('hex');
  const message =
    `SHAMBA LUV ❤ sign-in\n\n` +
    `wallet: ${checksummed}\n` +
    `nonce: ${nonce}\n\n` +
    `Signing proves you control this wallet. This request costs nothing.`;
  // Stateless challenge: the message is bound to the address+nonce in a short-lived JWT.
  const challengeToken = jwt.sign(
    { sub: 'wallet-challenge', address: checksummed, nonce },
    config.jwtSecret,
    { expiresIn: 300, issuer: 'shambaluv-auth' }
  );
  res.json({ message, challengeToken });
});

router.post('/wallet/verify', async (req, res) => {
  const { address, signature, challengeToken } = req.body || {};
  if (typeof address !== 'string' || !ADDR_RE.test(address)
    || typeof signature !== 'string' || typeof challengeToken !== 'string') {
    return res.status(400).json({ error: 'invalid_request' });
  }
  let claim;
  try {
    claim = jwt.verify(challengeToken, config.jwtSecret, { issuer: 'shambaluv-auth' });
  } catch (e) {
    return res.status(400).json({ error: 'challenge_expired' });
  }
  const checksummed = ethers.getAddress(address);
  if (claim.sub !== 'wallet-challenge' || claim.address !== checksummed) {
    return res.status(400).json({ error: 'challenge_mismatch' });
  }
  const message =
    `SHAMBA LUV ❤ sign-in\n\n` +
    `wallet: ${claim.address}\n` +
    `nonce: ${claim.nonce}\n\n` +
    `Signing proves you control this wallet. This request costs nothing.`;
  let recovered;
  try {
    recovered = ethers.verifyMessage(message, signature);
  } catch (e) {
    return res.status(400).json({ error: 'bad_signature' });
  }
  if (recovered.toLowerCase() !== checksummed.toLowerCase()) {
    return res.status(401).json({ error: 'signature_mismatch' });
  }
  // Session identity — no custodial wallet, no automatic gesture (social-only Sybil gate).
  const { identityKey } = await upsertIdentity({
    provider: 'metamask',
    providerUserId: checksummed.toLowerCase(),
  });
  const token = issueToken({ identityKey, provider: 'metamask' });
  setSessionCookie(res, token);
  res.json({ ok: true, walletAddress: checksummed });
});

// Current session identity + wallet. Requires auth.
router.get('/me', requireAuth, async (req, res) => {
  const { identityKey, provider } = req.identity;
  const r = await db.query(
    `SELECT i.email, w.address, w.smart_account
       FROM identities i
       LEFT JOIN wallets w ON w.identity_key = i.identity_key
      WHERE i.identity_key = $1`,
    [identityKey]
  );
  const row = r.rows[0] || {};
  // MetaMask identities bring their OWN wallet (identity_key = metamask:<address>) —
  // no custodial row exists; the user-facing wallet is theirs.
  const selfWallet = provider === 'metamask' && !row.address
    ? require('../ethers').getAddress(identityKey.split(':')[1]) : null;
  res.json({
    provider,
    // The user-facing wallet: the ERC-4337 smart account when the AA rail is on, else the EOA.
    walletAddress: row.smart_account || row.address || selfWallet,
    ownerAddress: row.address || selfWallet,
    smartAccount: row.smart_account || null,
    // Do not echo the raw identity key publicly beyond what the session already holds.
    email: row.email || null,
  });
});

// Logout — clear the cookie. (Stateless JWT; client should also drop any Bearer token.)
router.post('/logout', (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

module.exports = router;
