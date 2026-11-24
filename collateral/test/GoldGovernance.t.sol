// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {TwTest} from "./TwTest.sol";
import {MockGem, MockFeed} from "./GoldMocks.sol";
import {BasketGold} from "../src/BasketGold.sol";
import {PegSpotter} from "../src/PegSpotter.sol";
import {GoldVault} from "../src/GoldVault.sol";
import {GoldTimelock} from "../src/GoldTimelock.sol";
import {GoldGuardian} from "../src/GoldGuardian.sol";
import {GoldFlash, IERC3156FlashBorrower} from "../src/GoldFlash.sol";

interface IERC20Min {
    function approve(address, uint256) external returns (bool);
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external;
}

// ───────────────────────────── flash borrowers ─────────────────────────────

contract GoodBorrower is IERC3156FlashBorrower {
    uint256 public seen;

    function onFlashLoan(address, address token, uint256 amount, uint256, bytes calldata) external returns (bytes32) {
        seen = IERC20Min(token).balanceOf(address(this));
        IERC20Min(token).approve(msg.sender, amount);
        return keccak256("ERC3156FlashBorrower.onFlashLoan");
    }
}

contract BadReturnBorrower is IERC3156FlashBorrower {
    function onFlashLoan(address, address token, uint256 amount, uint256, bytes calldata) external returns (bytes32) {
        IERC20Min(token).approve(msg.sender, amount);
        return bytes32(0);
    }
}

contract NoApproveBorrower is IERC3156FlashBorrower {
    function onFlashLoan(address, address, uint256, uint256, bytes calldata) external pure returns (bytes32) {
        return keccak256("ERC3156FlashBorrower.onFlashLoan");
    }
}

contract ReentrantBorrower is IERC3156FlashBorrower {
    function onFlashLoan(address, address token, uint256 amount, uint256, bytes calldata) external returns (bytes32) {
        GoldFlash(msg.sender).flashLoan(this, token, amount, "");
        return keccak256("ERC3156FlashBorrower.onFlashLoan");
    }
}

/// Sells a gold peg for bXAU at a fixed price out of its own inventory (stands in for a DEX).
contract MockSwap {
    IERC20Min public immutable bxau;
    uint256 public bxauPerGem; // WAD

    constructor(address bxau_, uint256 p) {
        bxau = IERC20Min(bxau_);
        bxauPerGem = p;
    }

    function sell(address gem, uint256 amount) external returns (uint256 out) {
        MockGem(gem).transferFrom(msg.sender, address(this), amount);
        out = amount * bxauPerGem / 1e18;
        bxau.transfer(msg.sender, out);
    }
}

/// Example keeper: flash-mint bXAU, liquidate, sell just enough seized PAXG to repay, keep the rest.
contract FlashLiquidator is IERC3156FlashBorrower {
    GoldVault public immutable vault;
    GoldFlash public immutable flash;
    MockSwap public immutable swap;
    address public immutable owner;

    constructor(GoldVault v, GoldFlash f, MockSwap s) {
        vault = v;
        flash = f;
        swap = s;
        owner = msg.sender;
    }

    function run(bytes32 ilk, address urn, uint256 amount) external {
        require(msg.sender == owner, "owner");
        flash.flashLoan(this, address(vault.bxau()), amount, abi.encode(ilk, urn));
    }

    function onFlashLoan(address initiator, address token, uint256 amount, uint256, bytes calldata data)
        external
        returns (bytes32)
    {
        require(msg.sender == address(flash) && initiator == address(this), "untrusted");
        (bytes32 ilk, address urn) = abi.decode(data, (bytes32, address));
        IERC20Min(token).approve(address(vault), type(uint256).max);
        (uint256 wad, uint256 gemOut) = vault.liquidate(ilk, urn, amount);

        (address gem,,,,,,,,,,) = vault.ilks(ilk);
        // the vault burned `wad`; buy exactly that back (the unused amount - wad is still here)
        uint256 sellAmt = (wad * 1e18 + swap.bxauPerGem() - 1) / swap.bxauPerGem();
        require(sellAmt <= gemOut, "unprofitable");
        MockGem(gem).approve(address(swap), sellAmt);
        swap.sell(gem, sellAmt);

        IERC20Min(token).approve(msg.sender, amount);
        return keccak256("ERC3156FlashBorrower.onFlashLoan");
    }
}

// ─────────────────────────────────── tests ─────────────────────────────────

contract GoldGovernanceTest is TwTest {
    uint256 constant WAD = 1e18;
    bytes32 constant PAXG = "PAXG-A";
    uint256 constant DELAY = 2 days;

    MockGem paxg;
    MockFeed xauUsd;
    MockFeed paxgUsd;
    PegSpotter spotter;
    BasketGold bxau;
    GoldVault vault;
    GoldTimelock timelock;
    GoldGuardian guardian;
    GoldFlash flash;

    address gov = address(0x6060);
    address alice = address(0xA11CE);
    address bob = address(0xB0B);

    function setUp() public {
        vm.warp(1_800_000_000);
        paxg = new MockGem("PAX Gold", "PAXG", 18, 0, false);
        xauUsd = new MockFeed(8, 4000e8);
        paxgUsd = new MockFeed(8, 4000e8);
        spotter = new PegSpotter(address(xauUsd), 1 hours);
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

        // same authority layout as the deploy script
        timelock = new GoldTimelock(gov, DELAY);
        guardian = new GoldGuardian(address(vault), gov);
        flash = new GoldFlash(address(bxau), address(vault), address(timelock));
        bxau.rely(address(flash));
        vault.rely(address(timelock));
        vault.rely(address(guardian));
        spotter.transferOwnership(address(timelock));
        vault.deny(address(this));
        bxau.deny(address(this));

        // timelock raises the flash ceiling (exercises schedule → execute)
        _govExec(address(flash), abi.encodeCall(GoldFlash.setMax, (500e18)));
        xauUsd.set(4000e8); // the 2-day wait above left the 1-hour feeds stale
        paxgUsd.set(4000e8);

        paxg.mint(alice, 1000e18);
        paxg.mint(bob, 1000e18);
        vm.startPrank(alice);
        paxg.approve(address(vault), type(uint256).max);
        bxau.approve(address(vault), type(uint256).max);
        vm.stopPrank();
        vm.startPrank(bob);
        paxg.approve(address(vault), type(uint256).max);
        vm.stopPrank();
    }

    function _govExec(address target, bytes memory data) internal {
        uint256 eta = block.timestamp + DELAY;
        vm.prank(gov);
        timelock.schedule(target, 0, data, eta);
        vm.warp(eta);
        timelock.execute(target, 0, data, eta);
    }

    function _open(address u, uint256 amount, uint256 wad) internal {
        vm.startPrank(u);
        vault.lock(PAXG, amount);
        vault.draw(PAXG, wad);
        vm.stopPrank();
    }

    // ───────────────────────────── timelock ─────────────────────────────

    function testGovCannotActDirectly() public {
        vm.prank(gov);
        vm.expectRevert(GoldVault.NotAuthorized.selector);
        vault.file(PAXG, "line", 1);
    }

    function testScheduledChangeWaitsForDelay() public {
        bytes memory data = abi.encodeCall(GoldVault.file, (PAXG, "line", 5e18));
        uint256 eta = block.timestamp + DELAY;
        vm.prank(gov);
        timelock.schedule(address(vault), 0, data, eta);

        vm.expectRevert(GoldTimelock.NotReady.selector);
        timelock.execute(address(vault), 0, data, eta);

        vm.warp(eta);
        vm.prank(alice); // anyone may execute once ready
        timelock.execute(address(vault), 0, data, eta);
        (,,,,,,,, uint256 line,,) = vault.ilks(PAXG);
        assertEq(line, 5e18);

        vm.expectRevert(GoldTimelock.NotQueued.selector);
        timelock.execute(address(vault), 0, data, eta);
    }

    function testScheduleRules() public {
        bytes memory data = abi.encodeCall(GoldVault.fileLine, (1));
        vm.prank(alice);
        vm.expectRevert(GoldTimelock.NotAdmin.selector);
        timelock.schedule(address(vault), 0, data, block.timestamp + DELAY);

        vm.prank(gov);
        vm.expectRevert(GoldTimelock.EtaTooSoon.selector);
        timelock.schedule(address(vault), 0, data, block.timestamp + DELAY - 1);
    }

    function testCancelAndExpiry() public {
        bytes memory data = abi.encodeCall(GoldVault.fileLine, (1));
        uint256 eta = block.timestamp + DELAY;
        vm.startPrank(gov);
        timelock.schedule(address(vault), 0, data, eta);
        timelock.cancel(address(vault), 0, data, eta);
        vm.stopPrank();
        vm.warp(eta);
        vm.expectRevert(GoldTimelock.NotQueued.selector);
        timelock.execute(address(vault), 0, data, eta);

        uint256 eta2 = eta + DELAY; // now == eta
        vm.prank(gov);
        timelock.schedule(address(vault), 0, data, eta2);
        vm.warp(eta2 + 14 days + 1); // past GRACE
        vm.expectRevert(GoldTimelock.Expired.selector);
        timelock.execute(address(vault), 0, data, eta2);
    }

    function testDelayAndAdminOnlyViaTimelockItself() public {
        vm.prank(gov);
        vm.expectRevert(GoldTimelock.NotSelf.selector);
        timelock.setDelay(0);

        _govExec(address(timelock), abi.encodeCall(GoldTimelock.setDelay, (3 days)));
        assertEq(timelock.delay(), 3 days);

        uint256 eta = block.timestamp + 3 days;
        bytes memory data = abi.encodeCall(GoldTimelock.setDelay, (31 days));
        vm.prank(gov);
        timelock.schedule(address(timelock), 0, data, eta);
        vm.warp(eta);
        vm.expectRevert(); // CallFailed(BadDelay)
        timelock.execute(address(timelock), 0, data, eta);
    }

    function testSpotterIsGovernedByTimelock() public {
        vm.prank(gov);
        vm.expectRevert(PegSpotter.NotOwner.selector);
        spotter.fileSrc(PAXG, address(0), 0, WAD);
        _govExec(address(spotter), abi.encodeCall(PegSpotter.fileSrc, (PAXG, address(0), 0, WAD)));
        (,,, uint256 par) = spotter.srcs(PAXG);
        assertEq(par, WAD);
    }

    // ───────────────────────────── guardian ─────────────────────────────

    function testGuardianCagesInstantly() public {
        _open(alice, 12e18, 9e18);
        vm.prank(alice);
        vm.expectRevert(GoldGuardian.NotOwner.selector);
        guardian.fire();

        vm.prank(gov); // no delay for the emergency brake
        guardian.fire();
        assertEq(vault.live(), 0);
        assertEq(flash.maxFlashLoan(address(bxau)), 0);
    }

    // ───────────────────────────── flash-mint ─────────────────────────────

    function testFlashMintIsNetZero() public {
        _open(alice, 12e18, 9e18);
        uint256 supply = bxau.totalSupply();
        GoodBorrower b = new GoodBorrower();
        assertEq(flash.maxFlashLoan(address(bxau)), 500e18);
        assertEq(flash.flashFee(address(bxau), 500e18), 0);
        flash.flashLoan(b, address(bxau), 500e18, "");
        assertEq(b.seen(), 500e18);
        assertEq(bxau.totalSupply(), supply);
        assertEq(bxau.balanceOf(address(b)), 0);
    }

    function testFlashRejectsBadBorrowers() public {
        BadReturnBorrower bad = new BadReturnBorrower();
        vm.expectRevert(GoldFlash.CallbackFailed.selector);
        flash.flashLoan(bad, address(bxau), 1e18, "");

        NoApproveBorrower noApprove = new NoApproveBorrower();
        vm.expectRevert(BasketGold.InsufficientAllowance.selector);
        flash.flashLoan(noApprove, address(bxau), 1e18, "");

        ReentrantBorrower re = new ReentrantBorrower();
        vm.expectRevert(GoldFlash.Reentrancy.selector);
        flash.flashLoan(re, address(bxau), 1e18, "");
    }

    function testFlashLimits() public {
        GoodBorrower b = new GoodBorrower();
        vm.expectRevert(GoldFlash.OverMax.selector);
        flash.flashLoan(b, address(bxau), 500e18 + 1, "");
        vm.expectRevert(GoldFlash.UnsupportedToken.selector);
        flash.flashLoan(b, address(paxg), 1, "");
        vm.expectRevert(GoldFlash.NotOwner.selector);
        flash.setMax(1e30);

        vm.prank(gov);
        guardian.fire();
        vm.expectRevert(GoldFlash.NotLive.selector);
        flash.flashLoan(b, address(bxau), 1e18, "");
    }

    /// A keeper holding ZERO bXAU liquidates a depegged urn with a flash-mint and keeps the
    /// leftover PAXG as profit. Supply drops by exactly the debt repaid.
    function testFlashLiquidationWithoutHoldingBxau() public {
        _open(alice, 12.5e18, 10e18);
        _open(bob, 100e18, 50e18);
        MockSwap swap = new MockSwap(address(bxau), 0.9e18); // DEX pays 0.9 bXAU per PAXG
        vm.prank(bob);
        bxau.transfer(address(swap), 50e18);

        paxgUsd.set(3600e8); // 0.90 oz/PAXG → alice unsafe (11.25 < 12 oz required)
        FlashLiquidator keeper = new FlashLiquidator(vault, flash, swap);
        assertEq(bxau.balanceOf(address(keeper)), 0);
        uint256 supply = bxau.totalSupply();

        keeper.run(PAXG, alice, 10e18);

        (, uint256 art) = vault.urns(PAXG, alice);
        assertEq(art, 0);
        assertEq(bxau.totalSupply(), supply - 10e18);
        // seized 10·1.05/0.9 = 11.667 PAXG, sold 11.112 for 10 bXAU → ≈0.555 PAXG profit
        assertGt(paxg.balanceOf(address(keeper)), 0.55e18);
        assertEq(bxau.balanceOf(address(keeper)), 0);
        assertEq(vault.debt() + vault.sin(), bxau.totalSupply() * 1e27 + vault.surplus());
    }
}
