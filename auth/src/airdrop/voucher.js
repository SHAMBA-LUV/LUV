'use strict';

/*
 * voucher.js — OPTIONAL on-chain self-serve PULL path (NOT the primary gesture).
 *
 * The PRIMARY gesture is wallet-to-wallet and fee-free — see airdrop/gesture.js (treasury EOA →
 * user EOA, 0 fee, full trillion). This module is the alternative where the user (or a relayer)
 * submits an on-chain claim() against the signature-gated ShambaLuvAirdrop contract. NOTE: that
 * path is contract→EOA, so the LUV token charges a fee on it unless the airdrop contract is fee-exempt.
 * Use it only if you want a trustless on-chain pull with the cap/one-claim enforced on-chain.
 *
 * Build + sign an EIP-712 Claim voucher and RELAY the on-chain claim() so the recipient holds
 * 1 trillion LUV.
 *
 * Matches contracts/ShambaLuvAirdrop.sol EXACTLY:
 *   - signs with VOUCHER_SIGNER_PRIVATE_KEY (must equal the contract's `signer`)
 *   - Claim(address recipient,uint256 amount,uint256 nonce,uint256 deadline)
 *   - relays claim(recipient, amount, nonce, deadline, signature) via RELAYER_PRIVATE_KEY
 *
 * One claim per identity is enforced by the airdrop_claims UNIQUE(identity_key) row, the
 * UNIQUE(nonce), and (on-chain) by usedNonce[nonce] AND hasClaimed[recipient].
 */

const crypto = require('crypto');
const ethers = require('../ethers');
const { config } = require('../config');
const db = require('../db');
const { buildDomain, buildClaimValue, CLAIM_TYPES } = require('../eip712');

// Minimal ABI fragment — only what the relayer/status need (mirrors the .sol).
const AIRDROP_ABI = [
  'function claim(address recipient, uint256 amount, uint256 nonce, uint256 deadline, bytes signature) external',
  'function claimDigest(address recipient, uint256 amount, uint256 nonce, uint256 deadline) external view returns (bytes32)',
  'function usedNonce(uint256) external view returns (bool)',
  'function hasClaimed(address) external view returns (bool)',
  'function totalClaimed() external view returns (uint256)',
  'function AIRDROP_CAP() external view returns (uint256)',
  'function paused() external view returns (bool)',
  'function signer() external view returns (address)',
];

let _provider = null;
function provider() {
  if (!_provider) _provider = new ethers.JsonRpcProvider(config.rpcUrl, config.chainId);
  return _provider;
}

function voucherSigner() {
  // Plain key wallet — used only to signTypedData (no provider needed).
  return new ethers.Wallet(config.voucherSignerPrivateKey);
}

function relayerWallet() {
  return new ethers.Wallet(config.relayerPrivateKey, provider());
}

function airdropContract(runner) {
  return new ethers.Contract(config.airdropContractAddress, AIRDROP_ABI, runner || provider());
}

// Allocate a unique uint256 nonce. 256-bit random keeps collisions astronomically unlikely;
// the DB UNIQUE(nonce) and on-chain usedNonce[] are the real guards.
function allocateNonce() {
  return BigInt('0x' + crypto.randomBytes(32).toString('hex'));
}

/**
 * Build + sign an EIP-712 Claim voucher. Pure crypto, no chain/DB I/O.
 * @returns {Promise<{ recipient, amount, nonce, deadline, signature, signerAddress }>}
 */
async function buildSignedVoucher({ recipient, amount, nonce, deadline }) {
  const domain = buildDomain({
    chainId: config.chainId,
    verifyingContract: config.airdropContractAddress,
  });
  const value = buildClaimValue({ recipient, amount, nonce, deadline });
  const wallet = voucherSigner();
  const signature = await wallet.signTypedData(domain, CLAIM_TYPES, value);
  return {
    recipient: value.recipient,
    amount: value.amount,
    nonce: value.nonce,
    deadline: value.deadline,
    signature,
    signerAddress: await wallet.getAddress(),
  };
}

/**
 * The full gesture for one identity. Idempotent: if already claimed, returns the prior record.
 *
 * @param {string} identityKey
 * @param {string} recipient  the provisioned wallet address
 * @returns {Promise<{ status, walletAddress, txHash, nonce, amount, alreadyClaimed }>}
 */
async function runAirdrop(identityKey, recipient) {
  // Idempotency: one claim per identity. Insert a 'pending' row; if it exists, return it.
  const amount = config.claimAmount;
  const nonce = allocateNonce();
  const deadline = BigInt(Math.floor(Date.now() / 1000) + config.voucherTtlSeconds);

  let claimRow;
  try {
    const ins = await db.query(
      `INSERT INTO airdrop_claims (identity_key, wallet_address, nonce, amount, deadline, status)
       VALUES ($1, $2, $3, $4, $5, 'pending')
       RETURNING *`,
      [identityKey, recipient, nonce.toString(), amount.toString(), Number(deadline)]
    );
    claimRow = ins.rows[0];
  } catch (err) {
    if (err && err.code === '23505') {
      // Already has a claim row — return its current state (idempotent).
      const existing = await db.query(
        'SELECT * FROM airdrop_claims WHERE identity_key = $1',
        [identityKey]
      );
      const r = existing.rows[0];
      return {
        status: r.status,
        walletAddress: r.wallet_address,
        txHash: r.tx_hash,
        nonce: r.nonce,
        amount: r.amount,
        alreadyClaimed: true,
      };
    }
    throw err;
  }

  // Pre-flight on-chain checks so we fail gracefully (no wasted gas).
  const contract = airdropContract();
  try {
    const [isPaused, claimedAlready, totalClaimed, cap] = await Promise.all([
      contract.paused(),
      contract.hasClaimed(recipient),
      contract.totalClaimed(),
      contract.AIRDROP_CAP(),
    ]);
    if (isPaused) return finalize(identityKey, 'failed', null, 'contract_paused');
    if (claimedAlready) return finalize(identityKey, 'already_claimed', null, 'wallet_has_claimed');
    if (totalClaimed + amount > cap) return finalize(identityKey, 'cap_reached', null, 'cap_reached');
  } catch (err) {
    // If RPC is unreachable we still proceed to attempt the relay (the contract is the
    // ultimate guard); record the preflight note without PII.
    // eslint-disable-next-line no-console
    console.error('[airdrop] preflight check failed, attempting relay anyway:', err.message);
  }

  // Build + sign the voucher.
  const voucher = await buildSignedVoucher({ recipient, amount, nonce, deadline });

  // Relay claim() — the relayer pays gas.
  try {
    const relayer = relayerWallet();
    const withSigner = airdropContract(relayer);
    const tx = await withSigner.claim(
      voucher.recipient,
      voucher.amount,
      voucher.nonce,
      voucher.deadline,
      voucher.signature
    );
    await db.query(
      `UPDATE airdrop_claims SET status='submitted', tx_hash=$2, updated_at=now()
       WHERE identity_key=$1`,
      [identityKey, tx.hash]
    );

    const receipt = await tx.wait();
    const ok = receipt && receipt.status === 1;
    await db.query(
      `UPDATE airdrop_claims SET status=$2, tx_hash=$3, updated_at=now() WHERE identity_key=$1`,
      [identityKey, ok ? 'confirmed' : 'failed', tx.hash]
    );
    return {
      status: ok ? 'confirmed' : 'failed',
      walletAddress: recipient,
      txHash: tx.hash,
      nonce: nonce.toString(),
      amount: amount.toString(),
      alreadyClaimed: false,
    };
  } catch (err) {
    // Map known contract reverts to graceful statuses.
    const msg = (err && (err.shortMessage || err.message)) || 'relay_failed';
    let status = 'failed';
    if (/AlreadyClaimed/.test(msg)) status = 'already_claimed';
    else if (/CapReached/.test(msg)) status = 'cap_reached';
    else if (/NonceUsed/.test(msg)) status = 'failed';
    return finalize(identityKey, status, null, truncate(msg));
  }
}

async function finalize(identityKey, status, txHash, note) {
  await db.query(
    `UPDATE airdrop_claims SET status=$2, tx_hash=$3, error=$4, updated_at=now()
     WHERE identity_key=$1`,
    [identityKey, status, txHash, note ? truncate(note) : null]
  );
  const r = await db.query('SELECT * FROM airdrop_claims WHERE identity_key=$1', [identityKey]);
  const row = r.rows[0] || {};
  return {
    status,
    walletAddress: row.wallet_address,
    txHash: row.tx_hash,
    nonce: row.nonce,
    amount: row.amount,
    alreadyClaimed: false,
  };
}

function truncate(s) {
  return String(s).slice(0, 240);
}

async function getClaimStatus(identityKey) {
  const r = await db.query('SELECT * FROM airdrop_claims WHERE identity_key=$1', [identityKey]);
  if (r.rowCount === 0) return null;
  const row = r.rows[0];
  return {
    status: row.status,
    walletAddress: row.wallet_address,
    txHash: row.tx_hash,
    nonce: row.nonce,
    amount: row.amount,
    deadline: row.deadline,
    error: row.error,
    createdAt: row.created_at,
  };
}

module.exports = {
  AIRDROP_ABI,
  buildSignedVoucher,
  runAirdrop,
  getClaimStatus,
  allocateNonce,
};
