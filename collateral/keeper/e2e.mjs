#!/usr/bin/env node
// End-to-end check of the keeper and the monitor against a real node (anvil).
//
//   cd .. && forge build && cd keeper && npm ci && node e2e.mjs
//
// Starts anvil (or uses RPC_URL if set), deploys the whole system from ../out with the same
// authority layout as the mainnet script (timelock + guardian + flash), opens positions,
// depegs PAXG, then:
//   1. keeper dry run   → plans exactly one flash liquidation, sends nothing
//   2. keeper --execute → a keeper holding ZERO bXAU flash-liquidates for profit
//   3. monitor          → decodes a scheduled oracle swap as CRIT, then the guardian's shutdown
// Exits non-zero on any failed expectation.
import { spawn } from 'node:child_process';
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
  const port = 18545 + Math.floor(Math.random() * 1000);
  const bin = process.env.ANVIL ?? 'anvil';
  const proc = spawn(bin, ['--port', String(port), '--silent'], { stdio: 'ignore' });
  let spawnError = null;
  proc.on('error', (e) => (spawnError = e));
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
    const [deployer, gov, alice, bob, op] = await Promise.all([0, 1, 2, 3, 4].map((i) => provider.getSigner(i)));
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
    const startBlock = await provider.getBlockNumber();

    // positions: alice 12.5 PAXG → 10 bXAU; bob 100 XAUT → 60 bXAU, seeds a DEX with 50
    const swap = await deploy(deployer, 'GoldMocks.sol', 'MockSwap', bxau.target, 9n * 10n ** 17n); // 0.9 bXAU/PAXG
    const keeperC = await deploy(op, 'FlashKeeper.sol', 'FlashKeeper', vault.target, flash.target, await op.getAddress());
    await send(paxg.mint(await alice.getAddress(), 100n * WAD));
    await send(xaut.mint(await bob.getAddress(), 1000n * 10n ** 6n));
    await send(paxg.connect(alice).approve(vault.target, ethers.MaxUint256));
    await send(xaut.connect(bob).approve(vault.target, ethers.MaxUint256));
    await send(vault.connect(alice).lock(PAXG, 12_500_000_000_000_000_000n));
    await send(vault.connect(alice).draw(PAXG, 10n * WAD));
    await send(vault.connect(bob).lock(XAUT, 100n * 10n ** 6n));
    await send(vault.connect(bob).draw(XAUT, 60n * WAD));
    await send(bxau.connect(bob).transfer(swap.target, 50n * WAD));
    console.log(`  vault ${vault.target}\n  flash keeper ${keeperC.target} (holds ${fmt(await bxau.balanceOf(keeperC.target))} bXAU)`);

    // monitor baseline from the start: system healthy
    const mcfg = { provider, vault: vault.target, timelock: timelock.target, guardian: guardian.target, flash: flash.target };
    const ms = monitorState(startBlock);
    const base = await pollOnce(mcfg, ms);
    console.log('— monitor baseline');
    expect(!base.some((a) => a.severity === 'CRIT'), `healthy: no CRIT alerts (${base.length} alerts)`);

    // depeg: PAXG to 0.90 oz → alice 11.25 oz < 12 oz required
    await send(paxgUsd.set(3600n * 10n ** 8n));
    console.log('— PAXG depegs to 0.90 oz');

    const kcfg = {
      provider, signer: op, vault: vault.target, flashKeeper: keeperC.target, router: swap.target,
      route: await loadRoute('mockswap'), minProfit: '0', bufferBps: 10, log: (m) => console.log(`    ${m}`),
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

    console.log('— governance: schedule an oracle swap, then fire the guardian');
    const data = vault.interface.encodeFunctionData('fileSpotter', [ethers.ZeroAddress]);
    const now = (await provider.getBlock('latest')).timestamp;
    await send(timelock.connect(gov).schedule(vault.target, 0, data, now + 3 * 86400));
    let al = await pollOnce(mcfg, ms);
    al.forEach((a) => console.log(`    ${a.severity} ${a.title} — ${a.detail}`));
    expect(al.some((a) => a.severity === 'CRIT' && a.title.includes('SCHEDULED') && a.detail.includes('vault.fileSpotter(')),
      'scheduled oracle swap decoded and flagged CRIT');
    expect(al.some((a) => a.title === 'liquidation'), 'liquidation reported');

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
