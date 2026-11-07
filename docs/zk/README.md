# docs/zk: runnable companion to the ZK guide

Everything here backs [`../ZERO_KNOWLEDGE_PROOFS.md`](../ZERO_KNOWLEDGE_PROOFS.md), and all of
it is executed, not just written.

```bash
node js/run-all.mjs        # 8 protocol examples, zero dependencies (Node ≥ 18)

npm install                # circom (WASM), snarkjs, circomlib(js), solc, ethereumjs
npm test                   # examples + compile every .sol + 50 tests on a real EVM
npm run build              # optional: regenerate circuits, dev ceremony, proofs, verifiers, fixtures (~5 min)

cd foundry && forge test -vv   # the same Solidity tests under Foundry (no forge-std, no cheatcodes)
```

| folder | contents |
|---|---|
| `js/` | Schnorr (interactive, simulator, extractor, Fiat–Shamir), Pedersen, Chaum–Pedersen, R1CS→QAP, BN254 Schnorr prover |
| `circom/` | circuits (`cube`, `membership`, `credential`, ⚠ `age_buggy` + `attack/age_forger`), `build.sh`, input and fixture generators |
| `foundry/src/` | `ZkAirdrop`, `ZkGroup`, `OwnerRoots`, `ZkVote`, `KeyRegistry` + `BN254`, `CredentialGate`, `CubeGate`, ⚠ `AgeGate`, generated verifiers and Poseidon |
| `foundry/test/` | 8 suites + generated proof fixtures + `ZkTest.sol` (cheatcode-free base) |
| `evm/run-tests.mjs` | a forge-style runner on ethereumjs (BN254 precompiles included), plus JS ↔ Solidity interop |

> ⚠ The verifiers in `foundry/src/verifiers/` come from a **development ceremony** run on one
> machine, so they are for tests only. Never deploy them. `AgeGate` / `age_buggy.circom` are
> **intentionally vulnerable** (guide §12.1).
>
> Licences: generated verifiers (snarkjs template) and `generated/PoseidonT3.sol` (circomlibjs)
> are GPL-3.0. Everything else is MIT.
