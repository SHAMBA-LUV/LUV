// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {TwTest} from "./TwTest.sol";
import {MockGem, MockFeed} from "./GoldMocks.sol";
import {BasketGold} from "../contracts/gold/BasketGold.sol";
import {PegSpotter} from "../contracts/gold/PegSpotter.sol";
import {GoldVault} from "../contracts/gold/GoldVault.sol";

contract GoldVaultTest is TwTest {
    uint256 constant WAD = 1e18;
    uint256 constant RAY = 1e27;
    uint256 constant DUTY_5PCT = 1000000001547125957863212448; // 5% / yr (Maker table)

    bytes32 constant PAXG = "PAXG-A";
    bytes32 constant XAUT = "XAUT-A";

    MockGem paxg; // 18 dec, 0.02% transfer fee (like PAXG)
    MockGem xaut; // 6 dec, no-return transfers (like XAUT)
    MockFeed xauUsd;
    MockFeed paxgUsd;
    PegSpotter spotter;
    BasketGold bxau;
    GoldVault vault;

    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address treasury = address(0x7EA5);

    function setUp() public {
        vm.warp(1_800_000_000);
        paxg = new MockGem("PAX Gold", "PAXG", 18, 2, false);
        xaut = new MockGem("Tether Gold", "XAUt", 6, 0, true);
        xauUsd = new MockFeed(8, 4000e8);
        paxgUsd = new MockFeed(8, 4000e8);

        spotter = new PegSpotter(address(xauUsd), 1 hours);
        spotter.fileSrc(PAXG, address(paxgUsd), 1 hours, WAD);
        spotter.fileSrc(XAUT, address(0), 0, WAD); // priced at par

        bxau = new BasketGold();
        vault = new GoldVault(address(bxau), address(spotter));
        bxau.rely(address(vault));
        bxau.deny(address(this));

        vault.init(PAXG, address(paxg), 18);
        vault.init(XAUT, address(xaut), 6);
        bytes32[2] memory ids = [PAXG, XAUT];
        for (uint256 k; k < 2; ++k) {
            vault.file(ids[k], "mat", 110e25); // 110%
            vault.file(ids[k], "chop", 104e16); // 4%
            vault.file(ids[k], "line", 1000e18);
            vault.file(ids[k], "dust", 1e18);
            vault.file(ids[k], "floor", 95e16); // no new debt below 0.95 oz/token
        }
        vault.fileLine(2000e18);

        paxg.mint(alice, 1000e18);
        xaut.mint(alice, 1000e6);
        paxg.mint(bob, 1000e18);
        xaut.mint(bob, 1000e6);
        _approveAll(alice);
        _approveAll(bob);
    }

    function _approveAll(address u) internal {
        vm.startPrank(u);
        paxg.approve(address(vault), type(uint256).max);
        xaut.approve(address(vault), type(uint256).max);
        bxau.approve(address(vault), type(uint256).max);
        vm.stopPrank();
    }

    function _ink(bytes32 ilk, address u) internal view returns (uint256 ink) {
        (ink,) = vault.urns(ilk, u);
    }

    function _art(bytes32 ilk, address u) internal view returns (uint256 art) {
        (, art) = vault.urns(ilk, u);
    }

    function _open(address u, bytes32 ilk, uint256 amount, uint256 wad) internal {
        vm.startPrank(u);
        vault.lock(ilk, amount);
        vault.draw(ilk, wad);
        vm.stopPrank();
    }

    // ───────────────────────────── positions ─────────────────────────────

    function testLockMeasuresFeeOnTransfer() public {
        vm.prank(alice);
        vault.lock(PAXG, 100e18);
        assertEq(_ink(PAXG, alice), 99.98e18); // 2 bps kept by the token
        assertEq(paxg.balanceOf(address(vault)), 99.98e18);
    }

    function testSixDecimalNoReturnPeg() public {
        _open(alice, XAUT, 12e6, 10e18);
        assertEq(_ink(XAUT, alice), 12e18);
        assertEq(bxau.balanceOf(alice), 10e18);
        _checkBooks();
        vm.prank(alice);
        vault.wipeAll(XAUT);
        vm.prank(alice);
        vault.free(XAUT, 12e6);
        assertEq(xaut.balanceOf(alice), 1000e6);
        assertEq(bxau.totalSupply(), 0);
    }

    function testDrawUpToMatThenNotSafe() public {
        _open(alice, XAUT, 11e6, 9.999e18); // 11 oz / 110% = 10 oz ceiling (spot rounds down)
        assertTrue(vault.isSafe(XAUT, alice));
        vm.prank(alice);
        vm.expectRevert(GoldVault.NotSafe.selector);
        vault.draw(XAUT, 0.001e18);
    }

    function testFreeMustStaySafe() public {
        _open(alice, XAUT, 20e6, 10e18);
        vm.prank(alice);
        vault.free(XAUT, 8.9e6); // 11.1 oz left ≥ 11 oz required
        vm.prank(alice);
        vm.expectRevert(GoldVault.NotSafe.selector);
        vault.free(XAUT, 0.2e6); // 10.9 oz < 11 oz
    }

    function testDust() public {
        vm.prank(alice);
        vault.lock(XAUT, 10e6);
        vm.prank(alice);
        vm.expectRevert(GoldVault.Dusty.selector);
        vault.draw(XAUT, 0.5e18);
    }

    function testIlkAndGlobalCeilings() public {
        vault.file(XAUT, "line", 5e18);
        vm.prank(alice);
        vault.lock(XAUT, 100e6);
        vm.prank(alice);
        vm.expectRevert(GoldVault.CeilingExceeded.selector);
        vault.draw(XAUT, 6e18);

        vault.file(XAUT, "line", 1000e18);
        vault.fileLine(5e18);
        vm.prank(alice);
        vm.expectRevert(GoldVault.CeilingExceeded.selector);
        vault.draw(XAUT, 6e18);
    }

    // ─────────────────────────── stability fee ───────────────────────────

    function testDripAccruesFeeIntoSurplusAndFlap() public {
        vault.file(XAUT, "duty", DUTY_5PCT);
        _open(alice, XAUT, 20e6, 10e18);
        _open(bob, XAUT, 100e6, 10e18);

        vm.warp(block.timestamp + 365 days);
        vault.drip(XAUT);
        assertApproxEq(vault.owed(XAUT, alice), 10.5e18, 1e12);

        vm.prank(bob);
        bxau.transfer(alice, 1e18);
        vm.prank(alice);
        uint256 paid = vault.wipeAll(XAUT);
        assertApproxEq(paid, 10.5e18, 1e12);
        assertEq(_art(XAUT, alice), 0);
        assertApproxEq(vault.surplus(), 1e18 * RAY, 1e12 * RAY); // 0.5 oz fee from each urn

        vault.heal();
        vm.prank(alice);
        vm.expectRevert(GoldVault.NotAuthorized.selector);
        vault.flap(treasury, 0.4e18);
        vault.flap(treasury, 0.9e18);
        assertEq(bxau.balanceOf(treasury), 0.9e18);
        _checkBooks();
    }

    // ───────────────────────── depeg & liquidation ─────────────────────────

    function testPremiumIsCappedAtPar() public {
        paxgUsd.set(4400e8); // PAXG trading 10% over spot gold
        (uint256 price, bool ok) = spotter.peek(PAXG);
        assertTrue(ok);
        assertEq(price, WAD);
    }

    function testDepegFloorBlocksNewDebt() public {
        vm.prank(alice);
        vault.lock(PAXG, 50e18);
        paxgUsd.set(3600e8); // 0.90 oz / PAXG
        vm.prank(alice);
        vm.expectRevert(GoldVault.Depegged.selector);
        vault.draw(PAXG, 10e18);
    }

    function testStaleOracleHaltsPricedActions() public {
        _open(alice, PAXG, 12e18, 10e18);
        vm.warp(block.timestamp + 2 hours);
        vm.prank(alice);
        vm.expectRevert(GoldVault.OracleDown.selector);
        vault.draw(PAXG, 1e18);
        vm.prank(alice);
        vm.expectRevert(GoldVault.OracleDown.selector);
        vault.free(PAXG, 1e18);
    }

    function testSafeUrnCannotBeLiquidated() public {
        _open(alice, PAXG, 12e18, 10e18);
        _open(bob, XAUT, 100e6, 50e18);
        vm.prank(bob);
        vm.expectRevert(GoldVault.Safe.selector);
        vault.liquidate(PAXG, alice, type(uint256).max);
    }

    function testFullLiquidationOnDepeg() public {
        _open(alice, PAXG, 12e18, 10e18); // ink 11.9976
        _open(bob, XAUT, 100e6, 50e18);
        paxgUsd.set(3600e8); // 0.90 → 10.80 oz < 11 oz required
        assertFalse(vault.isSafe(PAXG, alice));

        uint256 before = paxg.balanceOf(bob);
        vm.prank(bob);
        (uint256 wad, uint256 gemOut) = vault.liquidate(PAXG, alice, type(uint256).max);
        assertEq(wad, 10e18);
        assertEq(gemOut, uint256(10e18) * 104e16 / 90e16); // 11.5555… PAXG
        assertEq(_art(PAXG, alice), 0);
        assertEq(_ink(PAXG, alice), 11.9976e18 - gemOut);
        assertEq(bxau.balanceOf(bob), 40e18);
        assertEq(paxg.balanceOf(bob) - before, gemOut - gemOut * 2 / 10000);
        assertEq(vault.sin(), 0);
        _checkBooks();
    }

    function testPartialLiquidation() public {
        _open(alice, PAXG, 12e18, 10e18);
        _open(bob, XAUT, 100e6, 50e18);
        paxgUsd.set(3600e8);
        vm.prank(bob); // leaving 0.5 oz would be dust
        vm.expectRevert(GoldVault.Dusty.selector);
        vault.liquidate(PAXG, alice, 9.5e18);

        vm.prank(bob);
        (uint256 wad,) = vault.liquidate(PAXG, alice, 4e18);
        assertEq(wad, 4e18);
        assertApproxEq(vault.owed(PAXG, alice), 6e18, 1);
        assertTrue(vault.isSafe(PAXG, alice)); // 4% discount still restores safety at 0.90

        vm.prank(bob);
        vm.expectRevert(GoldVault.Safe.selector);
        vault.liquidate(PAXG, alice, 1e18);
        _checkBooks();
    }

    function testCrashWritesOffBadDebtToSin() public {
        _open(alice, PAXG, 12e18, 10e18);
        _open(bob, XAUT, 100e6, 50e18);
        paxgUsd.set(2000e8); // 0.50 oz / PAXG
        vm.prank(bob);
        (uint256 wad, uint256 gemOut) = vault.liquidate(PAXG, alice, type(uint256).max);
        assertEq(gemOut, 11.9976e18); // everything
        assertLtApprox(wad, 5.77e18);
        assertEq(_ink(PAXG, alice), 0);
        assertEq(_art(PAXG, alice), 0);
        assertGt(vault.sin(), 4e18 * RAY);
        (,, uint256 Art,,,,,,,,) = vault.ilks(PAXG);
        assertEq(Art, 0);
        _checkBooks();
    }

    // ─────────────────────────────── shutdown ──────────────────────────────

    function testCageSkimThawCashRedeemsTheBasket() public {
        _open(alice, PAXG, 12e18, 10e18);
        _open(bob, XAUT, 20e6, 10e18);
        vault.cage();

        vm.prank(alice);
        vm.expectRevert(GoldVault.NotLive.selector);
        vault.draw(PAXG, 1e18);
        vm.expectRevert(GoldVault.Unskimmed.selector);
        vault.thaw();
        vm.prank(alice);
        vm.expectRevert(GoldVault.Unskimmed.selector);
        vault.free(PAXG, 1e18);

        vault.skim(PAXG, alice);
        vault.skim(XAUT, bob);
        assertEq(vault.pool(PAXG), 10e18);
        assertEq(vault.pool(XAUT), 10e18);

        vm.prank(alice); // excess collateral comes back to the urn owner
        vault.free(PAXG, 1.9976e18);
        vm.prank(bob);
        vault.free(XAUT, 10e6);

        vault.thaw();
        assertEq(vault.fix(PAXG), 0.5e18);
        assertEq(vault.fix(XAUT), 0.5e18);

        uint256 p0 = paxg.balanceOf(alice);
        uint256 x0 = xaut.balanceOf(alice);
        vm.prank(alice);
        vault.cash(10e18);
        assertEq(paxg.balanceOf(alice) - p0, 5e18 - 5e18 * 2 / 10000);
        assertEq(xaut.balanceOf(alice) - x0, 5e6);

        vm.prank(bob);
        vault.cash(10e18);
        assertEq(bxau.totalSupply(), 0);
        assertEq(vault.pool(PAXG), 0);
        assertEq(vault.pool(XAUT), 0);
    }

    // ───────────────────────────────── auth ────────────────────────────────

    function testOnlyWards() public {
        vm.prank(alice);
        vm.expectRevert(GoldVault.NotAuthorized.selector);
        vault.file(PAXG, "mat", 2e27);
        vm.prank(alice);
        vm.expectRevert(GoldVault.NotAuthorized.selector);
        vault.cage();
        vm.prank(alice);
        vm.expectRevert(BasketGold.NotAuthorized.selector);
        bxau.mint(alice, 1);
        vm.prank(alice);
        vm.expectRevert(PegSpotter.NotOwner.selector);
        spotter.fileSrc(PAXG, address(0), 0, WAD);
    }

    /// Vow identity: every RAD of debt is either a bXAU in circulation, accrued surplus, or
    /// written-off bad debt.   debt + sin == supply·RAY + surplus
    function _checkBooks() internal view {
        assertEq(vault.debt() + vault.sin(), bxau.totalSupply() * RAY + vault.surplus());
    }

    function assertLtApprox(uint256 a, uint256 b) internal pure {
        assertTrue(a < b);
    }
}
