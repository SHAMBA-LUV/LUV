// make-inputs.mjs — build a Poseidon Merkle tree of group members and write circuit inputs
// for membership.circom: two airdrop claims (members #5 and #2) and one vote (member #5).
//
// Usage: node make-inputs.mjs <outDir>          (needs circomlibjs — see ../package.json)
//
// Members' secrets are derived deterministically from labels so the fixtures are reproducible.
// In a real deployment every member generates `secret` locally and publishes only
// Poseidon(secret) — the identity commitment — to the group.

import { buildPoseidon } from 'circomlibjs';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';

const DEPTH = 10;                 // must match Membership(10) in membership.circom
export const AIRDROP_SCOPE = 1n;  // airdrop round id   (ZkAirdrop.t.sol uses the same constants)
export const PROPOSAL_ID = 7n;    // proposal id = vote scope
export const RECIPIENT_A = 0xb0bn;  // member #5 claims to this address
export const RECIPIENT_B = 0xcafen; // member #2 claims to this address
export const VOTE_OPTION = 1n;      // member #5 votes "yes"

const R = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const outDir = process.argv[2] ?? 'build';
mkdirSync(outDir, { recursive: true });

const poseidon = await buildPoseidon();
const H = (...xs) => poseidon.F.toObject(poseidon(xs));

const secretOf = (label) => BigInt('0x' + createHash('sha256').update(`LUV-ZK-GUIDE/member/${label}`).digest('hex')) % R;
const members = Array.from({ length: 8 }, (_, i) => secretOf(i));
const leaves = Array(2 ** DEPTH).fill(0n);
members.forEach((s, i) => { leaves[i] = H(s); }); // identity commitment = Poseidon(secret)

// full binary tree, level by level
const levels = [leaves];
for (let d = 0; d < DEPTH; d++) {
  const prev = levels[d], next = [];
  for (let i = 0; i < prev.length; i += 2) next.push(H(prev[i], prev[i + 1]));
  levels.push(next);
}
const root = levels[DEPTH][0];

function path(index) {
  const pathElements = [], pathIndices = [];
  for (let d = 0, i = index; d < DEPTH; d++, i >>= 1) {
    pathIndices.push(String(i & 1));
    pathElements.push(String(levels[d][i ^ 1]));
  }
  return { pathElements, pathIndices };
}

function input(memberIndex, scope, message) {
  const secret = members[memberIndex];
  return {
    root: String(root),
    nullifierHash: String(H(secret, scope)),
    message: String(message),
    scope: String(scope),
    secret: String(secret),
    ...path(memberIndex),
  };
}

const write = (name, obj) => writeFileSync(`${outDir}/${name}.input.json`, JSON.stringify(obj, null, 2));
write('airdropA', input(5, AIRDROP_SCOPE, RECIPIENT_A));
write('airdropB', input(2, AIRDROP_SCOPE, RECIPIENT_B));
write('vote', input(5, PROPOSAL_ID, VOTE_OPTION));
console.log(`group root ${root}`);
console.log(`wrote airdropA / airdropB / vote inputs to ${outDir}/`);
