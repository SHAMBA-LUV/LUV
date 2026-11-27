# docs/zk: runnable companion to the ZK guide

Everything here backs [`../ZERO_KNOWLEDGE_PROOFS.md`](../ZERO_KNOWLEDGE_PROOFS.md), and all of
it is executed, not just written.

```bash
node js/run-all.mjs        # 9 protocol examples, zero dependencies (Node ≥ 18)

npm install                # circom (WASM), snarkjs, circomlib(js), solc, ethereumjs
npm test                   # examples + 88 Solidity tests on a real EVM + 272 mutation checks
npm run build              # optional: regenerate circuits, dev ceremony, proofs, verifiers, fixtures (~5 min)

npm run e2e                # live flow with FRESH proofs via the client SDK (needs `npm run build` once)
npm run gas                # regenerate GAS.md from measurements
npm run scaling            # constraint counts vs tree depth (10 … 32)
npm run package            # build + self-test "complete zk.zip" (→ dist/)

cd foundry && forge test -vv   # the same Solidity tests under Foundry (no forge-std, no cheatcodes)
```

**Docs:** [USAGE.md](USAGE.md) (how to run, adapt, deploy) · [TECHNICAL.md](TECHNICAL.md)
(specs, API, internals) · [GAS.md](GAS.md) (measured costs, generated) · [the guide](../ZERO_KNOWLEDGE_PROOFS.md) (theory and patterns).

| folder | contents |
|---|---|
| `js/` | Schnorr (interactive, simulator, extractor, Fiat–Shamir), Pedersen, Chaum–Pedersen, R1CS→QAP, BN254 Schnorr prover, note encryption, `sdk/` (client SDK: proofs, encrypted notes, wallet scanning) |
| `circom/` | circuits (`cube`, `membership`, `compliant_withdraw`, `transaction` (join-split), `credential`, ⚠ `age_buggy` + `attack/age_forger`), `build.sh`, input and fixture generators |
| `foundry/src/` | `ZkAirdrop`, `ZkGroup`, `OwnerRoots`, `ShieldedPool`, `CompliantPool`, `VariablePool`, `ZkVote`, `ScopeLib`, `KeyRegistry` + `BN254`, `CredentialGate`, `CubeGate`, ⚠ `AgeGate`, generated verifiers and Poseidon |
| `foundry/test/` | 11 suites + generated proof fixtures + `ZkTest.sol` (cheatcode-free base) |
| `evm/` | `mutation.mjs`: every proof × every single-point mutation · `run-tests.mjs`: a forge-style runner on ethereumjs (BN254 precompiles included) plus JS ↔ Solidity interop · `e2e.mjs`: the live flow · `lib.mjs`: shared helpers |

> ⚠ The verifiers in `foundry/src/verifiers/` come from a **development ceremony** run on one
> machine, so they are for tests only. Never deploy them. `AgeGate` / `age_buggy.circom` are
> **intentionally vulnerable** (guide §12.1).
>
> Licences: generated verifiers (snarkjs template) and `generated/PoseidonT3.sol` (circomlibjs)
> are GPL-3.0. Everything else is MIT.
