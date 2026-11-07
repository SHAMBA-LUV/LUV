// bn254.mjs — dependency-free G1 arithmetic on BN254 (alt_bn128): the curve behind Circom,
// snarkjs, Groth16 on Ethereum, and the EIP-196/197 precompiles.
//
// EDUCATIONAL CODE — correct, NOT constant-time. Production: https://github.com/paulmillr/noble-curves
//
//   y² = x³ + 3  over F_P,  G1 = (1, 2),  prime group order N  (cofactor 1)
// The precompiles (and this file) encode the point at infinity as (0, 0) / null.

import { randomBytes } from 'node:crypto';

export const P = 21888242871839275222246405745257275088696311157297823662689037894645226208583n;
export const N = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
export const G = Object.freeze({ x: 1n, y: 2n });
export const INF = null;

export const mod = (a, m = P) => ((a % m) + m) % m;
export function inv(a, m = P) {
  let [r0, r1, s0, s1] = [mod(a, m), m, 1n, 0n];
  while (r1) { const q = r0 / r1; [r0, r1] = [r1, r0 - q * r1]; [s0, s1] = [s1, s0 - q * s1]; }
  if (r0 !== 1n) throw new Error('not invertible');
  return mod(s0, m);
}
export const isOnCurve = (Q) => Q === INF || mod(Q.y * Q.y - Q.x ** 3n - 3n) === 0n;
export const eq = (A, B) => (A === INF || B === INF ? A === B : A.x === B.x && A.y === B.y);

export function add(A, B) {
  if (A === INF) return B;
  if (B === INF) return A;
  if (A.x === B.x) {
    if (mod(A.y + B.y) === 0n) return INF;
    const l = mod(3n * A.x * A.x * inv(2n * A.y));
    const x = mod(l * l - 2n * A.x);
    return { x, y: mod(l * (A.x - x) - A.y) };
  }
  const l = mod((B.y - A.y) * inv(B.x - A.x));
  const x = mod(l * l - A.x - B.x);
  return { x, y: mod(l * (A.x - x) - A.y) };
}
export function mul(Q, k) {
  k = mod(k, N);
  let R = INF, D = Q;
  while (k) { if (k & 1n) R = add(R, D); D = add(D, D); k >>= 1n; }
  return R;
}
export function randomScalar() {
  const k = mod(BigInt('0x' + randomBytes(48).toString('hex')), N);
  return k === 0n ? randomScalar() : k;
}

// ── Solidity-compatible encoding helpers ──────────────────────────────────────
export const word = (v) => Buffer.from(BigInt(v).toString(16).padStart(64, '0'), 'hex');
export const addr = (a) => Buffer.from(a.replace(/^0x/, '').padStart(40, '0'), 'hex');
export const bytes32Str = (s) => { const b = Buffer.alloc(32); b.write(s, 'utf8'); return b; };
