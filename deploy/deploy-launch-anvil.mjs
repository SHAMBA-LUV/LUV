#!/usr/bin/env node
/*
 * deploy-launch-anvil.mjs — the SHAMBA LUV ETH-LAUNCH distribution, rehearsed on anvil.
 *
 * Token (111.11-quad supply) → split:
 *   • 100 quadrillion → LIQUIDITY wallet (reflection-EXCLUDED + fee/maxTx-exempt) — seeds the pool
 *   • remainder (11.11 quad) ÷ 4:
 *       founders     — liquid
 *       development  — liquid
 *       marketing    — LOCKED in LUVLocker (principal locked, interest-only redemption)
 *       community    — LOCKED in LUVLocker
 *   Lock duration is a deploy variable, first setting 90 days (immutable per LUVLocker deploy).
 *
 * Proves: supply conservation, the liquidity reflection exemption, both locks (principal held,
 * withdraw reverts before 90d), and interest-only redemption (harvest pays reflections while
 * principal stays locked; withdraw succeeds only after the 90-day time warp).
 *
 *   anvil & node shambaluv/deploy/deploy-launch-anvil.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const SL = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = resolve(SL, '..');
const require = createRequire(import.meta.url);
const ethers = require(join(ROOT, 'vendor', 'ethers.umd.min.js'));

const RPC = process.env.RPC || 'http://127.0.0.1:8545';
const LOCK_DURATION = Number(process.env.LOCK_DURATION || 90 * 24 * 60 * 60);   // 90 days
const MIN_BLOCK_DELTA = Number(process.env.MIN_BLOCK_DELTA || 1);
const LIQ_WHOLE = 100_000_000_000_000_000n;   // 100 quadrillion whole LUV → liquidity

// anvil dev accounts (LOCAL ONLY — public keys)
const KEYS = {
  overlord:    '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', // acct0
  liquidity:   '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d', // acct1
  founders:    '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a', // acct2 (= teamWallet)
  marketing:   '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6', // acct3
  development: '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a', // acct4
  community:   '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba', // acct5
};

function art(name) { return JSON.parse(readFileSync(join(SL, 'artifacts', name + '.json'), 'utf8')); }
const fmt = (x) => (x / 10n ** 18n).toString();   // whole tokens

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC);
  const net = await provider.getNetwork().catch(() => null);
  if (!net) { console.error('anvil not reachable at ' + RPC + ' — run: anvil'); process.exit(1); }
  const w = {}, N = {}, A = {};
  for (const [k, pk] of Object.entries(KEYS)) {
    w[k] = new ethers.Wallet(pk, provider);
    A[k] = w[k].address;
    N[k] = await provider.getTransactionCount(A[k]);   // explicit nonce counter per wallet (instamine-safe)
  }
  const ov = (role) => ({ nonce: N[role]++ });         // next nonce for `role`, then increment

  console.log(`\n❤️ SHAMBA LUV — ETH-launch distribution (rehearsal) · anvil ${net.chainId}`);
  console.log(`   lock duration = ${LOCK_DURATION}s (${LOCK_DURATION / 86400} days)\n`);

  // ── 1) deploy token: teamWallet = founders, liquidityWallet = LIQUIDITY (reflection-excluded) ──
  const luvArt = art('ShambaLuv');
  const luvC = await (await new ethers.ContractFactory(luvArt.abi, luvArt.bytecode.object, w.overlord)
    .deploy(A.founders, A.liquidity, ethers.ZeroAddress, ethers.ZeroAddress, ov('overlord'))).waitForDeployment();
  const luvAddr = await luvC.getAddress();
  const luv = new ethers.Contract(luvAddr, luvArt.abi, w.overlord);
  const supply = await luv.totalSupply();
  console.log(`  ✓ ShambaLuv ${luvAddr}  supply=${fmt(supply)} whole (${supply})`);

  // ── 2) deploy LUVLocker(90 days) ──
  const lockArt = art('LUVLocker');
  const lockC = await (await new ethers.ContractFactory(lockArt.abi, lockArt.bytecode.object, w.overlord)
    .deploy(luvAddr, LOCK_DURATION, MIN_BLOCK_DELTA, ov('overlord'))).waitForDeployment();
  const lockAddr = await lockC.getAddress();
  const lockRead = new ethers.Contract(lockAddr, lockArt.abi, provider);
  console.log(`  ✓ LUVLocker ${lockAddr}  lockDuration=${await lockRead.lockDuration()}s\n`);

  // ── 3) wiring: locker fee+maxTx exempt (reflection-INCLUDED); liquidity maxTx exempt (already fee-exempt + reflection-excluded) ──
  await (await luv.setFeeExemption(lockAddr, true, ov('overlord'))).wait();
  await (await luv.setMaxTxExemption(lockAddr, true, ov('overlord'))).wait();
  await (await luv.setMaxTxExemption(A.liquidity, true, ov('overlord'))).wait();
  const lockReflIncluded = !(await luv.isExcludedFromReflection(lockAddr));
  const liqReflExcluded = await luv.isExcludedFromReflection(A.liquidity);
  const liqFeeExempt = await luv.isExcludedFromFee(A.liquidity);
  console.log(`  ✓ locker    fee=${await luv.isExcludedFromFee(lockAddr)} maxTx=${await luv.isExcludedFromMaxTx(lockAddr)} reflection-included=${lockReflIncluded}`);
  console.log(`  ✓ liquidity fee=${liqFeeExempt} maxTx=${await luv.isExcludedFromMaxTx(A.liquidity)} reflection-EXCLUDED=${liqReflExcluded}\n`);

  // ── 4) split ──
  const liq = LIQ_WHOLE * 10n ** 18n;              // 100 quad base
  const remainder = supply - liq;                  // 11.11 quad
  const quarter = remainder / 4n;
  const dust = remainder - quarter * 4n;
  // The indivisible dust goes to the COMMUNITY — sharing is caring, down to the last wei.
  const alloc = { founders: quarter, development: quarter, marketing: quarter, community: quarter + dust };
  console.log(`  split: liquidity=${fmt(liq)} | founders=${fmt(alloc.founders)} development=${fmt(alloc.development)} marketing=${fmt(alloc.marketing)} community=${fmt(alloc.community)} (whole LUV)`);

  await (await luv.transfer(A.liquidity, liq, ov('overlord'))).wait();
  for (const role of ['founders', 'development', 'marketing', 'community'])
    await (await luv.transfer(A[role], alloc[role], ov('overlord'))).wait();

  // conservation
  const bal = {};
  for (const k of Object.keys(KEYS)) bal[k] = await luv.balanceOf(A[k]);
  const sum = Object.values(bal).reduce((a, b) => a + b, 0n);
  console.log(`  ✓ conservation: Σ balances = ${sum === supply ? 'totalSupply ✓' : '✗ ' + sum} · overlord left ${fmt(bal.overlord)}\n`);

  // ── 5) LOCK marketing + community (each deposits its own principal) ──
  const lockFor = async (role) => {
    const luvAsRole = new ethers.Contract(luvAddr, luvArt.abi, w[role]);
    const lockAsRole = new ethers.Contract(lockAddr, lockArt.abi, w[role]);
    await (await luvAsRole.approve(lockAddr, alloc[role], ov(role))).wait();
    await (await lockAsRole.deposit(alloc[role], ov(role))).wait();
    const u = await lockRead.users(A[role]);
    const locked = await lockRead.isLocked(A[role]);
    console.log(`  ✓ ${role.padEnd(11)} locked principal=${fmt(u.principal)} isLocked=${locked}`);
    return { principal: u.principal, locked };
  };
  const mk = await lockFor('marketing');
  const cm = await lockFor('community');

  // withdraw must revert before the 90-day lock elapses (reverts at estimateGas → no nonce consumed)
  let earlyBlocked = false;
  try { await (await new ethers.Contract(lockAddr, lockArt.abi, w.marketing).withdraw(1n, ov('marketing'))).wait(); }
  catch { earlyBlocked = true; N.marketing--; }   // roll back the reserved nonce (tx never sent)
  console.log(`  ${earlyBlocked ? '✓' : '✗'} early withdraw blocked (principal locked ${LOCK_DURATION / 86400}d)`);

  // EXTENDABLE: owner pushes the community lock 90 days further out; a shorten attempt reverts
  const unlockBefore = (await lockRead.users(A.community)).unlockAt;
  const newUnlock = unlockBefore + BigInt(LOCK_DURATION);
  await (await new ethers.Contract(lockAddr, lockArt.abi, w.overlord).extendLock(A.community, newUnlock, ov('overlord'))).wait();
  const unlockAfter = (await lockRead.users(A.community)).unlockAt;
  let shortenBlocked = false;
  try { await (await new ethers.Contract(lockAddr, lockArt.abi, w.overlord).extendLock(A.community, unlockBefore, ov('overlord'))).wait(); }
  catch { shortenBlocked = true; N.overlord--; }
  const extendedOk = unlockAfter === newUnlock && shortenBlocked;
  console.log(`  ${extendedOk ? '✓' : '✗'} lock extendable: community unlock ${unlockBefore} → ${unlockAfter} (+90d), shorten reverts\n`);

  // ── 6) INTEREST-ONLY redemption: simulate reflections landing on the locker, harvest, principal stays ──
  // (the whole supply is distributed — overlord holds 0 — so inject the mock reflections from a liquid
  //  wallet; to=locker is fee-exempt so the amount arrives whole, exactly as real reflections would.)
  const interest = 1_000_000_000_000n * 10n ** 18n;   // 1T LUV "reflections"
  await (await new ethers.Contract(luvAddr, luvArt.abi, w.founders).transfer(lockAddr, interest, ov('founders'))).wait();
  const pendMk = await lockRead.pendingRewards(A.marketing);
  console.log(`  injected ${fmt(interest)} LUV interest → pendingRewards(marketing)=${fmt(pendMk)} (≈ half, equal principals)`);

  const mkBefore = await luv.balanceOf(A.marketing);
  await (await new ethers.Contract(lockAddr, lockArt.abi, w.marketing).harvest(ov('marketing'))).wait();
  const mkAfter = await luv.balanceOf(A.marketing);
  const principalAfterHarvest = (await lockRead.users(A.marketing)).principal;
  console.log(`  ✓ marketing harvested interest: +${fmt(mkAfter - mkBefore)} LUV · principal still ${fmt(principalAfterHarvest)} (locked)`);
  const principalIntact = principalAfterHarvest === mk.principal;
  const stillLockedAfterHarvest = await lockRead.isLocked(A.marketing);
  console.log(`  ${principalIntact && stillLockedAfterHarvest ? '✓' : '✗'} interest-only: principal untouched by harvest, still locked\n`);

  // ── 7) after 90 days the principal unlocks ──
  await provider.send('evm_increaseTime', [LOCK_DURATION + 1]);
  await provider.send('evm_mine', []);
  await (await new ethers.Contract(lockAddr, lockArt.abi, w.marketing).withdraw(mk.principal, ov('marketing'))).wait();
  const principalReturned = (await lockRead.users(A.marketing)).principal === 0n;
  console.log(`  ✓ after ${LOCK_DURATION / 86400}d: marketing withdrew principal (remaining principal ${principalReturned ? '0 ✓' : '✗'})\n`);

  const ok = sum === supply && liqReflExcluded && liqFeeExempt && lockReflIncluded && mk.locked && cm.locked
    && earlyBlocked && extendedOk && principalIntact && stillLockedAfterHarvest && principalReturned;
  mkdirSync(join(SL, 'live'), { recursive: true });
  writeFileSync(join(SL, 'live', 'launch-distribution.json'), JSON.stringify({
    network: 'anvil', chainId: Number(net.chainId), ShambaLuv: luvAddr, LUVLocker: lockAddr,
    lockDurationSeconds: LOCK_DURATION, wallets: A,
    allocation: { liquidity: liq.toString(), founders: alloc.founders.toString(), development: alloc.development.toString(), marketing: alloc.marketing.toString(), community: alloc.community.toString() },
    locked: ['marketing', 'community'], liquid: ['founders', 'development'],
    liquidityReflectionExcluded: liqReflExcluded, lockerReflectionIncluded: lockReflIncluded,
  }, null, 2) + '\n');
  console.log(`  → shambaluv/live/launch-distribution.json`);
  console.log(`\n${ok ? '✓' : '✗'} launch distribution proven — 100q liquidity (reflection-exempt) + 4-way split, marketing & community locked 90d, interest-only redemption.\n`);
  process.exit(ok ? 0 : 1);
}
main().catch((e) => { console.error('launch rehearsal failed:', e.message || e); process.exit(1); });
