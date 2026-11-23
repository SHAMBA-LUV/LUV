// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/**
 * TwTest — self-contained Foundry test base (clean-room, zero external lib).
 *
 * Mirrors twengine/test/TwTest.sol: declares only the cheatcode (Vm) surface the
 * SHAMBA LUV suite uses, plus minimal asserts. No forge-std dependency — forge
 * discovers any contract with `test*` functions; inheriting this is enough.
 */
interface Vm {
    function prank(address) external;
    function startPrank(address) external;
    function stopPrank() external;
    function deal(address, uint256) external;
    function expectRevert() external;
    function expectRevert(bytes4) external;
    function warp(uint256) external;
    function addr(uint256) external returns (address);
    function sign(uint256, bytes32) external returns (uint8, bytes32, bytes32);
    function label(address, string calldata) external;
}

abstract contract TwTest {
    Vm internal constant vm = Vm(0x7109709ECfa91a80626fF3989D68f67F5b1DD12D);

    error AssertEq(uint256 a, uint256 b);
    error AssertEqAddr(address a, address b);
    error AssertTrue();
    error AssertGt(uint256 a, uint256 b);
    error AssertGe(uint256 a, uint256 b);
    error AssertApprox(uint256 a, uint256 b, uint256 tol);

    function assertEq(uint256 a, uint256 b) internal pure {
        if (a != b) revert AssertEq(a, b);
    }

    function assertEq(address a, address b) internal pure {
        if (a != b) revert AssertEqAddr(a, b);
    }

    function assertEq(bool a, bool b) internal pure {
        if (a != b) revert AssertTrue();
    }

    function assertTrue(bool c) internal pure {
        if (!c) revert AssertTrue();
    }

    function assertFalse(bool c) internal pure {
        if (c) revert AssertTrue();
    }

    function assertGt(uint256 a, uint256 b) internal pure {
        if (!(a > b)) revert AssertGt(a, b);
    }

    function assertGe(uint256 a, uint256 b) internal pure {
        if (!(a >= b)) revert AssertGe(a, b);
    }

    /// |a - b| <= tol
    function assertApproxEq(uint256 a, uint256 b, uint256 tol) internal pure {
        uint256 d = a > b ? a - b : b - a;
        if (d > tol) revert AssertApprox(a, b, tol);
    }
}
