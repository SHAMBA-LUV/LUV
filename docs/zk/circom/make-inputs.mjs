// make-inputs.mjs — every circuit input (witness) and Solidity fixture constant for the guide:
//   • membership.circom : a Poseidon Merkle group of 8 members → two airdrop claims + one vote
//   • age_buggy.circom  : a 10-year-old's honest input (the forger reuses it to lie)
//   • credential.circom : issuer-signed (EdDSA/Poseidon) birth-year credentials for an adult
//                         and a minor (the minor's must FAIL to prove)
//   • compliant_withdraw : 8 deposits, an association set without the flagged member #3
//   • transaction.circom : a 3-transaction join-split story (deposit → private transfer →
//                          withdrawal with fee) + 3 attacks that must FAIL to prove
//
// Usage: node make-inputs.mjs <outDir> [fixturesDir]   (needs circomlibjs — see ../package.json)
//
// Members' secrets are derived deterministically from labels so the fixtures are reproducible.
// In a real deployment every member generates `secret` locally and publishes only
// Poseidon(secret) — the identity commitment — to the group.

import { buildPoseidon, buildEddsa } from 'circomlibjs';
import { ZkClient, FIELD } from '../js/sdk/zk-client.mjs';
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
const fixDir = process.argv[3];
mkdirSync(outDir, { recursive: true });

const poseidon = await buildPoseidon();
const H = (...xs) => poseidon.F.toObject(poseidon(xs));

const secretOf = (label) => BigInt('0x' + createHash('sha256').update(`LUV-ZK-GUIDE/member/${label}`).digest('hex')) % R;
const members = Array.from({ length: 8 }, (_, i) => secretOf(i));
const commitments = members.map((s) => H(s)); // identity commitment = Poseidon(secret)

// A full depth-DEPTH Poseidon tree over `list` (empty leaves are 0), level by level.
function buildTree(list) {
  const leaves = Array(2 ** DEPTH).fill(0n);
  list.forEach((c, i) => { leaves[i] = c; });
  const levels = [leaves];
  for (let d = 0; d < DEPTH; d++) {
    const prev = levels[d], next = [];
    for (let i = 0; i < prev.length; i += 2) next.push(H(prev[i], prev[i + 1]));
    levels.push(next);
  }
  return {
    root: levels[DEPTH][0],
    path(index) {
      const pathElements = [], pathIndices = [];
      for (let d = 0, i = index; d < DEPTH; d++, i >>= 1) {
        pathIndices.push(String(i & 1));
        pathElements.push(String(levels[d][i ^ 1]));
      }
      return { pathElements, pathIndices };
    },
  };
}
const group = buildTree(commitments);
const root = group.root;
const leaves = commitments; // (used by the Solidity constants below)
const path = (i) => group.path(i);

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

// ── age_buggy: an honest minor's input (2016 → 10 years old in 2026) ─────────
export const CURRENT_YEAR = 2026n, MIN_AGE = 18n;
export const ATTACKER = 0xbadn, ADULT = 0xa11cen, MINOR = 0xc0ffeen;
write('ageMinor', { birthYear: '2016', currentYear: String(CURRENT_YEAR), minAge: String(MIN_AGE), subject: String(ATTACKER) });

// ── credential: the issuer signs Poseidon(birthYear, subject) with EdDSA on Baby Jubjub ──
const eddsa = await buildEddsa();
const F = eddsa.babyJub.F;
const issuerPrv = createHash('sha256').update('LUV-ZK-GUIDE/issuer').digest(); // demo key
const [Ax, Ay] = eddsa.prv2pub(issuerPrv).map((v) => F.toObject(v));
function credential(birthYear, subject) {
  const msg = eddsa.poseidon([birthYear, subject]);
  const sig = eddsa.signPoseidon(issuerPrv, msg);
  if (!eddsa.verifyPoseidon(msg, sig, eddsa.prv2pub(issuerPrv))) throw new Error('bad signature');
  return {
    issuerAx: String(Ax), issuerAy: String(Ay),
    currentYear: String(CURRENT_YEAR), minAge: String(MIN_AGE), subject: String(subject),
    birthYear: String(birthYear),
    sigR8x: String(F.toObject(sig.R8[0])), sigR8y: String(F.toObject(sig.R8[1])), sigS: String(sig.S),
  };
}
write('credAdult', credential(1990n, ADULT));
write('credMinor', credential(2015n, MINOR));

// ── compliant_withdraw: deposit tree = all 8 members; the Association Set Provider has
//    flagged member #3, so the association tree holds the other 7 (in deposit order) ──
export const FLAGGED = 3, RELAYER = 0xfee1n, FEE = 10n * 10n ** 18n;
const approved = commitments.filter((_, i) => i !== FLAGGED);
const association = buildTree(approved);
function withdrawal(memberIndex, associationIndex, recipient) {
  const dep = group.path(memberIndex), asc = association.path(associationIndex);
  return {
    depositRoot: String(root), associationRoot: String(association.root),
    nullifierHash: String(H(members[memberIndex], AIRDROP_SCOPE)),
    recipient: String(recipient), relayer: String(RELAYER), fee: String(FEE), scope: String(AIRDROP_SCOPE),
    secret: String(members[memberIndex]),
    depositPathElements: dep.pathElements, depositPathIndices: dep.pathIndices,
    associationPathElements: asc.pathElements, associationPathIndices: asc.pathIndices,
  };
}
write('withdrawOk', withdrawal(5, approved.indexOf(commitments[5]), RECIPIENT_A));
// the flagged depositor has a valid deposit path but NO association path; the best they can
// do is borrow someone else's — which recomputes a different root, so witness generation fails
write('withdrawFlagged', withdrawal(FLAGGED, 0, 0xbadn));

// ── transaction (join-split): built with the client SDK, so fixtures and live proofs share code ──
const zk = await ZkClient.create();
let ctr = 0; // reproducible "randomness" for dummies and blindings
const rand = () => BigInt('0x' + createHash('sha256').update(`LUV-ZK-GUIDE/tx-rand/${ctr++}`).digest('hex')) % FIELD;
const E18 = 10n ** 18n;
const alice = zk.createKeypair(BigInt('0x' + createHash('sha256').update('LUV-ZK-GUIDE/alice').digest('hex')) % FIELD);
const bob = zk.createKeypair(BigInt('0x' + createHash('sha256').update('LUV-ZK-GUIDE/bob').digest('hex')) % FIELD);
export const TX_RECIPIENT = 0xb0bn, TX_RELAYER = 0xfee1n;
const strip = ({ _outputs, ...i }) => i;

// tx1 — Alice deposits 100 as two notes (60 + 40). No inputs: two zero-value dummies.
const A1 = zk.createNote(60n * E18, alice.pubKey, rand()), A2 = zk.createNote(40n * E18, alice.pubKey, rand());
write('tx1', strip(zk.transactionInput({ leaves: [], outputs: [A1, A2], extData: { extAmount: 100n * E18 }, rand })));
// tx2 — Alice pays Bob 70 privately, keeps 30. No public amount: an observer sees nothing.
const B1 = zk.createNote(70n * E18, bob.pubKey, rand()), A3 = zk.createNote(30n * E18, alice.pubKey, rand());
const leaves2 = [A1.commitment, A2.commitment];
write('tx2', strip(zk.transactionInput({ leaves: leaves2, inputs: [{ note: A1, privKey: alice.privKey }, { note: A2, privKey: alice.privKey }], outputs: [B1, A3], rand })));
// tx3 — Bob withdraws 40 to 0xB0B through relayer 0xFEE1 (fee 5), keeps 25.
const B2 = zk.createNote(25n * E18, bob.pubKey, rand());
const leaves3 = [...leaves2, B1.commitment, A3.commitment];
const ext3 = { recipient: TX_RECIPIENT, extAmount: -40n * E18, relayer: TX_RELAYER, fee: 5n * E18 };
write('tx3', strip(zk.transactionInput({ leaves: leaves3, inputs: [{ note: B1, privKey: bob.privKey }], outputs: [B2], extData: ext3, rand })));

// must-FAIL witnesses (hand-built: the SDK itself refuses to make them)
const base = strip(zk.transactionInput({ leaves: leaves2, inputs: [{ note: A1, privKey: alice.privKey }, { note: A2, privKey: alice.privKey }], outputs: [B1, A3], rand }));
// (a) inflation: 100 in, 110 out, nothing paid in
const big = zk.createNote(80n * E18, bob.pubKey, rand());
write('txInflate', { ...base, outputCommitment: [String(big.commitment), base.outputCommitment[1]], outAmount: [String(big.amount), base.outAmount[1]], outPubKey: [String(big.pubKey), base.outPubKey[1]], outBlinding: [String(big.blinding), base.outBlinding[1]] });
// (b) "negative" note: 110 + (p − 10) ≡ 100 (mod p) balances — only the range check stops it
const neg = { amount: FIELD - 10n * E18, pubKey: alice.pubKey, blinding: rand() };
neg.commitment = zk.hash(neg.amount, neg.pubKey, neg.blinding);
const pos = zk.createNote(110n * E18, bob.pubKey, rand());
write('txNegative', { ...base, outputCommitment: [String(pos.commitment), String(neg.commitment)], outAmount: [String(pos.amount), String(neg.amount)], outPubKey: [String(pos.pubKey), String(neg.pubKey)], outBlinding: [String(pos.blinding), String(neg.blinding)] });
// (c) theft: Bob tries to spend Alice's change note A3 with HIS key (state after tx2)
const steal = strip(zk.transactionInput({ leaves: leaves3, inputs: [{ note: A3, privKey: alice.privKey }], outputs: [zk.createNote(30n * E18, bob.pubKey, rand())], rand }));
steal.inPrivKey = [String(bob.privKey), steal.inPrivKey[1]];
steal.inputNullifier = [String(zk.hash(A3.commitment, bob.privKey)), steal.inputNullifier[1]];
write('txSteal', steal);

// ── Solidity constants the tests need (group members + issuer key) ───────────
if (fixDir) {
  writeFileSync(`${fixDir}/ZkConstants.sol`, `// SPDX-License-Identifier: MIT
// AUTO-GENERATED by docs/zk/circom/make-inputs.mjs — do not edit. Regenerate: cd docs/zk && npm run build
pragma solidity ^0.8.24;

library ZkConstants {
    /// root of the depth-${DEPTH} Poseidon tree whose first 8 leaves are the commitments below
    uint256 internal constant GROUP_ROOT = ${root};
    /// root of the association tree: every member except the flagged #${FLAGGED}
    uint256 internal constant ASSOCIATION_ROOT = ${association.root};
    /// Baby Jubjub public key of the demo credential issuer
    uint256 internal constant ISSUER_AX = ${Ax};
    uint256 internal constant ISSUER_AY = ${Ay};
    /// TEST-ONLY secrets (deterministic, published): a ragequit reveals the note's secret
    /// on-chain, so the ragequit tests need them. Member #${FLAGGED} is the ASP-flagged depositor.
    uint256 internal constant FLAGGED_SECRET = ${members[FLAGGED]};
    uint256 internal constant MEMBER5_SECRET = ${members[5]};
    uint256 internal constant CURRENT_YEAR = ${CURRENT_YEAR};
    /// join-split story: tx1 deposit 100 → tx2 Alice pays Bob 70 → tx3 Bob withdraws 40 + fee 5
    address internal constant TX_RECIPIENT = address(uint160(0x${TX_RECIPIENT.toString(16)}));
    address internal constant TX_RELAYER = address(uint160(0x${TX_RELAYER.toString(16)}));
    uint256 internal constant MIN_AGE = ${MIN_AGE};

    /// identity commitments Poseidon(secret) of members #0..#7, in join order
    function members() internal pure returns (uint256[8] memory c) {
${members.map((sec, i) => `        c[${i}] = ${leaves[i]};`).join('\n')}
    }
}
`);
}
console.log(`wrote membership, age, credential, withdrawal and transaction inputs to ${outDir}/`);
