// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IRootSource} from "./interfaces/IRootSource.sol";
import {IPoseidonT3} from "./generated/PoseidonT3.sol";
import {IPoseidonT2} from "./generated/PoseidonT2.sol";
import {ScopeLib} from "./ScopeLib.sol";
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
///   • RAGEQUIT — a depositor the ASP left out is never trapped: `ragequit(secret)` returns the
///     full denomination to the ORIGINAL deposit address. It is public by construction (it
///     reveals the secret and links exit to deposit), and it burns the note's real nullifier
///     Poseidon(secret, scope) — the value the circuit uses — so the note cannot ALSO be
///     withdrawn privately. Funds can always leave; only private exit needs the ASP's approval.
///
/// ⚠ Still a teaching contract: dev-ceremony verifier, depth-10 trees, a single ASP.
///   A note secret must be used for ONE note only (ragequit reveals it). Get legal review.
contract CompliantPool {
    error UnknownRoot();
    error UnknownAssociationRoot();
    error NullifierUsed();
    error InvalidProof();
    error ZeroAddress();
    error FeeTooHigh();
    error TransferFailed();
    error NotDepositor();
    error SecretOutOfField();

    event Deposit(uint256 indexed commitment, uint256 leafIndex, address indexed depositor);
    event Withdrawal(address indexed recipient, uint256 nullifierHash, address indexed relayer, uint256 fee);
    event Ragequit(address indexed depositor, uint256 indexed commitment, uint256 nullifierHash);

    uint256 internal constant FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617;

    IERC20Pull public immutable token;
    uint256 public immutable denomination;
    uint256 public immutable maxFee;
    ICompliantWithdrawVerifier public immutable verifier;
    IRootSource public immutable associations;
    uint256 public immutable scope;
    ZkGroup public immutable tree;
    IPoseidonT3 public immutable hasher2; // Poseidon(2): tree nodes + nullifiers (shared with `tree`)
    IPoseidonT2 public immutable hasher1; // Poseidon(1): commitments, for ragequit

    mapping(uint256 => bool) public nullifierUsed;
    mapping(uint256 => address) public depositorOf; // commitment → who paid for it

    constructor(
        IERC20Pull token_,
        uint256 denomination_,
        uint256 maxFee_,
        ICompliantWithdrawVerifier verifier_,
        IPoseidonT3 hasher,
        IPoseidonT2 commitmentHasher,
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
        hasher2 = hasher;
        hasher1 = commitmentHasher;
        tree = new ZkGroup(hasher, address(this));
    }

    /// See ScopeLib: deploy with scope_ == boundScope(round) (address predicted from the nonce).
    function boundScope(uint256 round) public view returns (uint256) {
        return ScopeLib.derive(block.chainid, address(this), round);
    }

    function isScopeBound(uint256 round) external view returns (bool) {
        return scope == boundScope(round);
    }

    /// The depositor is logged on purpose: the ASP needs it to decide what to include.
    function deposit(uint256 commitment) external {
        if (!token.transferFrom(msg.sender, address(this), denomination)) revert TransferFailed();
        uint256 index = tree.join(commitment); // reverts on a duplicate, so depositorOf is never overwritten
        depositorOf[commitment] = msg.sender;
        emit Deposit(commitment, index, msg.sender);
    }

    /// Public exit for a depositor who cannot (or chooses not to) withdraw privately.
    /// Only the original depositor, only to themselves, only once, and never in addition to a
    /// private withdrawal of the same note (shared nullifier).
    function ragequit(uint256 secret) external {
        if (secret >= FIELD) revert SecretOutOfField(); // the circuit only knows canonical secrets
        uint256 commitment = hasher1.poseidon([secret]);
        if (depositorOf[commitment] != msg.sender) revert NotDepositor();
        uint256 nullifierHash = hasher2.poseidon([secret, scope]);
        if (nullifierUsed[nullifierHash]) revert NullifierUsed();
        nullifierUsed[nullifierHash] = true;
        if (!token.transfer(msg.sender, denomination)) revert TransferFailed();
        emit Ragequit(msg.sender, commitment, nullifierHash);
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
