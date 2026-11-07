// 01-schnorr-interactive.mjs — the "hello world" of zero knowledge.
//
// Statement : "I know x such that X = x·G"   (X is public, x is secret)
// Protocol  : Schnorr identification (Schnorr 1989), a Σ-protocol:
//
//     Prover                               Verifier
//     r ← random,  R = r·G      ── R ──▶
//                               ◀── c ──   c ← random challenge
//     s = r + c·x  (mod N)      ── s ──▶
//                                          accept iff  s·G == R + c·X
//
// Completeness: s·G = (r + c·x)·G = R + c·X.
// Run: node docs/zk/js/01-schnorr-interactive.mjs

import assert from 'node:assert/strict';
import { G, N, mod, mul, add, sub, eq, randomScalar } from './secp256k1.mjs';

// ── honest parties ────────────────────────────────────────────────────────────
class Prover {
  constructor(x) { this.x = x; }
  commit() { this.r = randomScalar(); return mul(G, this.r); }
  respond(c) { return mod(this.r + c * this.x, N); }
}
const verify = (X, R, c, s) => eq(mul(G, s), add(R, mul(X, c)));

const x = randomScalar(); // the secret (think: a private key)
const X = mul(G, x);      // the public statement (think: the public key)

const P = new Prover(x);
const R = P.commit();
const c = randomScalar(); // verifier's challenge — must be unpredictable to the prover
const s = P.respond(c);
assert.ok(verify(X, R, c, s), 'honest proof must verify');
console.log('✓ completeness: honest prover convinces the verifier');

// ── soundness: a cheater who does NOT know x ──────────────────────────────────
// The only way to pass without x is to guess c *before* sending R:
//   pick s at random, set R = s·G − c_guess·X.  It verifies iff c == c_guess.
// To make the odds visible we shrink the challenge space to ONE bit {0,1}.
function cheatOnce() {
  const cGuess = BigInt(Math.random() < 0.5 ? 0 : 1);
  const sFake = randomScalar();
  const RFake = sub(mul(G, sFake), mul(X, cGuess));
  const cReal = BigInt(Math.random() < 0.5 ? 0 : 1); // verifier flips a coin
  return verify(X, RFake, cReal, sFake);
}
const trials = 400;
let wins = 0;
for (let i = 0; i < trials; i++) if (cheatOnce()) wins++;
console.log(`✓ soundness: with a 1-bit challenge the cheater passes ${(100 * wins / trials).toFixed(1)}% of single rounds (≈50%)`);
assert.ok(wins > trials * 0.4 && wins < trials * 0.6);

// k independent rounds → success 2^-k.  With a full 256-bit challenge one round
// already gives ≈2^-256: that is why real deployments use a large challenge space.
const rounds = 20;
let survived = 0;
for (let t = 0; t < 100; t++) {
  let ok = true;
  for (let i = 0; i < rounds && ok; i++) ok = cheatOnce();
  if (ok) survived++;
}
console.log(`✓ soundness amplification: cheater survived ${rounds} rounds in ${survived}/100 attempts (expected ≈ 100·2^-20 ≈ 0)`);
assert.ok(survived <= 1);
