'use strict';

/*
 * eip712.js — the single source of truth for the EIP-712 voucher shape.
 *
 * This MUST byte-match contracts/ShambaLuvAirdrop.sol:
 *   - domain name    : "ShambaLuvAirdrop"
 *   - domain version : "1"
 *   - domain chainId : the deployed chain
 *   - domain verifyingContract : the deployed airdrop address
 *   - struct type    : Claim(address recipient,uint256 amount,uint256 nonce,uint256 deadline)
 *
 * The contract computes:
 *   CLAIM_TYPEHASH = keccak256("Claim(address recipient,uint256 amount,uint256 nonce,uint256 deadline)")
 *   DOMAIN_SEPARATOR = keccak256(abi.encode(
 *       keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
 *       keccak256("ShambaLuvAirdrop"), keccak256("1"), block.chainid, address(this)))
 *   digest = keccak256("\x19\x01" || DOMAIN_SEPARATOR || structHash)
 *
 * ethers v6 `signTypedData(domain, types, value)` reproduces exactly this digest given the
 * domain/types below — field NAMES and ORDER are what bind the encoding, so they are fixed here.
 */

const EIP712_DOMAIN_NAME = 'ShambaLuvAirdrop';
const EIP712_DOMAIN_VERSION = '1';

// The Claim struct. Order and names are load-bearing — do NOT reorder.
const CLAIM_TYPES = {
  Claim: [
    { name: 'recipient', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
};

/**
 * Build the EIP-712 domain object for ethers signTypedData / verifyTypedData.
 * @param {{ chainId: number|bigint, verifyingContract: string }} opts
 * @returns {{ name: string, version: string, chainId: number|bigint, verifyingContract: string }}
 */
function buildDomain({ chainId, verifyingContract }) {
  if (chainId === undefined || chainId === null) {
    throw new Error('buildDomain: chainId is required');
  }
  if (!verifyingContract || typeof verifyingContract !== 'string') {
    throw new Error('buildDomain: verifyingContract is required');
  }
  return {
    name: EIP712_DOMAIN_NAME,
    version: EIP712_DOMAIN_VERSION,
    chainId,
    verifyingContract,
  };
}

/**
 * Build the value (message) object for a Claim voucher.
 * @param {{ recipient: string, amount: bigint|string, nonce: bigint|string, deadline: bigint|number|string }} v
 */
function buildClaimValue({ recipient, amount, nonce, deadline }) {
  return {
    recipient,
    amount: BigInt(amount),
    nonce: BigInt(nonce),
    deadline: BigInt(deadline),
  };
}

module.exports = {
  EIP712_DOMAIN_NAME,
  EIP712_DOMAIN_VERSION,
  CLAIM_TYPES,
  buildDomain,
  buildClaimValue,
};
