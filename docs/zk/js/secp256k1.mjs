// secp256k1.mjs — a tiny, dependency-free secp256k1 toolkit for the ZK guide.
//
// EDUCATIONAL CODE. It is correct but NOT constant-time and NOT hardened:
// never use it to guard real value. For production use an audited library
// (e.g. https://github.com/paulmillr/noble-curves or libsecp256k1
// https://github.com/bitcoin-core/secp256k1).
//
// secp256k1 is the curve Ethereum and Bitcoin use for keys and ECDSA:
//   y^2 = x^3 + 7  over  F_p
// Curve parameters: SEC 2 v2, §2.4.1 — https://www.secg.org/sec2-v2.pdf

import { createHash, randomBytes, createECDH } from 'node:crypto';

export const P = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn; // field prime
export const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n; // group order
export const G = Object.freeze({
  x: 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n,
  y: 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n,
});
export const INF = null; // the point at infinity (group identity)

export const mod = (a, m = P) => ((a % m) + m) % m;

// modular inverse by the extended Euclidean algorithm
export function inv(a, m = P) {
  let [r0, r1] = [mod(a, m), m];
  let [s0, s1] = [1n, 0n];
  while (r1 !== 0n) {
    const q = r0 / r1;
    [r0, r1] = [r1, r0 - q * r1];
    [s0, s1] = [s1, s0 - q * s1];
  }
  if (r0 !== 1n) throw new Error('not invertible');
  return mod(s0, m);
}

export function powmod(b, e, m = P) {
  let r = 1n;
  b = mod(b, m);
  while (e > 0n) {
    if (e & 1n) r = (r * b) % m;
    b = (b * b) % m;
    e >>= 1n;
  }
  return r;
}

export const isOnCurve = (Q) => Q === INF || mod(Q.y * Q.y - (Q.x ** 3n + 7n)) === 0n;
export const eq = (A, B) => (A === INF || B === INF ? A === B : A.x === B.x && A.y === B.y);
export const neg = (A) => (A === INF ? INF : { x: A.x, y: mod(-A.y) });

export function add(A, B) {
  if (A === INF) return B;
  if (B === INF) return A;
  if (A.x === B.x) {
    if (mod(A.y + B.y) === 0n) return INF; // A + (-A)
    // doubling: λ = 3x² / 2y
    const l = mod(3n * A.x * A.x * inv(2n * A.y));
    const x = mod(l * l - 2n * A.x);
    return { x, y: mod(l * (A.x - x) - A.y) };
  }
  const l = mod((B.y - A.y) * inv(B.x - A.x)); // λ = Δy / Δx
  const x = mod(l * l - A.x - B.x);
  return { x, y: mod(l * (A.x - x) - A.y) };
}

export const sub = (A, B) => add(A, neg(B));

// scalar multiplication k·Q by double-and-add (NOT constant-time — demo only)
export function mul(Q, k) {
  k = mod(k, N);
  let R = INF;
  let D = Q;
  while (k > 0n) {
    if (k & 1n) R = add(R, D);
    D = add(D, D);
    k >>= 1n;
  }
  return R;
}

// SEC1 compressed encoding: 02/03 || x  (33 bytes)
export function encode(Q) {
  if (Q === INF) return Buffer.from([0]);
  return Buffer.concat([Buffer.from([Q.y & 1n ? 3 : 2]), Buffer.from(Q.x.toString(16).padStart(64, '0'), 'hex')]);
}

const toBuf = (v) => {
  if (typeof v === 'bigint') return Buffer.from(v.toString(16).padStart(64, '0'), 'hex');
  if (typeof v === 'string') return Buffer.from(v, 'utf8');
  if (Buffer.isBuffer(v)) return v;
  return encode(v); // a point (or INF)
};

// Hash an ordered list of points / scalars / strings to a scalar in Z_N.
// Every item is length-prefixed so that ("ab","c") and ("a","bc") never collide.
export function hashToScalar(...items) {
  const h = createHash('sha256');
  for (const it of items) {
    const b = toBuf(it);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(b.length);
    h.update(len).update(b);
  }
  return mod(BigInt('0x' + h.digest('hex')), N);
}

// Uniform scalar in [1, N-1]: 48 random bytes reduced mod N (bias < 2^-128).
export function randomScalar() {
  const k = mod(BigInt('0x' + randomBytes(48).toString('hex')), N);
  return k === 0n ? randomScalar() : k;
}

// "Nothing-up-my-sleeve" second generator H, by try-and-increment:
// hash a public seed to an x-coordinate until x³+7 is a square. Nobody knows log_G(H).
export function hashToPoint(seed) {
  for (let ctr = 0; ; ctr++) {
    const x = mod(BigInt('0x' + createHash('sha256').update(`${seed}:${ctr}`).digest('hex')));
    const rhs = mod(x ** 3n + 7n);
    const y = powmod(rhs, (P + 1n) / 4n); // sqrt works because P ≡ 3 (mod 4)
    if (mod(y * y) === rhs) return { x, y: y & 1n ? mod(-y) : y }; // pick the even root
  }
}

// Self-check: our arithmetic must agree with Node's OpenSSL-backed secp256k1.
export function selfTest() {
  if (!isOnCurve(G)) throw new Error('G not on curve');
  if (add(mul(G, N - 1n), G) !== INF) throw new Error('order check failed: (N-1)·G + G ≠ ∞');
  for (let i = 0; i < 3; i++) {
    const k = randomScalar();
    const ecdh = createECDH('secp256k1');
    ecdh.setPrivateKey(Buffer.from(k.toString(16).padStart(64, '0'), 'hex'));
    const theirs = ecdh.getPublicKey(null, 'compressed');
    if (!theirs.equals(encode(mul(G, k)))) throw new Error('scalar mult disagrees with OpenSSL');
  }
  return true;
}
