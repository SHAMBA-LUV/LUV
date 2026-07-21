'use strict';

/*
 * batch.js — the gesture, delivered in BATCHES through LuvBatchGesture (Ethereum gas saver).
 *
 * The direct path (gesture.js) sends one treasury→signup transfer per new identity — one
 * transaction, one nonce, one 21k base cost each. On Ethereum mainnet that overhead dominates,
 * so this module queues signups and flushes them N-at-a-time through the LuvBatchGesture
 * contract: ONE transaction delivers the 1-trillion-LUV gesture to every queued wallet.
 *
 * THE FEE MATH STILL HOLDS: each delivery is transferFrom(treasury EOA → signup EOA); ShambaLuv's
 * fee test is on the counterparties (`from.code.length == 0 && to.code.length == 0`), not
 * msg.sender, so every hop is wallet-to-wallet, 0-fee, full trillion. The treasury only
 * `approve`s the batcher; the pool never leaves the treasury wallet until delivery.
 *
 * Flush triggers: queue reaches BATCH_MAX_SIZE, or every BATCH_INTERVAL_MS — whichever first.
 * Rows move 'queued' → 'submitted' (shared batch tx hash) → 'confirmed' | back to 'queued'
 * (with attempts++) | 'failed' after BATCH_MAX_ATTEMPTS. Multi-process safe via
 * FOR UPDATE SKIP LOCKED. Sybil gate unchanged: one identity = one row (UNIQUE) = one gesture,
 * mirrored on-chain per-wallet by LuvBatchGesture.delivered.
 */

const ethers = require('../ethers');
const { config } = require('../config');
const db = require('../db');

// 1% of supply campaign cap — same constant as gesture.js, the off-chain ceiling.
const CAMPAIGN_CAP = 1_000_000_000_000_000n * (10n ** 18n);

const BATCH_ABI = [
  'function batchGesture(address[] recipients) external returns (uint256)',
  'function delivered(address) external view returns (bool)',
  'function deliverableGestures() external view returns (uint256)',
  'function gestureAmount() external view returns (uint256)',
  'event Gesture(address indexed recipient, uint256 amount)',
  'event GestureSkipped(address indexed recipient, uint8 reason)',
];

let _provider = null;
function provider() {
  if (!_provider) _provider = new ethers.JsonRpcProvider(config.rpcUrl, config.chainId);
  return _provider;
}

// The operator wallet fires batches and pays the (single, amortized) gas. It holds no LUV.
function operatorWallet() {
  return new ethers.Wallet(config.relayerPrivateKey, provider());
}

function batcher(runner) {
  if (!config.batchGestureAddress) throw new Error('BATCH_GESTURE_ADDRESS not configured');
  return new ethers.Contract(config.batchGestureAddress, BATCH_ABI, runner || provider());
}

// Everything queued or delivered counts toward the cap, so enqueue can never overshoot.
async function committedSoFar() {
  const r = await db.query(
    "SELECT COALESCE(SUM(amount::numeric),0) AS total FROM airdrop_claims WHERE status IN ('queued','submitted','confirmed')"
  );
  return BigInt(r.rows[0].total || '0');
}

/**
 * Queue the gesture for one identity. Idempotent (one row per identity). The actual delivery
 * happens on the next flush; /airdrop/status reports 'queued' until the batch confirms.
 * @returns {Promise<{ status, walletAddress, txHash, amount, alreadyClaimed }>}
 */
async function enqueueGesture(identityKey, recipient) {
  const amount = config.claimAmount;

  const committed = await committedSoFar();
  if (committed + amount > CAMPAIGN_CAP) {
    // Record the attempt so status reads honestly; nothing will be sent.
    try {
      await db.query(
        `INSERT INTO airdrop_claims (identity_key, wallet_address, amount, status, error)
         VALUES ($1, $2, $3, 'cap_reached', 'campaign_cap_reached')`,
        [identityKey, recipient, amount.toString()]
      );
    } catch (err) {
      if (!err || err.code !== '23505') throw err;
    }
    const r = await db.query('SELECT * FROM airdrop_claims WHERE identity_key=$1', [identityKey]);
    const row = r.rows[0];
    return { status: row.status, walletAddress: row.wallet_address, txHash: row.tx_hash, amount: row.amount, alreadyClaimed: true };
  }

  try {
    const ins = await db.query(
      `INSERT INTO airdrop_claims (identity_key, wallet_address, amount, status)
       VALUES ($1, $2, $3, 'queued') RETURNING *`,
      [identityKey, recipient, amount.toString()]
    );
    const row = ins.rows[0];
    // Size trigger: fire-and-forget — the interval timer is the safety net.
    queueDepth().then((n) => { if (n >= config.batchMaxSize) flushBatch().catch(() => {}); }).catch(() => {});
    return { status: row.status, walletAddress: row.wallet_address, txHash: null, amount: row.amount, alreadyClaimed: false };
  } catch (err) {
    if (err && err.code === '23505') {
      const existing = await db.query('SELECT * FROM airdrop_claims WHERE identity_key=$1', [identityKey]);
      const r = existing.rows[0];
      return { status: r.status, walletAddress: r.wallet_address, txHash: r.tx_hash, amount: r.amount, alreadyClaimed: true };
    }
    throw err;
  }
}

async function queueDepth() {
  const r = await db.query("SELECT COUNT(*)::int AS n FROM airdrop_claims WHERE status='queued'");
  return r.rows[0].n;
}

let _flushing = false; // single-flight within this process; SKIP LOCKED covers other processes

/**
 * Deliver up to BATCH_MAX_SIZE queued gestures in ONE LuvBatchGesture transaction.
 * @returns {Promise<{ sent: number, txHash: string|null }>}
 */
async function flushBatch() {
  if (_flushing) return { sent: 0, txHash: null };
  _flushing = true;
  try {
    // Claim a slice of the queue (multi-process safe), oldest first.
    const claimed = await db.withTransaction(async (client) => {
      const rows = await client.query(
        `SELECT identity_key, wallet_address FROM airdrop_claims
         WHERE status='queued' ORDER BY created_at
         LIMIT $1 FOR UPDATE SKIP LOCKED`,
        [config.batchMaxSize]
      );
      if (rows.rowCount === 0) return [];
      const keys = rows.rows.map((r) => r.identity_key);
      await client.query(
        "UPDATE airdrop_claims SET status='batching', updated_at=now() WHERE identity_key = ANY($1)",
        [keys]
      );
      return rows.rows;
    });
    if (claimed.length === 0) return { sent: 0, txHash: null };

    const keys = claimed.map((r) => r.identity_key);
    const recipients = claimed.map((r) => r.wallet_address);

    try {
      const c = batcher(operatorWallet());

      // Headroom check on-chain (cap ∧ treasury balance ∧ allowance) before spending gas.
      const headroom = await c.deliverableGestures();
      if (headroom < BigInt(recipients.length)) {
        await _requeue(keys, 'treasury_headroom_insufficient');
        return { sent: 0, txHash: null };
      }

      const tx = await c.batchGesture(recipients);
      await db.query(
        "UPDATE airdrop_claims SET status='submitted', tx_hash=$2, updated_at=now() WHERE identity_key = ANY($1)",
        [keys, tx.hash]
      );
      const receipt = await tx.wait();
      const ok = receipt && receipt.status === 1;
      await db.query(
        'UPDATE airdrop_claims SET status=$2, updated_at=now() WHERE identity_key = ANY($1)',
        [keys, ok ? 'confirmed' : 'failed']
      );
      return { sent: ok ? recipients.length : 0, txHash: tx.hash };
    } catch (err) {
      const note = String((err && (err.shortMessage || err.message)) || 'batch_failed').slice(0, 240);
      await _requeue(keys, note);
      return { sent: 0, txHash: null };
    }
  } finally {
    _flushing = false;
  }
}

// Send failure: retry later, up to batchMaxAttempts, then mark failed (visible in /status).
async function _requeue(keys, note) {
  await db.query(
    `UPDATE airdrop_claims
     SET attempts = attempts + 1,
         status = CASE WHEN attempts + 1 >= $3 THEN 'failed' ELSE 'queued' END,
         error = $2, updated_at = now()
     WHERE identity_key = ANY($1)`,
    [keys, note, config.batchMaxAttempts]
  );
}

let _timer = null;

/** Start the interval flusher (call once at server boot when GESTURE_MODE=batch). */
function startBatchFlusher() {
  if (_timer) return _timer;
  _timer = setInterval(() => { flushBatch().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[batch] flush error:', err.message);
  }); }, config.batchIntervalMs);
  if (_timer.unref) _timer.unref();
  return _timer;
}

function stopBatchFlusher() {
  if (_timer) { clearInterval(_timer); _timer = null; }
}

module.exports = { enqueueGesture, flushBatch, startBatchFlusher, stopBatchFlusher, queueDepth, CAMPAIGN_CAP, BATCH_ABI };
