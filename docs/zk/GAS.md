# GAS: measured costs

> **Generated** by `npm run gas` (`evm/run-tests.mjs --gas-md`). Do not edit by hand.
> solc 0.8.24, optimizer 200 runs, on @ethereumjs/vm (Mainnet rules, BN254 precompiles
> priced per EIP-1108). Each figure is `gasleft()` before minus after the call inside a test,
> so it includes the call overhead but not the transaction's 21,000 base gas or calldata gas.

| operation | gas |
|---|---:|
| CompliantPool.withdraw (2 Merkle proofs in-circuit, 7 public inputs) | 322,219 |
| FFLONK verifyProof | 192,936 |
| Groth16 verify, 5 public inputs (credential) | 225,278 |
| Groth16 verifyProof | 198,346 |
| KeyRegistry.register from an EOA (Schnorr on precompiles, no setup) | 93,450 |
| PLONK verifyProof | 271,686 |
| ShieldedPool.deposit (transferFrom + tree insert) | 389,173 |
| ShieldedPool.withdraw (proof + transfer, via relayer) | 275,788 |
| ZkGroup.join (depth 10, 10 Poseidon hashes) | 379,655 |

## Test suites

| suite | tests passed |
|---|---:|
| `CompliantPoolTest` | 9 / 9 |
| `CredentialTest` | 6 / 6 |
| `CubeGateTest` | 6 / 6 |
| `KeyRegistryTest` | 7 / 7 |
| `ProofSystemsTest` | 4 / 4 |
| `ShieldedPoolTest` | 8 / 8 |
| `UnderConstrainedTest` | 2 / 2 |
| `ZkAirdropTest` | 9 / 9 |
| `ZkGroupTest` | 8 / 8 |
| `ZkVoteTest` | 6 / 6 |
| JS ↔ Solidity interop | 2 / 2 |
| **total** | **67** |
