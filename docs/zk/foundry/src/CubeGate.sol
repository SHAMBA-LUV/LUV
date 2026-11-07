// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Interface of the verifier that `snarkjs zkey export solidityverifier` generates
///         (template: https://github.com/iden3/snarkjs/blob/master/templates/verifier_groth16.sol.ejs).
///         It runs the Groth16 pairing check on the EIP-196/197 BN254 precompiles
///         (ecAdd 0x06, ecMul 0x07, ecPairing 0x08) and returns false for an invalid proof.
interface IGroth16Verifier {
    function verifyProof(
        uint256[2] calldata pA,
        uint256[2][2] calldata pB,
        uint256[2] calldata pC,
        uint256[1] calldata pubSignals
    ) external view returns (bool);
}

/// @title CubeGate — an on-chain consumer of the cube.circom proof.
/// @notice Lets an address in if it presents a valid proof of knowing x with x³ + x + 5 = 35.
///
/// ⚠ TEACHING CONTRACT — it deliberately shows the classic replay / front-running flaw:
///   the proof does not commit to msg.sender, so once one proof lands in the mempool anyone can
///   copy it. Real applications put the caller (or a nullifier + recipient) into the circuit's
///   PUBLIC signals so a proof is only valid for one beneficiary and one use — see ZkAirdrop.sol and the guide §10.
contract CubeGate {
    error WrongStatement();
    error InvalidProof();

    event Entered(address indexed who);

    IGroth16Verifier public immutable verifier;
    uint256 public constant STATEMENT = 35; // the public output the proof must be about

    mapping(address => bool) public entered;

    constructor(IGroth16Verifier v) {
        verifier = v;
    }

    function enter(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[1] calldata pub
    ) external {
        // 1. check the statement: a valid proof of the WRONG statement is still a valid proof
        if (pub[0] != STATEMENT) revert WrongStatement();
        // 2. check the proof
        if (!verifier.verifyProof(a, b, c, pub)) revert InvalidProof();
        entered[msg.sender] = true;
        emit Entered(msg.sender);
    }
}
