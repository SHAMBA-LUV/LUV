// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IMembershipVerifier} from "./interfaces/IMembershipVerifier.sol";
import {IRootSource} from "./interfaces/IRootSource.sol";
import {ScopeLib} from "./ScopeLib.sol";

interface IERC20Minimal {
    function transfer(address to, uint256 amount) external returns (bool);
}

/// @title ZkAirdrop — anonymous, one-per-member token claims (the guide's §10 pattern, implemented).
///
/// Eligibility is membership of a Merkle group of identity commitments Poseidon(secret).
/// A claim proves "I am SOME member, this is my nullifier for this round, pay `recipient`"
/// with a Groth16 proof from circom/membership.circom. The contract learns neither which
/// member claimed nor any link between the member's identity and `recipient`.
///
/// Compare contracts/ShambaLuvAirdrop.sol (repo root): there a backend signer issues an
/// EIP-712 voucher per identity, so the signer can link identities to wallets.
///
/// Properties enforced here:
///   • one claim per member per round      — nullifierUsed[nullifierHash]
///   • proofs can't be front-run / redirected — recipient is a public signal of the proof
///   • relayable (gasless for the member)  — anyone may submit; funds go only to `recipient`
///   • group can grow                       — the root source keeps a root history:
///                                            OwnerRoots (operator-published) or ZkGroup (on-chain tree)
///   • rounds are separated                — `scope` is a public signal; a proof for round 1
///                                            is useless in round 2 and in ZkVote
///
/// ⚠ Production notes: deploy with scope = boundScope(round) so the same group cannot claim
///   twice on two deployments (verified live in evm/e2e.mjs); use verifiers from a real multi-party ceremony
///   (the committed verifiers come from a DEV ceremony); prefer ZkGroup over OwnerRoots so the
///   chain, not an operator, computes the group root.
contract ZkAirdrop {
    error ZeroAddress();
    error UnknownRoot();
    error NullifierUsed();
    error InvalidProof();
    error TransferFailed();

    event Claimed(uint256 indexed nullifierHash, address indexed recipient, uint256 amount);

    IERC20Minimal public immutable token;
    IMembershipVerifier public immutable verifier;
    IRootSource public immutable roots; // OwnerRoots or ZkGroup
    uint256 public immutable scope; // airdrop round id, a public signal of every claim proof
    uint256 public immutable amount; // fixed amount per member

    mapping(uint256 => bool) public nullifierUsed;

    constructor(
        IERC20Minimal token_,
        IMembershipVerifier verifier_,
        IRootSource roots_,
        uint256 scope_,
        uint256 amount_
    ) {
        token = token_;
        verifier = verifier_;
        roots = roots_;
        scope = scope_;
        amount = amount_;
    }

    /// The scope a production deployment should use for `round`: bound to this chain and this
    /// contract (see ScopeLib). Deploy with `scope_ == boundScope(round)` — the address is known
    /// in advance from the deployer's nonce or CREATE2 — and check it with isScopeBound.
    /// (The fixture-based tests use a fixed scope so the same proofs run under any deployer;
    /// evm/e2e.mjs deploys with a bound scope and fresh proofs.)
    function boundScope(uint256 round) public view returns (uint256) {
        return ScopeLib.derive(block.chainid, address(this), round);
    }

    function isScopeBound(uint256 round) external view returns (bool) {
        return scope == boundScope(round);
    }

    /// @param root          a published group root the proof was made against
    /// @param nullifierHash Poseidon(secret, scope) — the member's one-time tag for this round
    /// @param recipient     where the tokens go; bound into the proof
    function claim(
        uint256 root,
        uint256 nullifierHash,
        address recipient,
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c
    ) external {
        if (recipient == address(0)) revert ZeroAddress();
        if (!roots.isKnownRoot(root)) revert UnknownRoot();
        if (nullifierUsed[nullifierHash]) revert NullifierUsed();

        // The statement is assembled by the CONTRACT from its own state — never trust
        // caller-supplied public signals for values the contract already knows (scope).
        uint256[4] memory pub = [root, nullifierHash, uint256(uint160(recipient)), scope];
        if (!verifier.verifyProof(a, b, c, pub)) revert InvalidProof();

        nullifierUsed[nullifierHash] = true; // effects before the external token call
        if (!token.transfer(recipient, amount)) revert TransferFailed();
        emit Claimed(nullifierHash, recipient, amount);
    }
}
