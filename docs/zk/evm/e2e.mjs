// e2e.mjs — the whole flow LIVE: nothing here is a prebuilt fixture.
//
//   deploy Poseidon + ZkGroup + verifier + token + ZkAirdrop (scope BOUND to chain + address)
//   → random identities join on-chain → the client SDK rebuilds the tree from MemberAdded
//   events → generates fresh Groth16 proofs with snarkjs → relayed claims and a vote succeed;
//   replays, redirects and cross-deployment reuse fail. Then a CompliantPool: deposits from
//   random EOAs, an ASP builds its set from the Deposit log and flags one depositor, a relayed
//   withdrawal pays recipient and relayer, the flagged depositor ragequits. Finally a
//   VariablePool with HIDDEN AMOUNTS: deposit, a private Alice → Bob transfer, a relayed
//   withdrawal, a theft attempt and a replay.
//
// Run (from docs/zk):  npm run build   (once — needs circom/build/membership_final.zkey)
//                      npm run e2e
// The on-chain MembershipVerifier must come from the same build as the zkey (it does if you
// have not rebuilt since checkout, or have just run `npm run build`).

import { existsSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { poseidonContract } from 'circomlibjs';
import { createContractAddress } from '@ethereumjs/util';
import { compile, freshVM, deploy, call, encodeCall, decodeUint, eventsOf, address, common, DEPLOYER } from './lib.mjs';
import { ZkClient, deriveScope, artifacts } from '../js/sdk/zk-client.mjs';

const files = artifacts('membership');
const cfiles = artifacts('compliant_withdraw');
const tfiles = artifacts('transaction');
if (![files.zkey, files.wasm, cfiles.zkey, cfiles.wasm, tfiles.zkey, tfiles.wasm].every(existsSync)) {
  console.error('circuit artefacts missing — run `npm run build` first (they are not committed)');
  process.exit(2);
}

let failed = 0;
const ok = (cond, label) => { console.log(`  ${cond ? '✓' : '✗'} ${label}`); if (!cond) failed++; };
const randomAddress = () => '0x' + randomBytes(20).toString('hex');

const { get, decodeRevert } = compile({ quiet: true });
const C = {
  group: get('src/ZkGroup.sol', 'ZkGroup'),
  verifier: get('src/verifiers/MembershipVerifier.sol', 'MembershipVerifier'),
  airdrop: get('src/ZkAirdrop.sol', 'ZkAirdrop'),
  vote: get('src/ZkVote.sol', 'ZkVote'),
  token: get('test/ZkTest.sol', 'MockToken'),
  cpool: get('src/CompliantPool.sol', 'CompliantPool'),
  cverifier: get('src/verifiers/CompliantWithdrawVerifier.sol', 'CompliantWithdrawVerifier'),
  asp: get('src/OwnerRoots.sol', 'OwnerRoots'),
  vpool: get('src/VariablePool.sol', 'VariablePool'),
  txverifier: get('src/verifiers/TransactionVerifier.sol', 'TransactionVerifier'),
};
const TRANSACT = 'transact((uint256[2],uint256[2][2],uint256[2],uint256,uint256,uint256,uint256[2],uint256[2]),(address,int256,address,uint256,bytes,bytes))';
const CWITHDRAW = 'withdraw(uint256,uint256,uint256,address,address,uint256,uint256[2],uint256[2][2],uint256[2])';
const CLAIM = 'claim(uint256,uint256,address,uint256[2],uint256[2][2],uint256[2])';
const VOTE = 'vote(uint256,uint256,uint256,uint256[2],uint256[2][2],uint256[2])';
const AMOUNT = 10n ** 30n; // 1 trillion tokens, 18 decimals
const ROUND = 1n;
const chainId = common.chainId();

const vm = await freshVM();
const zk = await ZkClient.create();
const view = async (to, c, sig, args = []) => decodeUint((await call(vm, to, encodeCall(c, sig, args))).ret);

// ── 1. deploy ───────────────────────────────────────────────────────────────
console.log('1. deploy');
const hasher = await deploy(vm, poseidonContract.createCode(2));
const verifier = await deploy(vm, C.verifier.evm.bytecode.object);
const group = await deploy(vm, C.group.evm.bytecode.object, [hasher.toString(), DEPLOYER.toString()]);
const token = await deploy(vm, C.token.evm.bytecode.object, [100n * AMOUNT]);

// the airdrop's address is known before deployment (deployer + nonce), so its scope can be
// bound to (chain id, its own address, round) — ScopeLib.derive, computed off-chain here
const nonce = (await vm.stateManager.getAccount(DEPLOYER))?.nonce ?? 0n;
const predicted = createContractAddress(DEPLOYER, nonce);
const scope = deriveScope(chainId, predicted.toString(), ROUND);
const airdrop = await deploy(vm, C.airdrop.evm.bytecode.object, [token.toString(), verifier.toString(), group.toString(), scope, AMOUNT]);
ok(airdrop.toString() === predicted.toString(), `airdrop deployed at the predicted address ${airdrop}`);
ok((await view(airdrop, C.airdrop, 'isScopeBound(uint256)', [ROUND])) === 1n, 'on-chain: scope is bound to (chainid, address(this), round)');
await call(vm, token, encodeCall(C.token, 'transfer(address,uint256)', [airdrop.toString(), 50n * AMOUNT]));

// ── 2. members join; the client learns the tree from events ─────────────────
console.log('2. six fresh identities join the on-chain group');
const identities = Array.from({ length: 6 }, () => zk.createIdentity());
const leaves = [];
let joinGas = 0n;
for (const id of identities) {
  const r = await call(vm, group, encodeCall(C.group, 'join(uint256)', [id.commitment]));
  if (!r.ok) throw new Error('join failed: ' + decodeRevert(r.ret));
  joinGas = r.gas;
  for (const e of eventsOf(r.rawLogs, 'MemberAdded(uint256,uint256,uint256)')) leaves.push(e.topics[2]);
}
ok(leaves.length === 6, `6 MemberAdded events read (last join: ${joinGas} gas)`);
const onchainRoot = await view(group, C.group, 'root()');
ok(zk.buildTree(leaves).root === onchainRoot, 'SDK tree rebuilt from events == ZkGroup.root()');

// ── 3. a fresh proof, relayed ───────────────────────────────────────────────
console.log('3. member #4 claims privately (proof generated now, submitted by a relayer)');
const recipient = randomAddress();
const relayer = address(randomAddress());
let t = Date.now();
const p = await zk.proveMembership({ secret: identities[4].secret, leaves, message: BigInt(recipient), scope });
console.log(`     proof generated in ${((Date.now() - t) / 1000).toFixed(1)} s`);
const vkey = JSON.parse(readFileSync(files.vkey, 'utf8'));
ok(await zk.verify(vkey, p.publicSignals, p.proof), 'relayer pre-checks the proof off-chain');
const claimData = (proof, to) => encodeCall(C.airdrop, CLAIM, [proof.root, proof.nullifierHash, to, proof.a, proof.b, proof.c]);
const r1 = await call(vm, airdrop, claimData(p, recipient), relayer);
ok(r1.ok, `claim accepted (${r1.gas} gas)${r1.ok ? '' : ' → ' + decodeRevert(r1.ret) + ' (verifier and zkey from different builds? run npm run build)'}`);
ok((await view(token, C.token, 'balanceOf(address)', [recipient])) === AMOUNT, 'recipient received exactly 1 trillion tokens; nothing links it to member #4');

// ── 4. attacks on the live system ───────────────────────────────────────────
console.log('4. attacks');
const r2 = await call(vm, airdrop, claimData(p, recipient), relayer);
ok(!r2.ok && decodeRevert(r2.ret).startsWith('NullifierUsed'), 'replaying the claim → NullifierUsed');

const p5 = await zk.proveMembership({ secret: identities[5].secret, leaves, message: BigInt(recipient), scope });
const thief = randomAddress();
const r3 = await call(vm, airdrop, claimData(p5, thief), address(thief));
ok(!r3.ok && decodeRevert(r3.ret).startsWith('InvalidProof'), "front-runner swapping in their own address → InvalidProof");

// a second deployment of the SAME airdrop code: different address ⇒ different bound scope
const nonce2 = (await vm.stateManager.getAccount(DEPLOYER)).nonce;
const scope2 = deriveScope(chainId, createContractAddress(DEPLOYER, nonce2).toString(), ROUND);
const airdrop2 = await deploy(vm, C.airdrop.evm.bytecode.object, [token.toString(), verifier.toString(), group.toString(), scope2, AMOUNT]);
await call(vm, token, encodeCall(C.token, 'transfer(address,uint256)', [airdrop2.toString(), 10n * AMOUNT]));
const r4 = await call(vm, airdrop2, encodeCall(C.airdrop, CLAIM, [p5.root, p5.nullifierHash, recipient, p5.a, p5.b, p5.c]), relayer);
ok(scope2 !== scope && !r4.ok && decodeRevert(r4.ret).startsWith('InvalidProof'), 'the same proof on a second deployment (other bound scope) → InvalidProof');
ok(zk.nullifier(identities[5].secret, scope) !== zk.nullifier(identities[5].secret, scope2), 'the member\'s nullifiers on the two deployments are unlinkable');

let threw = false;
try { zk.membershipInput({ secret: zk.createIdentity().secret, leaves, message: 1n, scope }); } catch { threw = true; }
ok(threw, 'a non-member cannot even build a witness');

// ── 5. the group grows; an older proof still works ──────────────────────────
console.log('5. two more members join AFTER member #5 proved; the old proof still verifies');
for (let i = 0; i < 2; i++) {
  const id = zk.createIdentity();
  const r = await call(vm, group, encodeCall(C.group, 'join(uint256)', [id.commitment]));
  leaves.push(eventsOf(r.rawLogs, 'MemberAdded(uint256,uint256,uint256)')[0].topics[2]);
}
ok((await view(group, C.group, 'root()')) !== p5.root, 'the group root changed');
const r5 = await call(vm, airdrop, claimData(p5, recipient), relayer);
ok(r5.ok, 'member #5\'s proof against the previous root is accepted (root history)');
ok((await view(token, C.token, 'balanceOf(address)', [recipient])) === 2n * AMOUNT, 'second payout received');

// ── 6. same identity, same circuit, another app: an anonymous vote ──────────
console.log('6. member #4 votes anonymously on a proposal (scope = proposal id)');
const vote = await deploy(vm, C.vote.evm.bytecode.object, [verifier.toString()]);
const proposalId = deriveScope(chainId, vote.toString(), 42n); // proposal ids bound the same way
const root = await view(group, C.group, 'root()');
const r6 = await call(vm, vote, encodeCall(C.vote, 'createProposal(uint256,uint256,uint8,uint64)', [proposalId, root, 2, 10n ** 12n]));
ok(r6.ok, 'proposal created with a snapshot of the current group root');
const pv = await zk.proveMembership({ secret: identities[4].secret, leaves, message: 1n, scope: proposalId });
const voteData = (option) => encodeCall(C.vote, VOTE, [proposalId, pv.nullifierHash, option, pv.a, pv.b, pv.c]);
const r7 = await call(vm, vote, voteData(0n), relayer);
ok(!r7.ok && decodeRevert(r7.ret).startsWith('InvalidProof'), 'relayer flipping the vote to "no" → InvalidProof');
const r8 = await call(vm, vote, voteData(1n), relayer);
ok(r8.ok, `vote "yes" tallied (${r8.gas} gas)`);
ok((await view(vote, C.vote, 'tally(uint256,uint256)', [proposalId, 1n])) === 1n, 'tally[yes] == 1');
ok(pv.nullifierHash !== p.nullifierHash, 'member #4\'s vote nullifier is unlinkable to their airdrop nullifier');

// ── 7. compliant pool: association set, relayer fee, ragequit ───────────────
console.log('7. compliant pool: 5 depositors, the ASP flags one, private withdrawal with a fee, ragequit');
const DENOM = 1000n * 10n ** 18n, FEE = 10n * 10n ** 18n;
const hasher1 = await deploy(vm, poseidonContract.createCode(1));
const cverifier = await deploy(vm, C.cverifier.evm.bytecode.object);
const asp = await deploy(vm, C.asp.evm.bytecode.object);            // the ASP's root registry
const n3 = (await vm.stateManager.getAccount(DEPLOYER)).nonce;
const poolAddr = createContractAddress(DEPLOYER, n3).toString();
const poolScope = deriveScope(chainId, poolAddr, 1n);
const cpool = await deploy(vm, C.cpool.evm.bytecode.object,
  [token.toString(), DENOM, 50n * 10n ** 18n, cverifier.toString(), hasher.toString(), hasher1.toString(), asp.toString(), poolScope]);
ok(cpool.toString() === poolAddr && (await view(cpool, C.cpool, 'isScopeBound(uint256)', [1n])) === 1n, 'pool deployed with a bound scope');

const notes = Array.from({ length: 5 }, () => ({ ...zk.createIdentity(), from: randomAddress() }));
const depositLog = [];
for (const n of notes) {
  await call(vm, token, encodeCall(C.token, 'transfer(address,uint256)', [n.from, DENOM]));
  await call(vm, token, encodeCall(C.token, 'approve(address,uint256)', [cpool.toString(), DENOM]), address(n.from));
  const r = await call(vm, cpool, encodeCall(C.cpool, 'deposit(uint256)', [n.commitment]), address(n.from));
  if (!r.ok) throw new Error('deposit failed: ' + decodeRevert(r.ret));
  for (const e of eventsOf(r.rawLogs, 'Deposit(uint256,uint256,address)')) depositLog.push({ commitment: e.topics[1], depositor: e.topics[2] });
}
const depositLeaves = depositLog.map((d) => d.commitment);
const poolTree = await view(cpool, C.cpool, 'tree()');
ok(zk.buildTree(depositLeaves).root === (await view(address('0x' + poolTree.toString(16).padStart(40, '0')), C.group, 'root()')),
  'deposit tree rebuilt from Deposit events == the pool tree root');

// the ASP reviews the Deposit log (who paid for what) and leaves out depositor #2
const FLAG = 2;
const flaggedFrom = BigInt(notes[FLAG].from);
const associationLeaves = depositLog.filter((d) => d.depositor !== flaggedFrom).map((d) => d.commitment);
const assocRoot = zk.buildTree(associationLeaves).root;
await call(vm, asp, encodeCall(C.asp, 'addRoot(uint256)', [assocRoot]));
ok(associationLeaves.length === 4, 'ASP published an association set of 4 (depositor #2 excluded)');

const to = randomAddress(), feeTo = randomAddress(), sender = randomAddress();
t = Date.now();
const cw = await zk.proveCompliantWithdraw({ secret: notes[0].secret, depositLeaves, associationLeaves, recipient: to, relayer: feeTo, fee: FEE, scope: poolScope });
console.log(`     compliant proof generated in ${((Date.now() - t) / 1000).toFixed(1)} s`);
const cwData = (p, recip, rel, fee) => encodeCall(C.cpool, CWITHDRAW, [p.root, p.associationRoot, p.nullifierHash, recip, rel, fee, p.a, p.b, p.c]);
const r9 = await call(vm, cpool, cwData(cw, sender, feeTo, FEE), address(sender));
ok(!r9.ok && decodeRevert(r9.ret).startsWith('InvalidProof'), 'submitter redirecting the payout to itself → InvalidProof');
const r10 = await call(vm, cpool, cwData(cw, to, feeTo, FEE), address(sender));
ok(r10.ok, `compliant withdrawal accepted (${r10.gas} gas)`);
const bal = (a) => view(token, C.token, 'balanceOf(address)', [a]);
ok((await bal(to)) === DENOM - FEE && (await bal(feeTo)) === FEE && (await bal(sender)) === 0n,
  'recipient got 990, the PROVEN relayer 10, the submitter 0');

let flaggedBlocked = false;
try { zk.compliantWithdrawInput({ secret: notes[FLAG].secret, depositLeaves, associationLeaves, recipient: to, relayer: feeTo, fee: FEE, scope: poolScope }); }
catch (e) { flaggedBlocked = /association set/.test(e.message); }
ok(flaggedBlocked, 'flagged depositor #2 cannot build a private-withdrawal witness');
const r11 = await call(vm, cpool, encodeCall(C.cpool, 'ragequit(uint256)', [notes[FLAG].secret]), address(randomAddress()));
ok(!r11.ok && decodeRevert(r11.ret).startsWith('NotDepositor'), 'someone else trying to ragequit #2\'s note → NotDepositor');
const r12 = await call(vm, cpool, encodeCall(C.cpool, 'ragequit(uint256)', [notes[FLAG].secret]), address(notes[FLAG].from));
ok(r12.ok && (await bal(notes[FLAG].from)) === DENOM, `#2 ragequits: full 1,000 back to the original address (${r12.gas} gas)`);

// ── 8. hidden amounts + encrypted notes: Alice pays Bob; Bob's wallet finds it by scanning ──
console.log('8. variable pool: deposit 100 → Alice pays Bob 70 privately → Bob finds it by scanning → withdraws 40 (+5 fee)');
const E18 = 10n ** 18n;
const txverifier = await deploy(vm, C.txverifier.evm.bytecode.object);
const vpool = await deploy(vm, C.vpool.evm.bytecode.object, [token.toString(), txverifier.toString(), hasher.toString()]);
const aliceEOA = randomAddress();
await call(vm, token, encodeCall(C.token, 'transfer(address,uint256)', [aliceEOA, 100n * E18]));
await call(vm, token, encodeCall(C.token, 'approve(address,uint256)', [vpool.toString(), 100n * E18]), address(aliceEOA));
const aliceAcct = zk.createAccount(), bobAcct = zk.createAccount(), eveAcct = zk.createAccount();
// Bob gives Alice ONLY his shielded address: { pubKey, encryptionKey }

// the chain, as any wallet sees it: NewCommitment(commitment, index, encryptedOutput) + NewNullifier
const chain = { commitments: [], nullifiers: new Set() };
const leavesOf = () => chain.commitments.map((c) => c.commitment);
const ENC_TOPIC = 'NewCommitment(uint256,uint256,bytes)';
function ingest(rawLogs) {
  for (const e of eventsOf(rawLogs, ENC_TOPIC)) {
    const d = e.data.slice(2);
    const index = Number(BigInt('0x' + d.slice(0, 64)));
    const len = Number(BigInt('0x' + d.slice(128, 192)));
    chain.commitments.push({ commitment: e.topics[1], index, encryptedOutput: '0x' + d.slice(192, 192 + 2 * len) });
  }
  for (const e of eventsOf(rawLogs, 'NewNullifier(uint256)')) chain.nullifiers.add(e.topics[1]);
}
// transact((Proof),(ExtData)) — ExtData has two `bytes`, so it is a DYNAMIC tuple: encode by hand
function encodeTransact(p, ext) {
  const id = C.vpool.evm.methodIdentifiers[TRANSACT];
  const w = (v) => BigInt.asUintN(256, BigInt(v)).toString(16).padStart(64, '0');
  const proofWords = [p.a, p.b, p.c, p.root, p.publicAmount, p.extDataHash, p.nullifiers, p.commitments].flat(Infinity).map(w).join('');
  const bytesTail = (hex) => { const h = hex.replace(/^0x/, ''); const n = h.length / 2; return w(n) + h.padEnd(Math.ceil(n / 32) * 64, '0'); };
  const t1 = bytesTail(ext.encryptedOutput1 ?? '0x'), t2 = bytesTail(ext.encryptedOutput2 ?? '0x');
  const extHead = [BigInt(ext.recipient ?? 0n), ext.extAmount ?? 0n, BigInt(ext.relayer ?? 0n), ext.fee ?? 0n].map(w).join('')
    + w(6 * 32) + w(6 * 32 + t1.length / 2);
  // args: (static Proof: 15 words inline), (dynamic ExtData: offset = everything before it)
  const headBytes = proofWords.length / 2 + 32;
  return '0x' + id + proofWords + w(headBytes) + extHead + t1 + t2;
}
async function transact(p, ext, from) {
  const r = await call(vm, vpool, encodeTransact(p, ext), address(from));
  if (r.ok) ingest(r.rawLogs);
  return r;
}

// tx1 — Alice deposits 100 as 60 + 40, both encrypted to herself
const dep = [{ note: zk.createNote(60n * E18, aliceAcct.pubKey), to: aliceAcct.address }, { note: zk.createNote(40n * E18, aliceAcct.pubKey), to: aliceAcct.address }];
const ext1 = { extAmount: 100n * E18, ...zk.encryptOutputs(dep) };
const t1 = await zk.proveTransaction({ leaves: leavesOf(), outputs: dep.map((o) => o.note), extData: ext1 });
const r13 = await transact(t1, ext1, aliceEOA);
ok(r13.ok, `deposit of 100 accepted, split 60/40 in hidden, encrypted notes (${r13.gas} gas)${r13.ok ? '' : ' → ' + decodeRevert(r13.ret)}`);
const vtree = address('0x' + (await view(vpool, C.vpool, 'tree()')).toString(16).padStart(40, '0'));
ok(zk.buildTree(leavesOf()).root === (await view(vtree, C.group, 'root()')), 'SDK tree from NewCommitment events == pool tree root');

// tx2 — Alice's wallet finds her notes by scanning, pays Bob 70 to his shielded address, keeps 30
const aliceNotes = zk.scan(aliceAcct, chain.commitments, chain.nullifiers);
ok(aliceNotes.balance === 100n * E18 && aliceNotes.notes.length === 2, "Alice's wallet scan: 2 notes, balance 100");
const pay = [{ note: zk.createNote(70n * E18, bobAcct.address.pubKey), to: bobAcct.address }, { note: zk.createNote(30n * E18, aliceAcct.pubKey), to: aliceAcct.address }];
const ext2 = { ...zk.encryptOutputs(pay) };
const t2 = await zk.proveTransaction({ leaves: leavesOf(), inputs: aliceNotes.notes.map(({ note }) => ({ note, privKey: aliceAcct.privKey })), outputs: pay.map((o) => o.note), extData: ext2 });
const relayerEOA = randomAddress();
const swapped = await call(vm, vpool, encodeTransact(t2, { ...ext2, encryptedOutput1: zk.encryptOutputs([{ note: pay[0].note, to: eveAcct.address }]).encryptedOutput1 }), address(relayerEOA));
ok(!swapped.ok && decodeRevert(swapped.ret).startsWith('InvalidExtData'), 'relayer re-encrypting Bob\'s note to someone else → InvalidExtData');
const r14 = await transact(t2, ext2, relayerEOA);
ok(r14.ok && t2.publicAmount === 0n, `private payment accepted, publicAmount 0 (${r14.gas} gas)`);

// Bob received NOTHING out of band: his wallet scans the chain
const bobView = zk.scan(bobAcct, chain.commitments, chain.nullifiers);
ok(bobView.balance === 70n * E18 && bobView.notes.length === 1, "Bob's wallet scan finds the payment: balance 70 (from events alone)");
ok(zk.scan(eveAcct, chain.commitments, chain.nullifiers).balance === 0n, 'Eve scans the same events: balance 0, learns nothing');
// a decoy: a ciphertext that decrypts for Bob but promises a note that was never committed
const decoy = { commitment: 12345n, index: 99, encryptedOutput: zk.encryptOutputs([{ note: zk.createNote(1_000_000n * E18, bobAcct.pubKey), to: bobAcct.address }]).encryptedOutput1 };
ok(zk.scan(bobAcct, [...chain.commitments, decoy], chain.nullifiers).balance === 70n * E18,
  'a decoy ciphertext promising Bob 1,000,000 is ignored: it does not match its commitment');
ok(zk.scan(aliceAcct, chain.commitments, chain.nullifiers).balance === 30n * E18, "Alice's wallet: spent notes dropped via NewNullifier, balance 30");

let why = '';
try { await zk.proveTransaction({ leaves: leavesOf(), inputs: [{ note: bobView.notes[0].note, privKey: aliceAcct.privKey }], outputs: [] }); } catch (e) { why = e.message; }
ok(/does not own/.test(why), "Alice cannot spend the note she sent Bob (it is his key's now)");

// tx3 — Bob withdraws 40 via a relayer (fee 5) and keeps 25, encrypted to himself
const payee = randomAddress();
const keep = [{ note: zk.createNote(25n * E18, bobAcct.pubKey), to: bobAcct.address }];
const ext3 = { recipient: payee, extAmount: -40n * E18, relayer: relayerEOA, fee: 5n * E18, ...zk.encryptOutputs(keep) };
const t3 = await zk.proveTransaction({ leaves: leavesOf(), inputs: [{ note: bobView.notes[0].note, privKey: bobAcct.privKey }], outputs: keep.map((o) => o.note), extData: ext3 });
const r15 = await transact(t3, { ...ext3, recipient: randomAddress() }, relayerEOA);
ok(!r15.ok && decodeRevert(r15.ret).startsWith('InvalidExtData'), 'relayer swapping the recipient → InvalidExtData');
const r16 = await transact(t3, ext3, relayerEOA);
ok(r16.ok, `withdrawal accepted (${r16.gas} gas)`);
ok((await bal(payee)) === 40n * E18 && (await bal(relayerEOA)) === 5n * E18, 'payee received 40, relayer 5');
const finalA = zk.scan(aliceAcct, chain.commitments, chain.nullifiers).balance, finalB = zk.scan(bobAcct, chain.commitments, chain.nullifiers).balance;
ok(finalA === 30n * E18 && finalB === 25n * E18 && (await bal(vpool.toString())) === finalA + finalB,
  'wallet balances from events: Alice 30, Bob 25 — exactly what the pool holds (55)');
const r17 = await transact(t3, ext3, relayerEOA);
ok(!r17.ok && decodeRevert(r17.ret).startsWith('NullifierUsed'), 'replaying the withdrawal → NullifierUsed');

console.log(`\n${failed ? `${failed} check(s) FAILED` : 'e2e: all checks passed'}`);
process.exit(failed ? 1 : 0); // snarkjs keeps worker threads alive; exit explicitly
