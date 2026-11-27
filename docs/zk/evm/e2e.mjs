// e2e.mjs — the whole flow LIVE: nothing here is a prebuilt fixture.
//
//   deploy Poseidon + ZkGroup + verifier + token + ZkAirdrop (scope BOUND to chain + address)
//   → random identities join on-chain → the client SDK rebuilds the tree from MemberAdded
//   events → generates fresh Groth16 proofs with snarkjs → relayed claims and a vote succeed;
//   replays, redirects and cross-deployment reuse fail.
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
if (!existsSync(files.zkey) || !existsSync(files.wasm)) {
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
};
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

console.log(`\n${failed ? `${failed} check(s) FAILED` : 'e2e: all checks passed'}`);
process.exit(failed ? 1 : 0); // snarkjs keeps worker threads alive; exit explicitly
