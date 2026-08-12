/*
 * drip-e2e.mjs — the LUVdrip end to end, against a REAL postgres and a REAL chain.
 *
 * Proves the operator's rule with the actual backend modules (no mocks):
 *   1. a participant logs in            → a million is armed
 *   2. it drips the FULL 24 hours       → wall-clock, with nobody watching
 *   3. it stops at exactly 1,000,000    → and waits for the next login
 *   4. a subsequent login               → starts another million
 *   5. the tally accumulates            → one growing value across windows
 *   6. REDEEM self-paid                 → the PARTICIPANT sends it and spends their own ETH
 *   7. REDEEM sponsored                 → the PROJECT sends it; an ETH-less participant is paid
 *   8. the reward amount is a VARIABLE  → setDrip retunes it on-chain, live
 *   9. any ERC-20                       → assets added, paid out through the same rail, removed
 *
 * Time is warped by moving drip_state.window_started_at backwards in SQL — the ledger reads the
 * clock, so this is exactly equivalent to waiting a day.
 *
 * PREREQUISITES (throwaway, local):
 *   anvil --port 18545 --chain-id 31337 --base-fee 2000000000 --silent &
 *   # deploy RewardToken + IncentiveDistributor, fund the distributor, then:
 *   export TOKEN=0x… DIST=0x…                 # the two deployed addresses
 *   export DATABASE_URL=postgres://…/luvtest   # an EMPTY database — this test TRUNCATEs it
 *   node test/drip-e2e.mjs
 *
 * ⚠ It TRUNCATEs `identities` (and everything referencing it). Never point it at production.
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const RPC = process.env.RPC_URL || 'http://127.0.0.1:18545';
const TOKEN = process.env.TOKEN;
const DIST = process.env.DIST;
const SIGNER_PK = '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6'; // anvil #3
const PARTICIPANT_PK = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'; // anvil #1
const SPONSOR_PK = '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a'; // anvil #2

Object.assign(process.env, {
  NODE_ENV: 'test',
  JWT_SECRET: 'x'.repeat(32), SESSION_SECRET: 'y'.repeat(32), IP_SALT: 'z'.repeat(32),
  DATABASE_URL: process.env.DATABASE_URL || 'postgres://luv@127.0.0.1:55432/luvtest',
  RPC_URL: RPC, CHAIN_ID: '31337',
  LUV_TOKEN_ADDRESS: TOKEN,
  AIRDROP_CONTRACT_ADDRESS: '0x0000000000000000000000000000000000000001',
  WALLET_ENCRYPTION_KEY: 'a'.repeat(64),
  GESTURE_MODE: 'voucher',
  INCENTIVE_DISTRIBUTOR_ADDRESS: DIST,
  VOUCHER_SIGNER_PRIVATE_KEY: SIGNER_PK,
  RELAYER_PRIVATE_KEY: SPONSOR_PK,
  SPONSOR_MAX_GWEI: '10000',
  DRIP_SPONSOR: 'true',
});

const ethers = require('../src/ethers.js');
const db = require('../src/db.js');
const drip = require('../src/actions/drip.js');
const { upsertIdentity } = require('../src/auth/identity.js');

const LUV = 10n ** 18n;
const MILLION = 1_000_000n * LUV;
let failures = 0;
const ok = (cond, msg) => { if (cond) console.log('ok  -', msg); else { console.error('FAIL:', msg); failures++; } };
const luv = (w) => (BigInt(w) / LUV).toLocaleString('en-US');
// Real milliseconds pass between steps, and the drip is honest about them: allow ten seconds
// of flow (≈116 LUV) either side when checking a mid-window figure.
const SLACK = 120n * LUV;
// anvil mines instantly; give the provider a beat between owner transactions so its nonce
// view is never stale (a harness concern, not a contract one)
const settle = async (t) => { const r = await (await t).wait(); await new Promise((x) => setTimeout(x, 250)); return r; };
const near = (got, want) => { const g = BigInt(got), w = BigInt(want); return g >= w - SLACK && g <= w + SLACK; };

const RUN = Date.now().toString(36); // the chain persists between runs; ids must not repeat
const IDK = 'github:e2e-participant';
const provider = new ethers.JsonRpcProvider(RPC, 31337);

/** Move this identity's window back by `secs` — indistinguishable from having waited. */
async function warp(secs) {
  await db.query(
    `UPDATE drip_state
        SET window_started_at = window_started_at - make_interval(secs => $2),
            window_ends_at    = window_ends_at    - make_interval(secs => $2),
            settled_at        = settled_at        - make_interval(secs => $2)
      WHERE identity_key = $1`, [IDK, secs]
  );
}

async function main() {
  // schema
  const fs = require('fs');
  await db.query(fs.readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8'));
  await db.query('TRUNCATE identities CASCADE');

  // the rate is an ON-CHAIN VARIABLE, so reset it to the published million before testing
  // (a previous run may have retuned it — that is the point of step 8)
  const owner = new ethers.Wallet('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', provider);
  const dist = new ethers.Contract(DIST, [
    'function setDrip(address token, uint256 perDay)',
    'function dripPerDay() view returns (uint256)',
    'function addAsset(address token)',
    'function removeAsset(address token, address to)',
    'function assets() view returns (address[])',
    'function isAsset(address) view returns (bool)',
    'function assetBalances() view returns (address[], uint256[])',
  ], owner);
  await settle(dist.setDrip(TOKEN, MILLION));
  console.log(`— schema loaded · on-chain dripPerDay = ${luv(await dist.dripPerDay())} LUV/day —\n`);

  // ── 1. THE LOGIN ARMS A MILLION ────────────────────────────────────────────
  const participant = new ethers.Wallet(PARTICIPANT_PK, provider);
  await upsertIdentity({ provider: 'github', providerUserId: 'e2e-participant', email: null });
  // the wallet the LUV is owed to (provisioning is mocked here — the drip only needs the row)
  await db.query(
    `INSERT INTO wallets (identity_key, address, enc_ciphertext, enc_iv, enc_tag)
     VALUES ($1,$2,'x','x','x') ON CONFLICT (identity_key) DO NOTHING`,
    [IDK, participant.address]
  );

  let s = await drip.status(IDK);
  ok(s.eligible === true, 'after login the participant has a drip');
  ok(s.dailyLuv.toString() === '1000000', 'the day is 1,000,000 LUV');
  ok(s.windowEndsAt - s.windowStartedAt === 86400, 'the login armed a 24-hour window');
  ok(BigInt(s.accrued) < LUV, 'nothing has dripped yet in the first instants');
  ok(s.flowing === true && s.full === false, 'the drip is flowing');
  console.log(`   window ${new Date(s.windowStartedAt * 1000).toISOString()} → ${new Date(s.windowEndsAt * 1000).toISOString()}\n`);

  // ── 2. IT DRIPS ALL DAY, WITH NOBODY WATCHING ──────────────────────────────
  await warp(3600); // one hour later — no requests, no tab, no session
  s = await drip.status(IDK);
  const oneHour = MILLION / 24n;
  ok(near(s.accrued, oneHour), `an hour later, with nobody watching: ${luv(s.accrued)} LUV (≈1/24 of the million)`);

  await warp(3600 * 5); // six hours in
  s = await drip.status(IDK);
  const sixHours = MILLION / 4n;
  ok(near(s.accrued, sixHours), `six hours in: ${luv(s.accrued)} LUV (≈a quarter of the million)`);
  ok(s.flowing === true, 'still flowing at six hours');

  // ── 3. IT STOPS AT THE MILLION AND WAITS ───────────────────────────────────
  await warp(3600 * 18); // 24h total
  s = await drip.status(IDK);
  ok(BigInt(s.accrued) === MILLION, `at 24 hours the tally is EXACTLY ${luv(s.accrued)} LUV`);
  ok(s.full === true && s.flowing === false, 'the window is complete — the drip has stopped');
  ok(s.needsLogin === true, 'the next million needs a login');

  await warp(3600 * 48); // two more days away, no login
  s = await drip.status(IDK);
  ok(BigInt(s.accrued) === MILLION, 'two days later, still ONE million — no login, no new drip');

  // ── 4. A SUBSEQUENT LOGIN STARTS ANOTHER MILLION ───────────────────────────
  await upsertIdentity({ provider: 'github', providerUserId: 'e2e-participant', email: null });
  s = await drip.status(IDK);
  ok(s.full === false && s.flowing === true, 'the next login armed a fresh million');
  ok(s.windows === 2, 'two windows have been armed');
  ok(near(s.accrued, MILLION) && BigInt(s.accrued) >= MILLION,
    'the first million is untouched in the tally, and the new one has begun');

  // ── 5. THE TALLY ACCUMULATES AS ONE VALUE ──────────────────────────────────
  await warp(86400); // let the second million complete
  s = await drip.status(IDK);
  ok(BigInt(s.accrued) === 2n * MILLION, `the tally accumulated: ${luv(s.accrued)} LUV across two days`);
  ok(s.windowStartedAt > 0 && s.full === true, 'the second window is complete too');

  // ── 6. REDEEM, SELF-PAID: the participant sends it and spends their own ETH ─
  const v = await drip.issueVoucher(IDK, { payer: 'self' });
  ok(v.ok === true, 'the backend issued a signed redemption voucher');
  ok(v.to.toLowerCase() === DIST.toLowerCase(), 'it targets the IncentiveDistributor');
  ok(BigInt(v.amount) === 2n * MILLION, `the voucher carries the whole tally: ${luv(v.amount)} LUV`);
  ok(v.voucher.token.toLowerCase() === TOKEN.toLowerCase(), 'it pays in the asset the chain names as the drip asset');
  s = await drip.status(IDK);
  ok(BigInt(s.accrued) === 0n && BigInt(s.heldWei) === 2n * MILLION, 'the amount is held while the voucher is live');

  const token = new ethers.Contract(TOKEN, ['function balanceOf(address) view returns (uint256)'], provider);
  const before = await token.balanceOf(participant.address);
  const tx = await participant.sendTransaction({
    to: v.to, data: v.data,
    maxPriorityFeePerGas: 1_000_000_000n, maxFeePerGas: 5_000_000_000n, // a real tip: real ETH leaves their wallet
  });
  const rc = await tx.wait();
  const ethBefore = await provider.getBalance(participant.address, rc.blockNumber - 1);
  const ethAfter = await provider.getBalance(participant.address, rc.blockNumber);
  const after = await token.balanceOf(participant.address);

  ok(after - before === 2n * MILLION, `the participant received ${luv((after - before).toString())} LUV on-chain`);
  const spent = ethBefore - ethAfter;
  ok(spent === rc.gasUsed * rc.gasPrice && spent > 0n,
    `and PAID THE GAS themselves: ${ethers.formatEther(spent)} ETH (${rc.gasUsed} gas × ${rc.gasPrice} wei)`);
  ok(rc.from.toLowerCase() === participant.address.toLowerCase(), 'the transaction was sent BY the participant');

  await drip.reconcile();
  s = await drip.status(IDK);
  ok(BigInt(s.heldWei) === 0n && BigInt(s.redeemedWei) === 2n * MILLION, 'the ledger reconciled it from the chain');

  // ── 7. REDEEM, SPONSORED: the project pays, the participant needs no ETH ────
  await upsertIdentity({ provider: 'github', providerUserId: 'e2e-participant', email: null });
  await warp(86400); // a third million completes
  s = await drip.status(IDK);
  ok(near(s.accrued, MILLION), `a third million accumulated: ${luv(s.accrued)} LUV`);

  const poorIdk = 'github:e2e-noeth';
  const poor = ethers.Wallet.createRandom(); // a wallet that has never held ETH
  await upsertIdentity({ provider: 'github', providerUserId: 'e2e-noeth', email: null });
  await db.query(
    `INSERT INTO wallets (identity_key, address, enc_ciphertext, enc_iv, enc_tag)
     VALUES ($1,$2,'x','x','x') ON CONFLICT (identity_key) DO NOTHING`, [poorIdk, poor.address]
  );
  await db.query(
    `UPDATE drip_state SET window_started_at = window_started_at - make_interval(secs => 86400),
            window_ends_at = window_ends_at - make_interval(secs => 86400)
      WHERE identity_key = $1`, [poorIdk]
  );
  ok((await provider.getBalance(poor.address)) === 0n, 'the second participant holds ZERO ETH');

  const pass = await drip.sponsorRedeem([IDK, poorIdk], {});
  ok(pass.ok === true, `the project sponsored a pass: ${pass.sponsored} redeemed in one transaction`);
  const rcp = await provider.getTransactionReceipt(pass.txHash);
  ok(rcp.from.toLowerCase() === new ethers.Wallet(SPONSOR_PK).address.toLowerCase(),
    'the transaction was sent BY the project relayer, not the participants');
  ok((await token.balanceOf(poor.address)) === MILLION,
    `the ETH-less participant received ${luv((await token.balanceOf(poor.address)).toString())} LUV — gas paid by the project`);
  ok((await provider.getBalance(poor.address)) === 0n, 'and still holds zero ETH');

  s = await drip.status(IDK);
  ok(BigInt(s.accrued) === 0n, 'both tallies are delivered and reset');
  ok(BigInt(s.redeemedWei) === 3n * MILLION, `lifetime redeemed: ${luv(s.redeemedWei)} LUV`);

  // ── 8. THE REWARD AMOUNT IS A VARIABLE — the owner retunes it on-chain ─────
  await settle(dist.setDrip(TOKEN, 5n * MILLION));     // five million a day
  ok((await dist.dripPerDay()) === 5n * MILLION, 'the owner retuned the daily reward on-chain to 5,000,000 LUV');

  // ── 9. ANY ERC-20: assets can be added, paid out, and removed ───────────────
  const partnerFactory = new ethers.ContractFactory(
    ['constructor(uint256 supply)'],
    // minimal ERC-20 identical to the reward token used above, deployed from its artifact
    JSON.parse(require('fs').readFileSync(
      process.env.REWARD_TOKEN_ARTIFACT || '../out/RewardToken.sol/RewardToken.json', 'utf8')).bytecode.object,
    owner
  );
  const partner = await partnerFactory.deploy(10n ** 18n);
  await partner.waitForDeployment();
  await new Promise((x) => setTimeout(x, 250));
  const partnerAddr = await partner.getAddress();
  const partnerC = new ethers.Contract(partnerAddr, [
    'function transfer(address,uint256) returns (bool)', 'function balanceOf(address) view returns (uint256)',
  ], owner);
  await settle(partnerC.transfer(DIST, 10n ** 30n));
  const assetsBefore = (await dist.assets()).length;
  await settle(dist.addAsset(partnerAddr));
  ok(await dist.isAsset(partnerAddr), 'a second ERC-20 was ADDED to the distributor');
  const [tks, bals] = await dist.assetBalances();
  const idx = tks.findIndex((t) => t.toLowerCase() === partnerAddr.toLowerCase());
  ok(tks.length === assetsBefore + 1 && idx >= 0 && bals[idx] === 10n ** 30n,
    `the contract holds LUV and the other asset, both enumerable (${tks.length} assets)`);
  ok(tks.some((t) => t.toLowerCase() === TOKEN.toLowerCase()), 'LUV is in the registry alongside it');

  // it can pay the second asset through the same redeem rail
  const signerW = new ethers.Wallet(SIGNER_PK);
  const dl = Math.floor(Date.now() / 1000) + 3600;
  const digest = await new ethers.Contract(DIST,
    ['function redeemDigest(address,address,uint256,bytes32,uint256) view returns (bytes32)'], provider)
    .redeemDigest(participant.address, partnerAddr, MILLION, ethers.id('partner:' + RUN), dl);
  const psig = signerW.signingKey.sign(digest).serialized;
  const distW = new ethers.Contract(DIST,
    ['function redeemWithSignature(address,address,uint256,bytes32,uint256,bytes)'], participant);
  await settle(distW.redeemWithSignature(participant.address, partnerAddr, MILLION, ethers.id('partner:' + RUN), dl, psig));
  ok((await partnerC.balanceOf(participant.address)) === MILLION,
    'the participant redeemed 1,000,000 of the OTHER asset through the same rail');

  await settle(dist.removeAsset(partnerAddr, owner.address));
  ok((await dist.isAsset(partnerAddr)) === false, 'the asset was REMOVED from the registry');
  ok((await partnerC.balanceOf(DIST)) === 0n, 'and its remaining balance was swept out of the contract');
  ok((await dist.assets()).length === assetsBefore, 'the registry is back to what it was before');

  // ── 8. COLLECT — bank the flow, and the million starts over from that moment ─
  await upsertIdentity({ provider: 'github', providerUserId: 'e2e-participant', email: null });
  await warp(6 * 3600); // six hours into a fresh window
  let pre = await drip.status(IDK);
  const beforeTally = BigInt(pre.accrued);
  const meter = BigInt(pre.collectable);
  ok(meter > 0n && near(meter, MILLION / 4n), `six hours in, the meter reads ${luv(meter)} LUV`);

  const c = await drip.collect(IDK);
  ok(c.ok === true, 'COLLECT banked the flow');
  ok(BigInt(c.collected) >= meter, `it banked ${luv(c.collected)} LUV — what had dripped`);

  let post = await drip.status(IDK);
  // The tally ALREADY held this window's flow: settlement is continuous, so LUV is banked as
  // it drips rather than at the press. COLLECT reports what the window had contributed and
  // restarts the clock — it never credits the same LUV twice, which is what this asserts.
  ok(near(BigInt(post.accrued), beforeTally),
    `the tally holds ${luv(post.accrued)} LUV — the collected flow was already banked, not added twice`);
  ok(BigInt(post.accrued) >= meter, 'and it contains what the meter had dripped');
  ok(BigInt(post.collectable) < LUV, 'the meter restarted at zero');
  ok(post.full === false && post.flowing === true, 'a fresh million is already dripping');
  ok(post.windowEndsAt - post.windowStartedAt === 86400, 'the 24-hour clock started over on the press');
  ok(post.windowStartedAt >= pre.windowStartedAt + 6 * 3600 - 5, 'the new window begins at the moment of the press');

  // pressing again with nothing dripped is refused rather than wasting a write
  const again = await drip.collect(IDK);
  ok(again.error === 'nothing_to_collect', 'collecting a meter below one LUV is refused, not written');

  // ── 8b. COLLECT is rate-neutral: the clock restarting is not a faster drip ───
  await warp(12 * 3600);
  const half = await drip.collect(IDK);
  await warp(12 * 3600);
  const otherHalf = await drip.collect(IDK);
  const twoHalves = BigInt(half.collected) + BigInt(otherHalf.collected);
  ok(near(twoHalves, MILLION), `two half-day collections total ${luv(twoHalves)} LUV — one day's million, not two`);

  // ── 8c. and the collected balance is what REDEEM delivers ───────────────────
  const post2 = await drip.status(IDK);
  const v2 = await drip.issueVoucher(IDK, { payer: 'self' });
  ok(v2.ok === true && BigInt(v2.amount) >= BigInt(post2.accrued) && near(BigInt(v2.amount), BigInt(post2.accrued)),
    `the voucher carries the whole collected balance: ${luv(v2.amount)} LUV`);
  const bal0 = await token.balanceOf(participant.address);
  const tx2 = await participant.sendTransaction({
    to: v2.to, data: v2.data, maxPriorityFeePerGas: 1_000_000_000n, maxFeePerGas: 5_000_000_000n,
  });
  const rc2 = await tx2.wait();
  const eth0 = await provider.getBalance(participant.address, rc2.blockNumber - 1);
  const eth1 = await provider.getBalance(participant.address, rc2.blockNumber);
  ok((await token.balanceOf(participant.address)) - bal0 === BigInt(v2.amount),
    'the collected balance arrived on-chain');
  ok(eth0 - eth1 === rc2.gasUsed * rc2.gasPrice && eth0 - eth1 > 0n,
    `and the participant paid the gas: ${ethers.formatEther(eth0 - eth1)} ETH`);

  // ── the one-way door: a voucher cannot be replayed ──────────────────────────
  try {
    await participant.sendTransaction({ to: v.to, data: v.data });
    ok(false, 'a spent voucher must not be replayable');
  } catch (e) { ok(true, 'replaying a spent voucher reverts (AlreadyRedeemed)'); }

  console.log(failures ? `\n${failures} check(s) FAILED` : '\nEND TO END: login → a million a day → tally → redeemed, self-paid AND sponsored ❤');
  await db.close();
  process.exit(failures ? 1 : 0);
}

main().catch(async (e) => { console.error('ERROR:', e); try { await db.close(); } catch (_) {} process.exit(1); });
