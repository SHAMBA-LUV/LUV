// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ZkTest, Actor} from "./ZkTest.sol";
import {AgeHonestProof} from "./fixtures/AgeHonestProof.sol"; // honest witness, age 10 → isAdult = 0
import {AgeForgedProof} from "./fixtures/AgeForgedProof.sol"; // forger's witness, age 10 → isAdult = 1
import {AgeBuggyVerifier} from "../src/verifiers/AgeBuggyVerifier.sol";
import {AgeGate, IAgeVerifier} from "../src/AgeGate.sol";

/// The under-constrained circuit attack, end to end, on a real verifier.
/// Both proofs below were made with the SAME proving key for the SAME 10-year-old; the second
/// came from circom/attack/age_forger.circom, whose constraint system is byte-identical.
contract UnderConstrainedTest is ZkTest {
    address constant ATTACKER = address(0xBAD);

    AgeBuggyVerifier verifier;
    AgeGate gate;
    Actor anyone;

    function setUp() public {
        verifier = new AgeBuggyVerifier();
        gate = new AgeGate(IAgeVerifier(address(verifier)), 2026, 18);
        anyone = new Actor();
    }

    function test_honestWitnessSaysMinor() public {
        (uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c, uint256[4] memory pub) = AgeHonestProof.get();
        assertEq(pub[0], 0); // isAdult = 0: the honest witness generator tells the truth
        assertTrue(verifier.verifyProof(a, b, c, pub));
        // ...so the gate (which demands isAdult = 1) rejects it
        expectRevert(anyone, address(gate), abi.encodeCall(AgeGate.prove, (ATTACKER, a, b, c)), AgeGate.InvalidProof.selector);
    }

    /// ⚠ THE ATTACK: the forged witness satisfies every constraint, so its proof is VALID.
    function test_attack_forgedProofIsAccepted() public {
        (uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c, uint256[4] memory pub) = AgeForgedProof.get();
        assertEq(pub[0], 1); // isAdult = 1 for a 10-year-old
        assertTrue(verifier.verifyProof(a, b, c, pub));
        mustSucceed(anyone, address(gate), abi.encodeCall(AgeGate.prove, (ATTACKER, a, b, c)));
        assertTrue(gate.verifiedAdult(ATTACKER)); // the contract was "correct" — the circuit wasn't
    }
}
