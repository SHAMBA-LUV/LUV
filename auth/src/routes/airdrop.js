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
const { config } = require('../config');
const ethers = require('../ethers');
const db = require('../db');

const router = express.Router();

// Read-only chain access for balances/stats (the browser's CSP is connect-src 'self', so
// the backend proxies all chain reads). Failures degrade to nulls — never block the route.
const ERC20_READ_ABI = ['function balanceOf(address) view returns (uint256)'];
let _provider = null;
function provider() {
  if (!_provider) _provider = new ethers.JsonRpcProvider(config.rpcUrl, config.chainId);
  return _provider;
}
async function luvBalanceOf(address) {
  try {
    const luv = new ethers.Contract(config.luvTokenAddress, ERC20_READ_ABI, provider());
    return (await luv.balanceOf(address)).toString();
  } catch (e) {
    return null;
  }
}

function handleValidation(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ error: 'invalid_request' });
  return next();
}

// Has THIS identity claimed? wallet address? tx?  (read-only, but still session-gated)
// In batch mode a fresh signup reads 'queued'/'batching' until its batch confirms; `queue`
// tells the client roughly where it stands.
router.get('/status', requireAuth, async (req, res) => {
  const { identityKey } = req.identity;
  const status = await getGestureStatus(identityKey);
  const w = await db.query('SELECT address, smart_account FROM wallets WHERE identity_key = $1', [identityKey]);
  const row = w.rows[0] || {};
  // The user-facing wallet (and gesture target): the smart account when the AA rail is on.
  // MetaMask identities have no custodial row — their own address IS the wallet.
  const selfWallet = req.identity.provider === 'metamask' && !row.address
    ? ethers.getAddress(identityKey.split(':')[1]) : null;
  const walletAddress = row.smart_account || row.address || selfWallet;
  const pending = status && (status.status === 'queued' || status.status === 'batching');
  let queueDepth = null;
  if (pending) {
    const q = await db.query("SELECT COUNT(*)::int AS n FROM airdrop_claims WHERE status IN ('queued','batching')");
    queueDepth = q.rows[0].n;
  }
  res.json({
    walletAddress,
    ownerAddress: row.address || null,
    smartAccount: row.smart_account || null,
    luvBalance: walletAddress ? await luvBalanceOf(walletAddress) : null,
    claimed: !!status && (status.status === 'confirmed' || status.status === 'submitted'),
    queued: !!pending,
    queue: queueDepth === null ? undefined : { depth: queueDepth },
    claim: status || null,
  });
});

// ── The tasks rail (IncentiveDistributor actions) ──────────────────────────────
const actions = require('../actions');

// Public: the action registry (on-chain when configured, seeded fallback otherwise).
router.get('/actions', async (req, res) => {
  const { live, actions: list } = await actions.registry();
  res.json({ live, actions: list });
});

// Signed in: my submissions + my per-action on-chain stats (daily counts, cooldown clock).
router.get('/actions/mine', requireAuth, async (req, res) => {
  const { identityKey } = req.identity;
  const w = await db.query('SELECT address, smart_account FROM wallets WHERE identity_key = $1', [identityKey]);
  const wallet = (w.rows[0] && (w.rows[0].smart_account || w.rows[0].address)) || null;
  const { actions: list } = await actions.registry();
  const [submissions, stats] = await Promise.all([
    actions.mySubmissions(identityKey),
    actions.userStats(wallet, list.map((a) => a.name)),
  ]);
  res.json({ submissions, stats });
});

// Signed in: submit a proof URL for an action. Amounts/limits are the contract's alone.
router.post('/actions/submit', requireAuth, async (req, res) => {
  const { identityKey } = req.identity;
  const { action, proofUrl } = req.body || {};
  if (typeof action !== 'string' || action.length > 64) return res.status(400).json({ error: 'invalid_request' });
  const result = await actions.submitAction(identityKey, action, proofUrl);
  if (result.error) return res.status(400).json({ error: result.error });
  res.json(result);
});

// Public live stats for the landing page (no session; cheap DB counts + one chain read).
router.get('/stats', async (req, res) => {
  const agg = await db.query(
    `SELECT COUNT(*) FILTER (WHERE status IN ('submitted','confirmed'))::int AS delivered,
            COUNT(*) FILTER (WHERE status IN ('queued','batching'))::int    AS aboard
       FROM airdrop_claims`
  );
  const { delivered, aboard } = agg.rows[0];
  const capGestures = 1000; // 1% of supply / 1T per gesture
  res.json({
    totalSupply: '111111111111111111111111111111111111', // the 111-quad repunit (fixed at genesis)
    gesturesDelivered: delivered,
    gesturesAboard: aboard,
    gesturesRemaining: Math.max(0, capGestures - delivered),
    treasuryPool: config.relayerPrivateKey
      ? await luvBalanceOf(new ethers.Wallet(config.relayerPrivateKey).address)
      : null,
  });
});

// Idempotent trigger (normally auto on first login). Acts ONLY on the session identity.
// "Claim now": re-boards an expired self-claim voucher onto the luvbus, ensures the claim
// row, and (batch mode) asks the bus to depart — ONE operator-paid transaction delivers
// every queued rider at once.
router.post('/trigger', requireAuth, handleValidation, async (req, res) => {
  const { identityKey } = req.identity;
  try {
    // A 'pending' row is a self-claim voucher in flight; if its deadline passed unclaimed,
    // put the rider back on the bus.
    await db.query(
      `UPDATE airdrop_claims SET status='queued', nonce=NULL, deadline=NULL, updated_at=now()
        WHERE identity_key=$1 AND status='pending' AND deadline IS NOT NULL
          AND deadline < EXTRACT(EPOCH FROM now())::bigint`,
      [identityKey]
    );
    const result = await ensureProvisionedAndAirdropped(identityKey);
    if (config.gestureMode === 'batch' && config.batchGestureAddress) {
      const { flushBatch } = require('../airdrop/batch');
      flushBatch().catch((e) => {
        // eslint-disable-next-line no-console
        console.error('[airdrop] claim-now flush error (non-fatal):', e.message);
      });
    }
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

// ── ETH self-claim: a signed voucher for ShambaLuvAirdrop.claim() — the user's own wallet
// submits and pays gas; LUV goes to the identity's wallet either way. Taking a voucher
// steps the rider OFF the luvbus (status 'pending'); an expired unclaimed voucher re-boards
// via /trigger. On-chain usedNonce+hasClaimed and the UNIQUE identity row prevent doubles.
const { buildSignedVoucher, AIRDROP_ABI, allocateNonce } = require('../airdrop/voucher');
const ZERO = '0x0000000000000000000000000000000000000000';

router.post('/voucher', requireAuth, async (req, res) => {
  if (!config.airdropContractAddress || config.airdropContractAddress === ZERO) {
    return res.status(404).json({ error: 'campaign_not_live' });
  }
  const { identityKey } = req.identity;
  const r = await db.query('SELECT * FROM airdrop_claims WHERE identity_key=$1', [identityKey]);
  const row = r.rows[0];
  if (row && ['batching', 'submitted', 'confirmed'].includes(row.status)) {
    return res.status(409).json({ error: 'already_on_the_way', status: row.status });
  }
  const w = await db.query('SELECT address, smart_account FROM wallets WHERE identity_key=$1', [identityKey]);
  const recipient = (row && row.wallet_address)
    || (w.rows[0] && (w.rows[0].smart_account || w.rows[0].address)) || null;
  if (!recipient) return res.status(400).json({ error: 'no_wallet' });

  const now = Math.floor(Date.now() / 1000);
  let nonce; let deadline;
  if (row && row.status === 'pending' && row.nonce && Number(row.deadline) > now + 60) {
    nonce = BigInt(row.nonce); deadline = BigInt(row.deadline); // re-issue the live voucher
  } else {
    nonce = allocateNonce(); deadline = BigInt(now + config.voucherTtlSeconds);
    if (row) {
      await db.query(
        `UPDATE airdrop_claims SET status='pending', nonce=$2, deadline=$3, updated_at=now() WHERE identity_key=$1`,
        [identityKey, nonce.toString(), Number(deadline)]
      );
    } else {
      await db.query(
        `INSERT INTO airdrop_claims (identity_key, wallet_address, nonce, amount, deadline, status)
         VALUES ($1, $2, $3, $4, $5, 'pending')`,
        [identityKey, recipient, nonce.toString(), config.claimAmount.toString(), Number(deadline)]
      );
    }
  }

  const voucher = await buildSignedVoucher({ recipient, amount: config.claimAmount, nonce, deadline });
  // Pre-encoded calldata so the browser needs no ABI library (CSP: no CDNs).
  const iface = new ethers.Interface(AIRDROP_ABI);
  const data = iface.encodeFunctionData('claim', [
    voucher.recipient, voucher.amount, voucher.nonce, voucher.deadline, voucher.signature,
  ]);
  res.json({
    to: config.airdropContractAddress,
    data,
    chainId: config.chainId,
    voucher: {
      recipient: voucher.recipient,
      amount: voucher.amount.toString(),
      nonce: voucher.nonce.toString(),
      deadline: Number(voucher.deadline),
      signature: voucher.signature,
    },
  });
});

module.exports = router;
