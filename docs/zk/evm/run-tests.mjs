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
// The BN254 precompiles 0x06/0x07/0x08 are implemented by @ethereumjs/evm, so real Groth16
// proofs are verified exactly as on mainnet.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import solc from 'solc';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { createVM } from '@ethereumjs/vm';
import { Common, Mainnet } from '@ethereumjs/common';
import { createAddressFromString, hexToBytes, bytesToHex } from '@ethereumjs/util';
import { prove } from '../js/08-schnorr-bn254.mjs';
import { word } from '../js/bn254.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', 'foundry');

// ── 1. compile ──────────────────────────────────────────────────────────────
const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
const sources = {};
for (const f of [...walk(join(root, 'src')), ...walk(join(root, 'test'))].filter((f) => f.endsWith('.sol'))) {
  sources[relative(root, f)] = { content: readFileSync(f, 'utf8') };
}
const out = JSON.parse(solc.compile(JSON.stringify({
  language: 'Solidity',
  sources,
  settings: {
    optimizer: { enabled: true, runs: 200 },
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.methodIdentifiers'] } },
  },
})));
const errors = (out.errors ?? []).filter((e) => e.severity === 'error');
for (const e of out.errors ?? []) if (e.severity !== 'error') console.warn(e.formattedMessage.split('\n')[0]);
if (errors.length) { errors.forEach((e) => console.error(e.formattedMessage)); process.exit(1); }
console.log(`compiled ${Object.keys(sources).length} files with solc ${solc.version()}\n`);

// custom-error selectors → names, for readable failures
const errorNames = {};
for (const file of Object.values(out.contracts)) for (const c of Object.values(file))
  for (const item of c.abi) if (item.type === 'error') {
    const sig = `${item.name}(${item.inputs.map((i) => i.type).join(',')})`;
    errorNames[selector(sig)] = sig;
  }
// solc reports function selectors but not error selectors: bytes4(keccak256(signature))
function selectorFull(sig) {
  return '0x' + Buffer.from(keccak_256(new TextEncoder().encode(sig))).toString('hex');
}
function selector(sig) {
  return '0x' + Buffer.from(keccak_256(new TextEncoder().encode(sig))).subarray(0, 4).toString('hex');
}

// ── 2. run tests ────────────────────────────────────────────────────────────
const common = new Common({ chain: Mainnet });
const DEPLOYER = createAddressFromString('0x' + 'de'.repeat(20));
const GAS = 1_000_000_000n;

async function freshVM() {
  return createVM({ common, evmOpts: { allowUnlimitedContractSize: true } });
}
async function deploy(vm, bytecode, caller = DEPLOYER) {
  const r = await vm.evm.runCall({ caller, data: hexToBytes('0x' + bytecode), gasLimit: GAS, skipBalance: true });
  if (r.execResult.exceptionError) throw new Error(`deploy failed: ${r.execResult.exceptionError.error}`);
  return r.createdAddress;
}
async function call(vm, to, data, caller = DEPLOYER) {
  const r = await vm.evm.runCall({ caller, to, data: hexToBytes(data), gasLimit: GAS, skipBalance: true });
  return {
    ok: !r.execResult.exceptionError,
    ret: bytesToHex(r.execResult.returnValue),
    gas: r.execResult.executionGasUsed,
    logs: decodeLogs(r.execResult.logs ?? []),
  };
}
// DSTest-style `log_named_uint(string,uint256)` events, as printed by `forge test -vv`
const LOG_NAMED_UINT = selectorFull('log_named_uint(string,uint256)');
function decodeLogs(logs) {
  const out = [];
  for (const [, topics, data] of logs) {
    if (!topics.length || bytesToHex(topics[0]) !== LOG_NAMED_UINT) continue;
    const d = Buffer.from(data);
    const val = BigInt('0x' + d.subarray(32, 64).toString('hex'));
    const len = Number(BigInt('0x' + d.subarray(64, 96).toString('hex')));
    out.push(`${d.subarray(96, 96 + len).toString('utf8')}: ${val}`);
  }
  return out;
}
const decodeRevert = (ret) => {
  const sel = ret.slice(0, 10);
  return errorNames[sel] ? `${errorNames[sel]} ${ret.length > 10 ? '0x' + ret.slice(10) : ''}` : ret;
};

let passed = 0, failed = 0;
const gasReport = [];
for (const [file, contracts] of Object.entries(out.contracts)) {
  for (const [name, c] of Object.entries(contracts)) {
    const ids = c.evm.methodIdentifiers ?? {};
    const tests = Object.keys(ids).filter((s) => s.startsWith('test'));
    if (!tests.length) continue;
    console.log(`${file}:${name}`);
    for (const t of tests.sort()) {
      const vm = await freshVM();
      const addr = await deploy(vm, c.evm.bytecode.object);
      if (ids['setUp()']) {
        const s = await call(vm, addr, '0x' + ids['setUp()']);
        if (!s.ok) { console.log(`  ✗ ${t}  (setUp reverted: ${decodeRevert(s.ret)})`); failed++; continue; }
      }
      const r = await call(vm, addr, '0x' + ids[t]);
      if (r.ok) {
        passed++;
        console.log(`  ✓ ${t.replace('()', '')}  (gas: ${r.gas})`);
        for (const l of r.logs) { console.log(`      ${l}`); gasReport.push(l); }
      }
      else { failed++; console.log(`  ✗ ${t.replace('()', '')}  → ${decodeRevert(r.ret)}`); }
    }
  }
}

// ── 3. JS prover ↔ Solidity verifier interop (KeyRegistry) ──────────────────
console.log('\ninterop: js/08-schnorr-bn254.mjs → KeyRegistry.register from an EOA');
{
  const reg = out.contracts['src/KeyRegistry.sol'].KeyRegistry;
  const vm = await freshVM();
  const registry = await deploy(vm, reg.evm.bytecode.object);
  const alice = '0x' + 'a1'.repeat(20);
  const ctx = { chainId: common.chainId(), registry: registry.toString(), account: alice };
  const { X, R, s } = prove(ctx, 0xa11ce5ec12e7n);
  const data = '0x' + reg.evm.methodIdentifiers['register((uint256,uint256),(uint256,uint256),uint256)']
    + Buffer.concat([X.x, X.y, R.x, R.y, s].map(word)).toString('hex');
  // a front-runner submits Alice's proof first: the challenge hashes msg.sender, so it fails
  const r1 = await call(vm, registry, data, createAddressFromString('0x' + 'bb'.repeat(20)));
  check(!r1.ok && decodeRevert(r1.ret).startsWith('InvalidProof'), 'front-runner replaying the proof from another EOA: InvalidProof', r1);
  const r2 = await call(vm, registry, data, createAddressFromString(alice));
  check(r2.ok, `JS proof accepted on-chain from Alice (register gas: ${r2.gas})`, r2);
}
function check(cond, label, r) {
  if (cond) { passed++; console.log(`  ✓ ${label}`); } else { failed++; console.log(`  ✗ ${label} → ${decodeRevert(r.ret)}`); }
}

if (gasReport.length) console.log('\ngas report (measured with gasleft() around the call):\n  ' + gasReport.join('\n  '));
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
