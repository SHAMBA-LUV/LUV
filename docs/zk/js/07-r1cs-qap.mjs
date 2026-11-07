// 07-r1cs-qap.mjs — how a zk-SNARK "sees" a program: flatten → R1CS → QAP.
//
// The running example (from Vitalik Buterin's "Quadratic Arithmetic Programs: from Zero
// to Hero"): prove you know x with  x³ + x + 5 = 35  (the answer is x = 3), without
// revealing x.
//
// 1. FLATTEN into steps of the form  left (op) right:
//      sym1 = x · x
//      y    = sym1 · x
//      sym2 = y + x
//      out  = sym2 + 5
// 2. R1CS: a witness vector w and matrices A, B, C with  (A·w) ∘ (B·w) = C·w  row by row.
// 3. QAP: interpolate every column into a polynomial, so all rows hold at once iff
//      A(t)·B(t) − C(t)  is divisible by  Z(t) = (t−1)(t−2)(t−3)(t−4).
//    Checking that at ONE random point τ is enough (Schwartz–Zippel lemma). Groth16 does
//    exactly this, with τ hidden inside elliptic-curve points by the trusted setup and the
//    final equation checked with a pairing.
//
// All arithmetic is over the BN254 scalar field — the field Circom, snarkjs and the
// Ethereum precompiles (EIP-196/197) use.
//
// Run: node docs/zk/js/07-r1cs-qap.mjs

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

const R = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const f = (a) => ((a % R) + R) % R;
const finv = (a) => { let r = 1n, b = f(a), e = R - 2n; while (e) { if (e & 1n) r = r * b % R; b = b * b % R; e >>= 1n; } return r; };

// ── R1CS ──────────────────────────────────────────────────────────────────────
//            w = [ one,  x, out, sym1,  y, sym2 ]
const A = [   [   0,   1,   0,    0,   0,    0 ],   // x    · x   = sym1
              [   0,   0,   0,    1,   0,    0 ],   // sym1 · x   = y
              [   0,   1,   0,    0,   1,    0 ],   // (x+y)· 1   = sym2
              [   5,   0,   0,    0,   0,    1 ] ]; // (sym2+5)·1 = out
const B = [   [   0,   1,   0,    0,   0,    0 ],
              [   0,   1,   0,    0,   0,    0 ],
              [   1,   0,   0,    0,   0,    0 ],
              [   1,   0,   0,    0,   0,    0 ] ];
const C = [   [   0,   0,   0,    1,   0,    0 ],
              [   0,   0,   0,    0,   1,    0 ],
              [   0,   0,   0,    0,   0,    1 ],
              [   0,   0,   1,    0,   0,    0 ] ];
const toF = (M) => M.map((row) => row.map(BigInt));
const [Af, Bf, Cf] = [toF(A), toF(B), toF(C)];

const dot = (row, w) => f(row.reduce((s, a, j) => s + a * w[j], 0n));
const r1csHolds = (w) => Af.every((_, i) => f(dot(Af[i], w) * dot(Bf[i], w)) === dot(Cf[i], w));

const good = [1n, 3n, 35n, 9n, 27n, 30n];
const bad = [1n, 4n, 35n, 16n, 64n, 68n]; // x = 4 does not give 35
assert.ok(r1csHolds(good));
assert.ok(!r1csHolds(bad));
console.log('✓ R1CS: the witness for x = 3 satisfies all 4 constraints; x = 4 does not');

// ── polynomial helpers (coefficients low → high degree) ──────────────────────
const padd = (p, q) => Array.from({ length: Math.max(p.length, q.length) }, (_, i) => f((p[i] ?? 0n) + (q[i] ?? 0n)));
const psub = (p, q) => padd(p, q.map((c) => f(-c)));
const pscale = (p, k) => p.map((c) => f(c * k));
const pmul = (p, q) => {
  const out = Array(p.length + q.length - 1).fill(0n);
  p.forEach((a, i) => q.forEach((b, j) => { out[i + j] = f(out[i + j] + a * b); }));
  return out;
};
const peval = (p, t) => p.reduceRight((acc, c) => f(acc * t + c), 0n);
const trim = (p) => { const q = [...p]; while (q.length > 1 && q[q.length - 1] === 0n) q.pop(); return q; };
function pdivmod(num, den) {
  num = trim(num); den = trim(den);
  const q = Array(Math.max(num.length - den.length + 1, 1)).fill(0n);
  let rem = [...num];
  const lead = finv(den[den.length - 1]);
  for (let i = num.length - den.length; i >= 0; i--) {
    const k = f(rem[i + den.length - 1] * lead);
    q[i] = k;
    den.forEach((d, j) => { rem[i + j] = f(rem[i + j] - k * d); });
  }
  return [trim(q), trim(rem)];
}
// Lagrange interpolation through (xs[i], ys[i])
function interpolate(xs, ys) {
  let acc = [0n];
  xs.forEach((xi, i) => {
    let basis = [1n], denom = 1n;
    xs.forEach((xj, j) => { if (j !== i) { basis = pmul(basis, [f(-xj), 1n]); denom = f(denom * (xi - xj)); } });
    acc = padd(acc, pscale(basis, f(ys[i] * finv(denom))));
  });
  return acc;
}

// ── R1CS → QAP ────────────────────────────────────────────────────────────────
const points = [1n, 2n, 3n, 4n];                         // one evaluation point per constraint
const columnPolys = (M) => M[0].map((_, j) => interpolate(points, M.map((row) => row[j])));
const [Ap, Bp, Cp] = [columnPolys(Af), columnPolys(Bf), columnPolys(Cf)];
const Z = points.reduce((z, p) => pmul(z, [f(-p), 1n]), [1n]); // vanishing polynomial

function qap(w) {
  const combine = (polys) => polys.reduce((acc, p, j) => padd(acc, pscale(p, w[j])), [0n]);
  const P = psub(pmul(combine(Ap), combine(Bp)), combine(Cp)); // A(t)·B(t) − C(t)
  const [H, rem] = pdivmod(P, Z);
  return { P, H, divisible: rem.length === 1 && rem[0] === 0n };
}

const g = qap(good);
assert.ok(g.divisible);
console.log('✓ QAP: A(t)·B(t) − C(t) is divisible by Z(t) for the valid witness');
assert.ok(!qap(bad).divisible);
console.log('✓ QAP: the invalid witness leaves a non-zero remainder');

// The succinct check: one random point τ.  A wrong polynomial identity of degree d
// survives a random τ with probability ≤ d / |F|  ≈ 2^-250 here.
const tau = f(BigInt('0x' + randomBytes(32).toString('hex')));
assert.equal(peval(g.P, tau), f(peval(g.H, tau) * peval(Z, tau)));
console.log('✓ Schwartz–Zippel: P(τ) = H(τ)·Z(τ) at a random τ — the equation Groth16 checks "in the exponent"');

// Note: Circom folds additions into linear combinations, so this program compiles to just
// 2 constraints (sym1 = x·x and out = sym1·x + x + 5). Multiplications cost; additions are free.
