// 08-schnorr-bn254.mjs — the off-chain prover for foundry/src/KeyRegistry.sol.
//
// Same Schnorr proof of knowledge as 01/04, moved to BN254 so Ethereum can verify it with the
// ecAdd/ecMul precompiles, and with a Fiat–Shamir challenge that is byte-for-byte identical to
// the contract's:
//
//   c = sha256( DOMAIN(bytes32) ‖ chainid(uint256) ‖ registry(address) ‖ account(address)
//               ‖ X.x ‖ X.y ‖ R.x ‖ R.y )  mod N            — Solidity abi.encodePacked layout
//
// evm/run-tests.mjs uses `prove` from this file to register a key in the real contract.
// Run: node docs/zk/js/08-schnorr-bn254.mjs

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { G, N, mod, mul, add, eq, isOnCurve, randomScalar, word, addr, bytes32Str } from './bn254.mjs';

export const DOMAIN = 'LUV-ZK-GUIDE/KeyRegistry/v1';

export function challenge({ chainId, registry, account }, X, R) {
  const packed = Buffer.concat([
    bytes32Str(DOMAIN), word(chainId), addr(registry), addr(account),
    word(X.x), word(X.y), word(R.x), word(R.y),
  ]);
  return mod(BigInt('0x' + createHash('sha256').update(packed).digest('hex')), N);
}

export function prove(ctx, x) {
  const X = mul(G, x);
  const r = randomScalar();
  const R = mul(G, r);
  const s = mod(r + challenge(ctx, X, R) * x, N);
  return { X, R, s };
}

export function verify(ctx, { X, R, s }) {
  if (!isOnCurve(X) || !isOnCurve(R) || s >= N) return false;
  return eq(mul(G, s), add(R, mul(X, challenge(ctx, X, R))));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const ctx = { chainId: 1n, registry: '0x' + '11'.repeat(20), account: '0x' + 'a1'.repeat(20) };
  const x = randomScalar();
  const proof = prove(ctx, x);
  assert.ok(verify(ctx, proof));
  console.log('✓ BN254 Schnorr proof verifies off-chain (same math the KeyRegistry contract runs)');
  assert.ok(!verify({ ...ctx, account: '0x' + 'bb'.repeat(20) }, proof));
  console.log('✓ bound to the account: replay from another address fails');
  assert.ok(!verify({ ...ctx, chainId: 137n }, proof));
  console.log('✓ bound to the chain: replay on another chain fails');
  assert.ok(!verify({ ...ctx, registry: '0x' + '22'.repeat(20) }, proof));
  console.log('✓ bound to the contract: replay against another registry fails');
}
