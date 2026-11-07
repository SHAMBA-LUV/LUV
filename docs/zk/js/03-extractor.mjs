// 03-extractor.mjs — WHY the Schnorr protocol is sound (a proof of KNOWLEDGE),
// and why reusing a nonce leaks your key.
//
// Special soundness: from two accepting transcripts with the SAME commitment R but
// different challenges c1 ≠ c2, anyone can compute the secret:
//
//   s1 = r + c1·x,  s2 = r + c2·x   ⇒   x = (s1 − s2) / (c1 − c2)  (mod N)
//
// An "extractor" that can rewind a prover therefore pulls x out of any prover that
// succeeds often — so a successful prover must "know" x.
//
// The same algebra is a real-world attack: if a prover (or an ECDSA / Schnorr signer)
// ever reuses r, the secret is public. This is how the Sony PS3 ECDSA key was recovered
// (fail0verflow, 27C3, 2010).
//
// Run: node docs/zk/js/03-extractor.mjs

import assert from 'node:assert/strict';
import { G, N, mod, inv, mul, randomScalar } from './secp256k1.mjs';

const x = randomScalar();
const X = mul(G, x);

// A careless prover that reuses its nonce r across two sessions.
const r = randomScalar();
const c1 = randomScalar();
const c2 = randomScalar();
const s1 = mod(r + c1 * x, N);
const s2 = mod(r + c2 * x, N);

const extracted = mod((s1 - s2) * inv(c1 - c2, N), N);
assert.equal(extracted, x);
assert.ok(mul(G, extracted).x === X.x);
console.log('✓ extractor recovered the secret from two transcripts sharing one commitment');
console.log('  lesson: a fresh, uniformly random nonce per proof is not optional');
