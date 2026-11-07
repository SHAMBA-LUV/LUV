// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Verifier generated from circom/credential.circom. Public signals:
/// [issuerAx, issuerAy, currentYear, minAge, subject]
interface ICredentialVerifier {
    function verifyProof(
        uint256[2] calldata pA,
        uint256[2][2] calldata pB,
        uint256[2] calldata pC,
        uint256[5] calldata pubSignals
    ) external view returns (bool);
}

/// @title CredentialGate — private, issuer-backed age (or any attribute) verification.
///
/// A trusted issuer (KYC provider, government app, DAO) signs Poseidon(birthYear, subject)
/// with an EdDSA key on Baby Jubjub ONCE, off-chain. The holder then proves on-chain that
/// "my issuer-signed birth year makes me ≥ minAge" without revealing the birth year, the
/// signature, or anything else. The circuit verifies the signature and a range-checked
/// comparison; the contract pins the issuer key and the policy.
///
/// Because `subject` is inside the signed message, a credential cannot be lent or sold to
/// another address, and a proof cannot be redirected by a front-runner.
///
/// ⚠ Teaching contract: `currentYear` is fixed at deployment for reproducible tests; derive it
///   from block.timestamp (or sign full birth dates) in production, and use a verifier from a
///   real ceremony — the committed CredentialVerifier comes from a DEV ceremony.
contract CredentialGate {
    error InvalidProof();

    event Verified(address indexed subject);

    ICredentialVerifier public immutable verifier;
    uint256 public immutable issuerAx;
    uint256 public immutable issuerAy;
    uint256 public immutable currentYear;
    uint256 public immutable minAge;
    mapping(address => bool) public verified;

    constructor(ICredentialVerifier verifier_, uint256 ax, uint256 ay, uint256 currentYear_, uint256 minAge_) {
        verifier = verifier_;
        issuerAx = ax;
        issuerAy = ay;
        currentYear = currentYear_;
        minAge = minAge_;
    }

    /// Anyone may submit (relayable); only `subject` can benefit, because it is signed.
    function prove(address subject, uint256[2] calldata a, uint256[2][2] calldata b, uint256[2] calldata c) external {
        uint256[5] memory pub = [issuerAx, issuerAy, currentYear, minAge, uint256(uint160(subject))];
        if (!verifier.verifyProof(a, b, c, pub)) revert InvalidProof();
        verified[subject] = true;
        emit Verified(subject);
    }
}
