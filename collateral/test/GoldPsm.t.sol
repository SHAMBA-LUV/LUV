// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {TwTest} from "./TwTest.sol";
import {MockGem, MockFeed} from "./GoldMocks.sol";
import {BasketGold} from "../src/BasketGold.sol";
import {PegSpotter} from "../src/PegSpotter.sol";
import {GoldVault} from "../src/GoldVault.sol";
import {GoldPsm} from "../src/GoldPsm.sol";

/// Shared setup: a vault with a market-priced PAXG ilk and a PSM ilk for the same token.
abstract contract PsmSetup is TwTest {
    uint256 constant WAD = 1e18;
    uint256 constant RAY = 1e27;
    bytes32 constant PAXG = "PAXG-A";
    bytes32 constant PSM_ILK = "PSM-PAXG-A";
    uint256 constant TIN = 1e15; // 0.10%
    uint256 constant TOUT = 1e15;

    MockGem paxg;
    MockFeed xauUsd;
    MockFeed paxgUsd;
    PegSpotter spotter;
    BasketGold bxau;
    GoldVault vault;
    GoldPsm psm;
    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address treasury = address(0x7EA5);

    function _setUp() internal {
        vm.warp(1_800_000_000);
        paxg = new MockGem("PAX Gold", "PAXG", 18, 2, false); // 2 bps transfer fee, like PAXG
        xauUsd = new MockFeed(8, 4000e8);
        paxgUsd = new MockFeed(8, 4000e8);
        spotter = new PegSpotter(address(xauUsd), 1 hours);
        spotter.fileSrc(PAXG, address(paxgUsd), 1 hours, WAD);
        spotter.fileSrc(PSM_ILK, address(0), 0, WAD); // par
        bxau = new BasketGold();
        vault = new GoldVault(address(bxau), address(spotter));
        bxau.rely(address(vault));
        vault.init(PAXG, address(paxg));
        vault.file(PAXG, "chop", 105e16);
        vault.file(PAXG, "mat", 120e25);
        vault.file(PAXG, "line", 10_000e18);
        vault.init(PSM_ILK, address(paxg));
        vault.file(PSM_ILK, "chop", WAD); // no penalty …
        vault.file(PSM_ILK, "mat", RAY); // … 100% ratio, zero fee (default), zero dust (default)
        vault.file(PSM_ILK, "line", 500e18);
        vault.fileLine(20_000e18);
        psm = new GoldPsm(address(vault), PSM_ILK, PAXG, address(this), treasury, TIN, TOUT, 995e15);

        address[2] memory us = [alice, bob];
        for (uint256 k; k < 2; ++k) {
            paxg.mint(us[k], 100_000e18);
            vm.startPrank(us[k]);
            paxg.approve(address(psm), type(uint256).max);
            paxg.approve(address(vault), type(uint256).max);
            bxau.approve(address(psm), type(uint256).max);
            bxau.approve(address(vault), type(uint256).max);
            vm.stopPrank();
        }
    }

    /// PSM invariants: its urn is exactly 1:1, and the vault's books balance.
    function _checkPsm() internal view {
        (uint256 ink, uint256 art) = vault.urns(PSM_ILK, address(psm));
        assertEq(ink, art);
        assertEq(vault.debt() + vault.sin(), bxau.totalSupply() * RAY + vault.surplus());
        assertGe(paxg.balanceOf(address(vault)), ink);
        assertEq(paxg.balanceOf(address(psm)), 0); // the PSM never holds the peg itself
    }
}

contract GoldPsmTest is PsmSetup {
    function setUp() public {
        _setUp();
    }

    function testSellGemMintsOneToOneMinusFee() public {
        vm.prank(alice);
        uint256 out = psm.sellGem(100e18, 0);
        // 100 PAXG crosses two transfers (user → PSM → vault), each taking PAXG's 0.02%
        uint256 credited = 100e18 * 9998 / 10000 * 9998 / 10000;
        assertEq(out, credited - credited * TIN / WAD);
        assertEq(bxau.balanceOf(alice), out);
        assertEq(bxau.balanceOf(address(psm)), credited * TIN / WAD); // fee kept as bXAU
        assertEq(psm.reserves(), credited);
        _checkPsm();
    }

    function testBuyGemRedeemsOneToOnePlusFee() public {
        vm.prank(alice);
        psm.sellGem(100e18, 0);
        uint256 px0 = paxg.balanceOf(alice);
        uint256 bx0 = bxau.balanceOf(alice);
        vm.prank(alice);
        uint256 paid = psm.buyGem(50e18, type(uint256).max);
        assertEq(paid, 50e18 + 50e18 * TOUT / WAD);
        assertEq(bx0 - bxau.balanceOf(alice), paid);
        assertEq(paxg.balanceOf(alice) - px0, uint256(50e18) * 9998 / 10000 * 9998 / 10000);
        _checkPsm();
    }

    function testDepegGuardBlocksMintingButNeverRedemption() public {
        vm.prank(alice);
        psm.sellGem(100e18, 0);

        paxgUsd.set(3976e8); // PAXG at 0.994 oz, below the 0.995 floor
        assertFalse(psm.pegHealthy());
        vm.prank(alice);
        vm.expectRevert(GoldPsm.Depegged.selector);
        psm.sellGem(10e18, 0);
        vm.prank(alice);
        psm.buyGem(10e18, type(uint256).max); // redemption stays open

        paxgUsd.set(4000e8);
        vm.warp(block.timestamp + 2 hours); // feed goes stale → also blocked
        assertFalse(psm.pegHealthy());
        vm.prank(alice);
        vm.expectRevert(GoldPsm.Depegged.selector);
        psm.sellGem(10e18, 0);
        _checkPsm();
    }

    function testDebtCeilingCapsThePsm() public {
        vm.prank(alice);
        psm.sellGem(400e18, 0);
        vm.prank(alice);
        vm.expectRevert(GoldVault.CeilingExceeded.selector);
        psm.sellGem(200e18, 0); // line is 500 oz
        vm.prank(alice);
        psm.buyGem(300e18, type(uint256).max); // redemptions free up room
        vm.prank(alice);
        psm.sellGem(200e18, 0);
        _checkPsm();
    }

    function testSlippageBounds() public {
        vm.prank(alice);
        vm.expectRevert(GoldPsm.Slippage.selector);
        psm.sellGem(100e18, 100e18);
        vm.prank(alice);
        psm.sellGem(100e18, 0);
        vm.prank(alice);
        vm.expectRevert(GoldPsm.Slippage.selector);
        psm.buyGem(10e18, 10e18);
    }

    function testCannotRedeemMoreThanReserves() public {
        vm.prank(alice);
        psm.sellGem(10e18, 0);
        // bob gets bXAU from a normal position and tries to drain more than the PSM holds
        vm.startPrank(bob);
        vault.lock(PAXG, 100e18);
        vault.draw(PAXG, 50e18);
        vm.expectRevert(GoldVault.Insufficient.selector);
        psm.buyGem(20e18, type(uint256).max);
        psm.buyGem(5e18, type(uint256).max); // within reserves: fine, whoever holds the bXAU
        vm.stopPrank();
        _checkPsm();
    }

    function testFeesCollectToTreasury() public {
        vm.prank(alice);
        psm.sellGem(100e18, 0);
        vm.prank(alice);
        psm.buyGem(50e18, type(uint256).max);
        uint256 fees = bxau.balanceOf(address(psm));
        assertGt(fees, 0);
        vm.prank(bob); // anyone may trigger it
        assertEq(psm.collect(), fees);
        assertEq(bxau.balanceOf(treasury), fees);
        assertEq(bxau.balanceOf(address(psm)), 0);
    }

    function testAdminBounds() public {
        vm.prank(alice);
        vm.expectRevert(GoldPsm.NotOwner.selector);
        psm.setFees(0, 0);
        vm.expectRevert(GoldPsm.BadParam.selector);
        psm.setFees(1e16 + 1, 0); // > 1%
        vm.expectRevert(GoldPsm.BadParam.selector);
        psm.setTreasury(address(0));
        psm.setFees(0, 5e14);
        psm.setFloor(99e16);
        assertEq(psm.tout(), 5e14);
        assertEq(psm.floor(), 99e16);
    }

    function testPsmUrnIsNeverLiquidatable() public {
        vm.prank(alice);
        psm.sellGem(100e18, 0);
        paxgUsd.set(2000e8); // even with PAXG at 0.50 the PSM ilk is priced at par
        vm.warp(block.timestamp + 30 minutes);
        vm.prank(alice);
        vm.expectRevert(GoldVault.Safe.selector);
        vault.liquidate(PSM_ILK, address(psm), type(uint256).max);
    }

    function testShutdownSettlesThePsmLikeAnyUrn() public {
        vm.prank(alice);
        uint256 out = psm.sellGem(100e18, 0);
        psm.collect();
        uint256 reserves = psm.reserves();
        vault.cage();
        vm.prank(alice);
        vm.expectRevert(GoldVault.NotLive.selector);
        psm.sellGem(1e18, 0);
        vault.skim(PSM_ILK, address(psm));
        assertEq(vault.pool(PSM_ILK), reserves); // all reserves now back bXAU holders
        vault.thaw();
        uint256 px0 = paxg.balanceOf(alice);
        vm.prank(alice);
        vault.cash(out);
        assertGt(paxg.balanceOf(alice) - px0, out * 997 / 1000); // ≈ 1 PAXG per bXAU
    }
}

/// Property test: under any mix of PSM swaps, borrowing and peg moves the PSM stays 1:1.
contract PsmFuzzTest is PsmSetup {
    function setUp() public {
        _setUp();
    }

    function _bound(uint256 x, uint256 lo, uint256 hi) internal pure returns (uint256) {
        return lo + x % (hi - lo + 1);
    }

    function testFuzz_PsmStaysOneToOne(uint256 seed) public {
        uint256 sold;
        uint256 minted;
        for (uint256 n; n < 30; ++n) {
            seed = uint256(keccak256(abi.encode(seed, n)));
            uint256 op = seed % 6;
            uint256 r = seed >> 8;
            address u = (r >> 100) & 1 == 0 ? alice : bob;
            if (op == 0 || op == 1) {
                uint256 amt = _bound(r, 1e12, 200e18);
                vm.prank(u);
                try psm.sellGem(amt, 0) returns (uint256 out) {
                    sold += amt;
                    minted += out;
                    assertGe(amt, out); // never more bXAU out than PAXG in
                } catch {}
            } else if (op == 2) {
                uint256 bal = bxau.balanceOf(u);
                if (bal > 1e12) {
                    uint256 amt = _bound(r, 1, bal * 99 / 100);
                    uint256 px0 = paxg.balanceOf(u);
                    vm.prank(u);
                    try psm.buyGem(amt, type(uint256).max) returns (uint256 paid) {
                        assertGe(paid, paxg.balanceOf(u) - px0); // never more PAXG out than bXAU in
                    } catch {}
                }
            } else if (op == 3) {
                vm.startPrank(u);
                try vault.lock(PAXG, _bound(r, 1e18, 100e18)) {} catch {}
                try vault.draw(PAXG, _bound(r >> 30, 1e17, 50e18)) {} catch {}
                vm.stopPrank();
            } else if (op == 4) {
                paxgUsd.set(int256(_bound(r, 3900e8, 4100e8)));
            } else {
                psm.collect();
            }
            _checkPsm();
        }
    }
}
