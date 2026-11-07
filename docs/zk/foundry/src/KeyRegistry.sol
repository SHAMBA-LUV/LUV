// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BN254} from "./BN254.sol";

/// @title KeyRegistry — on-chain verification of a Schnorr proof of knowledge (a Σ-protocol)
///        on BN254. No circuit, no trusted setup: ~19k gas of precompiles per proof.
///
/// Statement: "msg.sender knows x such that X = x·G1."  Fiat–Shamir challenge:
///   c = sha256(DOMAIN ‖ chainid ‖ address(this) ‖ msg.sender ‖ X ‖ R)  mod N
///   accept iff  s·G1 == R + c·X
///
/// Why register keys with a proof of possession?
///   • BLS / aggregate-key schemes: without it, a "rogue key" X' = Y − ΣX_honest lets an
///     attacker forge aggregate signatures for keys it doesn't control.
///   • Stealth-address / encryption-key registries: nobody can register someone else's key.
///   • ZK identity keys: binds an off-chain proving key to an Ethereum account.
///
/// Binding the challenge to (chainid, this contract, msg.sender) makes a proof single-purpose:
/// a front-runner who copies it from the mempool computes a different challenge and fails —
/// the fix for the replay flaw CubeGate demonstrates. Omitting X from the hash would
/// reintroduce Frozen Heart (see js/04-fiat-shamir.mjs). The off-chain prover is
/// js/08-schnorr-bn254.mjs and produces byte-identical challenges.
contract KeyRegistry {
    using BN254 for BN254.G1;

    error NotOnCurve();
    error ScalarOutOfRange();
    error AlreadyRegistered();
    error KeyTaken();
    error InvalidProof();

    event KeyRegistered(address indexed account, uint256 x, uint256 y);

    bytes32 public constant DOMAIN = "LUV-ZK-GUIDE/KeyRegistry/v1";

    mapping(address => BN254.G1) internal _keyOf;
    mapping(bytes32 => address) public ownerOfKey; // keccak(X) => account (one account per key)

    function keyOf(address account) external view returns (uint256 x, uint256 y) {
        BN254.G1 memory k = _keyOf[account];
        return (k.x, k.y);
    }

    /// The Fiat–Shamir challenge for `account` — public so provers and tests can compute it.
    function challenge(address account, BN254.G1 memory X, BN254.G1 memory R) public view returns (uint256) {
        return uint256(sha256(abi.encodePacked(DOMAIN, block.chainid, address(this), account, X.x, X.y, R.x, R.y)))
            % BN254.N;
    }

    function register(BN254.G1 calldata X, BN254.G1 calldata R, uint256 s) external {
        BN254.G1 memory Xm = X;
        BN254.G1 memory Rm = R;
        // validate every input: points on the curve (not infinity), scalar canonical
        if (!Xm.isOnCurve() || !Rm.isOnCurve()) revert NotOnCurve();
        if (s >= BN254.N) revert ScalarOutOfRange();
        if (!_keyOf[msg.sender].isInfinity()) revert AlreadyRegistered();
        bytes32 keyId = keccak256(abi.encode(Xm.x, Xm.y));
        if (ownerOfKey[keyId] != address(0)) revert KeyTaken();

        uint256 c = challenge(msg.sender, Xm, Rm);
        BN254.G1 memory lhs = BN254.generator().mul(s);
        BN254.G1 memory rhs = Rm.add(Xm.mul(c));
        if (!lhs.eq(rhs)) revert InvalidProof();

        _keyOf[msg.sender] = Xm;
        ownerOfKey[keyId] = msg.sender;
        emit KeyRegistered(msg.sender, Xm.x, Xm.y);
    }
}
