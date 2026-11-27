// run-tests.mjs — a tiny forge-compatible test runner on a real EVM (ethereumjs), so the
// Solidity in foundry/ is compiled AND executed without installing Foundry.
//
//   1. compiles foundry/src + foundry/test with solc 0.8.24 (same settings as foundry.toml)
//   2. for every contract with test_* functions: fresh EVM → deploy → setUp() → test_*()
//      (exactly forge's model: each test starts from the post-setUp state)
//   3. JS ↔ Solidity interop: proves a key with js/08-schnorr-bn254.mjs and registers it in
//      the deployed KeyRegistry from an EOA — the off-chain prover must match the contract
//
// Run (from docs/zk):  npm install && npm run test:evm
//   --gas-md <file>   also write the measured gas table as Markdown (npm run gas → GAS.md)
// The BN254 precompiles 0x06/0x07/0x08 are implemented by @ethereumjs/evm, so real Groth16
// proofs are verified exactly as on mainnet.

import { writeFileSync } from 'node:fs';
import { compile, freshVM, deploy, call, encodeCall, address, common } from './lib.mjs';
import { prove } from '../js/08-schnorr-bn254.mjs';

const gasMdPath = process.argv.includes('--gas-md') ? process.argv[process.argv.indexOf('--gas-md') + 1] : null;

// ── 1. compile ──────────────────────────────────────────────────────────────
const { contracts, get, decodeRevert, fileCount, solcVersion } = compile();
console.log(`compiled ${fileCount} files with solc ${solcVersion}\n`);

// ── 2. run tests ────────────────────────────────────────────────────────────
let passed = 0, failed = 0;
const gasReport = [];
const suites = [];
for (const [file, cs] of Object.entries(contracts)) {
  for (const [name, c] of Object.entries(cs)) {
    const ids = c.evm.methodIdentifiers ?? {};
    const tests = Object.keys(ids).filter((s) => s.startsWith('test'));
    if (!tests.length) continue;
    console.log(`${file}:${name}`);
    let ok = 0;
    for (const t of tests.sort()) {
      const vm = await freshVM();
      const addr = await deploy(vm, c.evm.bytecode.object);
      if (ids['setUp()']) {
        const s = await call(vm, addr, '0x' + ids['setUp()']);
        if (!s.ok) { console.log(`  ✗ ${t}  (setUp reverted: ${decodeRevert(s.ret)})`); failed++; continue; }
      }
      const r = await call(vm, addr, '0x' + ids[t]);
      if (r.ok) {
        passed++; ok++;
        console.log(`  ✓ ${t.replace('()', '')}  (gas: ${r.gas})`);
        for (const l of r.logs) { console.log(`      ${l.key}: ${l.val}`); gasReport.push(l); }
      }
      else { failed++; console.log(`  ✗ ${t.replace('()', '')}  → ${decodeRevert(r.ret)}`); }
    }
    suites.push({ name, ok, total: tests.length });
  }
}

// ── 3. JS prover ↔ Solidity verifier interop (KeyRegistry) ──────────────────
console.log('\ninterop: js/08-schnorr-bn254.mjs → KeyRegistry.register from an EOA');
{
  const reg = get('src/KeyRegistry.sol', 'KeyRegistry');
  const vm = await freshVM();
  const registry = await deploy(vm, reg.evm.bytecode.object);
  const alice = '0x' + 'a1'.repeat(20);
  const ctx = { chainId: common.chainId(), registry: registry.toString(), account: alice };
  const { X, R, s } = prove(ctx, 0xa11ce5ec12e7n);
  const data = encodeCall(reg, 'register((uint256,uint256),(uint256,uint256),uint256)', [X.x, X.y, R.x, R.y, s]);
  // a front-runner submits Alice's proof first: the challenge hashes msg.sender, so it fails
  const r1 = await call(vm, registry, data, address('0x' + 'bb'.repeat(20)));
  check(!r1.ok && decodeRevert(r1.ret).startsWith('InvalidProof'), 'front-runner replaying the proof from another EOA: InvalidProof', r1);
  const r2 = await call(vm, registry, data, address(alice));
  check(r2.ok, `JS proof accepted on-chain from Alice (register gas: ${r2.gas})`, r2);
  if (r2.ok) gasReport.push({ key: 'gas: KeyRegistry.register from an EOA (Schnorr on precompiles, no setup)', val: r2.gas });
}
function check(cond, label, r) {
  if (cond) { passed++; console.log(`  ✓ ${label}`); } else { failed++; console.log(`  ✗ ${label} → ${decodeRevert(r.ret)}`); }
}

gasReport.sort((a, b) => a.key.localeCompare(b.key));
if (gasReport.length) console.log('\ngas report (measured with gasleft() around the call):\n  ' + gasReport.map((l) => `${l.key}: ${l.val}`).join('\n  '));
console.log(`\n${passed} passed, ${failed} failed`);

if (gasMdPath && !failed) {
  const n = (v) => v.toLocaleString('en-US');
  writeFileSync(gasMdPath, `# GAS: measured costs

> **Generated** by \`npm run gas\` (\`evm/run-tests.mjs --gas-md\`). Do not edit by hand.
> solc ${solcVersion.split('+')[0]}, optimizer 200 runs, on @ethereumjs/vm (Mainnet rules, BN254 precompiles
> priced per EIP-1108). Each figure is \`gasleft()\` before minus after the call inside a test,
> so it includes the call overhead but not the transaction's 21,000 base gas or calldata gas.

| operation | gas |
|---|---:|
${gasReport.map((l) => `| ${l.key.replace(/^gas: /, '')} | ${n(l.val)} |`).join('\n')}

## Test suites

| suite | tests passed |
|---|---:|
${suites.map((s) => `| \`${s.name}\` | ${s.ok} / ${s.total} |`).join('\n')}
| JS ↔ Solidity interop | 2 / 2 |
| **total** | **${passed}** |
`);
  console.log(`wrote ${gasMdPath}`);
}
process.exit(failed ? 1 : 0);
