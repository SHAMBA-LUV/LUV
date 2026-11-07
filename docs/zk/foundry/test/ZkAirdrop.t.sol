// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ZkTest, Actor, MockToken} from "./ZkTest.sol";
import {AirdropProofA} from "./fixtures/AirdropProofA.sol"; // member #5 → 0xB0B, round 1
import {AirdropProofB} from "./fixtures/AirdropProofB.sol"; // member #2 → 0xCAFE, round 1
import {MembershipVerifier} from "../src/verifiers/MembershipVerifier.sol";
import {IMembershipVerifier} from "../src/interfaces/IMembershipVerifier.sol";
import {ZkAirdrop, IERC20Minimal} from "../src/ZkAirdrop.sol";

contract ZkAirdropTest is ZkTest {
    uint256 constant ROUND = 1; // = AIRDROP_SCOPE in circom/make-inputs.mjs
    uint256 constant AMOUNT = 1_000_000_000_000 ether; // a 1-trillion gesture, 18 decimals
    address constant BOB = address(0xB0B);
    address constant CAFE = address(0xCAFE);

    MockToken token;
    MembershipVerifier verifier;
    ZkAirdrop drop;
    Actor relayer;
    Actor stranger;
    uint256 root;

    function setUp() public {
        token = new MockToken(10 * AMOUNT);
        verifier = new MembershipVerifier();
        drop = new ZkAirdrop(IERC20Minimal(address(token)), IMembershipVerifier(address(verifier)), ROUND, AMOUNT);
        token.transfer(address(drop), 10 * AMOUNT);
        (,,, uint256[4] memory pub) = AirdropProofA.get();
        root = pub[0];
        drop.addRoot(root);
        relayer = new Actor();
        stranger = new Actor();
    }

    function _claimA(address recipient) internal pure returns (bytes memory) {
        (uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c, uint256[4] memory pub) = AirdropProofA.get();
        return abi.encodeCall(ZkAirdrop.claim, (pub[0], pub[1], recipient, a, b, c));
    }

    function test_fixtureMatchesStatement() public pure {
        (,,, uint256[4] memory pub) = AirdropProofA.get();
        assertEq(pub[2], uint256(uint160(BOB)));
        assertEq(pub[3], ROUND);
    }

    /// Anyone can relay the proof (gasless for the member); the tokens go to the bound recipient.
    function test_claimPaysBoundRecipient() public {
        mustSucceed(relayer, address(drop), _claimA(BOB));
        assertEq(token.balanceOf(BOB), AMOUNT);
        assertEq(token.balanceOf(address(relayer)), 0);
    }

    function test_twoMembersBothClaim() public {
        mustSucceed(relayer, address(drop), _claimA(BOB));
        (uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c, uint256[4] memory pub) = AirdropProofB.get();
        mustSucceed(relayer, address(drop), abi.encodeCall(ZkAirdrop.claim, (pub[0], pub[1], CAFE, a, b, c)));
        assertEq(token.balanceOf(CAFE), AMOUNT);
    }

    function test_doubleClaimReverts() public {
        mustSucceed(relayer, address(drop), _claimA(BOB));
        expectRevert(stranger, address(drop), _claimA(BOB), ZkAirdrop.NullifierUsed.selector);
    }

    /// A front-runner copies the proof from the mempool and swaps in their own address.
    function test_frontRunnerCannotRedirect() public {
        expectRevert(stranger, address(drop), _claimA(address(stranger)), ZkAirdrop.InvalidProof.selector);
    }

    function test_unknownRootReverts() public {
        drop.revokeRoot(root);
        expectRevert(relayer, address(drop), _claimA(BOB), ZkAirdrop.UnknownRoot.selector);
    }

    /// The same member's proof for round 1 is useless in round 2 (scope is a public signal).
    function test_otherRoundRejectsProof() public {
        ZkAirdrop round2 =
            new ZkAirdrop(IERC20Minimal(address(token)), IMembershipVerifier(address(verifier)), 2, AMOUNT);
        round2.addRoot(root);
        expectRevert(relayer, address(round2), _claimA(BOB), ZkAirdrop.InvalidProof.selector);
    }

    function test_onlyOwnerManagesRoots() public {
        expectRevert(stranger, address(drop), abi.encodeCall(ZkAirdrop.addRoot, (123)), ZkAirdrop.NotOwner.selector);
    }

    function test_zeroRecipientReverts() public {
        expectRevert(relayer, address(drop), _claimA(address(0)), ZkAirdrop.ZeroAddress.selector);
    }
}
