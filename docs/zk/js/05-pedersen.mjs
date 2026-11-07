// 05-pedersen.mjs — Pedersen commitments, a ZK proof of opening, and a
// confidential-transfer balance proof (the core trick behind confidential transactions).
//
// Commitment:  C = v·G + r·H     (v = value, r = random blinding factor)
//   hiding  — for random r, C reveals nothing about v (information-theoretically)
//   binding — opening C to a different v' means finding log_G(H): hard if nobody knows it
//   additive — C(v1,r1) + C(v2,r2) = C(v1+v2, r1+r2)
//
// H must be a "nothing-up-my-sleeve" point: we derive it by hashing a public seed
// (see hashToPoint in secp256k1.mjs), so nobody knows log_G(H).
//
// Run: node docs/zk/js/05-pedersen.mjs

import assert from 'node:assert/strict';
import { G, N, mod, mul, add, sub, eq, hashToPoint, hashToScalar, randomScalar } from './secp256k1.mjs';

const H = hashToPoint('LUV-ZK-GUIDE/pedersen/H');
const commit = (v, r) => add(mul(G, v), mul(H, r));

// ── 1. ZK proof of knowledge of an opening (Okamoto's Σ-protocol, Fiat–Shamir'd) ──
// Statement: "I know (v, r) with C = v·G + r·H" — without revealing v or r.
function proveOpening(v, r, C) {
  const a = randomScalar(), b = randomScalar();
  const T = add(mul(G, a), mul(H, b));
  const c = hashToScalar('open/v1', G, H, C, T);
  return { T, zv: mod(a + c * v, N), zr: mod(b + c * r, N) };
}
function verifyOpening(C, { T, zv, zr }) {
  const c = hashToScalar('open/v1', G, H, C, T);
  return eq(add(mul(G, zv), mul(H, zr)), add(T, mul(C, c)));
}

const v = 1_000_000_000_000n; // a 1-trillion gesture, say
const r = randomScalar();
const C = commit(v, r);
assert.ok(verifyOpening(C, proveOpening(v, r, C)));
console.log('✓ proved knowledge of a commitment opening without revealing the value');

// ── 2. Confidential transfer: inputs = outputs, amounts hidden ────────────────
// Alice spends a hidden input of 500 into hidden outputs 300 (to Bob) + 200 (change).
// If Σin − Σout = 0 in value, then  C_in − C_out1 − C_out2 = (r_in − r1 − r2)·H,
// a multiple of H ONLY. Proving knowledge of log_H of that difference (a Schnorr proof
// on base H) proves the values balance, while revealing none of them.
const [vin, v1, v2] = [500n, 300n, 200n];
const [rin, r1, r2] = [randomScalar(), randomScalar(), randomScalar()];
const Cin = commit(vin, rin), C1 = commit(v1, r1), C2 = commit(v2, r2);

const excess = sub(sub(Cin, C1), C2);           // public: anyone can compute it
const k = mod(rin - r1 - r2, N);                 // private: only the sender knows it
function proveBalance(k, E) {
  const t = randomScalar();
  const T = mul(H, t);
  const c = hashToScalar('balance/v1', H, E, T);
  return { T, z: mod(t + c * k, N) };
}
const verifyBalance = (E, { T, z }) => eq(mul(H, z), add(T, mul(E, hashToScalar('balance/v1', H, E, T))));

assert.ok(verifyBalance(excess, proveBalance(k, excess)));
console.log('✓ balance proof: hidden input equals hidden outputs');

// An inflating transfer (outputs 300 + 201) leaves a G-component in the excess, so the
// sender cannot know its discrete log base H — the honest-looking proof fails.
const C2bad = commit(201n, r2);
const badExcess = sub(sub(Cin, C1), C2bad);
assert.ok(!verifyBalance(badExcess, proveBalance(k, badExcess)));
console.log('✓ an inflating transfer is rejected');

// Caveat: over a prime-order group, −1 is a huge positive number. Real systems ALSO need a
// RANGE proof that every output is in [0, 2^64) — e.g. Bulletproofs (eprint 2017/1066) —
// otherwise "300 + (−100)" balances a 200 input and mints money.
console.log('  (production confidential transfers also need range proofs — see Bulletproofs)');
