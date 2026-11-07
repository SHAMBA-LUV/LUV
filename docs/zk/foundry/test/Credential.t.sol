// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ZkTest, Actor} from "./ZkTest.sol";
import {ZkConstants} from "./fixtures/ZkConstants.sol";
import {CredentialProof} from "./fixtures/CredentialProof.sol"; // issuer-signed, born 1990, subject 0xA11CE
import {CredentialVerifier} from "../src/verifiers/CredentialVerifier.sol";
import {CredentialGate, ICredentialVerifier} from "../src/CredentialGate.sol";

/// The fixed design: EdDSA-signed attribute + range-checked comparison inside the circuit.
/// (A minor's credential has no proof at all: build.sh shows witness generation failing.)
contract CredentialTest is ZkTest {
    address constant ADULT = address(0xA11CE);

    CredentialVerifier verifier;
    CredentialGate gate;
    Actor relayer;

    function setUp() public {
        verifier = new CredentialVerifier();
        gate = _gate(ZkConstants.ISSUER_AX, ZkConstants.ISSUER_AY, ZkConstants.CURRENT_YEAR, ZkConstants.MIN_AGE);
        relayer = new Actor();
    }

    function _gate(uint256 ax, uint256 ay, uint256 year, uint256 minAge) internal returns (CredentialGate) {
        return new CredentialGate(ICredentialVerifier(address(verifier)), ax, ay, year, minAge);
    }

    function _prove(address subject) internal pure returns (bytes memory) {
        (uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c,) = CredentialProof.get();
        return abi.encodeCall(CredentialGate.prove, (subject, a, b, c));
    }

    function test_adultWithSignedCredentialIsVerified() public {
        mustSucceed(relayer, address(gate), _prove(ADULT));
        assertTrue(gate.verified(ADULT));
    }

    function test_publicSignalsRevealNoAttribute() public pure {
        (,,, uint256[5] memory pub) = CredentialProof.get();
        assertEq(pub[0], ZkConstants.ISSUER_AX);
        assertEq(pub[2], 2026);
        assertEq(pub[3], 18);
        assertEq(pub[4], uint256(uint160(ADULT))); // the birth year (1990) appears nowhere
    }

    /// The subject is inside the signed message: the credential can't be moved to another address.
    function test_credentialIsBoundToSubject() public {
        expectRevert(relayer, address(gate), _prove(address(relayer)), CredentialGate.InvalidProof.selector);
    }

    /// A gate that trusts a different issuer rejects this credential.
    function test_otherIssuerRejected() public {
        CredentialGate other = _gate(ZkConstants.ISSUER_AX, ZkConstants.ISSUER_AY + 1, 2026, 18);
        expectRevert(relayer, address(other), _prove(ADULT), CredentialGate.InvalidProof.selector);
    }

    /// The proof is for "≥ 18 in 2026": a stricter policy (≥ 40) needs a new proof (age 36 fails it).
    function test_policyIsPartOfTheStatement() public {
        CredentialGate strict = _gate(ZkConstants.ISSUER_AX, ZkConstants.ISSUER_AY, 2026, 40);
        expectRevert(relayer, address(strict), _prove(ADULT), CredentialGate.InvalidProof.selector);
    }

    function test_gasCredentialVerify() public {
        (uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c, uint256[5] memory pub) = CredentialProof.get();
        uint256 g = gasleft();
        bool ok = verifier.verifyProof(a, b, c, pub);
        emit log_named_uint("gas: Groth16 verify, 5 public inputs (credential)", g - gasleft());
        assertTrue(ok);
    }
}
