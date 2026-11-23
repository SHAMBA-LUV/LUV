// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// ZkTest — a zero-dependency test base (same philosophy as the repo-root test/TwTest.sol),
/// with NO cheatcodes at all. That makes every test here run unchanged under `forge test`
/// AND under the plain-EVM runner evm/run-tests.mjs (which has no cheatcodes).
///   • different callers  → Actor contracts (each has its own address)
///   • expected reverts   → low-level call + selector check (expectRevert)
abstract contract ZkTest {
    error AssertEq(uint256 a, uint256 b);
    error AssertTrue();
    error AssertFalse();
    error ExpectedRevert(bytes4 selector);
    error WrongRevert(bytes4 expected, bytes4 actual);

    /// DSTest-style log: `forge test -vv` prints it, and so does evm/run-tests.mjs
    event log_named_uint(string key, uint256 val);

    function assertEq(uint256 a, uint256 b) internal pure {
        if (a != b) revert AssertEq(a, b);
    }

    function assertTrue(bool c) internal pure {
        if (!c) revert AssertTrue();
    }

    function assertFalse(bool c) internal pure {
        if (c) revert AssertFalse();
    }

    /// assert that `actor` calling `target` with `data` reverts with custom error `selector`
    function expectRevert(Actor actor, address target, bytes memory data, bytes4 selector) internal {
        (bool ok, bytes memory ret) = actor.exec(target, data);
        if (ok) revert ExpectedRevert(selector);
        bytes4 got;
        if (ret.length >= 4) got = bytes4(ret);
        if (got != selector) revert WrongRevert(selector, got);
    }

    function mustSucceed(Actor actor, address target, bytes memory data) internal returns (bytes memory) {
        (bool ok, bytes memory ret) = actor.exec(target, data);
        if (!ok) {
            assembly {
                revert(add(ret, 32), mload(ret)) // bubble the real revert reason up
            }
        }
        return ret;
    }
}

/// A distinct msg.sender: forwards any call.
contract Actor {
    function exec(address target, bytes calldata data) external returns (bool ok, bytes memory ret) {
        (ok, ret) = target.call(data);
    }
}

/// Minimal ERC-20 for the airdrop and pool tests.
contract MockToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(uint256 supply) {
        balanceOf[msg.sender] = supply;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        return _move(msg.sender, to, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(allowance[from][msg.sender] >= amount, "allowance");
        allowance[from][msg.sender] -= amount;
        return _move(from, to, amount);
    }

    function _move(address from, address to, uint256 amount) internal returns (bool) {
        require(balanceOf[from] >= amount, "balance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}
