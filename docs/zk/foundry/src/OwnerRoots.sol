// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IRootSource} from "./interfaces/IRootSource.sol";

/// @title OwnerRoots — group roots published by a trusted operator.
/// @notice The cheapest root source: the operator builds the Poseidon tree off-chain
///         (circom/make-inputs.mjs does exactly that) and publishes each new root.
///         Trade-off: members must trust the operator not to insert fake members.
///         ZkGroup removes that trust by keeping the tree on-chain.
contract OwnerRoots is IRootSource {
    error NotOwner();

    event RootAdded(uint256 indexed root);
    event RootRevoked(uint256 indexed root);

    address public immutable owner;
    mapping(uint256 => bool) public isKnownRoot;

    constructor() {
        owner = msg.sender;
    }

    function addRoot(uint256 root) external {
        if (msg.sender != owner) revert NotOwner();
        isKnownRoot[root] = true;
        emit RootAdded(root);
    }

    function revokeRoot(uint256 root) external {
        if (msg.sender != owner) revert NotOwner();
        isKnownRoot[root] = false;
        emit RootRevoked(root);
    }
}
