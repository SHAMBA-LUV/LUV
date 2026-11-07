// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ZkTest, Actor, MockToken} from "./ZkTest.sol";
import {ZkConstants} from "./fixtures/ZkConstants.sol"; // members + root from make-inputs.mjs
import {AirdropProofA} from "./fixtures/AirdropProofA.sol";
import {PoseidonT3Deployer, IPoseidonT3} from "../src/generated/PoseidonT3.sol";
import {ZkGroup} from "../src/ZkGroup.sol";
import {ZkAirdrop, IERC20Minimal} from "../src/ZkAirdrop.sol";
import {MembershipVerifier} from "../src/verifiers/MembershipVerifier.sol";
import {IMembershipVerifier} from "../src/interfaces/IMembershipVerifier.sol";
import {IRootSource} from "../src/interfaces/IRootSource.sol";

contract ZkGroupTest is ZkTest {
    uint256 constant AMOUNT = 1_000_000_000_000 ether;
    uint256 constant FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617;

    IPoseidonT3 hasher;
    ZkGroup group;
    Actor stranger;

    function setUp() public {
        hasher = PoseidonT3Deployer.deploy();
        group = new ZkGroup(hasher, address(this)); // this test is the registrar
        stranger = new Actor();
        uint256[8] memory m = ZkConstants.members();
        for (uint256 i; i < 8; ++i) group.join(m[i]);
    }

    /// The chain computed the same root as the off-chain tree that the proofs were made against.
    function test_onchainRootEqualsOffchainTree() public view {
        assertEq(group.root(), ZkConstants.GROUP_ROOT);
        (,,, uint256[4] memory pub) = AirdropProofA.get();
        assertEq(group.root(), pub[0]);
        assertEq(group.nextIndex(), 8);
    }

    /// Solidity Poseidon == circuit Poseidon, on the standard circomlibjs test vector.
    function test_poseidonMatchesCircuit() public view {
        // Poseidon(1, 2) — the circomlib/circomlibjs test vector
        assertEq(hasher.poseidon([uint256(1), uint256(2)]), 0x115cc0f5e7d690413df64c6b9662e9cf2a3617f2743245519e19607a4417189a);
    }

    /// End to end: a real Groth16 proof verified against the root the CHAIN computed.
    function test_claimAgainstOnchainRoot() public {
        MockToken token = new MockToken(AMOUNT);
        ZkAirdrop drop = new ZkAirdrop(
            IERC20Minimal(address(token)),
            IMembershipVerifier(address(new MembershipVerifier())),
            IRootSource(address(group)),
            1,
            AMOUNT
        );
        token.transfer(address(drop), AMOUNT);
        (uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c, uint256[4] memory pub) = AirdropProofA.get();
        mustSucceed(stranger, address(drop), abi.encodeCall(ZkAirdrop.claim, (pub[0], pub[1], address(0xB0B), a, b, c)));
        assertEq(token.balanceOf(address(0xB0B)), AMOUNT);
    }

    /// New members change the root, but proofs made against a recent root stay valid.
    function test_rootHistoryKeepsRecentProofsValid() public {
        uint256 old = group.root();
        group.join(uint256(keccak256("member #8")) % FIELD);
        assertTrue(group.root() != old);
        assertTrue(group.isKnownRoot(old));
        assertTrue(group.isKnownRoot(group.root()));
        assertFalse(group.isKnownRoot(12345));
        assertFalse(group.isKnownRoot(0));
    }

    function test_gasPerJoin() public {
        uint256 g = gasleft();
        group.join(uint256(keccak256("member #9")) % FIELD);
        emit log_named_uint("gas: ZkGroup.join (depth 10, 10 Poseidon hashes)", g - gasleft());
    }

    function test_onlyRegistrarAdds() public {
        expectRevert(stranger, address(group), abi.encodeCall(ZkGroup.join, (42)), ZkGroup.NotRegistrar.selector);
    }

    function test_openGroupAcceptsAnyone() public {
        ZkGroup open = new ZkGroup(hasher, address(0));
        mustSucceed(stranger, address(open), abi.encodeCall(ZkGroup.join, (42)));
        assertEq(open.nextIndex(), 1);
    }

    function test_duplicateAndInvalidCommitmentsRejected() public {
        uint256[8] memory m = ZkConstants.members();
        Actor me = new Actor();
        ZkGroup g = new ZkGroup(hasher, address(me));
        mustSucceed(me, address(g), abi.encodeCall(ZkGroup.join, (m[0])));
        expectRevert(me, address(g), abi.encodeCall(ZkGroup.join, (m[0])), ZkGroup.AlreadyMember.selector);
        expectRevert(me, address(g), abi.encodeCall(ZkGroup.join, (0)), ZkGroup.BadCommitment.selector);
        expectRevert(me, address(g), abi.encodeCall(ZkGroup.join, (FIELD)), ZkGroup.BadCommitment.selector);
    }
}
