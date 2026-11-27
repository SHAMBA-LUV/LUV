// zk-client.mjs — a minimal client SDK for the membership apps (ZkAirdrop, ZkVote,
// ShieldedPool): everything a wallet or dapp does OFF-chain.
//
//   const zk = await ZkClient.create();
//   const me = zk.createIdentity();                         // keep me.secret private
//   … registrar calls ZkGroup.join(me.commitment) …
//   const leaves = [/* commitments from MemberAdded events, in order */];
//   const scope  = deriveScope(chainId, airdropAddress, round);
//   const { a, b, c, publicSignals } = await zk.proveMembership({
//     secret: me.secret, leaves, message: BigInt(recipient), scope });
//   … anyone submits ZkAirdrop.claim(publicSignals[0], publicSignals[1], recipient, a, b, c) …
//
// Needs circomlibjs + snarkjs (docs/zk/package.json) and, for proving, the circuit artefacts
// from `npm run build` (circom/build/membership_js/membership.wasm + membership_final.zkey).
// evm/e2e.mjs drives this file against live contracts.
//
// EDUCATIONAL: in a browser, load the same .wasm/.zkey over HTTPS and run snarkjs in a worker;
// never send `secret` anywhere.

import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPoseidon } from 'circomlibjs';
import { keccak_256 } from '@noble/hashes/sha3.js';
import * as snarkjs from 'snarkjs';

export const FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
export const DEPTH = 10; // must match Membership(10) and ZkGroup.DEPTH

const BUILD = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'circom', 'build');
export const artifacts = (circuit) => ({
  wasm: join(BUILD, `${circuit}_js`, `${circuit}.wasm`),
  zkey: join(BUILD, `${circuit}_final.zkey`),
  vkey: join(BUILD, `${circuit}_vkey.json`),
});

const word = (v) => Buffer.from(BigInt(v).toString(16).padStart(64, '0'), 'hex');

/** ScopeLib.derive, off-chain: keccak256(abi.encode(chainId, app, round)) mod FIELD */
export function deriveScope(chainId, app, round) {
  const packed = Buffer.concat([word(chainId), word(app), word(round)]);
  return BigInt('0x' + Buffer.from(keccak_256(packed)).toString('hex')) % FIELD;
}

/** snarkjs proof → the (a, b, c) a Solidity Groth16 verifier expects (G2 coordinates swapped) */
export function toSolidity(proof) {
  return {
    a: [proof.pi_a[0], proof.pi_a[1]].map(BigInt),
    b: [[proof.pi_b[0][1], proof.pi_b[0][0]], [proof.pi_b[1][1], proof.pi_b[1][0]]].map((p) => p.map(BigInt)),
    c: [proof.pi_c[0], proof.pi_c[1]].map(BigInt),
  };
}

export class ZkClient {
  static async create() {
    const c = new ZkClient();
    c.poseidon = await buildPoseidon();
    return c;
  }

  /** Poseidon hash of 1 or 2 field elements — identical to the circuit and to PoseidonT3.sol */
  hash(...xs) {
    return this.poseidon.F.toObject(this.poseidon(xs));
  }

  /** A fresh identity. `commitment` is public (goes on-chain); `secret` never leaves the device. */
  createIdentity(secret = BigInt('0x' + randomBytes(31).toString('hex'))) {
    return { secret, commitment: this.hash(secret) };
  }

  /** One-time tag for acting in `scope`: what the contract stores to stop double use. */
  nullifier(secret, scope) {
    return this.hash(secret, scope);
  }

  /** Rebuild the depth-10 tree ZkGroup keeps on-chain, from the leaves in join order. */
  buildTree(leaves) {
    if (leaves.length > 2 ** DEPTH) throw new Error('too many leaves');
    // sparse: only compute nodes that differ from the all-empty subtree
    const zeros = [0n];
    for (let d = 0; d < DEPTH; d++) zeros.push(this.hash(zeros[d], zeros[d]));
    const levels = [leaves.map(BigInt)];
    for (let d = 0; d < DEPTH; d++) {
      const prev = levels[d], next = [];
      for (let i = 0; i < prev.length; i += 2) next.push(this.hash(prev[i], prev[i + 1] ?? zeros[d]));
      levels.push(next.length ? next : [zeros[d + 1]]);
    }
    return {
      root: levels[DEPTH][0],
      path: (index) => {
        const pathElements = [], pathIndices = [];
        for (let d = 0, i = index; d < DEPTH; d++, i >>= 1) {
          pathIndices.push(String(i & 1));
          pathElements.push(String(levels[d][i ^ 1] ?? zeros[d]));
        }
        return { pathElements, pathIndices };
      },
    };
  }

  /** The witness for membership.circom. Throws if the identity is not in `leaves`. */
  membershipInput({ secret, leaves, message, scope }) {
    const commitment = this.hash(secret);
    const index = leaves.map(BigInt).indexOf(commitment);
    if (index < 0) throw new Error('identity is not a member of this group');
    const tree = this.buildTree(leaves);
    return {
      root: String(tree.root),
      nullifierHash: String(this.nullifier(secret, scope)),
      message: String(message),
      scope: String(scope),
      secret: String(secret),
      ...tree.path(index),
    };
  }

  /**
   * Generate a Groth16 membership proof.
   * @returns {{a, b, c, publicSignals: bigint[], root: bigint, nullifierHash: bigint}}
   *          publicSignals = [root, nullifierHash, message, scope]
   */
  async proveMembership(args, files = artifacts('membership')) {
    const input = this.membershipInput(args);
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, files.wasm, files.zkey);
    const pub = publicSignals.map(BigInt);
    return { ...toSolidity(proof), proof, publicSignals: pub, root: pub[0], nullifierHash: pub[1] };
  }

  /** Check a proof off-chain against the verification key (what a relayer does before paying gas). */
  async verify(vkey, publicSignals, proof) {
    return snarkjs.groth16.verify(vkey, publicSignals.map(String), proof);
  }
}
