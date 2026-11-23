// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ZkTest, Actor, MockToken} from "./ZkTest.sol";
import {ZkConstants} from "./fixtures/ZkConstants.sol";
import {AirdropProofA} from "./fixtures/AirdropProofA.sol"; // member #5 → 0xB0B, scope 1
import {AirdropProofB} from "./fixtures/AirdropProofB.sol"; // member #2 → 0xCAFE, scope 1
import {PoseidonT3Deployer} from "../src/generated/PoseidonT3.sol";
import {MembershipVerifier} from "../src/verifiers/MembershipVerifier.sol";
import {IMembershipVerifier} from "../src/interfaces/IMembershipVerifier.sol";
import {ShieldedPool, IERC20Pull} from "../src/ShieldedPool.sol";

/// Eight depositors (separate Actor addresses) pay into the pool with the 8 commitments from
/// make-inputs.mjs. The membership proofs generated for scope 1 then work as withdrawal proofs,
/// paying recipients that have no on-chain link to any depositor.
contract ShieldedPoolTest is ZkTest {
    uint256 constant DENOM = 1_000 ether;
    uint256 constant SCOPE = 1; // = AIRDROP_SCOPE: the fixtures double as withdrawal proofs
    address constant BOB = address(0xB0B);

    MockToken token;
    MembershipVerifier verifier;
    ShieldedPool pool;
    Actor relayer;

    function setUp() public {
        token = new MockToken(100 * DENOM);
        verifier = new MembershipVerifier();
        pool = _newPool();
        _depositAll(pool, 8);
        relayer = new Actor();
    }

    function _newPool() internal returns (ShieldedPool) {
        return new ShieldedPool(
            IERC20Pull(address(token)),
            DENOM,
            IMembershipVerifier(address(verifier)),
            PoseidonT3Deployer.deploy(),
            SCOPE
        );
    }

    function _depositAll(ShieldedPool p, uint256 n) internal {
        uint256[8] memory m = ZkConstants.members();
        for (uint256 i; i < n; ++i) {
            Actor depositor = new Actor();
            token.transfer(address(depositor), DENOM);
            mustSucceed(depositor, address(token), abi.encodeCall(MockToken.approve, (address(p), DENOM)));
            mustSucceed(depositor, address(p), abi.encodeCall(ShieldedPool.deposit, (m[i])));
        }
    }

    function _withdrawA(address recipient) internal pure returns (bytes memory) {
        (uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c, uint256[4] memory pub) = AirdropProofA.get();
        return abi.encodeCall(ShieldedPool.withdraw, (pub[0], pub[1], recipient, a, b, c));
    }

    function test_depositsBuildTheProvenTree() public view {
        assertEq(pool.tree().root(), ZkConstants.GROUP_ROOT);
        assertEq(token.balanceOf(address(pool)), 8 * DENOM);
    }

    function test_privateWithdrawal() public {
        uint256 g = gasleft();
        mustSucceed(relayer, address(pool), _withdrawA(BOB));
        emit log_named_uint("gas: ShieldedPool.withdraw (proof + transfer, via relayer)", g - gasleft());
        assertEq(token.balanceOf(BOB), DENOM);
        assertEq(token.balanceOf(address(pool)), 7 * DENOM);
    }

    function test_twoWithdrawalsFromDifferentNotes() public {
        mustSucceed(relayer, address(pool), _withdrawA(BOB));
        (uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c, uint256[4] memory pub) = AirdropProofB.get();
        mustSucceed(relayer, address(pool), abi.encodeCall(ShieldedPool.withdraw, (pub[0], pub[1], address(0xCAFE), a, b, c)));
        assertEq(token.balanceOf(address(pool)), 6 * DENOM);
    }

    function test_doubleWithdrawalReverts() public {
        mustSucceed(relayer, address(pool), _withdrawA(BOB));
        expectRevert(relayer, address(pool), _withdrawA(BOB), ShieldedPool.NullifierUsed.selector);
    }

    function test_relayerCannotRedirectFunds() public {
        expectRevert(relayer, address(pool), _withdrawA(address(relayer)), ShieldedPool.InvalidProof.selector);
    }

    /// A pool whose deposits never formed the proven tree doesn't know that root.
    function test_rootFromAnotherTreeIsUnknown() public {
        ShieldedPool small = _newPool();
        _depositAll(small, 3); // members #0..#2 only — a different root
        expectRevert(relayer, address(small), _withdrawA(BOB), ShieldedPool.UnknownRoot.selector);
    }

    function test_depositRequiresPayment() public {
        Actor broke = new Actor();
        (bool ok,) = broke.exec(address(pool), abi.encodeCall(ShieldedPool.deposit, (123)));
        assertFalse(ok); // no allowance, no balance → transferFrom fails, nothing joins the tree
        assertEq(pool.tree().nextIndex(), 8);
    }

    function test_gasDeposit() public {
        Actor d = new Actor();
        token.transfer(address(d), DENOM);
        mustSucceed(d, address(token), abi.encodeCall(MockToken.approve, (address(pool), DENOM)));
        uint256 g = gasleft();
        mustSucceed(d, address(pool), abi.encodeCall(ShieldedPool.deposit, (uint256(keccak256("note")) >> 8)));
        emit log_named_uint("gas: ShieldedPool.deposit (transferFrom + tree insert)", g - gasleft());
    }
}
