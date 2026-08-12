/*
 * drip-selftest.mjs — prove the LUVdrip's arithmetic and its redemption voucher.
 *
 * THE DRIP: a login arms 1,000,000 LUV that drips across the FULL 24 hours, wall-clock.
 * The ledger never counts per-second: window_wei = cap × elapsed ÷ 24h, floored — a pure
 * function of time. This test pins that (exact wei, no drift, idempotent settlement, hard
 * cap at the million) and pins the EIP-712 Redeem voucher to the type string the contract's
 * REDEEM_TYPEHASH is built from, so what the backend signs is what the chain verifies.
 *
 * Run: node test/drip-selftest.mjs   (no database, no chain — pure arithmetic + signing)
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// Minimal env so config.js loads (it fails fast on missing secrets by design).
Object.assign(process.env, {
  NODE_ENV: 'test',
  JWT_SECRET: 'x'.repeat(32),
  SESSION_SECRET: 'y'.repeat(32),
  DATABASE_URL: 'postgres://localhost/none',
  IP_SALT: 'z'.repeat(32),
  RPC_URL: 'http://127.0.0.1:8545',
  CHAIN_ID: '1',
  LUV_TOKEN_ADDRESS: '0x2711111111683B8708cb9a48cBf36a51315F8254',
  AIRDROP_CONTRACT_ADDRESS: '0x0000000000000000000000000000000000000001',
  WALLET_ENCRYPTION_KEY: 'a'.repeat(64),
  GESTURE_MODE: 'voucher',
});

const ethers = require('../src/ethers.js');
const drip = require('../src/actions/drip.js');

let failures = 0;
function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); failures++; } else { console.log('ok  -', msg); }
}

const LUV = 10n ** 18n;
const DAY_MS = 86_400_000;
const CAP = 1_000_000n * LUV; // the day's million in wei — 1e24

// ── the amount ───────────────────────────────────────────────────────────────
assert(drip.DAILY_WEI === CAP, 'the day is 1,000,000 LUV = 1e24 wei (not 1e27, not 1e30)');
assert(drip.DAILY_WEI === 10n ** 24n, 'exactly 10^24 wei');
assert(Math.abs(drip.perSecond() - 11.574074074074074) < 1e-9, 'the rate is 11.574074… LUV/s');
assert(drip.MIN_REDEEM_WEI === CAP, 'a redemption is worth a transaction at one day of drip');

// ── the flow: a pure function of elapsed time ────────────────────────────────
const t0 = 1_700_000_000_000;
assert(drip.windowEarned(t0, CAP, t0) === 0n, 'nothing at the instant the login arms it');
assert(drip.windowEarned(t0, CAP, t0 - 5000) === 0n, 'never negative before the window opens');
assert(drip.windowEarned(t0, CAP, t0 + DAY_MS / 2) === CAP / 2n, 'half a million at 12 hours');
assert(drip.windowEarned(t0, CAP, t0 + DAY_MS / 4) === CAP / 4n, 'a quarter million at 6 hours');
assert(drip.windowEarned(t0, CAP, t0 + DAY_MS) === CAP, 'the FULL million at exactly 24 hours');

// one second of drip, to the wei: 1e24 / 86400 floored
assert(drip.windowEarned(t0, CAP, t0 + 1000) === CAP / 86400n, 'one second = 11,574,074,074,074,074,074 wei');
assert(CAP / 86400n === 11574074074074074074n, 'the per-second wei figure is the published one');

// ── the cap: the million fills the day and stops ─────────────────────────────
assert(drip.windowEarned(t0, CAP, t0 + DAY_MS + 1) === CAP, 'a second past 24h adds nothing');
assert(drip.windowEarned(t0, CAP, t0 + 3 * DAY_MS) === CAP, 'three days away still yields ONE million');
assert(drip.windowEarned(t0, CAP, t0 + 365 * DAY_MS) === CAP, 'a year away still yields ONE million — the next needs a login');

// ── presence-free: the tab may close, the clock does not ─────────────────────
// Settling once at the end equals settling in many pieces along the way: no drift, and
// nothing depends on the browser being open or on how often the meter ticked.
let pieces = 0n; let last = 0n;
for (const frac of [0.013, 0.1, 0.25, 0.5, 0.5001, 0.77, 0.9, 0.99999, 1]) {
  const at = drip.windowEarned(t0, CAP, t0 + Math.floor(DAY_MS * frac));
  assert(at >= last, `monotonic at ${(frac * 100).toFixed(2)}% of the day`);
  pieces += at - last; last = at;
}
assert(pieces === CAP, 'settling in nine pieces equals settling once — no drift, no lost wei');
assert(drip.windowEarned(t0, CAP, t0 + DAY_MS) === last, 'the final settle matches the whole');

// idempotence: re-settling at the same instant credits nothing new
const twice = drip.windowEarned(t0, CAP, t0 + 12345678);
assert(twice === drip.windowEarned(t0, CAP, t0 + 12345678), 'settlement is idempotent');

// ── ON PAR: a million every 24 hours, measured hour by hour ─────────────────
// The claim is not "about a million a day". It is 1,000,000 LUV per 24 hours exactly, so
// this walks the day an hour at a time and checks the ledger's own function at each mark:
// the cumulative must equal floor(cap x h / 24) to the wei, each hour must deliver its
// 1/24 share to within the single wei that flooring can hide, and the 24 hourly deltas
// must sum to exactly one million with nothing lost between them.
const HOUR_MS = 3_600_000;
let running = 0n;
let minHour = null, maxHour = null;
const rows = [];
for (let h = 1; h <= 24; h++) {
  const at = drip.windowEarned(t0, CAP, t0 + h * HOUR_MS);
  const expected = (CAP * BigInt(h)) / 24n;          // the ledger's own arithmetic, independently
  const delta = at - running;
  running = at;
  if (minHour === null || delta < minHour) minHour = delta;
  if (maxHour === null || delta > maxHour) maxHour = delta;
  rows.push([h, at, delta, at === expected]);
}
const perHour = CAP / 24n;
assert(rows.every((r) => r[3]), 'every hour mark equals cap x h / 24 exactly, all 24 of them');
assert(maxHour - minHour <= 1n, `every hour delivers the same share to within 1 wei (spread ${maxHour - minHour} wei)`);
assert(minHour >= perHour - 1n && maxHour <= perHour + 1n,
  `each hour is 41,666.666... LUV (${Number(minHour) / 1e18} .. ${Number(maxHour) / 1e18})`);
assert(running === CAP, 'the 24 hourly deltas sum to EXACTLY 1,000,000 LUV — nothing lost between hours');
assert(drip.windowEarned(t0, CAP, t0 + 24 * HOUR_MS) === 1_000_000n * LUV, 'and the 24-hour mark IS the million');

console.log('\n    hour   cumulative LUV     this hour LUV        cumulative wei');
for (const [h, at, delta] of rows) {
  console.log('    ' + String(h).padStart(4) + '   ' + (Number(at) / 1e18).toFixed(2).padStart(13)
    + '   ' + (Number(delta) / 1e18).toFixed(6).padStart(15) + '   ' + at.toString().padStart(24));
}
console.log('');

// ── the redemption voucher: what we sign is what the contract verifies ───────
// The contract builds its digest from
//   keccak256("Redeem(address user,address token,uint256 amount,bytes32 redemptionId,uint256 deadline)")
// then "\x19\x01" || DOMAIN_SEPARATOR || structHash, with domain ("IncentiveDistributor","2").
const REDEEM_TYPE_STRING = 'Redeem(address user,address token,uint256 amount,bytes32 redemptionId,uint256 deadline)';
const REDEEM_TYPEHASH = ethers.keccak256(ethers.toUtf8Bytes(REDEEM_TYPE_STRING));

const domain = {
  name: 'IncentiveDistributor',
  version: '2',
  chainId: 1,
  verifyingContract: '0x607E000000000000000000000000000000000f806'.slice(0, 42),
};
const types = {
  Redeem: [
    { name: 'user', type: 'address' },
    { name: 'token', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'redemptionId', type: 'bytes32' },
    { name: 'deadline', type: 'uint256' },
  ],
};
const value = {
  user: '0x1111111111111111111111111111111111111111',
  token: process.env.LUV_TOKEN_ADDRESS,
  amount: (3n * CAP).toString(), // three days of drip, accumulated into one delivery
  redemptionId: ethers.keccak256(ethers.toUtf8Bytes('luvdrip:test:1')),
  deadline: 1_800_000_000,
};

assert(
  ethers.TypedDataEncoder.from(types).encodeType('Redeem') === REDEEM_TYPE_STRING,
  'the Redeem type string byte-matches the contract\'s REDEEM_TYPEHASH source'
);

const domainSeparator = ethers.TypedDataEncoder.hashDomain(domain);
const structHash = ethers.keccak256(
  ethers.AbiCoder.defaultAbiCoder().encode(
    ['bytes32', 'address', 'address', 'uint256', 'bytes32', 'uint256'],
    [REDEEM_TYPEHASH, value.user, value.token, value.amount, value.redemptionId, value.deadline]
  )
);
const manual = ethers.keccak256(ethers.concat(['0x1901', domainSeparator, structHash]));
assert(manual === ethers.TypedDataEncoder.hash(domain, types, value), 'the manual digest equals the EIP-712 hash');

// The backend signs the RAW digest (SigningKey.sign) — exactly what _recoverSigner ecrecovers.
const PK = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'; // test-only
const wallet = new ethers.Wallet(PK);
const sig = wallet.signingKey.sign(manual).serialized;
assert(ethers.dataLength(sig) === 65, 'the signature is 65 bytes (the contract length-checks it)');
assert(ethers.recoverAddress(manual, sig) === wallet.address, 'ecrecover(digest, sig) == signer');

// A single wei of drift in the amount invalidates the voucher — the tally is signed, not asserted.
const bent = ethers.TypedDataEncoder.hash(domain, types, { ...value, amount: (3n * CAP + 1n).toString() });
assert(ethers.recoverAddress(bent, sig) !== wallet.address, 'bending the amount by 1 wei breaks the signature');

console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed ❤ a million a day, dripped and redeemable');
process.exit(failures ? 1 : 0);
