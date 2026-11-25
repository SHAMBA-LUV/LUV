// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {TwTest} from "./TwTest.sol";
import {MockGem} from "./GoldMocks.sol";
import {GoldStablePool} from "../src/GoldStablePool.sol";
import {GoldLiquidityLocker} from "../src/GoldLiquidityLocker.sol";

contract GoldLiquidityLockerTest is TwTest {
    uint256 constant WAD = 1e18;

    MockGem bx;
    MockGem px;
    GoldStablePool pool;
    GoldLiquidityLocker locker;

    address seeder = address(0x5EED);
    address trader = address(0x7EAD);
    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address carol = address(0xCA201);

    uint8 constant BRONZE = 0;
    uint8 constant SILVER = 1;
    uint8 constant GOLD = 2;

    function setUp() public {
        vm.warp(1_800_000_000);
        bx = new MockGem("Basket Gold", "bXAU", 18, 0, false);
        px = new MockGem("PAX Gold", "PAXG", 18, 0, false);
        pool = new GoldStablePool(address(bx), address(px), 200, 4e6, 5e9, address(this), "bXAU/PAXG", "bXAU-PAXG");
        locker = new GoldLiquidityLocker(address(pool));
        pool.setFeeReceiver(address(locker));

        address[5] memory users = [seeder, trader, alice, bob, carol];
        for (uint256 k; k < users.length; ++k) {
            bx.mint(users[k], 100_000e18);
            px.mint(users[k], 100_000e18);
            vm.startPrank(users[k]);
            bx.approve(address(pool), type(uint256).max);
            px.approve(address(pool), type(uint256).max);
            bx.approve(address(locker), type(uint256).max);
            px.approve(address(locker), type(uint256).max);
            pool.approve(address(locker), type(uint256).max);
            vm.stopPrank();
        }
        vm.prank(seeder); // unlocked third-party liquidity
        pool.addLiquidity([uint256(10_000e18), uint256(10_000e18)], 0);
        vm.prank(alice);
        pool.addLiquidity([uint256(1000e18), uint256(1000e18)], 0);
        vm.prank(bob);
        pool.addLiquidity([uint256(1000e18), uint256(1000e18)], 0);
    }

    function _trade(uint256 rounds) internal {
        for (uint256 k; k < rounds; ++k) {
            vm.prank(trader);
            pool.exchange(k % 2, 1 - k % 2, 500e18, 0);
        }
    }

    function _ids(uint256 id) internal pure returns (uint256[] memory a) {
        a = new uint256[](1);
        a[0] = id;
    }

    function testTierInfo() public {
        (uint64 d0, uint256 m0) = locker.tierInfo(BRONZE);
        (uint64 d1, uint256 m1) = locker.tierInfo(SILVER);
        (uint64 d2, uint256 m2) = locker.tierInfo(GOLD);
        assertEq(d0, 30 days);
        assertEq(m0, 10_000);
        assertEq(d1, 180 days);
        assertEq(m1, 20_000);
        assertEq(d2, 365 days);
        assertEq(m2, 30_000);
        vm.expectRevert(GoldLiquidityLocker.BadTier.selector);
        locker.tierInfo(3);
    }

    /// Equal LP, Gold earns 3× Bronze from the staker stream.
    function testTierWeightsShareFees() public {
        vm.prank(alice);
        uint256 a = locker.lock(500e18, BRONZE);
        vm.prank(bob);
        uint256 b = locker.lock(500e18, GOLD);
        _trade(20);

        (uint256 pa0, uint256 pa1) = locker.pending(a);
        uint256 ax = bx.balanceOf(alice);
        uint256 ap = px.balanceOf(alice);
        vm.prank(alice);
        locker.claim(_ids(a));
        uint256 ra0 = bx.balanceOf(alice) - ax;
        uint256 ra1 = px.balanceOf(alice) - ap;
        assertEq(ra0, pa0); // pending() is exact
        assertEq(ra1, pa1);

        uint256 bxb = bx.balanceOf(bob);
        uint256 bpb = px.balanceOf(bob);
        vm.prank(bob);
        locker.claim(_ids(b));
        uint256 rb0 = bx.balanceOf(bob) - bxb;
        uint256 rb1 = px.balanceOf(bob) - bpb;
        assertGt(ra0 + ra1, 0);
        assertApproxEq(rb0, 3 * ra0, 3);
        assertApproxEq(rb1, 3 * ra1, 3);
        // the whole staker stream reached lockers (dust only)
        assertTrue(bx.balanceOf(address(locker)) < 10 && px.balanceOf(address(locker)) < 10);
    }

    function testAssetPairingAndSingleAssetEntry() public {
        vm.prank(carol);
        (uint256 id1, uint256 lp1) = locker.provide([uint256(100e18), uint256(100e18)], 199e18, SILVER);
        (address o1, uint8 t1,, uint256 amt1, uint256 w1,,) = locker.positions(id1);
        assertEq(o1, carol);
        assertEq(t1, SILVER);
        assertEq(amt1, lp1);
        assertEq(w1, lp1 * 2);
        assertGt(lp1, 199.9e18); // balanced: virtually no fee

        uint256 quote = pool.calcTokenAmount([uint256(0), uint256(100e18)]);
        vm.prank(carol);
        (uint256 id2, uint256 lp2) = locker.provideSingle(1, 100e18, quote, GOLD);
        assertEq(lp2, quote);
        (,,,, uint256 w2,,) = locker.positions(id2);
        assertEq(w2, lp2 * 3);
        assertEq(locker.positionsOf(carol).length, 2);
        assertEq(bx.allowance(address(locker), address(pool)), 0); // no lingering approvals
        assertEq(px.allowance(address(locker), address(pool)), 0);
    }

    function testLockedUntilExpiryThenWithdraw() public {
        vm.prank(alice);
        uint256 id = locker.lock(500e18, BRONZE);
        _trade(4);
        vm.prank(alice);
        vm.expectRevert(GoldLiquidityLocker.StillLocked.selector);
        locker.withdraw(id);

        vm.warp(block.timestamp + 30 days);
        uint256 lpBefore = pool.balanceOf(alice);
        uint256 bxBefore = bx.balanceOf(alice);
        vm.prank(alice);
        locker.withdraw(id);
        assertEq(pool.balanceOf(alice) - lpBefore, 500e18);
        assertGt(bx.balanceOf(alice), bxBefore); // rewards paid on exit
        assertEq(locker.totalWeight(), 0);
        assertEq(locker.totalLocked(), 0);
    }

    function testWithdrawOneCoin() public {
        vm.prank(alice);
        uint256 id = locker.lock(100e18, BRONZE);
        vm.warp(block.timestamp + 30 days);
        uint256 before = px.balanceOf(alice);
        vm.prank(alice);
        uint256 out = locker.withdrawOneCoin(id, 1, 99e18);
        assertGt(out, 99e18);
        assertTrue(px.balanceOf(alice) - before >= out);
    }

    function testRelockOnlyUpgradesAndExtends() public {
        vm.prank(alice);
        uint256 id = locker.lock(100e18, BRONZE);
        vm.warp(block.timestamp + 10 days);
        vm.prank(alice);
        locker.relock(id, GOLD);
        (, uint8 t, uint64 until,, uint256 w,,) = locker.positions(id);
        assertEq(t, GOLD);
        assertEq(w, 300e18);
        assertEq(until, block.timestamp + 365 days);
        assertEq(locker.totalWeight(), 300e18);

        vm.prank(alice);
        vm.expectRevert(GoldLiquidityLocker.BadTier.selector);
        locker.relock(id, BRONZE);
        vm.prank(bob);
        vm.expectRevert(GoldLiquidityLocker.NotOwner.selector);
        locker.relock(id, GOLD);
    }

    function testKickEndsExpiredBoost() public {
        vm.prank(alice);
        uint256 id = locker.lock(100e18, GOLD);
        vm.expectRevert(GoldLiquidityLocker.NotExpired.selector);
        locker.kick(id);

        vm.warp(block.timestamp + 365 days);
        _trade(2);
        uint256 before = bx.balanceOf(alice) + px.balanceOf(alice);
        vm.prank(carol); // anyone may kick; the owner still receives their rewards
        locker.kick(id);
        (,,,, uint256 w,,) = locker.positions(id);
        assertEq(w, 100e18);
        assertEq(locker.totalWeight(), 100e18);
        assertGt(bx.balanceOf(alice) + px.balanceOf(alice), before);
        vm.expectRevert(GoldLiquidityLocker.NotExpired.selector);
        locker.kick(id); // already at base
    }

    function testFeesBeforeAnyLockGoToFirstLockers() public {
        _trade(10); // staker fees accrue in the pool with nobody locked
        uint256 waiting = pool.stakerFees(0) + pool.stakerFees(1);
        assertGt(waiting, 0);
        vm.prank(alice);
        uint256 id = locker.lock(10e18, BRONZE); // harvest finds totalWeight == 0 → held
        assertEq(locker.undistributed0() + locker.undistributed1(), waiting);

        vm.prank(bob); // next harvest pays the held fees to the lockers present BEFORE bob joins
        uint256 idB = locker.lock(10e18, BRONZE);
        (uint256 p0, uint256 p1) = locker.pending(id);
        assertApproxEq(p0 + p1, waiting, 4); // alice, the first locker, receives all of it
        (uint256 q0, uint256 q1) = locker.pending(idB);
        assertEq(q0 + q1, 0); // late joiners cannot capture fees earned before they locked
    }

    function testEmergencyWithdrawReturnsLpAndForfeitsRewardsToOthers() public {
        vm.prank(alice);
        uint256 a = locker.lock(100e18, BRONZE);
        vm.prank(bob);
        uint256 b = locker.lock(100e18, GOLD);
        _trade(6);
        vm.prank(alice);
        locker.claim(_ids(a)); // harvest, so both have settled rewards on the books
        _trade(6);
        vm.prank(bob);
        locker.claim(_ids(b));
        (uint256 owed0, uint256 owed1) = locker.pending(a);
        assertGt(owed0 + owed1, 0);

        vm.prank(alice);
        vm.expectRevert(GoldLiquidityLocker.StillLocked.selector);
        locker.emergencyWithdraw(a);
        vm.warp(block.timestamp + 30 days);
        uint256 lp0 = pool.balanceOf(alice);
        uint256 bx0 = bx.balanceOf(alice);
        vm.prank(alice);
        locker.emergencyWithdraw(a);
        assertEq(pool.balanceOf(alice) - lp0, 100e18);
        assertEq(bx.balanceOf(alice), bx0); // no reward transfer attempted
        assertEq(locker.undistributed0() + locker.undistributed1(), owed0 + owed1);

        (uint256 before0, uint256 before1) = locker.pending(b);
        assertGe(before0 + before1 + 2, owed0 + owed1); // bob, still locked, inherits them
    }

    function testOnlyOwnerClaimsOrWithdraws() public {
        vm.prank(alice);
        uint256 id = locker.lock(10e18, BRONZE);
        vm.prank(bob);
        vm.expectRevert(GoldLiquidityLocker.NotOwner.selector);
        locker.claim(_ids(id));
        vm.warp(block.timestamp + 30 days);
        vm.prank(bob);
        vm.expectRevert(GoldLiquidityLocker.NotOwner.selector);
        locker.withdraw(id);
    }

    /// Unlocked LPs still earn: the non-staker half of every fee lifts virtual price for all.
    function testUnlockedLpsStillEarnFromVirtualPrice() public {
        uint256 vp0 = pool.getVirtualPrice();
        vm.prank(alice);
        locker.lock(500e18, GOLD);
        _trade(20);
        assertGt(pool.getVirtualPrice(), vp0);
    }
}
