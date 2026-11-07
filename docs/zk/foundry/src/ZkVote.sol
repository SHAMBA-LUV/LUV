// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IMembershipVerifier} from "./interfaces/IMembershipVerifier.sol";

/// @title ZkVote — anonymous one-member-one-vote polls on the SAME circuit as ZkAirdrop.
///
/// The membership circuit proves: "I am some member of group `root`; my nullifier for
/// `scope` is `nullifierHash`; my message is `message`." Here scope = proposal id and
/// message = vote option. Results are public; who voted for what is not.
///
/// Reusing one circuit (and one verifier deployment) across applications is safe because
/// the nullifier is scoped: Poseidon(secret, proposalId) is unlinkable to the member's
/// airdrop nullifier Poseidon(secret, airdropRound), and a proof for one scope never
/// verifies for another.
///
/// ⚠ Teaching contract: no vote-buying/coercion resistance (a voter can reveal their secret
///   to prove how they voted — see MACI, https://github.com/privacy-ethereum/maci,
///   for receipt-freeness), and the DEV-ceremony verifier must never be deployed.
contract ZkVote {
    error NotOwner();
    error ProposalExists();
    error UnknownProposal();
    error BadProposal();
    error VotingClosed();
    error BadOption();
    error NullifierUsed();
    error InvalidProof();

    event ProposalCreated(uint256 indexed id, uint256 groupRoot, uint8 options, uint64 deadline);
    event Voted(uint256 indexed id, uint256 indexed option, uint256 nullifierHash);

    struct Proposal {
        uint256 groupRoot; // the voter group, frozen at creation (a snapshot)
        uint64 deadline;
        uint8 options;
    }

    uint256 internal constant FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617;

    IMembershipVerifier public immutable verifier;
    address public owner;

    mapping(uint256 => Proposal) public proposals;
    mapping(uint256 => mapping(uint256 => uint256)) public tally; // id => option => votes
    mapping(uint256 => bool) public nullifierUsed; // scoped per proposal by construction

    constructor(IMembershipVerifier verifier_) {
        verifier = verifier_;
        owner = msg.sender;
    }

    function createProposal(uint256 id, uint256 groupRoot, uint8 options, uint64 deadline) external {
        if (msg.sender != owner) revert NotOwner();
        if (proposals[id].options != 0) revert ProposalExists();
        // id is used as a circuit input, so it must be a canonical field element
        if (id >= FIELD || options < 2 || deadline <= block.timestamp) revert BadProposal();
        proposals[id] = Proposal(groupRoot, deadline, options);
        emit ProposalCreated(id, groupRoot, options, deadline);
    }

    function vote(
        uint256 id,
        uint256 nullifierHash,
        uint256 option,
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c
    ) external {
        Proposal memory p = proposals[id];
        if (p.options == 0) revert UnknownProposal();
        if (block.timestamp > p.deadline) revert VotingClosed();
        if (option >= p.options) revert BadOption();
        if (nullifierUsed[nullifierHash]) revert NullifierUsed();

        uint256[4] memory pub = [p.groupRoot, nullifierHash, option, id];
        if (!verifier.verifyProof(a, b, c, pub)) revert InvalidProof();

        nullifierUsed[nullifierHash] = true;
        tally[id][option] += 1;
        emit Voted(id, option, nullifierHash);
    }
}
