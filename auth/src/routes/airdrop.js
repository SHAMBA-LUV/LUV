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

// Airdrop concluded — every mutating claim path returns a friendly 410. Reads (/status, /stats) stay
// open so past claimers still see their redeemed balance. Redeemed is redeemed; nothing new is minted.
function closedGuard(req, res, next) {
  if (config.airdropClosed) {
    return res.status(410).json({ error: 'airdrop_closed', message: 'The airdrop has concluded — thank you ❤ LUV is now live on Uniswap.' });
  }
  next();
}

// Tight per-client limiter for the sensitive WRITE actions only (claim/voucher/trigger/submit).
// Reads (status/gas/stats/actions) are NOT throttled here — they're under the app-wide limiter —
// so a read-heavy dashboard can never rate-limit a user out of claiming.
const rateLimit = require('express-rate-limit');
const writeLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false });

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
  let status = await getGestureStatus(identityKey);
  // Reconcile self-serve claims → confirmed once delivered on-chain. We check usedNonce(nonce)
  // FIRST (recipient-independent) so a claim sent to a CUSTOM receive address still confirms,
  // then hasClaimed(address) as a fallback.
  if (status && status.status === 'pending'
      && config.airdropContractAddress && config.airdropContractAddress !== '0x0000000000000000000000000000000000000000') {
    try {
      const cr = await db.query('SELECT nonce, wallet_address FROM airdrop_claims WHERE identity_key=$1', [identityKey]);
      const claimRow = cr.rows[0] || {};
      const ad = new ethers.Contract(config.airdropContractAddress,
        ['function hasClaimed(address) view returns (bool)', 'function usedNonce(uint256) view returns (bool)'], provider());
      const delivered = (claimRow.nonce && await ad.usedNonce(claimRow.nonce))
        || (claimRow.wallet_address && await ad.hasClaimed(claimRow.wallet_address));
      if (delivered) {
        await db.query("UPDATE airdrop_claims SET status='confirmed', updated_at=now() WHERE identity_key=$1", [identityKey]);
        status = await getGestureStatus(identityKey);
      }
    } catch (e) { /* non-fatal — the on-chain claim() is the real guard */ }
  }
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
router.post('/actions/submit', writeLimiter, requireAuth, async (req, res) => {
  const { identityKey } = req.identity;
  const { action, proofUrl } = req.body || {};
  if (typeof action !== 'string' || action.length > 64) return res.status(400).json({ error: 'invalid_request' });
  const result = await actions.submitAction(identityKey, action, proofUrl);
  if (result.error) return res.status(400).json({ error: result.error });
  res.json(result);
});

// ── The daily LUVdrop (presence claims — NOT part of the closed airdrop) ───────────────
// Signed in: my drop clock — reward, nextAt (epoch s), claimable, today's delivery state.
// The frontend counts down against serverNow and calls POST /return when the clock hits zero.
router.get('/drop', requireAuth, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    res.json(await actions.dropStatus(req.identity.identityKey, req.identity.provider));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[airdrop] drop status error:', err.message);
    res.status(500).json({ error: 'drop_unavailable' });
  }
});

// Signed in: REDEEM — deliver ALL accumulated presence LUV in one distributeReward tx.
// The participant decides when the accumulated value is worth a transaction; the frontend
// shows value vs estimated gas so the decision is informed.
router.post('/redeem', writeLimiter, requireAuth, async (req, res) => {
  try {
    const result = await actions.redeemAccrued(req.identity.identityKey);
    if (result.error) {
      const code = result.error === 'gas_too_high' || result.error === 'relayer_empty' ? 503
        : result.error === 'redeem_failed' ? 500 : 400;
      return res.status(code).json(result);
    }
    res.json(result);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[airdrop] redeem error:', err.message);
    res.status(500).json({ error: 'redeem_failed' });
  }
});

// Signed in: collect today's return drop. Idempotent: dedup rows, on-chain actionId dedup,
// and the contract's 24h cooldown all point the same way. Social identities only.
router.post('/return', writeLimiter, requireAuth, async (req, res) => {
  try {
    const result = await actions.claimPresence(req.identity.identityKey, req.identity.provider, 'return');
    if (result.error) {
      const code = result.error === 'come_back_soon' ? 425 : 400;
      return res.status(code).json(result);
    }
    res.json(result);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[airdrop] return claim error:', err.message);
    res.status(500).json({ error: 'return_failed' });
  }
});

// Public live stats for the landing page (no session; cheap DB counts + one chain read).
router.get('/stats', async (req, res) => {
  const agg = await db.query(
    `SELECT COUNT(*) FILTER (WHERE status IN ('submitted','confirmed'))::int        AS delivered,
            COUNT(*) FILTER (WHERE status IN ('queued','batching','pending'))::int  AS aboard
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
router.post('/trigger', closedGuard, writeLimiter, requireAuth, handleValidation, async (req, res) => {
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
const { buildSignedVoucher, AIRDROP_ABI, ensurePendingVoucher, sponsoredClaim } = require('../airdrop/voucher');
const ZERO = '0x0000000000000000000000000000000000000000';

// The LUVbus: canonical Multicall3 (same address on every chain). Anyone can "drive" — submit
// ONE tx that runs claim() for every waiting rider, paying the gas FOR ALL of them. claim() is
// caller-agnostic (the voucher names the recipient), so the driver needs no special role.
const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11';
const MULTICALL3_ABI = [
  'function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[])',
];

// Self-serve claim voucher: the user's OWN wallet submits and pays gas — claim WHENEVER you
// like. Optional `recipient` in the body directs the gesture to ANY address you choose (not
// just the wallet we created for you). The nonce is stable per identity, so switching the
// receive address can never double-claim: whichever address claims first wins, the rest revert.
router.post('/voucher', closedGuard, writeLimiter, requireAuth, async (req, res) => {
  if (!config.airdropContractAddress || config.airdropContractAddress === ZERO) {
    return res.status(404).json({ error: 'campaign_not_live' });
  }
  const { identityKey } = req.identity;

  // Optional custom receive address (validated, checksummed). Falls back to the wallet on file.
  let recipient = null;
  const wanted = req.body && req.body.recipient;
  if (wanted !== undefined && wanted !== null && String(wanted).trim() !== '') {
    try { recipient = ethers.getAddress(String(wanted).trim()); }
    catch (e) { return res.status(400).json({ error: 'invalid_recipient' }); }
  }
  if (!recipient) {
    const w = await db.query('SELECT address, smart_account FROM wallets WHERE identity_key=$1', [identityKey]);
    const cr = await db.query('SELECT wallet_address FROM airdrop_claims WHERE identity_key=$1', [identityKey]);
    recipient = (w.rows[0] && (w.rows[0].smart_account || w.rows[0].address))
      || (req.identity.provider === 'metamask' ? ethers.getAddress(identityKey.split(':')[1]) : null)
      || (cr.rows[0] && cr.rows[0].wallet_address) || null;
  }
  if (!recipient) return res.status(400).json({ error: 'no_wallet' });

  const v = await ensurePendingVoucher(identityKey, recipient);
  if (v.alreadyOnWay) return res.status(409).json({ error: 'already_claimed', status: v.status });

  const voucher = await buildSignedVoucher(v);
  // Pre-encoded calldata so the browser needs no ABI library (CSP: no CDNs).
  const iface = new ethers.Interface(AIRDROP_ABI);
  const data = iface.encodeFunctionData('claim', [
    voucher.recipient, voucher.amount, voucher.nonce, voucher.deadline, voucher.signature,
  ]);
  res.json({
    to: config.airdropContractAddress,
    data,
    chainId: config.chainId,
    recipient: voucher.recipient,
    voucher: {
      recipient: voucher.recipient,
      amount: voucher.amount.toString(),
      nonce: voucher.nonce.toString(),
      deadline: Number(voucher.deadline),
      signature: voucher.signature,
    },
  });
});

// ── Sponsored (gasless) claim: the relayer pays the gas, the user pays nothing ────────────────
// Guardrails: only if sponsorship is ON, gas ≤ ceiling (SPONSOR_MAX_GWEI), and the relayer holds
// enough ETH. Any guard failing returns 503 with a reason so the frontend falls back to self-serve.
router.post('/claim-sponsored', closedGuard, writeLimiter, requireAuth, async (req, res) => {
  if (!config.airdropContractAddress || config.airdropContractAddress === ZERO) return res.status(404).json({ error: 'campaign_not_live' });
  if (!config.sponsorClaims || !config.relayerPrivateKey) return res.status(503).json({ error: 'sponsor_off' });
  const { identityKey } = req.identity;
  try {
    const fee = await provider().getFeeData();
    const gp = fee.maxFeePerGas || fee.gasPrice || 0n;
    const gwei = Number(gp) / 1e9;
    if (gwei > config.sponsorMaxGwei) {
      return res.status(503).json({ error: 'gas_too_high', gwei: Math.round(gwei * 1000) / 1000, ceiling: config.sponsorMaxGwei });
    }
    const relayer = new ethers.Wallet(config.relayerPrivateKey, provider());
    const bal = await provider().getBalance(relayer.address);
    if (bal < gp * 250000n) return res.status(503).json({ error: 'relayer_empty' });

    // Optional custom receive address (else the wallet on file / connected metamask address).
    let recipient = null;
    const wanted = req.body && req.body.recipient;
    if (wanted && String(wanted).trim() !== '') {
      try { recipient = ethers.getAddress(String(wanted).trim()); } catch (e) { return res.status(400).json({ error: 'invalid_recipient' }); }
    }
    if (!recipient) {
      const w = await db.query('SELECT address, smart_account FROM wallets WHERE identity_key=$1', [identityKey]);
      const cr = await db.query('SELECT wallet_address FROM airdrop_claims WHERE identity_key=$1', [identityKey]);
      recipient = (w.rows[0] && (w.rows[0].smart_account || w.rows[0].address))
        || (req.identity.provider === 'metamask' ? ethers.getAddress(identityKey.split(':')[1]) : null)
        || (cr.rows[0] && cr.rows[0].wallet_address) || null;
    }
    if (!recipient) return res.status(400).json({ error: 'no_wallet' });

    const result = await sponsoredClaim(identityKey, recipient);
    res.json(result);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[airdrop] sponsored claim error:', e.message);
    res.status(500).json({ error: 'sponsor_failed' });
  }
});

// ── Gas price for a claim (so the UI can show the ETH cost up front) ──────────────────────────
// PUBLIC. Returns the live gas price + a representative claim() gas + the fee in ETH, and ETH/USD
// read from the Chainlink mainnet feed (CSP-safe: browser → this backend → chain, no external API).
// The frontend refines the gas with the wallet's own eth_estimateGas at claim time; this is the
// up-front figure. Cached 15s to spare the RPC.
const CLAIM_GAS = 130000n; // typical ShambaLuvAirdrop.claim() gas (ecrecover + 2 replay SSTOREs + LUV transfer)
const REDEEM_GAS = 100000n; // typical IncentiveDistributor.distributeReward() gas (stat SSTOREs + LUV transfer)
const CHAINLINK_ETH_USD = '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419'; // mainnet ETH/USD
let _gasCache = { t: 0, data: null };
router.get('/gas', async (req, res) => {
  const now = Date.now();
  if (_gasCache.data && now - _gasCache.t < 15000) return res.json(_gasCache.data);
  try {
    const p = provider();
    const fee = await p.getFeeData();
    const gasPrice = fee.maxFeePerGas || fee.gasPrice || 0n;
    let ethUsd = null;
    try {
      const agg = new ethers.Contract(CHAINLINK_ETH_USD,
        ['function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)', 'function decimals() view returns (uint8)'], p);
      const [rd, dec] = await Promise.all([agg.latestRoundData(), agg.decimals()]);
      ethUsd = Number(rd[1]) / 10 ** Number(dec);
    } catch (e) { /* feed unreachable — ETH-only estimate */ }
    const feeWei = gasPrice * CLAIM_GAS;
    const feeEth = ethers.formatEther(feeWei);
    const redeemFeeEth = ethers.formatEther(gasPrice * REDEEM_GAS);
    // Gas tank: the relayer's ETH + how many claims it can sponsor at the current fee.
    let relayerAddress = null; let relayerEth = null; let sponsorsLeft = null;
    if (config.relayerPrivateKey) {
      try {
        relayerAddress = new ethers.Wallet(config.relayerPrivateKey).address;
        const bal = await provider().getBalance(relayerAddress);
        relayerEth = ethers.formatEther(bal);
        if (feeWei > 0n) sponsorsLeft = Number(bal / feeWei);
      } catch (e) { /* relayer unset/unreadable */ }
    }
    const gwei = Number(gasPrice) / 1e9;
    const sponsorActive = !!(config.sponsorClaims && relayerEth != null && Number(relayerEth) > 0 && gwei <= config.sponsorMaxGwei);
    const payload = {
      gasPriceWei: gasPrice.toString(),
      gwei: Math.round(gwei * 1000) / 1000,
      claimGas: Number(CLAIM_GAS),
      claimFeeEth: feeEth,
      ethUsd,
      claimFeeUsd: ethUsd != null ? Number(feeEth) * ethUsd : null,
      // REDEEM (distributeReward — accumulated presence LUV in one tx)
      redeemGas: Number(REDEEM_GAS),
      redeemFeeEth,
      redeemFeeUsd: ethUsd != null ? Number(redeemFeeEth) * ethUsd : null,
      // gas tank
      relayerAddress,
      relayerEth,
      sponsorsLeft,
      sponsorActive,
      maxGwei: config.sponsorMaxGwei,
    };
    _gasCache = { t: now, data: payload };
    res.json(payload);
  } catch (e) {
    res.status(500).json({ error: 'gas_unavailable' });
  }
});

// ── The LUVbus is PARKED. ──────────────────────────────────────────────────────
// The "one driver pays for everyone" sweep was too expensive (~riders × ~130k gas). The model
// is now purely self-serve: each participant's 1T is RECORDED and waits until THEY claim it,
// whenever it's worth the gas to them (see POST /voucher). This endpoint is intentionally
// disabled; the Multicall3 driver code is retired. (listBusVouchers remains in voucher.js,
// dormant, so the bus can be un-parked later if ever wanted.)
router.get('/bus', (req, res) => res.status(410).json({ error: 'bus_parked', message: 'The LUVbus is parked — claim your gesture yourself, any time.' }));

module.exports = router;
