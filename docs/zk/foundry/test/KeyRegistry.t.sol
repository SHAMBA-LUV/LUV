// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ZkTest, Actor} from "./ZkTest.sol";
import {BN254} from "../src/BN254.sol";
import {KeyRegistry} from "../src/KeyRegistry.sol";

/// The prover runs inside the test, using the same precompiles: a Σ-protocol needs no fixtures.
contract KeyRegistryTest is ZkTest {
    using BN254 for BN254.G1;

    uint256 constant SECRET = 0x5ec4e7; // demo only — real keys are random
    uint256 constant NONCE = 0x0dd5;    // demo only — real nonces are fresh and random per proof

    KeyRegistry reg;
    Actor alice;
    Actor mallory;

    function setUp() public {
        reg = new KeyRegistry();
        alice = new Actor();
        mallory = new Actor();
    }

    /// Schnorr prover: R = r·G, c = H(…, account, X, R), s = r + c·x  (mod N)
    function _prove(address account, uint256 x, uint256 r)
        internal
        view
        returns (BN254.G1 memory X, BN254.G1 memory R, uint256 s)
    {
        X = BN254.generator().mul(x);
        R = BN254.generator().mul(r);
        uint256 c = reg.challenge(account, X, R);
        s = addmod(r, mulmod(c, x, BN254.N), BN254.N);
    }

    function _register(BN254.G1 memory X, BN254.G1 memory R, uint256 s) internal pure returns (bytes memory) {
        return abi.encodeCall(KeyRegistry.register, (X, R, s));
    }

    function test_registerWithProofOfPossession() public {
        (BN254.G1 memory X, BN254.G1 memory R, uint256 s) = _prove(address(alice), SECRET, NONCE);
        mustSucceed(alice, address(reg), _register(X, R, s));
        (uint256 kx, uint256 ky) = reg.keyOf(address(alice));
        assertEq(kx, X.x);
        assertEq(ky, X.y);
    }

    /// Mallory copies Alice's proof from the mempool: the challenge includes msg.sender, so it fails.
    function test_proofIsBoundToSender() public {
        (BN254.G1 memory X, BN254.G1 memory R, uint256 s) = _prove(address(alice), SECRET, NONCE);
        expectRevert(mallory, address(reg), _register(X, R, s), KeyRegistry.InvalidProof.selector);
    }

    /// Without knowing x, Mallory can't register Alice's public key under her own account.
    function test_cannotRegisterSomeoneElsesKey() public {
        BN254.G1 memory X = BN254.generator().mul(SECRET);
        (, BN254.G1 memory R, uint256 s) = _prove(address(mallory), 0xbad, NONCE); // proof for a different x
        expectRevert(mallory, address(reg), _register(X, R, s), KeyRegistry.InvalidProof.selector);
    }

    function test_tamperedResponseFails() public {
        (BN254.G1 memory X, BN254.G1 memory R, uint256 s) = _prove(address(alice), SECRET, NONCE);
        expectRevert(alice, address(reg), _register(X, R, addmod(s, 1, BN254.N)), KeyRegistry.InvalidProof.selector);
    }

    function test_offCurvePointRejected() public {
        (BN254.G1 memory X, BN254.G1 memory R, uint256 s) = _prove(address(alice), SECRET, NONCE);
        X.y = X.y ^ 1;
        expectRevert(alice, address(reg), _register(X, R, s), KeyRegistry.NotOnCurve.selector);
    }

    function test_nonCanonicalScalarRejected() public {
        (BN254.G1 memory X, BN254.G1 memory R, uint256 s) = _prove(address(alice), SECRET, NONCE);
        expectRevert(alice, address(reg), _register(X, R, s + BN254.N), KeyRegistry.ScalarOutOfRange.selector);
    }

    function test_oneKeyPerAccountAndAccountPerKey() public {
        (BN254.G1 memory X, BN254.G1 memory R, uint256 s) = _prove(address(alice), SECRET, NONCE);
        mustSucceed(alice, address(reg), _register(X, R, s));
        (X, R, s) = _prove(address(alice), SECRET + 1, NONCE + 1);
        expectRevert(alice, address(reg), _register(X, R, s), KeyRegistry.AlreadyRegistered.selector);
        (X, R, s) = _prove(address(mallory), SECRET, NONCE + 2); // even WITH a valid proof
        expectRevert(mallory, address(reg), _register(X, R, s), KeyRegistry.KeyTaken.selector);
    }
}
