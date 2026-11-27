// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IRootSource} from "./interfaces/IRootSource.sol";
import {IPoseidonT3} from "./generated/PoseidonT3.sol";
import {ZkGroup} from "./ZkGroup.sol";
import {IERC20Pull} from "./ShieldedPool.sol";

/// Verifier generated from circom/compliant_withdraw.circom. Public signals:
/// [depositRoot, associationRoot, nullifierHash, recipient, relayer, fee, scope]
interface ICompliantWithdrawVerifier {
    function verifyProof(
        uint256[2] calldata pA,
        uint256[2][2] calldata pB,
        uint256[2] calldata pC,
        uint256[7] calldata pubSignals
    ) external view returns (bool);
}

/// @title CompliantPool — ShieldedPool + a compliance proof + a relayer fee.
///
/// What it adds over ShieldedPool.sol:
///   • ASSOCIATION SET — each withdrawal also proves the deposit is in a tree of deposits an
///     Association Set Provider (ASP) has vetted. `associations` (an IRootSource, e.g.
///     OwnerRoots run by the ASP) says which association roots are currently accepted.
///     A flagged depositor is absent from the set and cannot build a proof; everyone else
///     withdraws privately AND demonstrably clean. (The Privacy Pools design.)
///   • RELAYER FEE — `relayer` and `fee` are public signals. The proven relayer is paid the
///     proven fee no matter who submits, so the withdrawer needs no gas (and no funded
///     address that would deanonymise them), and a front-runner cannot steal or raise the fee.
///
/// ⚠ Still a teaching contract: dev-ceremony verifier, depth-10 trees, a single ASP with no
///   "ragequit" path for flagged depositors to reclaim funds publicly (production pools let a
///   flagged depositor exit to the ORIGINAL deposit address). Get legal review before use.
contract CompliantPool {
    error UnknownRoot();
    error UnknownAssociationRoot();
    error NullifierUsed();
    error InvalidProof();
    error ZeroAddress();
    error FeeTooHigh();
    error TransferFailed();

    event Deposit(uint256 indexed commitment, uint256 leafIndex, address indexed depositor);
    event Withdrawal(address indexed recipient, uint256 nullifierHash, address indexed relayer, uint256 fee);

    IERC20Pull public immutable token;
    uint256 public immutable denomination;
    uint256 public immutable maxFee;
    ICompliantWithdrawVerifier public immutable verifier;
    IRootSource public immutable associations;
    uint256 public immutable scope;
    ZkGroup public immutable tree;

    mapping(uint256 => bool) public nullifierUsed;

    constructor(
        IERC20Pull token_,
        uint256 denomination_,
        uint256 maxFee_,
        ICompliantWithdrawVerifier verifier_,
        IPoseidonT3 hasher,
        IRootSource associations_,
        uint256 scope_
    ) {
        if (maxFee_ > denomination_) revert FeeTooHigh();
        token = token_;
        denomination = denomination_;
        maxFee = maxFee_;
        verifier = verifier_;
        associations = associations_;
        scope = scope_;
        tree = new ZkGroup(hasher, address(this));
    }

    /// The depositor is logged on purpose: the ASP needs it to decide what to include.
    function deposit(uint256 commitment) external {
        if (!token.transferFrom(msg.sender, address(this), denomination)) revert TransferFailed();
        uint256 index = tree.join(commitment);
        emit Deposit(commitment, index, msg.sender);
    }

    function withdraw(
        uint256 root,
        uint256 associationRoot,
        uint256 nullifierHash,
        address recipient,
        address relayer,
        uint256 fee,
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c
    ) external {
        if (recipient == address(0)) revert ZeroAddress();
        if (fee > maxFee) revert FeeTooHigh();
        if (!tree.isKnownRoot(root)) revert UnknownRoot();
        if (!associations.isKnownRoot(associationRoot)) revert UnknownAssociationRoot();
        if (nullifierUsed[nullifierHash]) revert NullifierUsed();

        uint256[7] memory pub = [
            root,
            associationRoot,
            nullifierHash,
            uint256(uint160(recipient)),
            uint256(uint160(relayer)),
            fee,
            scope
        ];
        if (!verifier.verifyProof(a, b, c, pub)) revert InvalidProof();

        nullifierUsed[nullifierHash] = true;
        if (!token.transfer(recipient, denomination - fee)) revert TransferFailed();
        if (fee != 0 && !token.transfer(relayer, fee)) revert TransferFailed();
        emit Withdrawal(recipient, nullifierHash, relayer, fee);
    }
}
