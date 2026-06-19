#!/usr/bin/env node
/*
 * deploy-full-anvil.mjs — the production deploy sequence, rehearsed on anvil.
 *
 * Deploys LUV + ShambaLuvAirdrop, then FEE-EXEMPTS the airdrop contract and any bridge
 * endpoint(s) — exactly like the liquidity wallet — so those flows move LUV with 0 fee. The
 * gesture itself is wallet-to-wallet (already 0 fee); the exemptions cover the optional on-chain
 * airdrop pull and cross-chain bridging. Records the deployment + exemptions to live/.
 *
 *   anvil & node deploy/deploy-full-anvil.mjs
 *   # add real bridge endpoints:  BRIDGES=0xabc...,0xdef... node deploy/deploy-full-anvil.mjs
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
const ANVIL = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const TEAM = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const LIQ = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC';
const SIGNER = '0x90F79bf6EB2c4f870365E785982E1f101E93b906';
// bridge endpoints to fee-exempt (real ones via BRIDGES env). A demo placeholder for the rehearsal:
const BRIDGES = (process.env.BRIDGES || '0x000000000000000000000000000000000000b71d').split(',').map((s) => s.trim()).filter(Boolean);

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC);
  const net = await provider.getNetwork().catch(() => null);
  if (!net) { console.error('anvil not reachable at ' + RPC + ' — run: anvil'); process.exit(1); }
  const base = new ethers.Wallet(ANVIL, provider);
  const signer = ethers.NonceManager ? new ethers.NonceManager(base) : base;

  const luvArt = JSON.parse(readFileSync(join(SL, 'artifacts', 'ShambaLuv.json'), 'utf8'));
  const dropArt = JSON.parse(readFileSync(join(SL, 'artifacts', 'ShambaLuvAirdrop.json'), 'utf8'));

  console.log(`\n❤️ SHAMBA LUV — full production deploy (rehearsal) · anvil ${net.chainId}\n`);

  // 1) deploy LUV
  const luv = await (await new ethers.ContractFactory(luvArt.abi, luvArt.bytecode.object, signer)
    .deploy(TEAM, LIQ, ethers.ZeroAddress, ethers.ZeroAddress)).waitForDeployment();
  const luvAddr = await luv.getAddress();
  // 2) deploy airdrop
  const drop = await (await new ethers.ContractFactory(dropArt.abi, dropArt.bytecode.object, signer)
    .deploy(luvAddr, SIGNER)).waitForDeployment();
  const dropAddr = await drop.getAddress();
  console.log(`  ✓ LUV     ${luvAddr}`);
  console.log(`  ✓ Airdrop ${dropAddr}\n`);

  // 3) FEE-EXEMPT the airdrop + every bridge endpoint (like liquidity)
  const exempt = [dropAddr, ...BRIDGES];
  const luvW = new ethers.Contract(luvAddr, luvArt.abi, signer);
  const results = [];
  for (const a of exempt) {
    if (!ethers.isAddress(a)) { console.log(`  · skip invalid address ${a} (check the checksum)`); continue; }
    await (await luvW.setFeeExemption(a, true)).wait();
    const ok = await luvW.isExcludedFromFee(a);
    const label = a === dropAddr ? 'airdrop' : 'bridge';
    console.log(`  ${ok ? '✓' : '✗'} fee-exempt ${label.padEnd(7)} ${a}`);
    results.push({ address: a, role: label, exempt: ok });
  }
  // sanity: liquidity wallet was exempted in the constructor
  const liqExempt = await luvW.isExcludedFromFee(LIQ);
  console.log(`  ${liqExempt ? '✓' : '✗'} fee-exempt liquidity ${LIQ} (constructor)\n`);

  const allOk = results.every((r) => r.exempt) && liqExempt;
  mkdirSync(join(SL, 'live'), { recursive: true });
  writeFileSync(join(SL, 'live', 'deployed-full.json'), JSON.stringify({
    network: 'anvil', chainId: Number(net.chainId), luv: luvAddr, airdrop: dropAddr,
    signer: SIGNER, team: TEAM, liquidity: LIQ, feeExempt: results.concat([{ address: LIQ, role: 'liquidity', exempt: liqExempt }]),
  }, null, 2) + '\n');
  console.log(`  → live/deployed-full.json`);
  console.log(`\n${allOk ? '✓' : '✗'} deploy + fee-exemptions complete — airdrop & bridges move LUV at 0 fee.\n`);
  process.exit(allOk ? 0 : 1);
}
main().catch((e) => { console.error('full deploy failed:', e.message || e); process.exit(1); });
