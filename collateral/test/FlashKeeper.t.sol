// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {TwTest} from "./TwTest.sol";
import {MockGem, MockFeed, MockSwap} from "./GoldMocks.sol";
import {BasketGold} from "../src/BasketGold.sol";
import {PegSpotter} from "../src/PegSpotter.sol";
import {GoldVault} from "../src/GoldVault.sol";
import {GoldFlash, IERC3156FlashBorrower} from "../src/GoldFlash.sol";
import {FlashKeeper} from "../src/FlashKeeper.sol";

contract FlashKeeperTest is TwTest {
    uint256 constant WAD = 1e18;
    bytes32 constant PAXG = "PAXG-A";

    MockGem paxg;
    MockFeed xauUsd;
    MockFeed paxgUsd;
    BasketGold bxau;
    GoldVault vault;
    GoldFlash flash;
    MockSwap swap;
    FlashKeeper keeper;

    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address op = address(0x0FE); // keeper operator

    function setUp() public {
        vm.warp(1_800_000_000);
        paxg = new MockGem("PAX Gold", "PAXG", 18, 0, false);
        xauUsd = new MockFeed(8, 4000e8);
        paxgUsd = new MockFeed(8, 4000e8);
        PegSpotter spotter = new PegSpotter(address(xauUsd), 1 hours);
        spotter.fileSrc(PAXG, address(paxgUsd), 1 hours, WAD);
        bxau = new BasketGold();
        vault = new GoldVault(address(bxau), address(spotter));
        bxau.rely(address(vault));
        vault.init(PAXG, address(paxg));
        vault.file(PAXG, "chop", 105e16);
        vault.file(PAXG, "mat", 120e25);
        vault.file(PAXG, "line", 1000e18);
        vault.file(PAXG, "dust", 1e18);
        vault.fileLine(1000e18);
        flash = new GoldFlash(address(bxau), address(vault), address(this));
        flash.setMax(500e18);
        bxau.rely(address(flash));

        paxg.mint(alice, 100e18);
        paxg.mint(bob, 1000e18);
        vm.prank(alice);
        paxg.approve(address(vault), type(uint256).max);
        vm.prank(bob);
        paxg.approve(address(vault), type(uint256).max);

        vm.startPrank(alice);
        vault.lock(PAXG, 12.5e18);
        vault.draw(PAXG, 10e18);
        vm.stopPrank();
        vm.startPrank(bob);
        vault.lock(PAXG, 200e18);
        vault.draw(PAXG, 100e18);
        vm.stopPrank();

        swap = new MockSwap(address(bxau), 0.9e18); // 0.9 bXAU per PAXG
        vm.prank(bob);
        bxau.transfer(address(swap), 100e18);

        keeper = new FlashKeeper(address(vault), address(flash), op);
        paxgUsd.set(3600e8); // 0.90 → alice unsafe
    }

    function _job(uint256 sellAmt, uint256 minProfit) internal view returns (FlashKeeper.Job memory) {
        return FlashKeeper.Job({
            ilk: PAXG,
            urn: alice,
            amount: 10e18,
            router: address(swap),
            swapData: abi.encodeCall(MockSwap.sell, (address(paxg), sellAmt)),
            minProfit: minProfit
        });
    }

    // seized 10·1.05/0.9 = 11.6667 PAXG; 10 bXAU costs 10/0.9 = 11.1112 PAXG → ≈0.5555 profit
    uint256 constant SELL = 11.111111111111111112e18;

    function testRunLiquidatesAndKeepsProfit() public {
        uint256 supply = bxau.totalSupply();
        vm.prank(op);
        keeper.run(_job(SELL, 0.55e18));
        (, uint256 art) = vault.urns(PAXG, alice);
        assertEq(art, 0);
        assertGt(paxg.balanceOf(address(keeper)), 0.55e18);
        assertEq(bxau.totalSupply(), supply - 10e18);

        uint256 p = paxg.balanceOf(address(keeper));
        vm.prank(op);
        keeper.sweep(address(paxg), op, p);
        assertEq(paxg.balanceOf(op), p);
    }

    function testProfitFloorReverts() public {
        vm.prank(op);
        vm.expectRevert(); // ProfitTooLow(profit, min)
        keeper.run(_job(SELL, 1e18));
    }

    function testUnderSellingCannotRepay() public {
        vm.prank(op);
        vm.expectRevert(); // CannotRepay(have, need)
        keeper.run(_job(5e18, 0));
    }

    function testOnlyOwnerAndTrustedCallback() public {
        vm.prank(alice);
        vm.expectRevert(FlashKeeper.NotOwner.selector);
        keeper.run(_job(SELL, 0));

        vm.prank(alice);
        vm.expectRevert(FlashKeeper.NotOwner.selector);
        keeper.sweep(address(paxg), alice, 1);

        // a stranger flash-loans INTO the keeper hoping it runs their job
        vm.expectRevert(FlashKeeper.Untrusted.selector);
        flash.flashLoan(IERC3156FlashBorrower(address(keeper)), address(bxau), 10e18, abi.encode(_job(SELL, 0)));

        vm.expectRevert(FlashKeeper.Untrusted.selector);
        keeper.onFlashLoan(address(keeper), address(bxau), 10e18, 0, "");
    }

    function testRouterCannotBeSystemContract() public {
        FlashKeeper.Job memory j = _job(SELL, 0);
        j.router = address(bxau);
        vm.prank(op);
        vm.expectRevert(FlashKeeper.BadRouter.selector);
        keeper.run(j);
        j.router = address(vault);
        vm.prank(op);
        vm.expectRevert(FlashKeeper.BadRouter.selector);
        keeper.run(j);
    }
}
