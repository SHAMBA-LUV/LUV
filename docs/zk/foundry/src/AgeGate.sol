// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Verifier generated from circom/age_buggy.circom. Public signals (outputs first):
/// [isAdult, currentYear, minAge, subject]
interface IAgeVerifier {
    function verifyProof(
        uint256[2] calldata pA,
        uint256[2][2] calldata pB,
        uint256[2] calldata pC,
        uint256[4] calldata pubSignals
    ) external view returns (bool);
}

/// @title AgeGate — ⚠ a CORRECT contract on top of a BROKEN circuit.
///
/// Everything here is done right: the contract assembles the statement itself, demands
/// isAdult == 1, binds the subject. It is still exploitable, because age_buggy.circom never
/// constrains isAdult (see foundry/test/UnderConstrained.t.sol: a 10-year-old gets in).
/// Contract audits cannot catch circuit bugs — the circuit must be audited too.
/// The fixed design is CredentialGate.sol + circom/credential.circom.
contract AgeGate {
    error InvalidProof();

    event AdultVerified(address indexed subject);

    IAgeVerifier public immutable verifier;
    uint256 public immutable currentYear;
    uint256 public immutable minAge;
    mapping(address => bool) public verifiedAdult;

    constructor(IAgeVerifier verifier_, uint256 currentYear_, uint256 minAge_) {
        verifier = verifier_;
        currentYear = currentYear_;
        minAge = minAge_;
    }

    function prove(address subject, uint256[2] calldata a, uint256[2][2] calldata b, uint256[2] calldata c) external {
        uint256[4] memory pub = [uint256(1), currentYear, minAge, uint256(uint160(subject))];
        if (!verifier.verifyProof(a, b, c, pub)) revert InvalidProof();
        verifiedAdult[subject] = true;
        emit AdultVerified(subject);
    }
}
