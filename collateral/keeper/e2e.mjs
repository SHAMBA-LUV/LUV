#!/usr/bin/env node
// End-to-end check of the keeper and the monitor against a real node (anvil).
//
//   cd .. && forge build && cd keeper && npm ci && node e2e.mjs
//
// Starts anvil (or uses RPC_URL if set), deploys the whole system from ../out with the same
// authority layout as the mainnet script (timelock + guardian + flash), opens positions,
// depegs PAXG, then:
//   1. keeper dry run   → plans exactly one flash liquidation, sends nothing
//   2. keeper --execute → a keeper holding ZERO bXAU flash-liquidates for profit, selling the
//                         seized PAXG into the real bXAU/PAXG StableSwap pool
//   3. a third-party single-asset LP, locked in the Gold tier, earns a share of that swap's fee
//   4. monitor          → decodes a scheduled oracle swap as CRIT, flags a pool pause, then the
//                         guardian's shutdown
// Exits non-zero on any failed expectation.
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ethers, WAD, ilkId, fmt, sleep } from './lib.mjs';
import { runOnce, createState as keeperState, loadRoute } from './keeper.mjs';
import { pollOnce, createState as monitorState } from './monitor.mjs';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'out');
const art = (file, name) => JSON.parse(readFileSync(join(OUT, file, `${name}.json`), 'utf8'));

let failures = 0;
function expect(cond, msg) {
  console.log(`${cond ? '  ✓' : '  ✗'} ${msg}`);
  if (!cond) failures++;
}

async function startAnvil() {
  if (process.env.RPC_URL) return { url: process.env.RPC_URL, stop: () => {} };
  // ask the OS for a free port, so we never talk to some other node already on it
  const port = await new Promise((res, rej) => {
    const srv = createServer();
    srv.once('error', rej);
    srv.listen(0, '127.0.0.1', () => {
      const p = srv.address().port;
      srv.close(() => res(p));
    });
  });
  const bin = process.env.ANVIL ?? 'anvil';
  const proc = spawn(bin, ['--port', String(port), '--silent'], { stdio: 'ignore' });
  let spawnError = null;
  proc.on('error', (e) => (spawnError = e));
  proc.on('exit', (code) => (spawnError ??= new Error(`exited early with code ${code}`)));
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 50; i++) {
    if (spawnError) throw new Error(`cannot start ${bin}: ${spawnError.message} — install Foundry or set ANVIL / RPC_URL`);
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}',
      });
      if (!r.ok) throw new Error();
      return { url, stop: () => proc.kill() };
    } catch {
      await sleep(200);
    }
  }
  proc.kill();
  throw new Error(`anvil did not start (${bin})`);
}

async function deploy(signer, file, name, ...args) {
  const a = art(file, name);
  const c = await new ethers.ContractFactory(a.abi, a.bytecode.object, signer).deploy(...args);
  await c.waitForDeployment();
  return c;
}

async function send(p) {
  return (await p).wait();
}

async function main() {
  const node = await startAnvil();
  const provider = new ethers.JsonRpcProvider(node.url, undefined, { pollingInterval: 100 });
  try {
    const [deployer, gov, alice, bob, op, carol] = await Promise.all([0, 1, 2, 3, 4, 5].map((i) => provider.getSigner(i)));
    const PAXG = ilkId('PAXG-A');
    const XAUT = ilkId('XAUT-A');
    console.log(`node ${node.url}\n— deploying`);

    // pegs + feeds
    const paxg = await deploy(deployer, 'GoldMocks.sol', 'MockGem', 'PAX Gold', 'PAXG', 18, 2, false);
    const xaut = await deploy(deployer, 'GoldMocks.sol', 'MockGem', 'Tether Gold', 'XAUt', 6, 0, true);
    const xauUsd = await deploy(deployer, 'GoldMocks.sol', 'MockFeed', 8, 4000n * 10n ** 8n);
    const paxgUsd = await deploy(deployer, 'GoldMocks.sol', 'MockFeed', 8, 4000n * 10n ** 8n);

    // system (mirrors script/DeployGoldVault.s.sol)
    const spotter = await deploy(deployer, 'PegSpotter.sol', 'PegSpotter', xauUsd.target, 3600);
    await send(spotter.fileSrc(PAXG, paxgUsd.target, 3600, WAD));
    await send(spotter.fileSrc(XAUT, ethers.ZeroAddress, 0, WAD));
    const bxau = await deploy(deployer, 'BasketGold.sol', 'BasketGold');
    const vault = await deploy(deployer, 'GoldVault.sol', 'GoldVault', bxau.target, spotter.target);
    await send(bxau.rely(vault.target));
    await send(vault.init(PAXG, paxg.target));
    await send(vault.init(XAUT, xaut.target));
    for (const [ilk, mat, line] of [[PAXG, 120n, 1000n], [XAUT, 150n, 100n]]) {
      await send(vault.file(ilk, ilkId('chop'), 105n * 10n ** 16n));
      await send(vault.file(ilk, ilkId('mat'), mat * 10n ** 25n));
      await send(vault.file(ilk, ilkId('line'), line * WAD));
      await send(vault.file(ilk, ilkId('dust'), WAD));
    }
    await send(vault.fileLine(1100n * WAD));
    const timelock = await deploy(deployer, 'GoldTimelock.sol', 'GoldTimelock', await gov.getAddress(), 2 * 86400);
    const guardian = await deploy(deployer, 'GoldGuardian.sol', 'GoldGuardian', vault.target, await gov.getAddress());
    const flash = await deploy(deployer, 'GoldFlash.sol', 'GoldFlash', bxau.target, vault.target, await deployer.getAddress());
    await send(flash.setMax(500n * WAD));
    await send(bxau.rely(flash.target));
    await send(vault.rely(timelock.target));
    await send(vault.rely(guardian.target));
    await send(spotter.transferOwnership(timelock.target));
    await send(flash.transferOwnership(timelock.target));
    await send(vault.deny(await deployer.getAddress()));
    await send(bxau.deny(await deployer.getAddress()));

    // bXAU/PAXG StableSwap pool + tiered locker (mirrors script/DeployGoldPools.s.sol)
    const pool = await deploy(deployer, 'GoldStablePool.sol', 'GoldStablePool', bxau.target, paxg.target, 200,
      4_000_000, 5_000_000_000, await deployer.getAddress(), 'bXAU/PAXG StableSwap', 'bXAU-PAXG');
    const locker = await deploy(deployer, 'GoldLiquidityLocker.sol', 'GoldLiquidityLocker', pool.target);
    await send(pool.setFeeReceiver(locker.target));
    await send(pool.setPauser(await gov.getAddress()));
    await send(pool.transferOwnership(timelock.target));

    // positions: alice 12.5 PAXG → 10 bXAU; bob 100 XAUT → 60 bXAU and seeds the pool 50/50
    const keeperC = await deploy(op, 'FlashKeeper.sol', 'FlashKeeper', vault.target, flash.target, await op.getAddress());
    await send(paxg.mint(await alice.getAddress(), 100n * WAD));
    await send(paxg.mint(await bob.getAddress(), 100n * WAD));
    await send(paxg.mint(await carol.getAddress(), 100n * WAD));
    await send(xaut.mint(await bob.getAddress(), 1000n * 10n ** 6n));
    await send(paxg.connect(alice).approve(vault.target, ethers.MaxUint256));
    await send(xaut.connect(bob).approve(vault.target, ethers.MaxUint256));
    await send(vault.connect(alice).lock(PAXG, 12_500_000_000_000_000_000n));
    await send(vault.connect(alice).draw(PAXG, 10n * WAD));
    await send(vault.connect(bob).lock(XAUT, 100n * 10n ** 6n));
    await send(vault.connect(bob).draw(XAUT, 60n * WAD));
    await send(bxau.connect(bob).approve(pool.target, ethers.MaxUint256));
    await send(paxg.connect(bob).approve(pool.target, ethers.MaxUint256));
    await send(pool.connect(bob).addLiquidity([50n * WAD, 50n * WAD], 0));
    // carol: third-party, SINGLE-ASSET liquidity (PAXG only), locked in the GOLD tier (365 d, 3×)
    await send(paxg.connect(carol).approve(locker.target, ethers.MaxUint256));
    await send(locker.connect(carol).provideSingle(1, 20n * WAD, 0, 2));
    const carolId = (await locker.positionsOf(await carol.getAddress()))[0];
    console.log(`  vault ${vault.target}\n  flash keeper ${keeperC.target} (holds ${fmt(await bxau.balanceOf(keeperC.target))} bXAU)`);

    // monitor baseline, scanning from just after deployment (operators set FROM_BLOCK the same way)
    const startBlock = (await provider.getBlockNumber()) + 1;
    const mcfg = {
      provider, vault: vault.target, timelock: timelock.target, guardian: guardian.target, flash: flash.target,
      pools: [pool.target],
    };
    const ms = monitorState(startBlock);
    const base = await pollOnce(mcfg, ms);
    console.log('— monitor baseline');
    base.forEach((a) => console.log(`    ${a.severity} ${a.title} — ${a.detail}`));
    expect(!base.some((a) => a.severity !== 'INFO'), `healthy: no WARN/CRIT alerts (${base.length} alerts)`);

    // depeg: PAXG to 0.90 oz → alice 11.25 oz < 12 oz required
    await send(paxgUsd.set(3600n * 10n ** 8n));
    console.log('— PAXG depegs to 0.90 oz');

    const kcfg = {
      provider, signer: op, vault: vault.target, flashKeeper: keeperC.target, router: pool.target,
      route: await loadRoute('stablepool'), minProfit: '0', bufferBps: 10, log: (m) => console.log(`    ${m}`),
    };
    const ks = keeperState(0);

    console.log('— keeper dry run');
    const dry = await runOnce({ ...kcfg, execute: false }, ks);
    expect(dry.length === 1 && dry[0].mode === 'flash' && dry[0].status === 'planned', 'plans one flash liquidation');
    expect((await vault.urns(PAXG, await alice.getAddress())).art > 0n, 'dry run sends nothing');
    expect(ks.urns.size === 2, 'discovered both urns from Lock events');

    console.log('— keeper --execute');
    const supply0 = await bxau.totalSupply();
    const run = await runOnce({ ...kcfg, execute: true }, ks);
    expect(run.length === 1 && run[0].status === 'sent', 'sent the flash liquidation');
    expect((await vault.urns(PAXG, await alice.getAddress())).art === 0n, "alice's debt is cleared");
    const profit = await paxg.balanceOf(keeperC.target);
    expect(profit > 5n * 10n ** 17n, `keeper kept ${fmt(profit)} PAXG profit with zero starting capital`);
    expect(supply0 - (await bxau.totalSupply()) >= 10n * WAD, 'bXAU supply fell by the debt repaid');
    expect((await runOnce({ ...kcfg, execute: true }, ks)).length === 0, 'next pass finds nothing unsafe');

    console.log('— liquidity: the keeper sold through the pool; third-party LPs earned the fee');
    const [r0, r1] = await locker.pending(carolId);
    expect(r0 + r1 > 0n, `carol's Gold-tier position earned ${fmt(r0)} bXAU + ${fmt(r1)} PAXG of staker fees`);
    expect((await pool.getVirtualPrice()) > WAD, `LP virtual price rose to ${fmt(await pool.getVirtualPrice())}`);

    console.log('— governance: schedule an oracle swap, then fire the guardian');
    const data = vault.interface.encodeFunctionData('fileSpotter', [ethers.ZeroAddress]);
    const now = (await provider.getBlock('latest')).timestamp;
    await send(timelock.connect(gov).schedule(vault.target, 0, data, now + 3 * 86400));
    let al = await pollOnce(mcfg, ms);
    al.forEach((a) => console.log(`    ${a.severity} ${a.title} — ${a.detail}`));
    expect(al.some((a) => a.severity === 'CRIT' && a.title.includes('SCHEDULED') && a.detail.includes('vault.fileSpotter(')),
      'scheduled oracle swap decoded and flagged CRIT');
    expect(al.some((a) => a.title === 'liquidation'), 'liquidation reported');

    await send(pool.connect(gov).setPaused(true));
    al = await pollOnce(mcfg, ms);
    al.forEach((a) => console.log(`    ${a.severity} ${a.title} — ${a.detail}`));
    expect(al.some((a) => a.severity === 'CRIT' && a.title.includes('PAUSED')), 'pool pause flagged CRIT');

    await send(guardian.connect(gov).fire());
    al = await pollOnce(mcfg, ms);
    al.forEach((a) => console.log(`    ${a.severity} ${a.title} — ${a.detail}`));
    expect(al.some((a) => a.severity === 'CRIT' && a.title.includes('EMERGENCY SHUTDOWN')), 'guardian shutdown flagged CRIT');
    expect(al.some((a) => a.title === 'vault is not live'), 'health check reports caged vault');
    expect((await pollOnce(mcfg, ms)).length === 0, 'health alerts are deduplicated on the next pass');
  } finally {
    provider.destroy();
    node.stop();
  }
  console.log(failures ? `\n${failures} FAILED` : '\nall e2e checks passed');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
