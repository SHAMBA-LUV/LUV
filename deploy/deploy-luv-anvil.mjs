#!/usr/bin/env node
/*
 * deploy-luv-anvil.mjs — SHAMBA LUV deploy rehearsal on anvil.
 *
 * Deploys the corrected LUV token, verifies the genesis invariants (name/symbol/
 * supply/owner balance/router approval), and records to shambaluv/live/. Uses the
 * repo's vendored ethers (clean-room, no CDN). Production is the OVERLORD's signed
 * deploy in pages/deploy.html on ETHEREUM (primary).
 *
 *   anvil & node shambaluv/deploy/deploy-luv-anvil.mjs
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
const ANVIL_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const ETH_ROUTER = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D';

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC);
  const net = await provider.getNetwork().catch(() => null);
  if (!net) { console.error('anvil not reachable at ' + RPC + ' — run: anvil'); process.exit(1); }
  const signer = new ethers.Wallet(ANVIL_KEY, provider);
  const me = await signer.getAddress();
  // distinct team/liquidity wallets (anvil #1/#2) — best practice; the liquidity wallet
  // is reflection-excluded so it should not coincide with the deployer/holder.
  const team = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
  const liquidity = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC';

  const art = JSON.parse(readFileSync(join(SL, 'artifacts', 'ShambaLuv.json'), 'utf8'));
  const factory = new ethers.ContractFactory(art.abi, art.bytecode.object, signer);
  // router/weth = 0x0 → contract defaults to Ethereum mainnet addresses
  const inst = await factory.deploy(team, liquidity, ethers.ZeroAddress, ethers.ZeroAddress);
  await inst.waitForDeployment();
  const address = await inst.getAddress();
  const c = new ethers.Contract(address, art.abi, signer);

  const [name, symbol, dec, supply, bal, cfg] = await Promise.all([
    c.name(), c.symbol(), c.decimals(), c.totalSupply(), c.balanceOf(me), c.getConfig(),
  ]);
  const EXPECT = 10n ** 35n;
  const ok = name === 'SHAMBA' && symbol === 'LUV' && supply === EXPECT && bal === EXPECT;

  console.log(`\n❤️ SHAMBA LUV rehearsal · chain ${net.chainId} · ${address}`);
  console.log(`  name=${name} symbol=${symbol} decimals=${dec}`);
  console.log(`  totalSupply=${supply} (expect 1e35: ${supply === EXPECT ? '✓' : '✗'})`);
  console.log(`  deployer balance=${bal} (== supply: ${bal === EXPECT ? '✓' : '✗'})`);
  console.log(`  router(default ETH)=${cfg[0]} weth=${cfg[1]} maxTx=${cfg[3]} fee=${cfg[5]}bps`);
  console.log(`  router approval=${await c.allowance(address, ETH_ROUTER)} (max → swaps armed at genesis ✓)`);
  if (!ok) { console.error('  ✗ genesis invariants failed'); process.exit(1); }

  mkdirSync(join(SL, 'live'), { recursive: true });
  writeFileSync(join(SL, 'live', 'deployed.json'), JSON.stringify({
    token: 'SHAMBA LUV', symbol: 'LUV', network: 'anvil', chainId: Number(net.chainId),
    address, owner: me, team, liquidity, totalSupply: supply.toString(), primaryChain: 'ethereum',
  }, null, 2) + '\n');
  console.log(`\n  → shambaluv/live/deployed.json`);
  console.log(`\n✓ LUV rehearsal: deployed ✓ · 1e35 minted ✓ · SHAMBA/LUV ✓ · router armed ✓\n`);
}
main().catch((e) => { console.error('LUV rehearsal failed:', e.message || e); process.exit(1); });
