// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice The verifier generated from circom/membership.circom by
///         `snarkjs zkey export solidityverifier` (renamed MembershipVerifier by build.sh).
/// Public signals, in circuit order: [root, nullifierHash, message, scope].
interface IMembershipVerifier {
    function verifyProof(
        uint256[2] calldata pA,
        uint256[2][2] calldata pB,
        uint256[2] calldata pC,
        uint256[4] calldata pubSignals
    ) external view returns (bool);
}
