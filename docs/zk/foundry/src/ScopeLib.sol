// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ScopeLib — derive a nullifier scope that is unique to one deployment.
///
/// A scope is a public signal of every membership proof and the second input of the
/// nullifier Poseidon(secret, scope). If two deployments share a scope and a group, one
/// membership can act once in EACH of them (e.g. claim an airdrop on every chain). Binding the
/// scope to (chain id, contract address, round) makes a proof valid for exactly one contract
/// on exactly one chain. Reduced mod the BN254 scalar field so it is a canonical circuit input.
///
/// Off-chain equivalent: js/sdk/zk-client.mjs `deriveScope(chainId, app, round)`.
library ScopeLib {
    uint256 internal constant FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617;

    function derive(uint256 chainId, address app, uint256 round) internal pure returns (uint256) {
        return uint256(keccak256(abi.encode(chainId, app, round))) % FIELD;
    }
}
