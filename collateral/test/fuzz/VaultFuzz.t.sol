// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {TwTest} from "../TwTest.sol";
import {MockGem, MockFeed} from "../GoldMocks.sol";
import {BasketGold} from "../../src/BasketGold.sol";
import {PegSpotter} from "../../src/PegSpotter.sol";
import {GoldVault} from "../../src/GoldVault.sol";

/// Property tests for GoldVault: random sequences of user, keeper, oracle and time actions.
contract VaultFuzzTest is TwTest {
    uint256 constant WAD = 1e18;
    uint256 constant RAY = 1e27;
    bytes32 constant PAXG = "PAXG-A";
    bytes32 constant XAUT = "XAUT-A";

    MockGem paxg;
    MockGem xaut;
    MockFeed xauUsd;
    MockFeed paxgUsd;
    PegSpotter spotter;
    BasketGold bxau;
    GoldVault vault;
    address[3] users = [address(0xA1), address(0xB2), address(0xC3)];
    int256 pegAnswer = 4000e8;

    function setUp() public {
        vm.warp(1_800_000_000);
        paxg = new MockGem("PAX Gold", "PAXG", 18, 2, false);
        xaut = new MockGem("Tether Gold", "XAUt", 6, 0, true);
        xauUsd = new MockFeed(8, 4000e8);
        paxgUsd = new MockFeed(8, 4000e8);
        spotter = new PegSpotter(address(xauUsd), 1 hours);
        spotter.fileSrc(PAXG, address(paxgUsd), 1 hours, WAD);
        spotter.fileSrc(XAUT, address(0), 0, WAD);
        bxau = new BasketGold();
        vault = new GoldVault(address(bxau), address(spotter));
        bxau.rely(address(vault));
        vault.init(PAXG, address(paxg));
        vault.init(XAUT, address(xaut));
        bytes32[2] memory ids = [PAXG, XAUT];
        for (uint256 k; k < 2; ++k) {
            vault.file(ids[k], "chop", 105e16);
            vault.file(ids[k], "mat", 120e25);
            vault.file(ids[k], "line", 100_000e18);
            vault.file(ids[k], "dust", 1e18);
            vault.file(ids[k], "duty", 1000000001547125957863212448); // 5% / yr
        }
        vault.fileLine(200_000e18);
        for (uint256 k; k < 3; ++k) {
            paxg.mint(users[k], 100_000e18);
            xaut.mint(users[k], 100_000e6);
            vm.startPrank(users[k]);
            paxg.approve(address(vault), type(uint256).max);
            xaut.approve(address(vault), type(uint256).max);
            bxau.approve(address(vault), type(uint256).max);
            vm.stopPrank();
        }
    }

    function _bound(uint256 x, uint256 lo, uint256 hi) internal pure returns (uint256) {
        return lo + x % (hi - lo + 1);
    }

    function _checkInvariants() internal view {
        // 1. books: every unit of debt is circulating bXAU, surplus, or written-off bad debt
        assertEq(vault.debt() + vault.sin(), bxau.totalSupply() * RAY + vault.surplus());
        bytes32[2] memory ids = [PAXG, XAUT];
        MockGem[2] memory gems = [paxg, xaut];
        uint256 debtSum;
        for (uint256 k; k < 2; ++k) {
            (, uint256 scale, uint256 Art, uint256 rate,,,,,,,) = vault.ilks(ids[k]);
            uint256 inkSum;
            uint256 artSum;
            for (uint256 u; u < 3; ++u) {
                (uint256 ink, uint256 art) = vault.urns(ids[k], users[u]);
                inkSum += ink;
                artSum += art;
            }
            // 2. per-ilk debt equals the sum of its urns
            assertEq(artSum, Art);
            // 3. the vault holds every unit of collateral it has credited
            assertGe(gems[k].balanceOf(address(vault)) * scale, inkSum + vault.pool(ids[k]));
            debtSum += Art * rate;
        }
        // 4. global debt equals the sum over ilks
        assertEq(debtSum, vault.debt());
    }

    function _act(uint256 seed) internal {
        uint256 op = seed % 10;
        uint256 r = seed >> 8;
        address u = users[(r >> 100) % 3];
        bytes32 ilk = (r >> 110) & 1 == 0 ? PAXG : XAUT;
        uint256 unit = ilk == PAXG ? 1e18 : 1e6;
        if (op == 0) {
            vm.prank(u);
            try vault.lock(ilk, _bound(r, unit / 10, 500 * unit)) {} catch {}
        } else if (op == 1 || op == 2) {
            vm.prank(u);
            try vault.draw(ilk, _bound(r, 1e17, 400e18)) {} catch {}
        } else if (op == 3) {
            uint256 bal = bxau.balanceOf(u);
            if (bal > 0) {
                vm.prank(u);
                try vault.wipe(ilk, _bound(r, 1, bal)) {} catch {}
            }
        } else if (op == 4) {
            vm.prank(u);
            try vault.wipeAll(ilk) {} catch {}
        } else if (op == 5) {
            vm.prank(u);
            try vault.free(ilk, _bound(r, 1, 300 * unit)) {} catch {}
        } else if (op == 6) {
            vm.warp(block.timestamp + _bound(r, 1 hours, 60 days));
            xauUsd.set(4000e8); // keepers keep feeds fresh
            paxgUsd.set(pegAnswer);
        } else if (op == 7) {
            pegAnswer = int256(_bound(r, 2000e8, 4400e8)); // PAXG between 0.50 and 1.10 oz
            paxgUsd.set(pegAnswer);
        } else if (op == 8) {
            address victim = users[(r >> 120) % 3];
            uint256 bal = bxau.balanceOf(u);
            if (bal > 0) {
                vm.prank(u);
                try vault.liquidate(ilk, victim, bal) {} catch {}
            }
        } else {
            vault.heal();
        }
    }

    /// The four accounting invariants hold after every step of any action sequence.
    function testFuzz_AccountingInvariants(uint256 seed) public {
        for (uint256 n; n < 40; ++n) {
            seed = uint256(keccak256(abi.encode(seed, n)));
            _act(seed);
            _checkInvariants();
        }
    }

    /// A successful draw always leaves the position at or above the liquidation ratio.
    function testFuzz_DrawRespectsRatio(uint256 a, uint256 w, uint256 p) public {
        pegAnswer = int256(_bound(p, 3900e8, 4400e8));
        paxgUsd.set(pegAnswer);
        uint256 amt = _bound(a, 1e18, 1000e18);
        uint256 wad = _bound(w, 1e18, 1000e18);
        vm.startPrank(users[0]);
        vault.lock(PAXG, amt);
        try vault.draw(PAXG, wad) {
            (uint256 ink,) = vault.urns(PAXG, users[0]);
            (uint256 price,) = spotter.peek(PAXG);
            assertGe(ink * price / WAD * 100, wad * 120); // value ≥ 120% of debt
            assertTrue(vault.isSafe(PAXG, users[0]));
        } catch {}
        vm.stopPrank();
    }

    /// A liquidation only ever writes off debt when the collateral is worth less than the debt.
    function testFuzz_NoBadDebtWhileSolvent(uint256 p, uint256 a) public {
        uint256 amt = _bound(a, 13e18, 500e18);
        vm.startPrank(users[0]);
        vault.lock(PAXG, amt);
        (uint256 ink,) = vault.urns(PAXG, users[0]);
        uint256 wad = ink * 100 / 121; // just inside 120%
        vault.draw(PAXG, wad);
        vm.stopPrank();
        vm.startPrank(users[1]); // liquidator funds itself from XAUT
        vault.lock(XAUT, 10_000e6);
        vault.draw(XAUT, wad + 1e18);
        vm.stopPrank();

        pegAnswer = int256(_bound(p, 2000e8, 3900e8));
        paxgUsd.set(pegAnswer);
        (uint256 price,) = spotter.peek(PAXG);
        if (vault.isSafe(PAXG, users[0])) return;
        uint256 owed = vault.owed(PAXG, users[0]);
        vm.prank(users[1]);
        vault.liquidate(PAXG, users[0], type(uint256).max);
        if (ink * price / WAD >= owed) assertEq(vault.sin(), 0);
        else assertGt(vault.sin(), 0);
        _checkInvariants();
    }

    /// Shutdown always completes: every holder can redeem and the pool empties.
    function testFuzz_ShutdownRedeemsEverything(uint256 seed) public {
        for (uint256 n; n < 25; ++n) {
            seed = uint256(keccak256(abi.encode(seed, n)));
            _act(seed);
        }
        vault.cage();
        bytes32[2] memory ids = [PAXG, XAUT];
        for (uint256 k; k < 2; ++k) {
            for (uint256 u; u < 3; ++u) {
                vault.skim(ids[k], users[u]);
            }
        }
        // after skim the debt is settled into the pool, which now backs bXAU instead
        assertEq(vault.debt(), 0);
        assertGe(paxg.balanceOf(address(vault)), vault.pool(PAXG));
        assertGe(xaut.balanceOf(address(vault)) * 1e12, vault.pool(XAUT));
        vault.thaw();
        for (uint256 u; u < 3; ++u) {
            // everyone can always take back their remaining collateral …
            for (uint256 k; k < 2; ++k) {
                (uint256 ink,) = vault.urns(ids[k], users[u]);
                (, uint256 scale,,,,,,,,,) = vault.ilks(ids[k]);
                vm.prank(users[u]);
                vault.free(ids[k], ink / scale);
            }
            // … and redeem every bXAU they hold (unless it is too small to buy one unit)
            uint256 bal = bxau.balanceOf(users[u]);
            if (bal > 0) {
                vm.prank(users[u]);
                try vault.cash(bal) {}
                catch (bytes memory err) {
                    assertEq(uint256(bytes32(err) >> 224), uint256(uint32(GoldVault.NothingToCash.selector)));
                }
            }
        }
        if (bxau.totalSupply() == 0) {
            assertTrue(vault.pool(PAXG) == 0 && vault.pool(XAUT) < 1e12); // only sub-unit dust
        }
    }
}
