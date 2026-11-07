// 06-chaum-pedersen.mjs — proving two discrete logs are EQUAL (Chaum & Pedersen, 1992).
//
// Statement: "I know x such that X = x·G  AND  Y = x·H"   — same x, never revealed.
//
// Where it shows up:
//   • VRFs (RFC 9381 ECVRF): the output Γ = x·H(msg) is proven consistent with the public key.
//   • Verifiable decryption / threshold crypto: a share was computed with the committed key.
//   • Deterministic nullifiers: prove a public tag N = x·H(scope) belongs to a registered
//     key X = x·G — "this member acted once in this scope" without revealing which member.
//
// Run: node docs/zk/js/06-chaum-pedersen.mjs

import assert from 'node:assert/strict';
import { G, N, mod, mul, add, eq, hashToPoint, hashToScalar, randomScalar } from './secp256k1.mjs';

function prove(x, H) {
  const X = mul(G, x), Y = mul(H, x);
  const r = randomScalar();
  const A = mul(G, r), B = mul(H, r);            // the same nonce on both bases
  const c = hashToScalar('dleq/v1', G, H, X, Y, A, B);
  return { X, Y, proof: { A, B, s: mod(r + c * x, N) } };
}
function verify(H, X, Y, { A, B, s }) {
  const c = hashToScalar('dleq/v1', G, H, X, Y, A, B);
  return eq(mul(G, s), add(A, mul(X, c))) && eq(mul(H, s), add(B, mul(Y, c)));
}

// Nullifier example: one key, one tag per scope.
const x = randomScalar();
const scope = hashToPoint('LUV-ZK-GUIDE/nullifier/airdrop-round-1');
const { X, Y: nullifier, proof } = prove(x, scope);
assert.ok(verify(scope, X, nullifier, proof));
console.log('✓ DLEQ proof: the nullifier was derived from the registered key');

// The same key in the same scope always yields the same nullifier → double claims are visible.
assert.ok(eq(prove(x, scope).Y, nullifier));
console.log('✓ deterministic: acting twice in one scope repeats the nullifier (double-spend detected)');

// A different scope gives an unlinkable tag.
const scope2 = hashToPoint('LUV-ZK-GUIDE/nullifier/airdrop-round-2');
assert.ok(!eq(prove(x, scope2).Y, nullifier));
console.log('✓ unlinkable across scopes');

// Cheating: claim Y = x'·H for a different x' — the proof fails.
const forged = prove(randomScalar(), scope);
assert.ok(!verify(scope, X, forged.Y, forged.proof));
console.log('✓ a tag from a different key is rejected');

// Note: this DLEQ proof still reveals X, so it ties the nullifier to ONE known key. Hiding
// *which* member acted needs a membership proof (Merkle path or ring) inside the ZK proof —
// that is what Semaphore does in a SNARK circuit (see the guide, §8).
