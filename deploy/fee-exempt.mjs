#!/usr/bin/env node
/*
 * fee-exempt.mjs — fee-exempt the airdrop contract and any bridge endpoint(s).
 *
 * The LUV 5% reward is taken only when a non-exempt CONTRACT is the counterparty (buy/sell).
 * Infrastructure contracts that must move LUV fee-free — the airdrop, and every bridge endpoint
 * — are added to `isExcludedFromFee` EXACTLY like the liquidity wallet, so their transfers incur
 * no fee. Run this once per such contract after deploying (owner key signs).
 *
 *   RPC=<rpc> PRIVATE_KEY=<owner> node deploy/fee-exempt.mjs <LUV_ADDRESS> <addr1> [addr2 ...]
 *
 * Works on any chain (anvil / Ethereum / Polygon). Verifies each exemption took effect.
 */
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const SL = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = resolve(SL, '..');
const require = createRequire(import.meta.url);
const ethers = require(join(ROOT, 'vendor', 'ethers.umd.min.js'));

const RPC = process.env.RPC || 'http://127.0.0.1:8545';
const KEY = process.env.PRIVATE_KEY || '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'; // anvil[0]
const [luvAddr, ...targets] = process.argv.slice(2);

const ABI = [
  'function setFeeExemption(address account, bool status) external',
  'function isExcludedFromFee(address) view returns (bool)',
  'function owner() view returns (address)',
];

async function main() {
  if (!luvAddr || targets.length === 0) {
    console.error('usage: RPC=.. PRIVATE_KEY=.. node deploy/fee-exempt.mjs <LUV_ADDRESS> <addr1> [addr2 ...]');
    process.exit(1);
  }
  const provider = new ethers.JsonRpcProvider(RPC);
  const base = new ethers.Wallet(KEY, provider);
  const signer = ethers.NonceManager ? new ethers.NonceManager(base) : base;
  const luv = new ethers.Contract(luvAddr, ABI, signer);

  const owner = await luv.owner();
  console.log(`\n❤️ fee-exempt on LUV ${luvAddr} · owner ${owner}\n`);

  let ok = 0;
  for (const t of targets) {
    if (!ethers.isAddress(t)) { console.log(`  ✗ ${t} — not an address`); continue; }
    if (await luv.isExcludedFromFee(t)) { console.log(`  · ${t} already fee-exempt`); ok++; continue; }
    await (await luv.setFeeExemption(t, true)).wait();
    const now = await luv.isExcludedFromFee(t);
    console.log(`  ${now ? '✓' : '✗'} ${t} ${now ? 'fee-exempt' : 'FAILED'}`);
    if (now) ok++;
  }
  console.log(`\n${ok}/${targets.length} addresses fee-exempt — they move LUV with 0 fee, like liquidity.\n`);
  process.exit(ok === targets.length ? 0 : 1);
}
main().catch((e) => { console.error('fee-exempt failed:', e.message || e); process.exit(1); });
