// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {TwTest} from "./TwTest.sol";
import {MockRouter} from "./MockRouter.sol";
import {ShambaLuv} from "../contracts/ShambaLuv.sol";

/// A tiny contract used as a non-EOA "pair" so walletToWallet is false on a sell.
contract DummyPair {
    receive() external payable {}
}

contract ShambaLuvTest is TwTest {
    ShambaLuv internal token;
    MockRouter internal router;
    DummyPair internal pair;

    address internal constant DEPLOYER = address(0xD0); // owner/admin, fee + maxTx exempt
    address internal constant TEAM = address(0x7EA);
    address internal constant LIQ = address(0x711);

    // fresh EOAs (no code) — not exempt, not reflection-excluded
    address internal user1 = address(0xA11CE);
    address internal user2 = address(0xB0B);
    address internal user3 = address(0xCAFE);

    address internal WETH = address(0x4E74); // mock weth

    uint256 internal constant SUPPLY = 1e35;
    // default payout threshold: 10 trillion LUV
    uint256 internal constant PAYOUT = 10_000_000_000_000 * 1e18;

    function setUp() public {
        router = new MockRouter(WETH);
        pair = new DummyPair();

        // deploy as DEPLOYER so owner/admin == DEPLOYER, router = our mock
        vm.prank(DEPLOYER);
        token = new ShambaLuv(TEAM, LIQ, address(router), WETH);

        // fund the mock router with ETH so swaps can pay out
        vm.deal(address(router), 100 ether);
    }

    // ─────────────────────────── metadata + genesis ───────────────────────────
    function testMetadataAndGenesis() public {
        assertTrue(keccak256(bytes(token.name())) == keccak256(bytes("SHAMBA")));
        assertTrue(keccak256(bytes(token.symbol())) == keccak256(bytes("LUV")));
        assertEq(uint256(token.decimals()), 18);
        assertEq(token.totalSupply(), SUPPLY);
        assertEq(token.balanceOf(DEPLOYER), SUPPLY);
        assertEq(token.owner(), DEPLOYER);
        assertEq(token.admin(), DEPLOYER);
        // genesis router approval (FIX #1)
        assertEq(token.allowance(address(token), address(router)), type(uint256).max);
    }

    // ─────────────────────────── unified payout threshold default ─────────────
    function testPayoutThresholdDefault() public {
        assertEq(token.payoutThreshold(), PAYOUT); // 10 trillion LUV
        // getConfig()[4] is now payoutThreshold (was swapThreshold)
        (, , , , uint256 payoutAt, ) = token.getConfig();
        assertEq(payoutAt, token.payoutThreshold());
    }

    // ─────────────────────────── wallet-to-wallet fee-free ────────────────────
    function testWalletToWalletFeeFree() public {
        uint256 amt = 1_000_000e18;
        // deployer (excluded) funds USER1
        vm.prank(DEPLOYER);
        token.transfer(user1, amt);
        assertEq(token.balanceOf(user1), amt);

        // USER1 -> USER2, both EOAs => no fee
        vm.prank(user1);
        token.transfer(user2, amt);

        assertEq(token.balanceOf(user2), amt); // exact, no fee taken
        assertEq(token.balanceOf(user1), 0);
        assertEq(token.totalReflectionsDistributed(), 0); // nothing reflected
        assertEq(token.accumulatedFees(), 0);
        assertEq(token.pendingReflection(), 0);
    }

    // ─────────────────────────── fee on a sell (contract dest) ────────────────
    // In the UNIFIED model, a fee transfer ACCUMULATES fees: the 2% team/liq lands in the
    // contract as real tokens, the 3% reflection becomes PENDING (not yet applied to _rTotal).
    function testFeeOnSell() public {
        uint256 amt = 1_000_000e18;
        // fund USER1 (non-exempt EOA)
        vm.prank(DEPLOYER);
        token.transfer(user1, amt);

        // set pair to a contract so to.code.length != 0 => not walletToWallet
        vm.prank(DEPLOYER);
        token.setPair(address(pair));

        uint256 contractBefore = token.balanceOf(address(token));

        // USER1 sells to the pair => fees apply (accumulated, not distributed)
        vm.prank(user1);
        token.transfer(address(pair), amt);

        // recipient (a non-excluded holder) is CREDITED exactly amount - 5%. Reflection is
        // NOT applied yet (batched), so no extra reflection bump on its balance.
        uint256 expectedTo = amt - (amt * 500) / 10000;
        assertEq(token.balanceOf(address(pair)), expectedTo);

        // contract token balance grew by 2% (team+liq) — real tokens awaiting swap
        uint256 expectedSwap = (amt * 200) / 10000;
        assertEq(token.balanceOf(address(token)) - contractBefore, expectedSwap);

        // 3% reflection is PENDING, not distributed
        uint256 expectedRefl = (amt * 300) / 10000;
        assertEq(token.pendingReflection(), expectedRefl);
        assertEq(token.totalReflectionsDistributed(), 0); // not yet distributed

        // accumulatedFees == reflection + team + liquidity (5%)
        uint256 expectedAccum = (amt * 500) / 10000;
        assertEq(token.accumulatedFees(), expectedAccum);
    }

    // ─────────────────────────── reflection is BATCHED, not continuous ────────
    function testReflectionBatchedNotContinuous() public {
        uint256 amt = 10_000_000e18;
        vm.prank(DEPLOYER);
        token.transfer(user1, amt);
        vm.prank(DEPLOYER);
        token.transfer(user3, amt);

        vm.prank(DEPLOYER);
        token.setPair(address(pair));

        uint256 user3Before = token.balanceOf(user3);

        // ONE fee transfer (USER1 sells to the pair)
        vm.prank(user1);
        token.transfer(address(pair), amt);

        // reflection is PENDING — USER3's balance did NOT increase yet
        assertEq(token.balanceOf(user3), user3Before);
        assertGt(token.pendingReflection(), 0);
        assertGt(token.accumulatedFees(), 0);
        assertEq(token.totalReflectionsDistributed(), 0);

        // trigger the unified payout permissionlessly (anyone can call)
        vm.prank(user2);
        token.processFees();

        // now USER3 earned reflection WITHOUT claiming
        uint256 user3After = token.balanceOf(user3);
        assertGt(user3After, user3Before);
        assertEq(token.pendingReflection(), 0);
        assertGt(token.totalReflectionsDistributed(), 0);

        // RFI conservation: sum of all balances + contract ≈ totalSupply, never exceeding it.
        // The unified payout swapped the contract's 2% team/liq tokens to the router, so those
        // tokens now live at the router address — include it to close the books.
        uint256 sum = token.balanceOf(DEPLOYER)
            + token.balanceOf(user1)
            + token.balanceOf(user2)
            + token.balanceOf(user3)
            + token.balanceOf(address(token))
            + token.balanceOf(LIQ)
            + token.balanceOf(TEAM)
            + token.balanceOf(address(router))
            + token.balanceOf(address(pair));

        assertGe(SUPPLY, sum);          // never exceeds supply (solvent by construction)
        assertGe(1e35, sum);            // never exceeds 1e35
        assertApproxEq(sum, SUPPLY, 8); // ≤ #holders wei floor drift
    }

    // ─────────────────────────── unified payout: ALL THREE in ONE call ────────
    function testUnifiedPayoutAllThree() public {
        uint256 amt = 10_000_000e18;
        vm.prank(DEPLOYER);
        token.transfer(user1, amt);
        vm.prank(DEPLOYER);
        token.transfer(user3, amt); // a passive holder that should earn reflection

        vm.prank(DEPLOYER);
        token.setPair(address(pair));

        // accumulate fees via a fee-charged sell (contract now holds 2% team/liq tokens, 3% pending)
        vm.prank(user1);
        token.transfer(address(pair), amt);

        uint256 teamEthBefore = TEAM.balance;
        uint256 liqEthBefore = LIQ.balance;
        uint256 reflBefore = token.totalReflectionsDistributed();
        assertEq(reflBefore, 0);

        // ONE call distributes reflection + team ETH + liquidity ETH together
        vm.prank(user2);
        token.processFees();

        // (1) reflection distributed
        assertGt(token.totalReflectionsDistributed(), reflBefore);
        assertEq(token.pendingReflection(), 0);
        // (2) team ETH increased  (3) liquidity ETH increased, split 1:1
        uint256 teamGain = TEAM.balance - teamEthBefore;
        uint256 liqGain = LIQ.balance - liqEthBefore;
        assertGt(teamGain, 0);
        assertGt(liqGain, 0);
        assertEq(teamGain, liqGain); // teamFee == liquidityFee == 100 => 1:1
        assertGt(router.swapCount(), 0);

        // accumulator reset after the unified payout
        assertEq(token.accumulatedFees(), 0);
    }

    // ─────────────────────────── payout triggered at threshold by a sell ──────
    function testPayoutTrippedByThreshold() public {
        vm.prank(DEPLOYER);
        token.setPair(address(pair));

        // lower the threshold so a single sell trips the unified payout on the NEXT fee transfer
        vm.prank(DEPLOYER);
        token.setPayoutThreshold(1e18);

        uint256 amt = 1_000_000e18;
        vm.prank(DEPLOYER);
        token.transfer(user1, amt);

        uint256 teamEthBefore = TEAM.balance;
        uint256 liqEthBefore = LIQ.balance;

        // first sell accumulates fees (threshold is checked at the START of _transfer)
        vm.prank(user1);
        token.transfer(address(pair), amt);

        // fund USER1 again and sell once more -> accumulatedFees >= threshold at entry,
        // so _processFees fires (from != pair)
        vm.prank(DEPLOYER);
        token.transfer(user1, amt);
        vm.prank(user1);
        token.transfer(address(pair), amt);

        // ETH flowed to team and liquidity, split 1:1
        uint256 teamGain = TEAM.balance - teamEthBefore;
        uint256 liqGain = LIQ.balance - liqEthBefore;
        assertGt(teamGain, 0);
        assertGt(liqGain, 0);
        assertEq(teamGain, liqGain);
        assertGt(token.totalReflectionsDistributed(), 0);
        assertGt(router.swapCount(), 0);
    }

    // ─────────────────────────── max transfer (FIX #2) ────────────────────────
    function testMaxTxFix() public {
        // 1% of supply at genesis
        assertEq(token.maxTxAmount(), SUPPLY / 100);

        // fund USER1 above the cap from deployer (deployer is maxTx-exempt so this is fine)
        uint256 big = SUPPLY / 50; // 2%
        vm.prank(DEPLOYER);
        token.transfer(user1, big);

        // USER1 -> USER2 above maxTx reverts (both non-exempt)
        vm.prank(user1);
        vm.expectRevert(ShambaLuv.MaxTxExceeded.selector);
        token.transfer(user2, big);

        // setMaxTxBps(100) keeps 1%
        vm.prank(DEPLOYER);
        token.setMaxTxBps(100);
        assertEq(token.maxTxAmount(), SUPPLY / 100);

        // setMaxTxBps(10000) => 100% of supply (the FIX — NOT tiny)
        vm.prank(DEPLOYER);
        token.setMaxTxBps(10000);
        assertEq(token.maxTxAmount(), SUPPLY);
        assertGt(token.maxTxAmount(), SUPPLY / 100); // emphatically not tiny

        // below 1% reverts
        vm.prank(DEPLOYER);
        vm.expectRevert(ShambaLuv.OutOfRange.selector);
        token.setMaxTxBps(50);
    }

    // ─────────────────────────── payout threshold config ─────────────────────
    function testSetPayoutThreshold() public {
        vm.prank(DEPLOYER);
        token.setPayoutThreshold(1e18); // ok
        assertEq(token.payoutThreshold(), 1e18);

        // zero reverts
        vm.prank(DEPLOYER);
        vm.expectRevert(ShambaLuv.OutOfRange.selector);
        token.setPayoutThreshold(0);

        // > 2% of supply reverts
        vm.prank(DEPLOYER);
        vm.expectRevert(ShambaLuv.OutOfRange.selector);
        token.setPayoutThreshold(SUPPLY / 50 + 1);
    }

    // ─────────────────────────── fees lower-only ─────────────────────────────
    function testFeesLowerOnly() public {
        vm.prank(DEPLOYER);
        token.lowerFees(200, 50, 50); // all lower => ok
        assertEq(token.reflectionFee(), 200);
        assertEq(token.liquidityFee(), 50);
        assertEq(token.teamFee(), 50);

        // raising reflection above current reverts
        vm.prank(DEPLOYER);
        vm.expectRevert(ShambaLuv.OnlyLower.selector);
        token.lowerFees(400, 50, 50);
    }

    // ─────────────────────────── cross-chain router update (FIX #1/#6) ────────
    function testUpdateRouterCrossChain() public {
        address oldRouter = address(router);
        MockRouter newRouter = new MockRouter(address(0x9999));
        address newWeth = address(0x9999);

        // admin (DEPLOYER) re-points the router
        vm.prank(DEPLOYER);
        token.updateRouter(address(newRouter), newWeth);

        // new router approved at max, old router revoked
        assertEq(token.allowance(address(token), address(newRouter)), type(uint256).max);
        assertEq(token.allowance(address(token), oldRouter), 0);
        assertEq(token.weth(), newWeth);
        assertEq(address(token.router()), address(newRouter));
    }

    // ─────────────────────────── renounce flows ──────────────────────────────
    function testRenounce() public {
        // owner renounce -> owner == 0, admin still set
        vm.prank(DEPLOYER);
        token.renounceOwnership();
        assertEq(token.owner(), address(0));
        assertEq(token.admin(), DEPLOYER);

        // admin renounce -> admin == 0
        vm.prank(DEPLOYER);
        token.renounceAdmin();
        assertEq(token.admin(), address(0));
    }
}
