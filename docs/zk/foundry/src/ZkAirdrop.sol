// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IMembershipVerifier} from "./interfaces/IMembershipVerifier.sol";

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
///   • group can grow                       — owner adds roots; old roots stay valid (history)
///   • rounds are separated                — `scope` is a public signal; a proof for round 1
///                                            is useless in round 2 and in ZkVote
///
/// ⚠ Production notes: derive `scope` from (chainid, address(this), round) so the same group
///   cannot claim twice on two deployments; use verifiers from a real multi-party ceremony
///   (the committed verifiers come from a DEV ceremony); consider making the root an on-chain
///   incremental Merkle tree (as Semaphore does) instead of an owner-published value.
contract ZkAirdrop {
    error NotOwner();
    error ZeroAddress();
    error UnknownRoot();
    error NullifierUsed();
    error InvalidProof();
    error TransferFailed();

    event RootAdded(uint256 indexed root);
    event RootRevoked(uint256 indexed root);
    event Claimed(uint256 indexed nullifierHash, address indexed recipient, uint256 amount);

    IERC20Minimal public immutable token;
    IMembershipVerifier public immutable verifier;
    uint256 public immutable scope; // airdrop round id, a public signal of every claim proof
    uint256 public immutable amount; // fixed amount per member
    address public owner;

    mapping(uint256 => bool) public isKnownRoot;
    mapping(uint256 => bool) public nullifierUsed;

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(IERC20Minimal token_, IMembershipVerifier verifier_, uint256 scope_, uint256 amount_) {
        token = token_;
        verifier = verifier_;
        scope = scope_;
        amount = amount_;
        owner = msg.sender;
    }

    function addRoot(uint256 root) external onlyOwner {
        isKnownRoot[root] = true;
        emit RootAdded(root);
    }

    function revokeRoot(uint256 root) external onlyOwner {
        isKnownRoot[root] = false;
        emit RootRevoked(root);
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
        if (!isKnownRoot[root]) revert UnknownRoot();
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
