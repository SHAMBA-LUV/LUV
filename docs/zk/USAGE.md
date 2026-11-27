# USAGE: run it, change it, build on it

How to run everything in `docs/zk/`, adapt it to your own circuit, and what to do before
anything goes near mainnet. For specifications see [TECHNICAL.md](TECHNICAL.md). For the theory
see [../ZERO_KNOWLEDGE_PROOFS.md](../ZERO_KNOWLEDGE_PROOFS.md).

---

## 1. Requirements

| need | for | install |
|---|---|---|
| Node ≥ 18 (tested on 22) | everything | <https://nodejs.org> |
| npm packages (pinned in `package-lock.json`) | circuits, proofs, Solidity tests | `npm install` (or `npm ci`) in `docs/zk` |
| Foundry *(optional)* | `forge test` instead of / as well as the Node EVM | <https://github.com/foundry-rs/foundry> |
| native circom *(optional)* | faster compiles; `build.sh` uses it if it is on `PATH` | <https://docs.circom.io/getting-started/installation/> |

No Rust, Docker or Foundry is required: circom runs as WASM (`circom2`), Solidity compiles with
solc-js, and contracts execute on ethereumjs.

---

## 2. Quick start

```bash
cd docs/zk
node js/run-all.mjs      # 1. the 8 protocol examples: zero dependencies, ~16 s
npm install              # 2. toolchain
npm test                 # 3. examples + 74 Solidity tests on a real EVM + 200 mutation checks (~25 s)
```

Expected tail of `npm test`:

```
gas report (measured with gasleft() around the call):
  gas: Groth16 verifyProof: 198346
  gas: PLONK verifyProof: 270744
  gas: FFLONK verifyProof: 192936
  …
74 passed, 0 failed
  ✓ CubeProof                groth16 original verifies: yes · 11/11 mutants rejected
  …
mutation: 10/10 fixtures clean (200 verifier calls)
```

### All commands

| command | what it does | time |
|---|---|---|
| `npm run examples` | `js/run-all.mjs`: Schnorr, simulator, extractor, Fiat–Shamir, Pedersen, DLEQ, R1CS→QAP, BN254 Schnorr | ~16 s |
| `npm run test:evm` | compile `foundry/` with solc 0.8.24 and run every `test_*` on ethereumjs, plus JS↔Solidity interop | ~10 s |
| `npm run mutation` | mutation-test every committed proof: each proof word, each public signal, each non-canonical alias, un-swapped G2 | ~7 s |
| `npm test` | examples + `test:evm` + `mutation` | ~30 s |
| `npm run build` | compile all circuits; run the setup for new or changed ones (unchanged circuits keep their keys); regenerate proofs and fixtures; run the attack and the must-fail checks. `FORCE=1 npm run build` redoes every ceremony | ~1 min incremental, ~8 min from scratch |
| `npm run e2e` | the **live** flow: deploy, join, generate fresh proofs with the SDK, claim, attack, vote, then a compliant pool with an ASP, a relayer fee and a ragequit (28 checks). Needs `npm run build` first | ~11 s |
| `npm run scaling` | constraint counts for membership and compliant withdrawal at depths 10–32 (compile only) | ~12 s |
| `npm run gas` | run the tests and regenerate [GAS.md](GAS.md) from the measurements | ~10 s |
| `npm run package` | build `complete zk.zip` from git-tracked files, unpack it in a temp dir and run the tests there | ~30 s |
| `cd foundry && forge test -vv` | the same Solidity tests under Foundry (prints the gas logs too) | — |
| `node js/0N-*.mjs` | run one example | seconds |

---

## 3. Recipes

### 3.1 Run one thing

```bash
node js/04-fiat-shamir.mjs                          # watch the Frozen Heart forgery
node evm/run-tests.mjs 2>&1 | grep -A9 ShieldedPool  # one suite's results
```

### 3.2 Change a circuit, then rebuild

Verifiers and fixtures **must come from the same build run**: a proof only verifies against
the verifier from its own ceremony. After editing any `.circom` file:

```bash
npm run build && npm run test:evm
```

`build.sh` is incremental. It reuses `circom/build/pot14_final.ptau`, and it skips phase 2 for
any circuit whose `.r1cs` is unchanged (comments and `<--` hints don't change it; constraints
do). Use `FORCE=1 npm run build` to redo every phase 2, or delete `circom/build/` to redo
phase 1 as well. Afterwards run `npm run gas` so GAS.md matches.

### 3.3 Add your own circuit (end to end)

Example: a new circuit `mycircuit.circom` with 3 public signals.

1. **Write the circuit** in `circom/mycircuit.circom`. Constrain everything (`<==`, `===`).
   Bind any value the contract relies on as a public signal. Remember that public-signal order
   is outputs first, then public inputs in declaration order.
2. **Produce an input.** Add `write('my', {...})` to `make-inputs.mjs`, or drop
   `circom/build/my.input.json` in place.
3. **Wire it into `build.sh`:**
   ```bash
   setup mycircuit MyVerifier          # compile + phase 2 + verifier → src/verifiers/MyVerifier.sol
   prove mycircuit my MyProof          # proof → test/fixtures/MyProof.sol
   ```
   If the circuit has more than 16,384 constraints, raise the ptau power (`bn128 14` → `15`, and
   so on) and delete `circom/build/pot14*`.
4. **Write the consumer** in `foundry/src/MyApp.sol`. Declare the verifier interface with
   `uint256[3] calldata pubSignals`. **Build the public-signal array inside the contract**
   from its own state. Check nullifiers and roots before verifying, and mark them before any
   external call.
5. **Test** in `foundry/test/MyApp.t.sol`, extending `ZkTest`. Use `MyProof.get()`, an `Actor`
   per caller, and `expectRevert(actor, target, data, Error.selector)` for every negative case:
   tampered signal, wrong beneficiary, double use, unknown root.
6. `npm run build && npm test`.

### 3.4 Generate a proof for your own input (no rebuild)

```bash
cd circom
SJ="node ../node_modules/snarkjs/build/cli.cjs"
echo '{"x":"3"}' > build/mine.input.json
$SJ groth16 fullprove build/mine.input.json build/cube_js/cube.wasm build/cube_final.zkey build/mine.proof.json build/mine.public.json
$SJ groth16 verify build/cube_vkey.json build/mine.public.json build/mine.proof.json
$SJ zkey export soliditycalldata build/mine.public.json build/mine.proof.json   # paste into a tx
```

This needs the `build/` artefacts from a local `npm run build`. They are not committed.

### 3.5 Membership apps: create members, claim, vote, withdraw

Off-chain, each user, with the SDK in `js/sdk/zk-client.mjs` (`evm/e2e.mjs` is the full worked
example):

```js
import { ZkClient, deriveScope } from './js/sdk/zk-client.mjs';
const zk = await ZkClient.create();
const me = zk.createIdentity();          // publish me.commitment; keep me.secret private

// later: leaves = commitments from MemberAdded / Deposit events, in order
const scope = deriveScope(chainId, appAddress, round);          // same value as ScopeLib on-chain
const p = await zk.proveMembership({ secret: me.secret, leaves, message: BigInt(recipient), scope });
// p.root, p.nullifierHash, p.a, p.b, p.c  → the contract call below
```

On-chain:

| goal | call |
|---|---|
| admit a member (registrar) | `ZkGroup.join(commitment)` |
| airdrop claim | `ZkAirdrop.claim(root, nullifierHash, recipient, a, b, c)` with input `message = recipient`, `scope = round` |
| shielded deposit / withdraw | `ShieldedPool.deposit(commitment)` (approve first) · `withdraw(root, nullifierHash, recipient, a, b, c)` |
| compliant withdraw | `zk.proveCompliantWithdraw({ secret, depositLeaves, associationLeaves, recipient, relayer, fee, scope })` → `CompliantPool.withdraw(p.root, p.associationRoot, p.nullifierHash, recipient, relayer, fee, p.a, p.b, p.c)`. `depositLeaves` come from `Deposit` events, `associationLeaves` from the ASP |
| left out by the ASP | the SDK throws *"not in the association set — use ragequit"*. Call `CompliantPool.ragequit(secret)` **from the original deposit address**: the full amount returns there, publicly |
| vote | `ZkVote.vote(id, nullifierHash, option, a, b, c)` with `message = option`, `scope = id` |

The prover needs the Merkle path: rebuild the tree from the `MemberAdded` / `Deposit` events in
order (as `make-inputs.mjs` does), then pass `pathElements` / `pathIndices` for the user's leaf.
**Relayers:** any address can submit a claim, withdrawal or vote. Funds only ever go to the
proven `recipient`.

### 3.6 Register a key (no circuit, no setup)

```js
import { prove } from './js/08-schnorr-bn254.mjs';
const { X, R, s } = prove({ chainId: 1n, registry: '0x…KeyRegistry', account: '0x…you' }, secretScalar);
// KeyRegistry.register(X, R, s), sent FROM `account`: the challenge commits to msg.sender
```

### 3.7 Issue and use a credential

The issuer, off-chain, signs `Poseidon(attribute, subjectAddress)` with
`eddsa.signPoseidon(prvKey, msg)` (circomlibjs) and gives the holder the signature. The holder
proves with `credential.circom` and calls `CredentialGate.prove(subject, a, b, c)`. To use your
own issuer, deploy `CredentialGate` with that issuer's Baby Jubjub public key (`eddsa.prv2pub`).

---

## 4. Integrating with LUV

| LUV piece | ZK counterpart | how they fit |
|---|---|---|
| `contracts/ShambaLuvAirdrop.sol` (EIP-712 voucher per identity) | `ZkGroup` + `ZkAirdrop` | the `/auth` backend checks a social login **once** and calls `ZkGroup.join(commitment)` as registrar. Claims are then anonymous and relayable, and the backend never learns which wallet a member claims to |
| LUV token fee model | `ZkAirdrop` / `ShieldedPool` | make the ZK contract **fee-exempt** on LUV (`setFeeExemption`), like any other infra contract, so payouts are exact |
| multichain doctrine | `scope` | derive the scope from `chainid` + contract address + round, so one membership can't claim once per chain |
| treasury / DAIO governance | `ZkVote` | anonymous member polls. Use MACI-style designs where bribery resistance matters |

---

## 5. Before mainnet: checklist

- [ ] **Real ceremony.** Start from a public multi-party powers of tau (e.g. Perpetual Powers
      of Tau), run a phase 2 with independent contributors, publish the transcript, and
      `snarkjs zkey verify` it. **Delete every verifier in `foundry/src/verifiers/`** and
      regenerate.
- [ ] **Circuit audit.** Run circomspect and Picus, and get human review for under-constrained
      signals (see the guide §12.1). Check every public input is bound.
- [ ] **Contract audit.** Check the statement is built in-contract, the CEI order, nullifiers,
      root history and access control.
- [ ] **Scope binding.** Deploy with `scope = ScopeLib.derive(chainid, address(this), round)`
      (predict the address from the deployer nonce or use CREATE2, as `evm/e2e.mjs` does), and
      assert `isScopeBound(round)` after deployment.
- [ ] **Tree depth** big enough for your population (depth 20 = 1M members). `npm run scaling`
      gives the constraint counts and the ptau power you'll need. Re-measure gas.
- [ ] **Mutation-test** the production verifiers (`npm run mutation`, after regenerating fixtures).
- [ ] **Exit guarantee.** Any gate on private exit (an ASP) comes with a public exit (ragequit).
- [ ] **Hasher.** Deploy `PoseidonT3` once and share it. Re-check the test vector on the
      target chain.
- [ ] **Admission policy** for `ZkGroup` (registrar vs open) and its Sybil story.
- [ ] **Compliance and legal review** for anything that moves value privately (`ShieldedPool`).
- [ ] **Licences.** The generated verifiers and Poseidon bytecode are GPL-3.0.
- [ ] **Deploy with Foundry** (`forge script … --broadcast --verify`) to a testnet first, and
      replay the `foundry/test` scenarios against the deployment.

---

## 6. Troubleshooting

| symptom | cause and fix |
|---|---|
| `run 'npm install' in docs/zk first` | `build.sh` can't find `node_modules/circomlib`. Run `npm install` in `docs/zk` |
| `error[P1014]: The file circomlib/... to be included has not been found` | WASM circom only reads under the current directory's ancestors. `build.sh` copies circomlib into `circom/build/lib`, so run it via `npm run build`, not from elsewhere |
| `Invalid File format` on `groth16 setup` | the circuit has more constraints than the ptau supports. Raise the power and delete `circom/build/pot14*` |
| `Assert Failed. Error in template …` during `fullprove` | your input violates a constraint, which is correct behaviour. Example: the minor's credential, by design |
| `npm run e2e` says artefacts are missing | the zkey and WASM are not committed. Run `npm run build` once |
| `npm run e2e` claim fails with `InvalidProof` | the local zkey and the committed `MembershipVerifier.sol` come from different builds. Run `FORCE=1 npm run build` |
| a fixture suddenly fails `verifyProof` | verifier and fixture come from different build runs. Run `npm run build` again (it regenerates both) |
| a proof verifies off-chain but not in Solidity | public-signal order (outputs first), or a missing G2 swap. Use `gen-fixture.mjs` / `soliditycalldata` |
| a tampered proof costs a huge amount of gas | a failing BN254 precompile consumes all forwarded gas, which is expected. Relayers should `eth_call` first |
| `NotDepositor` on ragequit | send it from the address that made the deposit. Ragequit never pays anyone else |
| `UnknownRoot` after many joins | root history is 32. Rebuild the path against a recent root |
| `forge test` can't find `forge-std` | it doesn't need it. Run from `docs/zk/foundry` (its own `foundry.toml`, `libs = []`) |
