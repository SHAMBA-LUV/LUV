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
  res.json({ providers: ENABLED });
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
  res.json({
    provider,
    // The user-facing wallet: the ERC-4337 smart account when the AA rail is on, else the EOA.
    walletAddress: row.smart_account || row.address || null,
    ownerAddress: row.address || null,
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
