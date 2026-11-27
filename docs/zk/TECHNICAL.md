# TECHNICAL: architecture, specifications and internals

This is the engineering reference for `docs/zk/`. For *how to run and adapt it*, see
[USAGE.md](USAGE.md). For *why ZK works* (theory, attacks, design rationale), see
[../ZERO_KNOWLEDGE_PROOFS.md](../ZERO_KNOWLEDGE_PROOFS.md).

Every number below comes from `npm run build`, `npm run test:evm` and `npm run e2e` on this code, using
solc 0.8.24 (optimizer, 200 runs), circom 2.2.3 (WASM build `circom2` 0.2.23), snarkjs 0.7.6
and @ethereumjs/vm 10.1.3, pinned in `package-lock.json`.

---

## 1. Architecture

```
               off-chain (Node)                                   on-chain (EVM)
 ┌──────────────────────────────────────────┐        ┌───────────────────────────────────────────┐
 │ circom/*.circom ──circom──▶ R1CS + WASM  │        │ verifiers/*Verifier.sol  (snarkjs-generated)│
 │        │                                 │        │        ▲ verifyProof(a,b,c,pub) → bool     │
 │        ▼  snarkjs (ptau 2^14 + phase 2)  │        │        │                                    │
 │   *.zkey ──▶ proofs ──gen-fixture*.mjs──▶│──────▶ │ test/fixtures/*.sol (proofs as constants)  │
 │   make-inputs.mjs: Poseidon tree, EdDSA  │        │                                            │
 │   credentials, witnesses, ZkConstants.sol│        │ apps: ZkAirdrop · ZkVote · ShieldedPool    │
 │   gen-poseidon.mjs ──▶ PoseidonT3.sol    │──────▶ │  CompliantPool · CredentialGate · AgeGate⚠ │
 │                                          │        │ roots: ZkGroup (on-chain tree) · OwnerRoots│
 │ js/*.mjs: Σ-protocols (no setup)         │──────▶ │ KeyRegistry + BN254 (Schnorr, precompiles) │
 └──────────────────────────────────────────┘        └───────────────────────────────────────────┘
   evm/run-tests.mjs: solc-js compile → ethereumjs → run every test_* (forge model, fixtures)
   evm/e2e.mjs + js/sdk/zk-client.mjs: deploy → join → FRESH proofs at runtime → claim / vote
```

**Two families of proofs:**

| family | where | setup | used by |
|---|---|---|---|
| Σ-protocols (Schnorr, Pedersen, Chaum–Pedersen) + Fiat–Shamir | `js/01–06`, `js/08`, `KeyRegistry.sol` | none | key ownership, equality of logs, balance proofs |
| zk-SNARKs over R1CS (Groth16; PLONK/FFLONK for comparison) | `circom/`, `foundry/src/verifiers/` | universal ptau (+ per-circuit phase 2 for Groth16) | membership, credentials, arbitrary computation |

Everything is over the **BN254** (alt_bn128) curve and its scalar field
`r = 21888242871839275222246405745257275088548364400416034343698204186575808495617`, except
`js/01–06`, which use secp256k1 to match Ethereum keys.

---

## 2. Circuits

| circuit | constraints | public signals (exact order in `public.json` and `verifyProof`) | private inputs |
|---|---|---|---|
| `cube.circom` | 2 | `[out]` | `x` |
| `membership.circom` (depth 10) | 6,143 | `[root, nullifierHash, message, scope]` | `secret, pathElements[10], pathIndices[10]` |
| `compliant_withdraw.circom` (depth 10) | 11,355 | `[depositRoot, associationRoot, nullifierHash, recipient, relayer, fee, scope]` | `secret`, two Merkle paths (`deposit…`, `association…`) |
| `credential.circom` | 8,635 | `[issuerAx, issuerAy, currentYear, minAge, subject]` | `birthYear, sigR8x, sigR8y, sigS` |
| ⚠ `age_buggy.circom` | 3 | `[isAdult, currentYear, minAge, subject]` (outputs come first) | `birthYear` |
| ⚠ `attack/age_forger.circom` | 3 (**byte-identical R1CS**) | same as `age_buggy` | same |

**Ordering rule (snarkjs):** outputs first, then public inputs in *declaration* order (not the
order listed in `{public [...]}`).

### 2.1 `membership.circom`

```
commitment    = Poseidon(secret)                     (Poseidon(1))
root          = MerkleRoot(commitment, path)         (10 × Poseidon(2), branch-free swap)
nullifierHash = Poseidon(secret, scope)              (Poseidon(2))
message²      constrained                            (binds message)
pathIndices[i] ∈ {0,1}                               (bit constraint per level)
```

Swap per level: `d = s·(sibling − node); left = node + d; right = sibling − d` (1 constraint).
Empty leaves are `0`, and an empty subtree of height *i+1* is `Poseidon(z_i, z_i)` with
`z_0 = 0`. That is exactly what `ZkGroup` reproduces on-chain.

`MerkleRoot(depth)` lives in `circom/lib/merkle.circom` and is shared with
`compliant_withdraw.circom`. Moving it there left `membership.r1cs` byte-identical.

| app | `message` | `scope` |
|---|---|---|
| `ZkAirdrop` | `uint160(recipient)` | round id (immutable; production: `boundScope(round)`) |
| `ShieldedPool` | `uint160(recipient)` | pool id (immutable) |
| `ZkVote` | option index | proposal id |

### 2.2 `compliant_withdraw.circom`

```
commitment      = Poseidon(secret)
depositRoot     = MerkleRoot(commitment, depositPath)          the pool's on-chain tree
associationRoot = MerkleRoot(commitment, associationPath)      the ASP's vetted subset (other index)
nullifierHash   = Poseidon(secret, scope)
recipient², relayer², fee² constrained                         binds the payout terms
```

Fixture: 8 deposits (the 8 members); the association set is all but member #3 (flagged), in
deposit order; member #5 withdraws to `0xB0B`, relayer `0xFEE1`, fee `10e18`, scope 1.
`build.sh` asserts that proving for #3 fails.

### 2.3 `credential.circom`

```
M = Poseidon(birthYear, subject)
EdDSAPoseidonVerifier(enabled=1, Ax, Ay, R8x, R8y, S, M)     (Baby Jubjub, circomlib)
age = currentYear − birthYear;  Num2Bits(8)(age);  Num2Bits(8)(minAge)
GreaterEqThan(8)(age, minAge).out === 1
```

Issuer signatures come from circomlibjs `eddsa.signPoseidon(prv, Poseidon(birthYear, subject))`.
The demo issuer key is `sha256("LUV-ZK-GUIDE/issuer")`, a **published test key**.

### 2.4 The under-constrained pair

`age_buggy` computes `isAdult <-- (age >= minAge) ? 1 : 0` and constrains only
`isAdult·(isAdult−1) = 0`. `age_forger` uses `isAdult <-- 1`. `build.sh` asserts
`cmp age_buggy.r1cs age_forger.r1cs` (identical), then proves with the forger's WASM and the
honest zkey. The proof verifies.

---

## 3. Trusted setup and artefacts

| stage | command | output | notes |
|---|---|---|---|
| phase 1 | `powersoftau new bn128 14` → `contribute` → `prepare phase2` | `build/pot14_final.ptau` | universal, up to 16,384 constraints; **dev, single contributor** |
| phase 2 (Groth16) | `groth16 setup` → `zkey contribute` → `zkey verify` | `build/<c>_final.zkey` | per circuit |
| PLONK / FFLONK | `plonk setup` / `fflonk setup` | `build/cube_<sys>.zkey` | ptau only, no phase 2 |
| verifier | `zkey export solidityverifier` | `foundry/src/verifiers/*.sol` | renamed by `build.sh`, stamped DO-NOT-DEPLOY |
| fixture | `gen-fixture.mjs` / `gen-fixture-calldata.mjs` | `foundry/test/fixtures/*.sol` | proofs as Solidity constants |

**Incremental builds.** `setup` stores a checksum of each `.r1cs`. If the constraint system is
unchanged and the zkey and verifier exist, phase 2 is skipped and the committed verifier stays
byte-identical (`FORCE=1` redoes everything). Proofs are re-generated every run (Groth16 proofs
are randomised), so fixtures change but still verify.

`build/` is git-ignored. Verifiers and fixtures are committed, and they belong together: a
fixture only verifies against the verifier from the same build run. Regenerate both or
neither.

**Fixture formats:**

- **Groth16:** `get() → (uint256[2] a, uint256[2][2] b, uint256[2] c, uint256[N] pub)`. `b` has each
  Fp2 pair swapped (`[x.c1, x.c0]`), the order EIP-197 expects.
- **PLONK:** `get() → (uint256[24] proof, uint256[N] pub)`. **FFLONK:** `(bytes32[24] proof, uint256[N] pub)`.
- `ZkConstants.sol`: `GROUP_ROOT`, `ASSOCIATION_ROOT`, `ISSUER_AX/AY`, `CURRENT_YEAR`, `MIN_AGE`, `members()`
  (8 identity commitments in join order).

---

## 4. Contracts: API reference

All contracts use custom errors, no external dependencies, and solc ^0.8.24.

### Root sources: `IRootSource { isKnownRoot(uint256) view returns (bool) }`

| contract | API | errors |
|---|---|---|
| `OwnerRoots` | `addRoot(root)`, `revokeRoot(root)` (owner), `isKnownRoot(root)` | `NotOwner` |
| `ZkGroup` | `constructor(IPoseidonT3 hasher, address registrar)` (`0` = open) · `join(commitment) → index` · `root()` · `isKnownRoot(r)` (current + 31 previous) · `nextIndex()` · `isMember(c)` · `DEPTH = 10` · `ROOT_HISTORY_SIZE = 32` | `NotRegistrar`, `GroupFull`, `BadCommitment` (0 or ≥ r), `AlreadyMember` |

### Applications

| contract | constructor | entry point | checks, in order | errors |
|---|---|---|---|---|
| `ZkAirdrop` | `(token, IMembershipVerifier, IRootSource, scope, amount)` | `claim(root, nullifierHash, recipient, a, b, c)` · views `boundScope(round)`, `isScopeBound(round)` | recipient ≠ 0 → known root → unused nullifier → proof over `[root, nullifier, recipient, scope]` → mark → transfer | `ZeroAddress`, `UnknownRoot`, `NullifierUsed`, `InvalidProof`, `TransferFailed` |
| `ShieldedPool` | `(token, denomination, IMembershipVerifier, IPoseidonT3, scope)`, which deploys its own `ZkGroup` | `deposit(commitment)` · `withdraw(root, nullifierHash, recipient, a, b, c)` | deposit: `transferFrom` → `tree.join`. Withdraw: as `ZkAirdrop` | as above |
| `CompliantPool` | `(token, denomination, maxFee, ICompliantWithdrawVerifier, IPoseidonT3, IRootSource associations, scope)`; deploys its own `ZkGroup`; reverts if `maxFee > denomination` | `deposit(commitment)` · `withdraw(root, associationRoot, nullifierHash, recipient, relayer, fee, a, b, c)` | recipient ≠ 0 → fee ≤ maxFee → known deposit root → accepted association root → unused nullifier → proof over the 7 signals → mark → pay recipient `denomination − fee` → pay relayer `fee` | `ZeroAddress`, `FeeTooHigh`, `UnknownRoot`, `UnknownAssociationRoot`, `NullifierUsed`, `InvalidProof`, `TransferFailed` |
| `ZkVote` | `(IMembershipVerifier)` | `createProposal(id, groupRoot, options, deadline)` (owner) · `vote(id, nullifierHash, option, a, b, c)` | exists → open → option < options → unused → proof over `[groupRoot, nullifier, option, id]` | `NotOwner`, `ProposalExists`, `BadProposal`, `UnknownProposal`, `VotingClosed`, `BadOption`, `NullifierUsed`, `InvalidProof` |
| `CredentialGate` | `(ICredentialVerifier, issuerAx, issuerAy, currentYear, minAge)` | `prove(subject, a, b, c)` | proof over `[Ax, Ay, year, minAge, subject]` | `InvalidProof` |
| `KeyRegistry` | none | `register(X, R, s)` · `challenge(account, X, R)` · `keyOf(account)` · `ownerOfKey(keccak(X))` | X, R on curve and not ∞ → s < N → account unregistered → key unclaimed → `s·G == R + c·X` | `NotOnCurve`, `ScalarOutOfRange`, `AlreadyRegistered`, `KeyTaken`, `InvalidProof` |
| `CubeGate` | `(IGroth16Verifier)` | `enter(a, b, c, pub)` | `pub[0] == 35` → proof | `WrongStatement`, `InvalidProof` (⚠ replayable by design) |
| ⚠ `AgeGate` | `(IAgeVerifier, currentYear, minAge)` | `prove(subject, a, b, c)` | proof over `[1, year, minAge, subject]` | `InvalidProof` (⚠ circuit is broken) |

**Design invariants** that every app follows:

1. The contract **builds the public-signal array itself** from its own state (scope, root,
   policy). It never accepts it from the caller.
2. **Checks → verify → effects → interaction.** The nullifier is marked before any token
   transfer.
3. Beneficiaries and payout terms are **public signals** (`recipient`, `relayer`, `fee`, `subject`, `option`) or are hashed into
   the challenge (`msg.sender` in `KeyRegistry`), so proofs can't be redirected.
4. The nullifier is a public signal, never `hash(proof)`, because Groth16 proofs are malleable.

### Libraries and generated code

- **`ScopeLib`**: `derive(chainId, app, round) = uint256(keccak256(abi.encode(chainId, app, round))) mod r`.
  Off-chain twin: `deriveScope` in `js/sdk/zk-client.mjs`. Checked equal on a live deployment
  by `evm/e2e.mjs`.
- **`BN254`**: `add` (0x06), `mul` (0x07), `eq`, `isInfinity`, `isOnCurve`, constants `P`, `N`.
  The precompiles encode ∞ as `(0, 0)`.
- **`generated/PoseidonT3.sol`**: `IPoseidonT3.poseidon(uint256[2])` and
  `PoseidonT3Deployer.deploy()` (circomlibjs creation bytecode, 9,755 bytes). Test vector:
  `Poseidon(1,2) = 0x115cc0f5e7d690413df64c6b9662e9cf2a3617f2743245519e19607a4417189a`.
- **KeyRegistry challenge:** `sha256(abi.encodePacked(bytes32 DOMAIN, chainid, address(this), account, X.x, X.y, R.x, R.y)) mod N`,
  with `DOMAIN = "LUV-ZK-GUIDE/KeyRegistry/v1"`. `js/08-schnorr-bn254.mjs` reproduces it
  byte for byte.

---

## 5. Gas (measured)

The authoritative, always-current table is [GAS.md](GAS.md), **generated** by `npm run gas`.
The summary below adds context. Figures are measured with `gasleft()` around the call
(`log_named_uint`) or as the whole test-transaction `executionGasUsed`, as noted.

| operation | gas | how measured |
|---|---|---|
| Groth16 `verifyProof`, 1 public input (cube) | **198,346** | `gasleft()` |
| PLONK `verifyProof` (cube) | **271,686** (varies ~1k with the proof) | `gasleft()` |
| FFLONK `verifyProof` (cube) | **192,936** | `gasleft()` |
| Groth16 `verifyProof`, 5 public inputs (credential) | **225,278** | `gasleft()` |
| `ZkAirdrop.claim` (proof + checks + ERC-20 transfer) | ≈ 280,000 | test tx |
| `ZkVote.vote` | ≈ 275,000 | test tx |
| `ShieldedPool.withdraw` via relayer | **275,788** | `gasleft()` |
| `CompliantPool.withdraw` (7 public inputs, two transfers) | **322,219** | `gasleft()` |
| `ShieldedPool.deposit` (transferFrom + 10-level insert) | **389,173** | `gasleft()` |
| live `ZkAirdrop.claim` with a fresh proof, bound scope | ≈ 270,000 | e2e tx |
| `ZkGroup.join` (10 Poseidon hashes + storage) | **379,655** | `gasleft()` |
| `KeyRegistry.register` from an EOA | **93,450** | tx `executionGasUsed` |
| tampered proof point (precompile failure) | **all forwarded gas** (~969M in a 1G-gas test) | test tx |

Cost model: Groth16 ≈ 181k (one pairing call with 4 pairs, EIP-1108) + ~6.15k per public input
(ecMul + ecAdd) + calldata. A Poseidon(2) call to the generated contract costs roughly 30k gas,
which dominates `join`.

---

## 6. Test harness: `evm/run-tests.mjs`

Shared helpers live in `evm/lib.mjs`: `compile()`, `freshVM()`, `deploy()`, `call()`,
`encodeCall()` (static ABI types as 32-byte words), `eventsOf()` and selector hashing.

1. **Compile.** All of `foundry/src` and `foundry/test` go through solc-js standard JSON
   (optimizer 200, default EVM version), with source keys relative to `foundry/`.
2. **Discover.** Every contract with `test*` methods (from `evm.methodIdentifiers`).
3. **Execute, forge model.** For each test: a fresh `createVM({ allowUnlimitedContractSize })`
   on Mainnet `Common` (chainid 1), deploy from `0xdede…`, call `setUp()`, then the test. A
   revert is a failure. Custom-error selectors are decoded from the ABI.
4. **Logs.** `log_named_uint(string,uint256)` events are decoded and printed, then collected
   into a gas report.
5. **Interop.** Deploy `KeyRegistry`, produce a proof with `js/08` bound to an EOA, and check
   that a front-runner's replay fails and the owner's registration succeeds.

**Expected compiler warnings** (all harmless):
- `ProofSystemsTest` exceeds the EIP-170 24,576-byte limit (24,957 B). It is a test contract
  and is never deployed; forge and the runner both lift the limit for tests. Every deployable
  contract fits. The largest is `CubeFflonkVerifier` at 13,658 B.
- "Unused function parameter" in the snarkjs-generated PLONK and FFLONK verifiers.

### 6.1 Live flow: `evm/e2e.mjs` + `js/sdk/zk-client.mjs`

Nothing is a fixture. The script deploys Poseidon (circomlibjs bytecode), `ZkGroup`,
`MembershipVerifier`, a token and `ZkAirdrop` at a **predicted** address
(`createContractAddress(deployer, nonce)`) with `scope = deriveScope(chainId, address, round)`.
Then: 6 random identities join → the SDK rebuilds the tree from `MemberAdded` topics →
`snarkjs.groth16.fullProve` at runtime → relayed claim. It checks 19 properties, including
replay, redirect, cross-deployment reuse (a second deployment has another bound scope), root
history after later joins, and an anonymous vote with a flipped-option attempt. It needs
`circom/build/membership_final.zkey` and `.wasm` from the **same build** as the committed
`MembershipVerifier.sol`, and exits 2 with a hint if they are missing.

SDK surface: `ZkClient.create()`, `createIdentity()`, `hash()`, `nullifier()`, `buildTree()`,
`membershipInput()`, `proveMembership()`, `verify()`, plus `deriveScope()`, `toSolidity()`,
`artifacts()`.

The tests use **no cheatcodes**. `Actor` contracts provide distinct `msg.sender`s,
`expectRevert` does a low-level call plus a selector match, and `mustSucceed` bubbles up the
real revert data. So the same files run under `forge test`. Exit code: non-zero on any
failure.

---

## 7. Security model and known limitations

| item | status |
|---|---|
| Verifiers / zkeys | **dev ceremony, single contributor.** Forgeable by whoever held the entropy. Never deploy |
| `AgeGate`, `age_buggy.circom` | intentionally vulnerable (the §12.1 demonstration) |
| `CubeGate` | intentionally replayable (proof not bound to the caller) |
| `OwnerRoots` | operator is trusted not to add fake members. `ZkGroup` removes that trust |
| `ZkGroup` open mode | Sybil-prone. Use a registrar or a gated `join` |
| `scope` values | fixed constants in the fixture tests (same proofs under any deployer). `ScopeLib` + `ZkAirdrop.boundScope` give the bound form, exercised live by `e2e.mjs`. The pools and `ZkVote` take the scope as a parameter: pass a bound one |
| `ShieldedPool` | no relayer fee, no compliance layer. Depth 10 = 1,024 notes. Teaching only |
| `CompliantPool` | a single ASP (`IRootSource`), **no ragequit** path for flagged depositors, depositor addresses are logged for the ASP. Teaching only |
| `ZkVote` | anonymity without receipt-freeness (see MACI) |
| `CredentialGate` | `currentYear` is a constructor constant. Issuer key is a published demo key |
| Root history | 32 roots. A proof older than 31 later joins becomes `UnknownRoot` |
| JS libraries (`secp256k1.mjs`, `bn254.mjs`) | correct but **not constant-time**. Education only |
| Licences | generated verifiers and `PoseidonT3.sol` are GPL-3.0. Everything else is MIT |

---

## 8. File map

```
docs/zk/
├── README.md · TECHNICAL.md · USAGE.md · GAS.md (generated) · package.json · package-lock.json
├── js/            secp256k1.mjs · bn254.mjs · 01…08 examples · run-all.mjs · sdk/zk-client.mjs
├── circom/        cube · membership · compliant_withdraw · credential · age_buggy (+ attack/age_forger) .circom
│                  lib/merkle.circom
│                  build.sh · make-inputs.mjs · gen-fixture.mjs · gen-fixture-calldata.mjs · gen-poseidon.mjs
├── foundry/
│   ├── foundry.toml
│   ├── src/       ZkAirdrop · ZkGroup · OwnerRoots · ShieldedPool · CompliantPool · ZkVote
│   │              CredentialGate · KeyRegistry · BN254 · ScopeLib · CubeGate · AgeGate⚠
│   │              interfaces/ (IMembershipVerifier, IRootSource) · generated/PoseidonT3 · verifiers/ (7)
│   └── test/      ZkTest (base) · 10 suites · fixtures/ (10 proofs + ZkConstants)
├── evm/           run-tests.mjs · e2e.mjs · lib.mjs
└── scripts/package.sh       → complete zk.zip (self-tested)
```
