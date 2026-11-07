// 04-fiat-shamir.mjs — non-interactive ZK (NIZK) with the Fiat–Shamir transform,
// and the "Frozen Heart" bug you get when the transcript hash is incomplete.
//
// Fiat–Shamir (1986): replace the verifier's random challenge with a hash of everything
// the verifier would have seen so far:
//
//     c = H(domain, G, X, R, message)
//
// The prover can no longer pick R after seeing c, so a single (R, s) pair is a proof
// anyone can check, any time. Binding a `message` turns it into a signature of knowledge
// (this is essentially a Schnorr signature — cf. BIP-340).
//
// Run: node docs/zk/js/04-fiat-shamir.mjs

import assert from 'node:assert/strict';
import { G, N, mod, inv, mul, add, sub, eq, hashToScalar, randomScalar } from './secp256k1.mjs';

const DOMAIN = 'LUV-ZK-GUIDE/schnorr-nizk/v1'; // domain separation: proofs for one app never verify in another

export function prove(x, message = '') {
  const X = mul(G, x);
  const r = randomScalar();
  const R = mul(G, r);
  const c = hashToScalar(DOMAIN, G, X, R, message); // ← hash the WHOLE statement + commitment
  return { R, s: mod(r + c * x, N) };
}

export function verify(X, { R, s }, message = '') {
  const c = hashToScalar(DOMAIN, G, X, R, message);
  return eq(mul(G, s), add(R, mul(X, c)));
}

const x = randomScalar();
const X = mul(G, x);
const proof = prove(x, 'claim 1T LUV to 0xabc…');
assert.ok(verify(X, proof, 'claim 1T LUV to 0xabc…'));
assert.ok(!verify(X, proof, 'claim 1T LUV to 0xEVIL'), 'proof is bound to its message');
assert.ok(!verify(mul(G, randomScalar()), proof, 'claim 1T LUV to 0xabc…'), 'proof is bound to its statement');
console.log('✓ NIZK verifies, and is bound to both the statement X and the message');

// ── Frozen Heart: forgetting to hash the statement ────────────────────────────
// "Weak Fiat–Shamir" computes c = H(R) only. Then an attacker can pick R and s first,
// derive c, and SOLVE for a statement X it can "prove" without knowing its discrete log:
//     s·G = R + c·X   ⇒   X = c⁻¹·(s·G − R)
// Trail of Bits disclosed this class in 2022 across several production proof systems
// (https://blog.trailofbits.com/2022/04/13/part-1-coordinated-disclosure-of-vulnerabilities-affecting-girault-bulletproofs-and-plonk/).
const weakVerify = (X, { R, s }) => eq(mul(G, s), add(R, mul(X, hashToScalar(DOMAIN, R))));

const Rf = mul(G, randomScalar());
const sf = randomScalar();
const cf = hashToScalar(DOMAIN, Rf);
const Xforged = mul(sub(mul(G, sf), Rf), inv(cf, N));
assert.ok(weakVerify(Xforged, { R: Rf, s: sf }));
assert.ok(!verify(Xforged, { R: Rf, s: sf }));
console.log('✓ weak Fiat–Shamir is forgeable (Frozen Heart); the strong version rejects the forgery');
console.log('  rule: hash the public parameters, the statement, every commitment, and the context');
