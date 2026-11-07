// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ZkTest, Actor} from "./ZkTest.sol";
import {VoteProof} from "./fixtures/VoteProof.sol"; // member #5 votes option 1 on proposal 7
import {AirdropProofA} from "./fixtures/AirdropProofA.sol"; // the same member's airdrop proof
import {MembershipVerifier} from "../src/verifiers/MembershipVerifier.sol";
import {IMembershipVerifier} from "../src/interfaces/IMembershipVerifier.sol";
import {ZkVote} from "../src/ZkVote.sol";

contract ZkVoteTest is ZkTest {
    uint256 constant PROPOSAL = 7; // = PROPOSAL_ID in circom/make-inputs.mjs
    uint256 constant YES = 1;

    ZkVote poll;
    Actor relayer;
    uint256 root;

    function setUp() public {
        poll = new ZkVote(IMembershipVerifier(address(new MembershipVerifier())));
        (,,, uint256[4] memory pub) = VoteProof.get();
        root = pub[0];
        poll.createProposal(PROPOSAL, root, 2, uint64(block.timestamp + 7 days));
        relayer = new Actor();
    }

    function _vote(uint256 option) internal pure returns (bytes memory) {
        (uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c, uint256[4] memory pub) = VoteProof.get();
        return abi.encodeCall(ZkVote.vote, (PROPOSAL, pub[1], option, a, b, c));
    }

    function test_anonymousVoteIsTallied() public {
        mustSucceed(relayer, address(poll), _vote(YES));
        assertEq(poll.tally(PROPOSAL, YES), 1);
        assertEq(poll.tally(PROPOSAL, 0), 0);
    }

    function test_doubleVoteReverts() public {
        mustSucceed(relayer, address(poll), _vote(YES));
        expectRevert(relayer, address(poll), _vote(YES), ZkVote.NullifierUsed.selector);
    }

    /// The option is bound into the proof: a relayer cannot flip the vote.
    function test_relayerCannotFlipVote() public {
        expectRevert(relayer, address(poll), _vote(0), ZkVote.InvalidProof.selector);
    }

    /// Same member, same circuit, different scope: the airdrop proof can't be used as a vote,
    /// and the airdrop nullifier differs from the vote nullifier (unlinkable).
    function test_airdropProofIsNotAVote() public {
        (uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c, uint256[4] memory pub) = AirdropProofA.get();
        (,,, uint256[4] memory votePub) = VoteProof.get();
        assertTrue(pub[1] != votePub[1]);
        expectRevert(
            relayer,
            address(poll),
            abi.encodeCall(ZkVote.vote, (PROPOSAL, pub[1], YES, a, b, c)),
            ZkVote.InvalidProof.selector
        );
    }

    function test_optionOutOfRangeReverts() public {
        expectRevert(relayer, address(poll), _vote(2), ZkVote.BadOption.selector);
    }

    function test_unknownProposalReverts() public {
        (uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c, uint256[4] memory pub) = VoteProof.get();
        expectRevert(
            relayer, address(poll), abi.encodeCall(ZkVote.vote, (8, pub[1], YES, a, b, c)), ZkVote.UnknownProposal.selector
        );
    }
}
