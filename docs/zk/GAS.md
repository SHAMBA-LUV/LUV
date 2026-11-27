# GAS: measured costs

> **Generated** by `npm run gas` (`evm/run-tests.mjs --gas-md`). Do not edit by hand.
> solc 0.8.24, optimizer 200 runs, on @ethereumjs/vm (Mainnet rules, BN254 precompiles
> priced per EIP-1108). Each figure is `gasleft()` before minus after the call inside a test,
> so it includes the call overhead but not the transaction's 21,000 base gas or calldata gas.

| operation | gas |
|---|---:|
| CompliantPool.ragequit (Poseidon(1) + Poseidon(2) on-chain + transfer) | 98,607 |
| CompliantPool.withdraw (2 Merkle proofs in-circuit, 7 public inputs) | 322,175 |
| FFLONK verifyProof | 192,936 |
| Groth16 verify, 5 public inputs (credential) | 225,278 |
| Groth16 verifyProof | 198,346 |
| KeyRegistry.register from an EOA (Schnorr on precompiles, no setup) | 93,450 |
| PLONK verifyProof | 269,496 |
| ShieldedPool.deposit (transferFrom + tree insert) | 389,173 |
| ShieldedPool.withdraw (proof + transfer, via relayer) | 275,721 |
| VariablePool deposit (join-split proof + pair insert + transferFrom) | 795,915 |
| VariablePool private transfer (nothing revealed) | 669,121 |
| VariablePool withdrawal + relayer fee | 717,662 |
| ZkGroup 8 members via 4 joinPair | 1,556,848 |
| ZkGroup 8 members via 8 join | 2,853,240 |
| ZkGroup.join (depth 10, 10 Poseidon hashes) | 379,655 |

## Test suites

| suite | tests passed |
|---|---:|
| `CompliantPoolTest` | 16 / 16 |
| `CredentialTest` | 6 / 6 |
| `CubeGateTest` | 6 / 6 |
| `KeyRegistryTest` | 7 / 7 |
| `ProofSystemsTest` | 4 / 4 |
| `ShieldedPoolTest` | 8 / 8 |
| `UnderConstrainedTest` | 2 / 2 |
| `VariablePoolTest` | 12 / 12 |
| `ZkAirdropTest` | 9 / 9 |
| `ZkGroupTest` | 10 / 10 |
| `ZkVoteTest` | 6 / 6 |
| JS ↔ Solidity interop | 2 / 2 |
| **total** | **88** |
