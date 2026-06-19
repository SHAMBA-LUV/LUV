'use strict';

/*
 * routes/airdrop.js — /airdrop/status (read) and /airdrop/trigger (idempotent retry).
 * BOTH require a valid JWT session (the old backend had NO auth on state routes — fixed here).
 * The identity comes from the SESSION (req.identity), never from the request body, so a caller
 * can only ever act on their own identity.
 */

const express = require('express');
const { validationResult } = require('express-validator');
const { requireAuth } = require('../auth/session');
const { getGestureStatus } = require('../airdrop/gesture');
const { ensureProvisionedAndAirdropped } = require('../auth/identity');
const db = require('../db');

const router = express.Router();

function handleValidation(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ error: 'invalid_request' });
  return next();
}

// Has THIS identity claimed? wallet address? tx?  (read-only, but still session-gated)
router.get('/status', requireAuth, async (req, res) => {
  const { identityKey } = req.identity;
  const status = await getGestureStatus(identityKey);
  const w = await db.query('SELECT address FROM wallets WHERE identity_key = $1', [identityKey]);
  res.json({
    walletAddress: (w.rows[0] && w.rows[0].address) || null,
    claimed: !!status && (status.status === 'confirmed' || status.status === 'submitted'),
    claim: status || null,
  });
});

// Idempotent trigger (normally auto on first login). Acts ONLY on the session identity.
router.post('/trigger', requireAuth, handleValidation, async (req, res) => {
  const { identityKey } = req.identity;
  try {
    const result = await ensureProvisionedAndAirdropped(identityKey);
    res.json({
      walletAddress: result.walletAddress,
      airdrop: result.airdrop,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[airdrop] trigger error:', err.message);
    res.status(500).json({ error: 'airdrop_failed' });
  }
});

module.exports = router;
