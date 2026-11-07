// 02-simulator.mjs — WHY the Schnorr protocol is zero-knowledge.
//
// Definition (honest-verifier ZK): there is an efficient SIMULATOR that, given only the
// public statement X — never the secret x — outputs transcripts (R, c, s) distributed
// exactly like real conversations. If transcripts can be manufactured without x, then
// seeing one cannot teach the verifier anything about x.
//
// The simulator runs the protocol "backwards":
//   c ← random,  s ← random,  R = s·G − c·X
// Real transcripts:      c uniform, s uniform (r masks c·x), R determined by (c, s).
// Simulated transcripts: c uniform, s uniform, R determined by (c, s).   Identical.
//
// Run: node docs/zk/js/02-simulator.mjs

import assert from 'node:assert/strict';
import { G, N, mod, mul, add, sub, eq, randomScalar } from './secp256k1.mjs';

const verify = (X, R, c, s) => eq(mul(G, s), add(R, mul(X, c)));

const x = randomScalar();
const X = mul(G, x);

function realTranscript() {          // needs x
  const r = randomScalar();
  const R = mul(G, r);
  const c = randomScalar();
  return { R, c, s: mod(r + c * x, N) };
}

function simulatedTranscript(X) {    // needs ONLY the public X
  const c = randomScalar();
  const s = randomScalar();
  return { R: sub(mul(G, s), mul(X, c)), c, s };
}

for (let i = 0; i < 5; i++) {
  const real = realTranscript();
  const sim = simulatedTranscript(X);
  assert.ok(verify(X, real.R, real.c, real.s));
  assert.ok(verify(X, sim.R, sim.c, sim.s));
}
console.log('✓ real and simulated transcripts both verify — an observer cannot tell them apart');

// The crucial caveat: the simulator chose c itself. A real verifier only accepts because
// R was fixed BEFORE c was revealed. A transcript alone is therefore not a proof to a third
// party — interactivity (or Fiat–Shamir, see 04) is what binds R before c.
console.log('  (note: a recorded transcript convinces no third party — that is exactly the ZK property)');
