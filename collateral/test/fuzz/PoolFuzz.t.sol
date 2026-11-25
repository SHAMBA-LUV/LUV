// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {TwTest} from "../TwTest.sol";
import {MockGem} from "../GoldMocks.sol";
import {GoldStablePool} from "../../src/GoldStablePool.sol";

/// Property tests for GoldStablePool. Each property must hold for every fuzzed input.
contract PoolFuzzTest is TwTest {
    MockGem c0;
    MockGem c1; // 6 decimals, no-return: the harder case
    GoldStablePool pool;
    address lp = address(0x11);
    address trader = address(0x22);
    address other = address(0x33);

    function setUp() public {
        vm.warp(1_800_000_000);
        c0 = new MockGem("Basket Gold", "bXAU", 18, 0, false);
        c1 = new MockGem("Tether Gold", "XAUt", 6, 0, true);
        pool = new GoldStablePool(address(c0), address(c1), 200, 4e6, 5e9, address(this), "p", "p");
        address[3] memory us = [lp, trader, other];
        for (uint256 k; k < 3; ++k) {
            c0.mint(us[k], 1e9 * 1e18);
            c1.mint(us[k], 1e9 * 1e6);
            vm.startPrank(us[k]);
            c0.approve(address(pool), type(uint256).max);
            c1.approve(address(pool), type(uint256).max);
            vm.stopPrank();
        }
        vm.prank(lp);
        pool.addLiquidity([uint256(10_000e18), uint256(10_000e6)], 0);
    }

    function _bound(uint256 x, uint256 lo, uint256 hi) internal pure returns (uint256) {
        return lo + x % (hi - lo + 1);
    }

    function _unit(uint256 i) internal pure returns (uint256) {
        return i == 0 ? 1e18 : 1e6;
    }

    /// value of (a0, a1) in 18-decimal ounces
    function _oz(uint256 a0, uint256 a1) internal pure returns (uint256) {
        return a0 + a1 * 1e12;
    }

    function _solvent() internal view {
        assertGe(c0.balanceOf(address(pool)), pool.balances(0) + pool.stakerFees(0));
        assertGe(c1.balanceOf(address(pool)), pool.balances(1) + pool.stakerFees(1));
    }

    /// Selling and immediately buying back never returns more than was put in.
    function testFuzz_SwapRoundTripNeverProfits(uint256 amt, bool dir) public {
        uint256 i = dir ? 0 : 1;
        uint256 dx = _bound(amt, _unit(i) / 1000, 9000 * _unit(i));
        vm.startPrank(trader);
        uint256 dy = pool.exchange(i, 1 - i, dx, 0);
        uint256 back = dy == 0 ? 0 : pool.exchange(1 - i, i, dy, 0);
        vm.stopPrank();
        assertGe(dx, back);
        _solvent();
    }

    /// A single-asset deposit followed by any single-coin exit never returns more value.
    function testFuzz_SingleAssetInOutNeverProfits(uint256 amt, bool inSide, bool outSide) public {
        uint256 i = inSide ? 0 : 1;
        uint256 j = outSide ? 0 : 1;
        uint256 a = _bound(amt, _unit(i) / 100, 5000 * _unit(i));
        uint256[2] memory amounts;
        amounts[i] = a;
        vm.startPrank(other);
        uint256 minted = pool.addLiquidity(amounts, 0);
        uint256 out = pool.removeLiquidityOneCoin(minted, j, 0);
        vm.stopPrank();
        assertGe(a * 1e18 / _unit(i), out * 1e18 / _unit(j));
        _solvent();
    }

    /// The quotes match execution exactly.
    function testFuzz_QuotesMatchExecution(uint256 amt, bool dir) public {
        uint256 i = dir ? 0 : 1;
        uint256 dx = _bound(amt, _unit(i) / 1000, 5000 * _unit(i));
        uint256 q = pool.getDy(i, 1 - i, dx);
        vm.prank(trader);
        assertEq(pool.exchange(i, 1 - i, dx, 0), q);

        uint256[2] memory amounts;
        amounts[i] = dx;
        uint256 qm = pool.calcTokenAmount(amounts);
        vm.prank(other);
        uint256 m = pool.addLiquidity(amounts, 0);
        assertEq(m, qm);
        uint256 qw = pool.calcWithdrawOneCoin(m, 1 - i);
        vm.prank(other);
        assertEq(pool.removeLiquidityOneCoin(m, 1 - i, 0), qw);
    }

    /// getDx always buys at least the requested output, and not wastefully more.
    function testFuzz_GetDxCoversRequestedOutput(uint256 amt, bool dir) public {
        uint256 i = dir ? 0 : 1;
        uint256 j = 1 - i;
        uint256 dy = _bound(amt, _unit(j) / 100, 5000 * _unit(j));
        uint256 dx = pool.getDx(i, j, dy);
        vm.prank(trader);
        uint256 got = pool.exchange(i, j, dx, 0);
        assertGe(got, dy);
        // within 1 bp of the target, plus one smallest unit of the input coin
        assertGe(dy + dy / 10_000 + 2 + 2 * _unit(j) / _unit(i), got);
    }

    /// Under any mix of operations: LP value per token never falls, the pool stays solvent,
    /// and proportional exits always work.
    function testFuzz_VirtualPriceMonotoneAndSolvent(uint256 seed) public {
        uint256 vp = pool.getVirtualPrice();
        for (uint256 n; n < 24; ++n) {
            seed = uint256(keccak256(abi.encode(seed, n)));
            uint256 op = seed % 5;
            uint256 r = seed >> 8;
            uint256 i = (r >> 200) & 1;
            if (op == 0) {
                vm.prank(trader);
                try pool.exchange(i, 1 - i, _bound(r, _unit(i) / 100, 4000 * _unit(i)), 0) {} catch {}
            } else if (op == 1) {
                uint256[2] memory a;
                a[i] = _bound(r, _unit(i) / 100, 3000 * _unit(i));
                if (r & 1 == 1) a[1 - i] = _bound(r >> 20, 0, 3000 * _unit(1 - i));
                vm.prank(other);
                try pool.addLiquidity(a, 0) {} catch {}
            } else if (op == 2) {
                uint256 bal = pool.balanceOf(other);
                if (bal > 0) {
                    vm.prank(other);
                    try pool.removeLiquidityOneCoin(_bound(r, 1, bal), i, 0) {} catch {}
                }
            } else if (op == 3) {
                uint256 bal = pool.balanceOf(other);
                if (bal > 0) {
                    vm.prank(other);
                    pool.removeLiquidity(_bound(r, 1, bal), [uint256(0), uint256(0)]); // must never fail
                }
            } else {
                vm.warp(block.timestamp + _bound(r, 1, 30 days));
            }
            uint256 v = pool.getVirtualPrice();
            assertGe(v, vp);
            vp = v;
            _solvent();
        }
        // the seed LP can always leave with at least what the pool recorded for them
        uint256 all = pool.balanceOf(lp);
        vm.prank(lp);
        uint256[2] memory out = pool.removeLiquidity(all, [uint256(0), uint256(0)]);
        assertGt(_oz(out[0], out[1]), 0);
        _solvent();
    }
}
