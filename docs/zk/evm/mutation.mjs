// mutation.mjs — mutation-test every committed proof against its on-chain verifier.
//
// A test suite that only checks "the valid proof verifies" would pass with a verifier that
// returns true for everything. Here each fixture is verified once unchanged (must be TRUE) and
// then under every single-point mutation (each must be FALSE or revert):
//
//   • each proof word + 1                     — any change to the proof breaks it
//   • each public signal + 1                  — a proof is bound to exactly one statement
//   • each public signal + r (same value mod r) — non-canonical aliases must be rejected,
//                                               otherwise one statement has many encodings
//                                               (a classic nullifier-bypass bug)
//   • G2 point not swapped (Groth16)          — the most common integration bug (EIP-197 order)
//
// Run (from docs/zk):  npm run mutation        (also part of `npm test`)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hexToBytes, bytesToHex } from '@ethereumjs/util';
import { compile, freshVM, deploy, word, FOUNDRY_ROOT, DEPLOYER } from './lib.mjs';

const R = 21888242871839275222246405745257275088548364400416034343698204186575808495617n; // scalar field
const P = 21888242871839275222246405745257275088696311157297823662689037894645226208583n; // base field
const MUTATION_GAS = 5_000_000n; // a failing precompile burns all forwarded gas — keep it bounded

// fixture library → [verifier source, verifier contract, proof system]
const CASES = [
  ['CubeProof', 'CubeVerifier', 'groth16'],
  ['AirdropProofA', 'MembershipVerifier', 'groth16'],
  ['AirdropProofB', 'MembershipVerifier', 'groth16'],
  ['VoteProof', 'MembershipVerifier', 'groth16'],
  ['CredentialProof', 'CredentialVerifier', 'groth16'],
  ['CompliantWithdrawProof', 'CompliantWithdrawVerifier', 'groth16'],
  ['TxDepositProof', 'TransactionVerifier', 'groth16'],
  ['TxTransferProof', 'TransactionVerifier', 'groth16'],
  ['TxWithdrawProof', 'TransactionVerifier', 'groth16'],
  ['AgeHonestProof', 'AgeBuggyVerifier', 'groth16'],
  ['AgeForgedProof', 'AgeBuggyVerifier', 'groth16'],
  ['CubePlonkProof', 'CubePlonkVerifier', 'plonk'],
  ['CubeFflonkProof', 'CubeFflonkVerifier', 'fflonk'],
];

// Parse the generated fixture Solidity back into numbers (format from gen-fixture*.mjs).
function parseFixture(name, system) {
  const src = readFileSync(join(FOUNDRY_ROOT, 'test', 'fixtures', `${name}.sol`), 'utf8');
  const nums = (re) => [...src.matchAll(re)].map((m) => BigInt(m[1]));
  const pub = nums(/pub\[\d+\] = (\d+);/g);
  if (system === 'groth16') {
    const w = nums(/uint256\((\d+)\)/g); // a0 a1, b00 b01 b10 b11, c0 c1 — in Solidity order
    if (w.length !== 8) throw new Error(`${name}: expected 8 proof words, got ${w.length}`);
    return { proof: w, pub };
  }
  const w = nums(/(?:uint256|bytes32)\((0x[0-9a-f]+)\)/g);
  if (w.length !== 24) throw new Error(`${name}: expected 24 proof words, got ${w.length}`);
  return { proof: w, pub };
}

const { get } = compile({ srcOnly: true, quiet: true });
const vm = await freshVM();
const deployed = {};

async function verify(verifierName, system, proof, pub) {
  const c = get(`src/verifiers/${verifierName}.sol`, verifierName);
  deployed[verifierName] ??= await deploy(vm, c.evm.bytecode.object);
  const sig = system === 'groth16'
    ? `verifyProof(uint256[2],uint256[2][2],uint256[2],uint256[${pub.length}])`
    : system === 'plonk' ? `verifyProof(uint256[24],uint256[${pub.length}])` : `verifyProof(bytes32[24],uint256[${pub.length}])`;
  const data = '0x' + c.evm.methodIdentifiers[sig] + [...proof, ...pub].map(word).join('');
  const r = await vm.evm.runCall({ caller: DEPLOYER, to: deployed[verifierName], data: hexToBytes(data), gasLimit: MUTATION_GAS, skipBalance: true });
  if (r.execResult.exceptionError) return false; // revert / out of gas = rejected
  return BigInt(bytesToHex(r.execResult.returnValue)) === 1n;
}

let total = 0, failed = 0;
for (const [fixture, verifierName, system] of CASES) {
  const { proof, pub } = parseFixture(fixture, system);
  const mutants = [];
  proof.forEach((_, i) => mutants.push([`proof[${i}]+1`, proof.map((v, j) => (j === i ? (v + 1n) % P : v)), pub]));
  pub.forEach((_, i) => mutants.push([`pub[${i}]+1`, proof, pub.map((v, j) => (j === i ? (v + 1n) % R : v))]));
  pub.forEach((_, i) => mutants.push([`pub[${i}]+r`, proof, pub.map((v, j) => (j === i ? v + R : v))]));
  if (system === 'groth16') {
    const [a0, a1, b00, b01, b10, b11, c0, c1] = proof;
    mutants.push(['G2 unswapped', [a0, a1, b01, b00, b11, b10, c0, c1], pub]);
  }

  const original = await verify(verifierName, system, proof, pub);
  let killed = 0;
  const survivors = [];
  for (const [label, mp, mpub] of mutants) {
    if (await verify(verifierName, system, mp, mpub)) survivors.push(label); else killed++;
  }
  const good = original && survivors.length === 0;
  total += 1 + mutants.length;
  if (!good) failed++;
  console.log(`  ${good ? '✓' : '✗'} ${fixture.padEnd(24)} ${system.padEnd(7)} original verifies: ${original ? 'yes' : 'NO'} · ${killed}/${mutants.length} mutants rejected${survivors.length ? ' · SURVIVED: ' + survivors.join(', ') : ''}`);
}
console.log(`\nmutation: ${CASES.length - failed}/${CASES.length} fixtures clean (${total} verifier calls)`);
process.exit(failed ? 1 : 0);
