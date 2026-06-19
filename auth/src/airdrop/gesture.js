'use strict';

/*
 * gesture.js — the gesture, delivered WALLET-TO-WALLET (0 fee).
 *
 * The LUV token already makes EOA↔EOA transfers fee-free (walletToWalletFeeExempt). So the
 * handshake simply sends the 1-trillion-LUV gesture as a DIRECT transfer from the relayer/
 * treasury wallet (an EOA holding the campaign pool) → the new signup's provisioned wallet (an
 * EOA). Both ends are wallets, so NO fee is taken and the recipient receives the FULL trillion —
 * with no fee-exemption and no contract distributor (a contract sender would incur the fee).
 *
 * Sybil gate is the backend: one social identity = one wallet = one gesture (airdrop_claims
 * UNIQUE(identity_key)). The 1%-of-supply campaign cap (1 Quadrillion = 1000 trillion = 1000
 * gestures) is enforced by funding the treasury wallet with exactly that pool AND an off-chain
 * running total here. (The on-chain signature-gated ShambaLuvAirdrop in voucher.js remains as an
 * OPTIONAL self-serve PULL path; it is contract→EOA and therefore fee-charged unless that contract is
 * fee-exempt — so the wallet-to-wallet push is the primary, fee-free path.)
 */

const ethers = require('../ethers');
const { config } = require('../config');
const db = require('../db');

// 1% of the 100-Quadrillion supply = 1 Quadrillion LUV (campaign cap).
const CAMPAIGN_CAP = 1_000_000_000_000_000n * (10n ** 18n);

const ERC20_ABI = [
  'function transfer(address to, uint256 amount) external returns (bool)',
  'function balanceOf(address) external view returns (uint256)',
];

let _provider = null;
function provider() {
  if (!_provider) _provider = new ethers.JsonRpcProvider(config.rpcUrl, config.chainId);
  return _provider;
}

// The treasury/relayer is a WALLET (EOA) holding the airdrop pool — this is what keeps the
// transfer wallet-to-wallet (0 fee). It also pays the (simple-transfer) gas.
function treasuryWallet() {
  return new ethers.Wallet(config.relayerPrivateKey, provider());
}

function luv(runner) {
  return new ethers.Contract(config.luvTokenAddress, ERC20_ABI, runner || provider());
}

// Off-chain campaign total (confirmed gestures). The treasury balance is the hard floor.
async function distributedSoFar() {
  const r = await db.query(
    "SELECT COALESCE(SUM(amount::numeric),0) AS total FROM airdrop_claims WHERE status='confirmed'"
  );
  return BigInt(r.rows[0].total || '0');
}

/**
 * Deliver the gesture to one identity, wallet-to-wallet. Idempotent (one per identity).
 * @returns {Promise<{ status, walletAddress, txHash, amount, alreadyClaimed }>}
 */
async function runGesture(identityKey, recipient) {
  const amount = config.claimAmount; // 1 trillion LUV (BigInt)

  // Idempotency: one gesture per identity. Insert 'pending'; if it exists, return it.
  let row;
  try {
    const ins = await db.query(
      `INSERT INTO airdrop_claims (identity_key, wallet_address, amount, status)
       VALUES ($1, $2, $3, 'pending') RETURNING *`,
      [identityKey, recipient, amount.toString()]
    );
    row = ins.rows[0];
  } catch (err) {
    if (err && err.code === '23505') {
      const existing = await db.query('SELECT * FROM airdrop_claims WHERE identity_key=$1', [identityKey]);
      const r = existing.rows[0];
      return {
        status: r.status, walletAddress: r.wallet_address, txHash: r.tx_hash,
        amount: r.amount, alreadyClaimed: true,
      };
    }
    throw err;
  }

  // Campaign cap (1% of supply) — off-chain total + treasury balance floor.
  const sent = await distributedSoFar();
  if (sent + amount > CAMPAIGN_CAP) return _finalize(identityKey, 'cap_reached', null, 'campaign_cap_reached');

  try {
    const treasury = treasuryWallet();
    const token = luv(treasury);
    const bal = await token.balanceOf(await treasury.getAddress());
    if (bal < amount) return _finalize(identityKey, 'failed', null, 'treasury_underfunded');

    // WALLET-TO-WALLET transfer — EOA → EOA, 0 fee, full trillion arrives.
    const tx = await token.transfer(recipient, amount);
    await db.query(
      "UPDATE airdrop_claims SET status='submitted', tx_hash=$2, updated_at=now() WHERE identity_key=$1",
      [identityKey, tx.hash]
    );
    const receipt = await tx.wait();
    const ok = receipt && receipt.status === 1;
    await db.query(
      'UPDATE airdrop_claims SET status=$2, tx_hash=$3, updated_at=now() WHERE identity_key=$1',
      [identityKey, ok ? 'confirmed' : 'failed', tx.hash]
    );
    return {
      status: ok ? 'confirmed' : 'failed', walletAddress: recipient, txHash: tx.hash,
      amount: amount.toString(), alreadyClaimed: false,
    };
  } catch (err) {
    const msg = (err && (err.shortMessage || err.message)) || 'transfer_failed';
    return _finalize(identityKey, 'failed', null, String(msg).slice(0, 240));
  }
}

async function _finalize(identityKey, status, txHash, note) {
  await db.query(
    'UPDATE airdrop_claims SET status=$2, tx_hash=$3, error=$4, updated_at=now() WHERE identity_key=$1',
    [identityKey, status, txHash, note || null]
  );
  const r = await db.query('SELECT * FROM airdrop_claims WHERE identity_key=$1', [identityKey]);
  const row = r.rows[0] || {};
  return { status, walletAddress: row.wallet_address, txHash: row.tx_hash, amount: row.amount, alreadyClaimed: false };
}

async function getGestureStatus(identityKey) {
  const r = await db.query('SELECT * FROM airdrop_claims WHERE identity_key=$1', [identityKey]);
  if (r.rowCount === 0) return null;
  const row = r.rows[0];
  return {
    status: row.status, walletAddress: row.wallet_address, txHash: row.tx_hash,
    amount: row.amount, error: row.error, createdAt: row.created_at,
  };
}

module.exports = { runGesture, getGestureStatus, CAMPAIGN_CAP, ERC20_ABI };
