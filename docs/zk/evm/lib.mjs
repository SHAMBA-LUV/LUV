// lib.mjs — shared helpers for run-tests.mjs and e2e.mjs: compile the Foundry project with
// solc-js, run it on ethereumjs (BN254 precompiles included), and encode/decode the ABI for
// the static types these contracts use. No ethers/viem needed.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import solc from 'solc';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { createVM } from '@ethereumjs/vm';
import { Common, Mainnet } from '@ethereumjs/common';
import { createAddressFromString, hexToBytes, bytesToHex } from '@ethereumjs/util';

const here = dirname(fileURLToPath(import.meta.url));
export const FOUNDRY_ROOT = join(here, '..', 'foundry');
export const common = new Common({ chain: Mainnet }); // chain id 1
export const GAS = 1_000_000_000n;
export const address = (hex) => createAddressFromString(hex);
export const DEPLOYER = address('0x' + 'de'.repeat(20));

// ── hashing / selectors ─────────────────────────────────────────────────────
export const keccak = (bytes) => Buffer.from(keccak_256(bytes));
export const selectorFull = (sig) => '0x' + keccak(new TextEncoder().encode(sig)).toString('hex');
export const selector = (sig) => selectorFull(sig).slice(0, 10);

// ── ABI for static types: every uint256 / address / bool / fixed array is one 32-byte word ──
export const word = (v) => {
  if (typeof v === 'string' && v.startsWith('0x')) v = BigInt(v);
  if (typeof v === 'boolean') v = v ? 1n : 0n;
  return BigInt.asUintN(256, BigInt(v)).toString(16).padStart(64, '0'); // negatives → two's complement (int256)
};
/** encodeCall(contract, 'claim(uint256,…)', [args…]) — args may be nested arrays; all are flattened to words */
export function encodeCall(contract, signature, args = []) {
  const id = contract.evm.methodIdentifiers[signature];
  if (!id) throw new Error(`no method ${signature}`);
  return '0x' + id + args.flat(Infinity).map(word).join('');
}
export const decodeUint = (ret, i = 0) => BigInt('0x' + ret.slice(2 + 64 * i, 66 + 64 * i));

// ── compile ─────────────────────────────────────────────────────────────────
const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));

/** Compile foundry/src (+ foundry/test unless srcOnly) with the settings in foundry.toml. */
export function compile({ srcOnly = false, quiet = false } = {}) {
  const dirs = srcOnly ? ['src'] : ['src', 'test'];
  const sources = {};
  for (const f of dirs.flatMap((d) => walk(join(FOUNDRY_ROOT, d))).filter((f) => f.endsWith('.sol'))) {
    sources[relative(FOUNDRY_ROOT, f)] = { content: readFileSync(f, 'utf8') };
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
  if (!quiet) for (const e of out.errors ?? []) if (e.severity !== 'error') console.warn(e.formattedMessage.split('\n')[0]);
  if (errors.length) { errors.forEach((e) => console.error(e.formattedMessage)); process.exit(1); }

  // custom-error selectors → names (solc reports function selectors but not error selectors)
  const errorNames = {};
  for (const file of Object.values(out.contracts)) for (const c of Object.values(file))
    for (const item of c.abi) if (item.type === 'error') {
      const sig = `${item.name}(${item.inputs.map((i) => i.type).join(',')})`;
      errorNames[selector(sig)] = sig;
    }
  const decodeRevert = (ret) => {
    const sel = ret.slice(0, 10);
    return errorNames[sel] ? `${errorNames[sel]}${ret.length > 10 ? ' 0x' + ret.slice(10) : ''}` : ret;
  };
  const get = (file, name) => out.contracts[file][name];
  return { contracts: out.contracts, get, decodeRevert, fileCount: Object.keys(sources).length, solcVersion: solc.version() };
}

// ── EVM ─────────────────────────────────────────────────────────────────────
export const freshVM = () => createVM({ common, evmOpts: { allowUnlimitedContractSize: true } });

/** deploy(vm, creationBytecodeHex, constructorArgs?) → Address */
export async function deploy(vm, bytecode, args = [], caller = DEPLOYER) {
  const data = hexToBytes('0x' + bytecode.replace(/^0x/, '') + args.flat(Infinity).map(word).join(''));
  const r = await vm.evm.runCall({ caller, data, gasLimit: GAS, skipBalance: true });
  if (r.execResult.exceptionError) throw new Error(`deploy failed: ${r.execResult.exceptionError.error}`);
  return r.createdAddress;
}

/** call(vm, to, calldataHex, caller?) → { ok, ret, gas, rawLogs, logs } (state changes persist) */
export async function call(vm, to, data, caller = DEPLOYER) {
  const r = await vm.evm.runCall({ caller, to, data: hexToBytes(data), gasLimit: GAS, skipBalance: true });
  const rawLogs = r.execResult.logs ?? [];
  return {
    ok: !r.execResult.exceptionError,
    ret: bytesToHex(r.execResult.returnValue),
    gas: r.execResult.executionGasUsed,
    rawLogs,
    logs: decodeNamedUints(rawLogs),
  };
}

// DSTest-style `log_named_uint(string,uint256)` events, as printed by `forge test -vv`
const LOG_NAMED_UINT = selectorFull('log_named_uint(string,uint256)');
function decodeNamedUints(logs) {
  const out = [];
  for (const [, topics, data] of logs) {
    if (!topics.length || bytesToHex(topics[0]) !== LOG_NAMED_UINT) continue;
    const d = Buffer.from(data);
    const val = BigInt('0x' + d.subarray(32, 64).toString('hex'));
    const len = Number(BigInt('0x' + d.subarray(64, 96).toString('hex')));
    out.push({ key: d.subarray(96, 96 + len).toString('utf8'), val });
  }
  return out;
}

/** topics/data of every log with the given event signature, e.g. 'MemberAdded(uint256,uint256,uint256)' */
export function eventsOf(rawLogs, signature) {
  const t0 = selectorFull(signature);
  return rawLogs
    .filter(([, topics]) => topics.length && bytesToHex(topics[0]) === t0)
    .map(([, topics, data]) => ({ topics: topics.map((t) => BigInt(bytesToHex(t))), data: bytesToHex(data) }));
}
