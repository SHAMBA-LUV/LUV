// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {TwTest} from "../TwTest.sol";
import {MockGem} from "../GoldMocks.sol";
import {GoldStablePool} from "../../src/GoldStablePool.sol";
import {GoldLiquidityLocker} from "../../src/GoldLiquidityLocker.sol";

/// Property tests for GoldLiquidityLocker: rewards are conserved and exits always work.
contract LockerFuzzTest is TwTest {
    MockGem c0;
    MockGem c1;
    GoldStablePool pool;
    GoldLiquidityLocker locker;
    address[3] users = [address(0xA1), address(0xB2), address(0xC3)];
    address trader = address(0x7EAD);

    function setUp() public {
        vm.warp(1_800_000_000);
        c0 = new MockGem("Basket Gold", "bXAU", 18, 0, false);
        c1 = new MockGem("PAX Gold", "PAXG", 18, 2, false); // with PAXG's transfer fee
        pool = new GoldStablePool(address(c0), address(c1), 200, 4e6, 5e9, address(this), "p", "p");
        locker = new GoldLiquidityLocker(address(pool));
        pool.setFeeReceiver(address(locker));
        address[4] memory all = [users[0], users[1], users[2], trader];
        for (uint256 k; k < 4; ++k) {
            c0.mint(all[k], 1e8 * 1e18);
            c1.mint(all[k], 1e8 * 1e18);
            vm.startPrank(all[k]);
            c0.approve(address(pool), type(uint256).max);
            c1.approve(address(pool), type(uint256).max);
            c0.approve(address(locker), type(uint256).max);
            c1.approve(address(locker), type(uint256).max);
            pool.approve(address(locker), type(uint256).max);
            vm.stopPrank();
        }
        for (uint256 k; k < 3; ++k) {
            vm.prank(users[k]);
            pool.addLiquidity([uint256(5000e18), uint256(5000e18)], 0);
        }
    }

    function _bound(uint256 x, uint256 lo, uint256 hi) internal pure returns (uint256) {
        return lo + x % (hi - lo + 1);
    }

    function _weightsAddUp() internal view {
        uint256 w;
        uint256 a;
        for (uint256 id = 1; id < locker.nextId(); ++id) {
            (,,, uint256 amount, uint256 weight,,) = locker.positions(id);
            w += weight;
            a += amount;
        }
        assertEq(w, locker.totalWeight());
        assertEq(a, locker.totalLocked());
        assertEq(pool.balanceOf(address(locker)), a); // holds exactly the LP it owes
    }

    function testFuzz_RewardsConservedAndExitsAlwaysWork(uint256 seed) public {
        for (uint256 n; n < 30; ++n) {
            seed = uint256(keccak256(abi.encode(seed, n)));
            uint256 op = seed % 8;
            uint256 r = seed >> 8;
            address u = users[(r >> 100) % 3];
            uint256 id = locker.nextId() > 1 ? _bound(r >> 120, 1, locker.nextId() - 1) : 0;
            if (op == 0) {
                vm.prank(u);
                try locker.lock(_bound(r, 1e15, 300e18), uint8(r % 3)) {} catch {}
            } else if (op == 1) {
                vm.prank(u);
                try locker.provideSingle(r & 1, _bound(r, 1e15, 200e18), 0, uint8((r >> 4) % 3)) {} catch {}
            } else if (op == 2) {
                vm.prank(u);
                try locker.provide([_bound(r, 1e15, 100e18), _bound(r >> 40, 1e15, 100e18)], 0, uint8(r % 3)) {}
                    catch {}
            } else if (op == 3) {
                vm.prank(trader);
                pool.exchange(r & 1, 1 - (r & 1), _bound(r, 1e18, 2000e18), 0);
            } else if (op == 4) {
                vm.warp(block.timestamp + _bound(r, 1 days, 200 days));
            } else if (op == 5 && id != 0) {
                (address o,,,,,,) = locker.positions(id);
                uint256[] memory ids = new uint256[](1);
                ids[0] = id;
                vm.prank(o);
                try locker.claim(ids) {} catch {}
            } else if (op == 6 && id != 0) {
                try locker.kick(id) {} catch {}
            } else if (op == 7 && id != 0) {
                (address o,,,,,,) = locker.positions(id);
                vm.prank(o);
                try locker.relock(id, uint8(r % 3)) {} catch {}
            }
            _weightsAddUp();
        }

        // After every lock has expired, every position can leave — never blocked, never short.
        vm.warp(block.timestamp + 366 days);
        for (uint256 id = 1; id < locker.nextId(); ++id) {
            (address o,,, uint256 amount,,,) = locker.positions(id);
            if (o == address(0)) continue;
            uint256 before = pool.balanceOf(o);
            vm.prank(o);
            locker.withdraw(id);
            assertEq(pool.balanceOf(o) - before, amount);
        }
        assertEq(locker.totalWeight(), 0);
        assertEq(locker.totalLocked(), 0);
        assertEq(pool.balanceOf(address(locker)), 0);
        // Nothing but rounding dust (and fees still waiting for the next locker) is left behind.
        assertGe(c0.balanceOf(address(locker)), locker.undistributed0());
        assertGe(c1.balanceOf(address(locker)), locker.undistributed1());
        assertTrue(c0.balanceOf(address(locker)) - locker.undistributed0() < 1e6);
        assertTrue(c1.balanceOf(address(locker)) - locker.undistributed1() < 1e6);
    }
}
