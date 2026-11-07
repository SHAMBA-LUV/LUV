// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ZkTest} from "./ZkTest.sol";
import {CubeProof} from "./fixtures/CubeProof.sol";
import {CubePlonkProof} from "./fixtures/CubePlonkProof.sol";
import {CubeFflonkProof} from "./fixtures/CubeFflonkProof.sol";
import {CubeVerifier} from "../src/verifiers/CubeVerifier.sol";
import {CubePlonkVerifier} from "../src/verifiers/CubePlonkVerifier.sol";
import {CubeFflonkVerifier} from "../src/verifiers/CubeFflonkVerifier.sol";

/// One circuit (cube.circom), three proof systems, measured on the same EVM.
///   Groth16 — per-circuit trusted setup (phase 2), 3-point proof
///   PLONK   — universal setup only (the powers of tau), 24-word proof
///   FFLONK  — universal setup only, PLONK variant optimised for cheap EVM verification
contract ProofSystemsTest is ZkTest {
    CubeVerifier groth16;
    CubePlonkVerifier plonk;
    CubeFflonkVerifier fflonk;

    function setUp() public {
        groth16 = new CubeVerifier();
        plonk = new CubePlonkVerifier();
        fflonk = new CubeFflonkVerifier();
    }

    function test_groth16() public {
        (uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c, uint256[1] memory pub) = CubeProof.get();
        uint256 g = gasleft();
        bool ok = groth16.verifyProof(a, b, c, pub);
        emit log_named_uint("gas: Groth16 verifyProof", g - gasleft());
        assertTrue(ok);
        pub[0] = 36;
        assertFalse(groth16.verifyProof(a, b, c, pub));
    }

    function test_plonk() public {
        (uint256[24] memory proof, uint256[1] memory pub) = CubePlonkProof.get();
        uint256 g = gasleft();
        bool ok = plonk.verifyProof(proof, pub);
        emit log_named_uint("gas: PLONK verifyProof", g - gasleft());
        assertTrue(ok);
        pub[0] = 36;
        assertFalse(plonk.verifyProof(proof, pub));
    }

    function test_fflonk() public {
        (bytes32[24] memory proof, uint256[1] memory pub) = CubeFflonkProof.get();
        uint256 g = gasleft();
        bool ok = fflonk.verifyProof(proof, pub);
        emit log_named_uint("gas: FFLONK verifyProof", g - gasleft());
        assertTrue(ok);
        pub[0] = 36;
        assertFalse(fflonk.verifyProof(proof, pub));
    }

    function test_allThreeProveTheSameStatement() public pure {
        (,,, uint256[1] memory g) = CubeProof.get();
        (, uint256[1] memory p) = CubePlonkProof.get();
        (, uint256[1] memory f) = CubeFflonkProof.get();
        assertEq(g[0], 35);
        assertEq(p[0], 35);
        assertEq(f[0], 35);
    }
}
