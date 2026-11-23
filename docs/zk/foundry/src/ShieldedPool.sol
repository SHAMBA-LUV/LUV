// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IMembershipVerifier} from "./interfaces/IMembershipVerifier.sol";
import {IPoseidonT3} from "./generated/PoseidonT3.sol";
import {ZkGroup} from "./ZkGroup.sol";

interface IERC20Pull {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @title ShieldedPool — fixed-denomination private transfers, built ONLY from parts already
///        in this project: ZkGroup (on-chain Poseidon tree) + membership.circom + its verifier.
///
///   deposit(commitment)  — pay `denomination` tokens; Poseidon(secret) joins the pool's tree.
///   withdraw(proof, …)   — prove "I own SOME unspent deposit" and send `denomination` to any
///                          `recipient`. The proof reveals neither which deposit nor who made it.
///
/// It is the airdrop pattern with money flowing in: deposits are joins, withdrawals are claims.
/// Same guarantees, re-used: the nullifier Poseidon(secret, scope) stops double-withdrawals;
/// `recipient` is a public signal so a relayer or front-runner cannot redirect funds; the root
/// history keeps proofs valid while others deposit. No new circuit, no new ceremony.
///
/// Privacy = the anonymity set: a withdrawal is hidden among all deposits made before its root.
/// Fixed denominations matter — a unique amount would link deposit and withdrawal by value.
///
/// ⚠ TEACHING CONTRACT, deliberately minimal: no relayer fee, a dev-ceremony verifier, a depth-10
///   tree (1,024 deposits). Unrestricted mixers have been abused for laundering and sanctioned;
///   production designs add COMPLIANCE, e.g. Privacy Pools' association sets — withdrawers also
///   prove membership in a set that excludes flagged deposits
///   (https://github.com/0xbow-io/privacy-pools-core). Check the law where you deploy.
contract ShieldedPool {
    error UnknownRoot();
    error NullifierUsed();
    error InvalidProof();
    error ZeroAddress();
    error TransferFailed();

    event Deposit(uint256 indexed commitment, uint256 leafIndex);
    event Withdrawal(address indexed recipient, uint256 nullifierHash);

    IERC20Pull public immutable token;
    uint256 public immutable denomination;
    IMembershipVerifier public immutable verifier;
    uint256 public immutable scope; // public signal: proofs for this pool only
    ZkGroup public immutable tree; // the pool is the tree's registrar

    mapping(uint256 => bool) public nullifierUsed;

    constructor(
        IERC20Pull token_,
        uint256 denomination_,
        IMembershipVerifier verifier_,
        IPoseidonT3 hasher,
        uint256 scope_
    ) {
        token = token_;
        denomination = denomination_;
        verifier = verifier_;
        scope = scope_;
        tree = new ZkGroup(hasher, address(this));
    }

    function deposit(uint256 commitment) external {
        if (!token.transferFrom(msg.sender, address(this), denomination)) revert TransferFailed();
        uint256 index = tree.join(commitment); // reverts on duplicate / invalid / full
        emit Deposit(commitment, index);
    }

    function withdraw(
        uint256 root,
        uint256 nullifierHash,
        address recipient,
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c
    ) external {
        if (recipient == address(0)) revert ZeroAddress();
        if (!tree.isKnownRoot(root)) revert UnknownRoot();
        if (nullifierUsed[nullifierHash]) revert NullifierUsed();
        uint256[4] memory pub = [root, nullifierHash, uint256(uint160(recipient)), scope];
        if (!verifier.verifyProof(a, b, c, pub)) revert InvalidProof();
        nullifierUsed[nullifierHash] = true;
        if (!token.transfer(recipient, denomination)) revert TransferFailed();
        emit Withdrawal(recipient, nullifierHash);
    }
}
