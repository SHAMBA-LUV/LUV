// encode-proof.mjs — turn snarkjs proof.json + public.json into the ABI-encoded calldata
// of  verifyProof(uint[2] a, uint[2][2] b, uint[2] c, uint[N] pubSignals),  as one 0x-hex
// string the Foundry test reads with vm.readFile + abi.decode. Zero dependencies.
//
// All arguments are fixed-size uint arrays, so the ABI encoding is simply each value as a
// 32-byte big-endian word, in order (Solidity ABI spec, "static types").
//
// ⚠ The G2 point b is stored by snarkjs as [[x.c0, x.c1], [y.c0, y.c1]], but the EIP-197
//   pairing precompile expects [[x.c1, x.c0], [y.c1, y.c0]] — so each pair is swapped,
//   exactly as `snarkjs zkey export soliditycalldata` does.
//
// Usage: node encode-proof.mjs proof.json public.json > proof/calldata.hex

import { readFileSync } from 'node:fs';

const [proofPath, publicPath] = process.argv.slice(2);
if (!proofPath || !publicPath) {
  console.error('usage: node encode-proof.mjs proof.json public.json');
  process.exit(2);
}
const proof = JSON.parse(readFileSync(proofPath, 'utf8'));
const pub = JSON.parse(readFileSync(publicPath, 'utf8'));

const word = (v) => BigInt(v).toString(16).padStart(64, '0');
const words = [
  proof.pi_a[0], proof.pi_a[1],
  proof.pi_b[0][1], proof.pi_b[0][0],
  proof.pi_b[1][1], proof.pi_b[1][0],
  proof.pi_c[0], proof.pi_c[1],
  ...pub,
];
process.stdout.write('0x' + words.map(word).join(''));
