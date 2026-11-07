// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IRootSource} from "./interfaces/IRootSource.sol";
import {IPoseidonT3} from "./generated/PoseidonT3.sol";

/// @title ZkGroup — an on-chain incremental Poseidon Merkle tree of identity commitments.
///
/// Members publish only Poseidon(secret). The contract keeps the tree, so the root that
/// membership proofs are checked against is computed by the chain itself — nobody can slip
/// in a fake member. The hash is circomlibjs's Poseidon contract (src/generated/PoseidonT3.sol),
/// so the on-chain root is bit-identical to the one membership.circom recomputes in-circuit
/// (ZkGroup.t.sol checks this against the off-chain tree from circom/make-inputs.mjs).
///
/// Incremental insertion (as in Tornado Cash / Semaphore): only the right-most "frontier"
/// node per level is stored, so a join costs DEPTH Poseidon hashes and DEPTH storage writes.
/// A ring buffer of recent roots keeps proofs made just before other members joined valid.
///
/// Admission: `registrar == address(0)` → anyone may join (open group; beware Sybils).
/// Otherwise only the registrar adds members — e.g. a backend that checks a social login ONCE
/// (like the LUV gesture backend in /auth) and then forgets which commitment is whose. After
/// that, members act anonymously: the registrar knows WHO joined, never WHO claims or votes.
contract ZkGroup is IRootSource {
    error NotRegistrar();
    error GroupFull();
    error BadCommitment();
    error AlreadyMember();

    event MemberAdded(uint256 indexed index, uint256 indexed commitment, uint256 root);

    uint256 public constant DEPTH = 10; // must match Membership(10) in circom/membership.circom
    uint256 public constant ROOT_HISTORY_SIZE = 32;
    uint256 internal constant FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617;

    IPoseidonT3 public immutable hasher;
    address public immutable registrar;

    uint256 public nextIndex;
    uint256 public currentRootIndex;
    uint256[DEPTH] internal zeros; // zeros[i] = root of an empty subtree of height i
    uint256[DEPTH] internal frontier; // right-most filled node per level
    uint256[ROOT_HISTORY_SIZE] internal roots;
    mapping(uint256 => bool) public isMember;

    constructor(IPoseidonT3 hasher_, address registrar_) {
        hasher = hasher_;
        registrar = registrar_;
        uint256 z = 0; // empty leaf, as in make-inputs.mjs
        for (uint256 i; i < DEPTH; ++i) {
            zeros[i] = z;
            frontier[i] = z;
            z = _hash(z, z);
        }
        roots[0] = z; // root of the empty tree
    }

    function join(uint256 commitment) external returns (uint256 index) {
        if (registrar != address(0) && msg.sender != registrar) revert NotRegistrar();
        if (commitment == 0 || commitment >= FIELD) revert BadCommitment(); // 0 is the empty leaf
        if (isMember[commitment]) revert AlreadyMember();
        index = nextIndex;
        if (index >= 2 ** DEPTH) revert GroupFull();

        uint256 node = commitment;
        uint256 i = index;
        for (uint256 level; level < DEPTH; ++level) {
            if (i & 1 == 0) {
                frontier[level] = node; // left child: pair with the empty subtree for now
                node = _hash(node, zeros[level]);
            } else {
                node = _hash(frontier[level], node); // right child: pair with the stored left
            }
            i >>= 1;
        }

        uint256 next = (currentRootIndex + 1) % ROOT_HISTORY_SIZE;
        roots[next] = node;
        currentRootIndex = next;
        nextIndex = index + 1;
        isMember[commitment] = true;
        emit MemberAdded(index, commitment, node);
    }

    function root() external view returns (uint256) {
        return roots[currentRootIndex];
    }

    /// true for the current root and the previous ROOT_HISTORY_SIZE − 1 roots
    function isKnownRoot(uint256 r) external view returns (bool) {
        if (r == 0) return false;
        uint256 i = currentRootIndex;
        for (uint256 n; n < ROOT_HISTORY_SIZE; ++n) {
            if (roots[i] == r) return true;
            i = i == 0 ? ROOT_HISTORY_SIZE - 1 : i - 1;
        }
        return false;
    }

    function _hash(uint256 left, uint256 right) internal view returns (uint256) {
        return hasher.poseidon([left, right]);
    }
}
