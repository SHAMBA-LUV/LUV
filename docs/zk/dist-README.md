# complete zk: zero-knowledge proofs, from first principles to on-chain apps

A self-contained, executable package: a guide to zero-knowledge proofs, 9 runnable protocol
examples, 7 Circom circuits, 13 Solidity contracts plus 8 generated verifiers, a client SDK, and
88 tests that run on a real EVM plus 272 mutation checks on the verifiers, Foundry not required. Everything was built and tested before packaging:
this archive was unpacked into a clean directory and its full test suite run.

## Start here

| document | read it for |
|---|---|
| [`docs/ZERO_KNOWLEDGE_PROOFS.md`](docs/ZERO_KNOWLEDGE_PROOFS.md) | **the guide**: what ZK is, why it works, attacks, design patterns, a complete reference of sources, specs and papers |
| [`docs/zk/USAGE.md`](docs/zk/USAGE.md) | **how to**: run, rebuild, add your own circuit, recipes per app, LUV integration, mainnet checklist, troubleshooting |
| [`docs/zk/TECHNICAL.md`](docs/zk/TECHNICAL.md) | **specs**: architecture, circuit signal layouts, constraint counts, contract API, measured gas, test harness, security model |
| [`docs/zk/GAS.md`](docs/zk/GAS.md) | **measured gas** for every operation, generated from the test run |
| [`docs/zk/README.md`](docs/zk/README.md) | folder map |

## Run it

```bash
cd docs/zk
node js/run-all.mjs      # zero dependencies: Schnorr, simulator, extractor, Fiat–Shamir, Pedersen, DLEQ, R1CS→QAP, BN254
npm ci                   # pinned toolchain: circom (WASM), snarkjs, circomlib(js), solc 0.8.24, ethereumjs
npm test                 # + 88 Solidity tests on an EVM with the BN254 precompiles + verifier mutation tests
npm run build            # build the circuit keys locally (not shipped; ~8 min the first time)
npm run e2e              # live flow: fresh proofs via the SDK, bound scope, compliant pool + ragequit, hidden-amount payments found by wallet scanning (44 checks)
```

## What's inside

| area | highlights |
|---|---|
| protocols (`docs/zk/js`) | interactive and Fiat–Shamir Schnorr, a live **Frozen Heart** forgery, nonce-reuse key extraction, Pedersen confidential balances, Chaum–Pedersen nullifiers, R1CS→QAP over BN254, note encryption to a receiver |
| circuits (`docs/zk/circom`) | `membership` (Merkle + nullifier + bound message), `compliant_withdraw` (two Merkle proofs + bound relayer fee), `transaction` (2-in/2-out join-split with hidden amounts and range proofs), `credential` (EdDSA verified in-circuit + range proof), `cube`, and ⚠ `age_buggy` + an attacker's forger with a byte-identical R1CS |
| contracts (`docs/zk/foundry/src`) | `ZkAirdrop` · `ZkGroup` (on-chain Poseidon tree) · `ShieldedPool` · `CompliantPool` (association set + relayer fee + ragequit) · `VariablePool` (hidden amounts) · `ZkVote` · `ScopeLib` · `CredentialGate` · `KeyRegistry` + `BN254` (no setup) · `OwnerRoots` · `CubeGate` · ⚠ `AgeGate` |
| client (`docs/zk/js/sdk`, `docs/zk/evm/e2e.mjs`) | identities, shielded accounts, tree from events, chain-bound scope, fresh Groth16 proofs, encrypted notes, wallet scanning, a live deploy-to-payment run |
| evidence (`docs/zk/foundry/test`, `docs/zk/evm`) | 88 tests + 272 mutation checks covering front-running, replay, double spend, scope separation, on-chain root == proof root, a flagged depositor unable to prove, inflation and "negative" notes unprovable, a forged proof accepted by a broken circuit, and Groth16 vs PLONK vs FFLONK gas (198k / 271k / 193k) |

## ⚠ Read before reuse

- The verifiers come from a **development trusted setup** with one contributor. They are for
  tests only: **never deploy them**.
- `AgeGate.sol` / `age_buggy.circom` are **intentionally vulnerable**, and `CubeGate` is
  intentionally replayable.
- `ShieldedPool`, `CompliantPool` and `VariablePool` are teaching contracts. `CompliantPool` adds an association
  set and a ragequit exit, but has a single ASP and fixed amounts. Get legal review before moving value privately.
- Licences: the generated verifiers and `PoseidonT3.sol` are GPL-3.0. Everything else is MIT.

`contracts/ShambaLuvAirdrop.sol` is included because the guide compares it with the ZK airdrop.
