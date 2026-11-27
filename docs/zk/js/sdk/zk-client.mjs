// zk-client.mjs — a minimal client SDK for the membership apps (ZkAirdrop, ZkVote,
// ShieldedPool, CompliantPool, VariablePool): everything a wallet or dapp does OFF-chain.
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
import { createEncryptionKey, encryptNote, decryptNote } from './note-crypto.mjs';
export { createEncryptionKey, encryptNote, decryptNote };

export const FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
export const DEPTH = 10; // must match Membership(10) and ZkGroup.DEPTH

const BUILD = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'circom', 'build');
export const artifacts = (circuit) => ({
  wasm: join(BUILD, `${circuit}_js`, `${circuit}.wasm`),
  zkey: join(BUILD, `${circuit}_final.zkey`),
  vkey: join(BUILD, `${circuit}_vkey.json`),
});

const word = (v) => Buffer.from(BigInt(v).toString(16).padStart(64, '0'), 'hex');
// int256 two's complement, as abi.encode writes it
const int256 = (v) => word(BigInt.asUintN(256, BigInt(v)));
const randomField = () => BigInt('0x' + randomBytes(31).toString('hex'));

/** Range bound shared by transaction.circom (Num2Bits(120)) and VariablePool.sol */
export const MAX_AMOUNT = 2n ** 120n;

/** VariablePool external data → the public extDataHash, exactly as VariablePool.extDataHashOf:
 *  keccak256(abi.encode(recipient, extAmount, relayer, fee, keccak256(enc1), keccak256(enc2))) mod FIELD */
export function extDataHash({ recipient = 0n, extAmount = 0n, relayer = 0n, fee = 0n, encryptedOutput1 = '0x', encryptedOutput2 = '0x' }) {
  const h = (hex) => Buffer.from(keccak_256(Buffer.from(hex.replace(/^0x/, ''), 'hex')));
  const packed = Buffer.concat([word(BigInt(recipient)), int256(extAmount), word(BigInt(relayer)), word(fee),
    h(encryptedOutput1), h(encryptedOutput2)]);
  return BigInt('0x' + Buffer.from(keccak_256(packed)).toString('hex')) % FIELD;
}

/** extAmount − fee as a field element (negative ⇒ FIELD − |x|), exactly as the contract computes it */
export const publicAmount = (extAmount, fee) => ((BigInt(extAmount) - BigInt(fee)) % FIELD + FIELD) % FIELD;

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

  /**
   * Witness for compliant_withdraw.circom. The deposit and association trees are separate
   * (an ASP publishes the association leaves). Throws if the note was left out of the
   * association set — such a depositor cannot withdraw privately and should `ragequit`.
   */
  compliantWithdrawInput({ secret, depositLeaves, associationLeaves, recipient, relayer, fee, scope }) {
    const commitment = this.hash(secret);
    const di = depositLeaves.map(BigInt).indexOf(commitment);
    if (di < 0) throw new Error('note is not in the deposit tree');
    const ai = associationLeaves.map(BigInt).indexOf(commitment);
    if (ai < 0) throw new Error('note is not in the association set — private exit unavailable, use ragequit');
    const dep = this.buildTree(depositLeaves), asc = this.buildTree(associationLeaves);
    const dp = dep.path(di), ap = asc.path(ai);
    return {
      depositRoot: String(dep.root), associationRoot: String(asc.root),
      nullifierHash: String(this.nullifier(secret, scope)),
      recipient: String(BigInt(recipient)), relayer: String(BigInt(relayer)), fee: String(fee), scope: String(scope),
      secret: String(secret),
      depositPathElements: dp.pathElements, depositPathIndices: dp.pathIndices,
      associationPathElements: ap.pathElements, associationPathIndices: ap.pathIndices,
    };
  }

  /**
   * Generate a compliant withdrawal proof.
   * publicSignals = [depositRoot, associationRoot, nullifierHash, recipient, relayer, fee, scope]
   */
  async proveCompliantWithdraw(args, files = artifacts('compliant_withdraw')) {
    const input = this.compliantWithdrawInput(args);
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, files.wasm, files.zkey);
    const pub = publicSignals.map(BigInt);
    return { ...toSolidity(proof), proof, publicSignals: pub, root: pub[0], associationRoot: pub[1], nullifierHash: pub[2] };
  }

  // ── join-split notes (transaction.circom / VariablePool.sol) ─────────────────

  /** Spending key pair: share pubKey to get paid, keep privKey to spend. */
  createKeypair(privKey = randomField()) {
    return { privKey, pubKey: this.hash(privKey) };
  }

  /**
   * A full wallet account: spending key pair + encryption key. Its SHIELDED ADDRESS
   * `{ pubKey, encryptionKey }` is what you hand out to get paid.
   */
  createAccount(privKey) {
    const k = this.createKeypair(privKey);
    const enc = createEncryptionKey();
    return { ...k, encryption: enc, address: { pubKey: k.pubKey, encryptionKey: enc.publicKey } };
  }

  /** Encrypt each output note to its receiver's address → { encryptedOutput1, encryptedOutput2 }. */
  encryptOutputs(outputs) {
    const enc = outputs.map(({ note, to }) => (to ? encryptNote(note, to.encryptionKey) : '0x'));
    return { encryptedOutput1: enc[0] ?? '0x', encryptedOutput2: enc[1] ?? '0x' };
  }

  /**
   * Wallet scan: find this account's unspent notes from chain data alone.
   * @param commitments  [{ commitment, index, encryptedOutput }] from NewCommitment events, in order
   * @param spent        Set of nullifiers from NewNullifier events
   * @returns { notes: [{ note, index, nullifier }], balance }
   * A decrypted note is accepted only if Poseidon(amount, pubKey, blinding) equals the on-chain
   * commitment — a sender cannot fool the wallet with a ciphertext for a note that doesn't exist.
   */
  scan(account, commitments, spent = new Set()) {
    const notes = [];
    for (const { commitment, index, encryptedOutput } of commitments) {
      if (!encryptedOutput || encryptedOutput === '0x') continue;
      const d = decryptNote(encryptedOutput, account.encryption.privateKey);
      if (!d) continue; // not ours
      const note = { amount: d.amount, pubKey: account.pubKey, blinding: d.blinding, commitment: this.hash(d.amount, account.pubKey, d.blinding) };
      if (note.commitment !== BigInt(commitment)) continue; // decrypts, but isn't the committed note
      const nullifier = this.noteNullifier(note, account.privKey);
      if (spent.has(nullifier)) continue;
      notes.push({ note, index, nullifier });
    }
    return { notes, balance: notes.reduce((t, n) => t + n.note.amount, 0n) };
  }

  /** A note of `amount` owned by `pubKey`. Only `commitment` goes on-chain. */
  createNote(amount, pubKey, blinding = randomField()) {
    amount = BigInt(amount);
    if (amount < 0n || amount >= MAX_AMOUNT) throw new Error('amount out of range');
    return { amount, pubKey, blinding, commitment: this.hash(amount, pubKey, blinding) };
  }

  noteNullifier(note, privKey) {
    return this.hash(note.commitment, privKey);
  }

  /**
   * Witness for transaction.circom.
   * @param leaves   all commitments in the pool tree, in insertion order (from NewCommitment events)
   * @param inputs   up to 2 × { note, privKey } being spent (padded with zero-value dummies)
   * @param outputs  up to 2 notes being created (padded with zero-value notes)
   * @param extData  { recipient, extAmount, relayer, fee }  (extAmount > 0 deposit, < 0 withdraw)
   * @param rand     randomness source for dummies (override only for reproducible fixtures)
   */
  transactionInput({ leaves, inputs = [], outputs = [], extData = {}, rand = randomField }) {
    if (inputs.length > 2 || outputs.length > 2) throw new Error('2-in / 2-out');
    const tree = this.buildTree(leaves);
    const leafIndex = new Map(leaves.map((c, i) => [BigInt(c), i]));
    const ins = [...inputs];
    while (ins.length < 2) {
      const k = this.createKeypair(rand());
      ins.push({ note: this.createNote(0n, k.pubKey, rand()), privKey: k.privKey, dummy: true });
    }
    const outs = [...outputs];
    while (outs.length < 2) outs.push(this.createNote(0n, this.createKeypair(rand()).pubKey, rand()));
    for (const { note, privKey, dummy } of ins) {
      if (!dummy && this.hash(privKey) !== note.pubKey) throw new Error('this key does not own the input note');
    }
    const paths = ins.map(({ note, dummy }) => {
      if (dummy) return { pathElements: Array(DEPTH).fill('0'), pathIndices: Array(DEPTH).fill('0') };
      const i = leafIndex.get(note.commitment);
      if (i === undefined) throw new Error('input note is not in the pool tree');
      return tree.path(i);
    });
    const { extAmount = 0n, fee = 0n } = extData;
    const sumIn = ins.reduce((t, x) => t + x.note.amount, 0n), sumOut = outs.reduce((t, n) => t + n.amount, 0n);
    if (sumIn + BigInt(extAmount) - BigInt(fee) !== sumOut) throw new Error('value is not conserved');
    return {
      root: String(tree.root),
      publicAmount: String(publicAmount(extAmount, fee)),
      extDataHash: String(extDataHash(extData)),
      inputNullifier: ins.map(({ note, privKey }) => String(this.noteNullifier(note, privKey))),
      outputCommitment: outs.map((n) => String(n.commitment)),
      inAmount: ins.map(({ note }) => String(note.amount)),
      inPrivKey: ins.map(({ privKey }) => String(privKey)),
      inBlinding: ins.map(({ note }) => String(note.blinding)),
      inPathIndices: paths.map((p) => p.pathIndices),
      inPathElements: paths.map((p) => p.pathElements),
      outAmount: outs.map((n) => String(n.amount)),
      outPubKey: outs.map((n) => String(n.pubKey)),
      outBlinding: outs.map((n) => String(n.blinding)),
      _outputs: outs, // the notes created (the receiver needs amount + blinding to spend later)
    };
  }

  /**
   * Generate a join-split proof.
   * publicSignals = [root, publicAmount, extDataHash, nullifier0, nullifier1, commitment0, commitment1]
   */
  async proveTransaction(args, files = artifacts('transaction')) {
    const { _outputs, ...input } = this.transactionInput(args);
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, files.wasm, files.zkey);
    const pub = publicSignals.map(BigInt);
    return {
      ...toSolidity(proof), proof, publicSignals: pub, outputs: _outputs,
      root: pub[0], publicAmount: pub[1], extDataHash: pub[2], nullifiers: [pub[3], pub[4]], commitments: [pub[5], pub[6]],
    };
  }

  /** Check a proof off-chain against the verification key (what a relayer does before paying gas). */
  async verify(vkey, publicSignals, proof) {
    return snarkjs.groth16.verify(vkey, publicSignals.map(String), proof);
  }
}
