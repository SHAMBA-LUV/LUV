// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Where a membership-proof consumer learns which group roots are valid.
///   OwnerRoots — an owner publishes roots computed off-chain (simple, trusted operator)
///   ZkGroup    — the tree lives on-chain; every join updates the root (trust-minimised)
interface IRootSource {
    function isKnownRoot(uint256 root) external view returns (bool);
}
