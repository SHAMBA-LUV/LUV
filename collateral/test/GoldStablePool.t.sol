// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {TwTest} from "./TwTest.sol";
import {MockGem} from "./GoldMocks.sol";
import {GoldStablePool} from "../src/GoldStablePool.sol";

contract GoldStablePoolTest is TwTest {
    uint256 constant WAD = 1e18;
    uint256 constant FEE = 4e6; // 4 bps of 1e10
    uint256 constant SHARE = 5e9; // 50% of each fee to stakers

    MockGem bx; // bXAU stand-in
    MockGem px; // PAXG stand-in (no transfer fee here; see testFeeOnTransferCredited)
    GoldStablePool pool;

    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address carol = address(0xCA201);
    address pauser = address(0x9A05E);

    function setUp() public {
        vm.warp(1_800_000_000);
        bx = new MockGem("Basket Gold", "bXAU", 18, 0, false);
        px = new MockGem("PAX Gold", "PAXG", 18, 0, false);
        pool = new GoldStablePool(address(bx), address(px), 200, FEE, SHARE, address(this), "bXAU/PAXG", "bXAU-PAXG");
        pool.setPauser(pauser);
        _fund(pool, bx, px, alice, 10_000e18, 10_000e18);
        _fund(pool, bx, px, bob, 10_000e18, 10_000e18);
        _fund(pool, bx, px, carol, 10_000e18, 10_000e18);
    }

    function _fund(GoldStablePool p, MockGem a, MockGem b, address u, uint256 x, uint256 y) internal {
        a.mint(u, x);
        b.mint(u, y);
        vm.startPrank(u);
        a.approve(address(p), type(uint256).max);
        b.approve(address(p), type(uint256).max);
        vm.stopPrank();
    }

    function _seed() internal returns (uint256 lp) {
        vm.prank(alice);
        lp = pool.addLiquidity([uint256(1000e18), uint256(1000e18)], 0);
    }

    // ───────────────────────────── liquidity ─────────────────────────────

    function testFirstDepositMintsDAndBurnsMinimum() public {
        uint256 lp = _seed();
        assertEq(lp, 2000e18 - 1000);
        assertEq(pool.balanceOf(address(0xdEaD)), 1000);
        assertEq(pool.getVirtualPrice(), WAD);
    }

    function testFirstDepositNeedsBothCoins() public {
        vm.prank(alice);
        vm.expectRevert(GoldStablePool.InitialDepositNeedsBoth.selector);
        pool.addLiquidity([uint256(1e18), 0], 0);
    }

    function testPairedDepositPaysNoImbalanceFee() public {
        _seed();
        vm.prank(bob);
        uint256 lp = pool.addLiquidity([uint256(50e18), uint256(50e18)], 0);
        assertApproxEq(lp, 100e18, 1e6);
    }

    function testSingleAssetDepositAndWithdraw() public {
        _seed();
        uint256 quote = pool.calcTokenAmount([uint256(0), uint256(100e18)]);
        vm.prank(carol);
        uint256 lp = pool.addLiquidity([uint256(0), uint256(100e18)], quote);
        assertEq(lp, quote);
        assertTrue(lp < 100e18 && lp > 99.9e18); // small imbalance fee, no swap needed

        uint256 q1 = pool.calcWithdrawOneCoin(lp, 1);
        uint256 before = px.balanceOf(carol);
        vm.prank(carol);
        uint256 out = pool.removeLiquidityOneCoin(lp, 1, q1);
        assertEq(out, q1);
        assertEq(px.balanceOf(carol) - before, out);
        assertTrue(out < 100e18 && out > 99.9e18); // round trip cost ≈ two half-fees
    }

    function testRemoveLiquidityProportional() public {
        uint256 lp = _seed();
        vm.prank(alice);
        uint256[2] memory out = pool.removeLiquidity(lp / 2, [uint256(0), uint256(0)]);
        assertApproxEq(out[0], 500e18, 1e3);
        assertApproxEq(out[1], 500e18, 1e3);
    }

    // ─────────────────────────────── swaps ───────────────────────────────

    function testSwapNearParAndFeeSplit() public {
        _seed();
        uint256 vp0 = pool.getVirtualPrice();
        uint256 quote = pool.getDy(1, 0, 10e18);
        vm.prank(bob);
        uint256 dy = pool.exchange(1, 0, 10e18, quote);
        assertEq(dy, quote);
        assertTrue(dy > 9.99e18 && dy < 9.9961e18); // ≈ 10 · (1 − 4 bps) minus tiny slippage
        // half of the 4 bps fee is set aside for stakers, half stays with LPs
        assertApproxEq(pool.stakerFees(0), 0.002e18, 0.00001e18);
        assertGt(pool.getVirtualPrice(), vp0);
    }

    function testGetDxIsInverseOfExchange() public {
        _seed();
        uint256 dx = pool.getDx(1, 0, 5e18);
        vm.prank(bob);
        uint256 dy = pool.exchange(1, 0, dx, 5e18);
        assertGe(dy, 5e18);
        assertTrue(dy - 5e18 < 1e12);
    }

    function testVirtualPriceNeverFallsUnderTrading() public {
        _seed();
        uint256 vp = pool.getVirtualPrice();
        for (uint256 k; k < 20; ++k) {
            vm.prank(bob);
            pool.exchange(k % 2, 1 - k % 2, 300e18, 0); // push the pool far off balance and back
            uint256 v = pool.getVirtualPrice();
            assertGe(v, vp);
            vp = v;
        }
    }

    function testSlippageBounds() public {
        _seed();
        uint256 quote = pool.getDy(0, 1, 10e18);
        vm.prank(bob);
        vm.expectRevert(GoldStablePool.Slippage.selector);
        pool.exchange(0, 1, 10e18, quote + 1);
        vm.prank(bob);
        vm.expectRevert(GoldStablePool.Slippage.selector);
        pool.addLiquidity([uint256(10e18), 0], 10e18);
    }

    function testSixDecimalCoin() public {
        MockGem xt = new MockGem("Tether Gold", "XAUt", 6, 0, true); // no-return transfers
        GoldStablePool p2 = new GoldStablePool(address(bx), address(xt), 200, FEE, SHARE, address(this), "x", "x");
        _fund(p2, bx, xt, alice, 1000e18, 1000e6);
        vm.prank(alice);
        p2.addLiquidity([uint256(1000e18), uint256(1000e6)], 0);
        assertApproxEq(p2.getVirtualPrice(), WAD, 1);

        _fund(p2, bx, xt, bob, 100e18, 100e6);
        vm.prank(bob);
        uint256 dy = p2.exchange(1, 0, 10e6, 0); // 10 XAUT → ≈ 9.996 bXAU
        assertTrue(dy > 9.99e18 && dy < 10e18);
        vm.prank(bob);
        uint256 dy2 = p2.exchange(0, 1, 10e18, 0); // 10 bXAU → ≈ 9.996 XAUT
        assertTrue(dy2 > 9.99e6 && dy2 < 10e6);
    }

    function testFeeOnTransferCredited() public {
        MockGem pf = new MockGem("PAX Gold", "PAXG", 18, 2, false); // 2 bps transfer fee
        GoldStablePool p2 = new GoldStablePool(address(bx), address(pf), 200, FEE, SHARE, address(this), "x", "x");
        _fund(p2, bx, pf, alice, 1000e18, 1000e18);
        vm.prank(alice);
        p2.addLiquidity([uint256(1000e18), uint256(1000e18)], 0);
        assertEq(p2.balances(1), 999.8e18); // only what arrived
        assertEq(p2.balances(1), pf.balanceOf(address(p2)));
    }

    // ─────────────────────────────── safety ───────────────────────────────

    function testPauseStopsSwapsAndDepositsButNeverWithdrawals() public {
        uint256 lp = _seed();
        vm.prank(pauser);
        pool.setPaused(true);
        vm.prank(bob);
        vm.expectRevert(GoldStablePool.IsPaused.selector);
        pool.exchange(0, 1, 1e18, 0);
        vm.prank(bob);
        vm.expectRevert(GoldStablePool.IsPaused.selector);
        pool.addLiquidity([uint256(1e18), uint256(1e18)], 0);

        vm.prank(alice);
        pool.removeLiquidity(lp / 4, [uint256(0), uint256(0)]);
        vm.prank(alice);
        pool.removeLiquidityOneCoin(lp / 4, 0, 0);

        vm.prank(pauser); // the pauser can stop, only the owner can resume
        vm.expectRevert(GoldStablePool.NotOwner.selector);
        pool.setPaused(false);
        pool.setPaused(false);
        vm.prank(bob);
        pool.exchange(0, 1, 1e18, 0);
    }

    function testAdminBoundsAndRampA() public {
        vm.prank(alice);
        vm.expectRevert(GoldStablePool.NotOwner.selector);
        pool.setFee(1, 1);
        vm.expectRevert(GoldStablePool.BadParam.selector);
        pool.setFee(1e8 + 1, SHARE); // > 1%

        vm.expectRevert(GoldStablePool.Ramp.selector);
        pool.rampA(2001, block.timestamp + 2 days); // > 10× change
        vm.expectRevert(GoldStablePool.Ramp.selector);
        pool.rampA(400, block.timestamp + 1 hours); // too fast

        pool.rampA(400, block.timestamp + 2 days);
        vm.warp(block.timestamp + 12 hours);
        assertEq(pool.A(), 250); // linear interpolation
        vm.expectRevert(GoldStablePool.Ramp.selector);
        pool.rampA(500, block.timestamp + 2 days); // at most one ramp per day
        pool.stopRampA();
        vm.warp(block.timestamp + 5 days);
        assertEq(pool.A(), 250);
    }

    function testOnlyFeeReceiverCollects() public {
        _seed();
        vm.prank(bob);
        pool.exchange(1, 0, 10e18, 0);
        vm.expectRevert(GoldStablePool.NotFeeReceiver.selector);
        pool.collectStakerFees();
        pool.setFeeReceiver(carol);
        uint256 owed = pool.stakerFees(0);
        uint256 before = bx.balanceOf(carol);
        vm.prank(carol);
        pool.collectStakerFees();
        assertEq(bx.balanceOf(carol) - before, owed);
        assertEq(pool.stakerFees(0), 0);
    }

    /// Pool tokens always cover recorded balances + staker fees.
    function testSolvencyAfterMixedActivity() public {
        _seed();
        vm.prank(carol);
        uint256 lp = pool.addLiquidity([uint256(0), uint256(200e18)], 0);
        for (uint256 k; k < 6; ++k) {
            vm.prank(bob);
            pool.exchange(k % 2, 1 - k % 2, 150e18, 0);
        }
        vm.prank(carol);
        pool.removeLiquidityOneCoin(lp, 0, 0);
        assertGe(bx.balanceOf(address(pool)), pool.balances(0) + pool.stakerFees(0));
        assertGe(px.balanceOf(address(pool)), pool.balances(1) + pool.stakerFees(1));
    }
}
