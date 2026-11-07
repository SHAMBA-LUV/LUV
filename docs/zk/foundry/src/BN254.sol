// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title BN254 — G1 arithmetic on the alt_bn128 curve via the EVM precompiles.
///   ecAdd     0x06  (EIP-196)   150 gas
///   ecMul     0x07  (EIP-196)   6,000 gas
///   ecPairing 0x08  (EIP-197)   45,000 + 34,000·k gas      (prices: EIP-1108)
/// Curve: y² = x³ + 3 over F_P, generator G1 = (1, 2), prime group order N.
/// The precompiles encode the point at infinity as (0, 0).
library BN254 {
    error PrecompileFailed();

    uint256 internal constant P = 21888242871839275222246405745257275088696311157297823662689037894645226208583;
    uint256 internal constant N = 21888242871839275222246405745257275088548364400416034343698204186575808495617;

    struct G1 {
        uint256 x;
        uint256 y;
    }

    function generator() internal pure returns (G1 memory) {
        return G1(1, 2);
    }

    function add(G1 memory a, G1 memory b) internal view returns (G1 memory r) {
        uint256[4] memory input = [a.x, a.y, b.x, b.y];
        bool ok;
        assembly ("memory-safe") {
            ok := staticcall(gas(), 0x06, input, 0x80, r, 0x40)
        }
        if (!ok) revert PrecompileFailed();
    }

    function mul(G1 memory a, uint256 s) internal view returns (G1 memory r) {
        uint256[3] memory input = [a.x, a.y, s];
        bool ok;
        assembly ("memory-safe") {
            ok := staticcall(gas(), 0x07, input, 0x60, r, 0x40)
        }
        if (!ok) revert PrecompileFailed();
    }

    function eq(G1 memory a, G1 memory b) internal pure returns (bool) {
        return a.x == b.x && a.y == b.y;
    }

    function isInfinity(G1 memory a) internal pure returns (bool) {
        return a.x == 0 && a.y == 0;
    }

    /// true iff `a` is a valid, non-infinity curve point with canonical coordinates
    function isOnCurve(G1 memory a) internal pure returns (bool) {
        if (a.x >= P || a.y >= P || isInfinity(a)) return false;
        uint256 lhs = mulmod(a.y, a.y, P);
        uint256 rhs = addmod(mulmod(mulmod(a.x, a.x, P), a.x, P), 3, P);
        return lhs == rhs;
    }
}
