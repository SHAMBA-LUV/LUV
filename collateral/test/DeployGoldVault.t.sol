// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {TwTest} from "./TwTest.sol";
import {DeployGoldVault} from "../script/DeployGoldVault.s.sol";
import {BasketGold} from "../src/BasketGold.sol";
import {PegSpotter} from "../src/PegSpotter.sol";
import {GoldVault} from "../src/GoldVault.sol";
import {GoldTimelock} from "../src/GoldTimelock.sol";
import {GoldGuardian} from "../src/GoldGuardian.sol";
import {GoldFlash} from "../src/GoldFlash.sol";
import {DeployGoldPools} from "../script/DeployGoldPools.s.sol";

interface VmDeploy {
    function etch(address, bytes calldata) external;
    function setEnv(string calldata, string calldata) external;
    function prank(address, address) external;
    function toString(address) external pure returns (string memory);
    function warp(uint256) external;
}

/// Stand-ins etched at the real mainnet addresses (no RPC needed): code only, no storage.
contract FixedFeed {
    function decimals() external pure returns (uint8) {
        return 8;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (1, 4000e8, block.timestamp, block.timestamp, 1);
    }
}

contract Dec18 {
    function decimals() external pure returns (uint8) {
        return 18;
    }
}

contract Dec6 {
    function decimals() external pure returns (uint8) {
        return 6;
    }
}

/// Runs the real deploy script end-to-end against etched mainnet addresses and checks the
/// resulting wiring, risk parameters and that the deployer holds no rights.
contract DeployGoldVaultTest is TwTest {
    VmDeploy constant vmd = VmDeploy(0x7109709ECfa91a80626fF3989D68f67F5b1DD12D);
    address constant GOV = address(0x6060);
    DeployGoldVault.Deployed internal lastVault;

    function testDeployScriptWiresTimelockGuardianFlashAndDropsDeployer() public {
        vmd.warp(1_800_000_000);
        vmd.etch(0x45804880De22913dAFE09f4980848ECE6EcbAf78, address(new Dec18()).code); // PAXG
        vmd.etch(0x68749665FF8D2d112Fa859AA293F07A622782F38, address(new Dec6()).code); // XAUT
        vmd.etch(0x214eD9Da11D2fbe465a6fc601a91E62EbEc1a0D6, address(new FixedFeed()).code); // XAU/USD
        vmd.etch(0x9944D86CEB9160aF5C5feB251FD671923323f8C3, address(new FixedFeed()).code); // PAXG/USD
        vmd.setEnv("GOV", "0x0000000000000000000000000000000000006060");

        DeployGoldVault script = new DeployGoldVault();
        DeployGoldVault.Deployed memory d = script.run();
        lastVault = d;
        BasketGold bxau = d.bxau;
        PegSpotter spotter = d.spotter;
        GoldVault vault = d.vault;
        address DEPLOYER = tx.origin; // the broadcaster, as in `forge script --sender`

        assertEq(vault.wards(DEPLOYER), 0);
        assertEq(bxau.wards(DEPLOYER), 0);
        assertEq(vault.wards(GOV), 0); // GOV acts only through the timelock …
        assertEq(vault.wards(address(d.timelock)), 1);
        assertEq(vault.wards(address(d.guardian)), 1); // … or fires the guardian
        assertEq(d.timelock.admin(), GOV);
        assertEq(d.timelock.delay(), 2 days);
        assertEq(d.guardian.owner(), GOV);
        assertEq(bxau.wards(GOV), 0); // governance can never mint directly
        assertEq(bxau.wards(address(d.timelock)), 0);
        assertEq(bxau.wards(address(vault)), 1);
        assertEq(bxau.wards(address(d.flash)), 1);
        assertEq(d.flash.owner(), address(d.timelock));
        assertEq(d.flash.max(), 500e18);
        assertEq(spotter.owner(), address(d.timelock));
        assertEq(vault.ilkCount(), 3);
        assertEq(vault.Line(), 1_600e18);
        (,,,,,, uint256 matS, uint256 chopS, uint256 lineS, uint256 dustS,) = vault.ilks("PSM-PAXG-A");
        assertEq(matS, 1e27); // PSM ilk: exactly 100%, no penalty, no dust
        assertEq(chopS, 1e18);
        assertEq(lineS, 500e18);
        assertEq(dustS, 0);
        assertEq(d.psm.owner(), address(d.timelock));
        assertEq(d.psm.treasury(), GOV);
        assertEq(d.psm.tin(), 1e15);
        assertEq(d.psm.floor(), 995e15);
        assertEq(d.psm.gem(), 0x45804880De22913dAFE09f4980848ECE6EcbAf78);
        assertTrue(d.psm.pegHealthy());
        assertEq(bxau.wards(address(d.psm)), 0);

        (,,,,,, uint256 matP, uint256 chopP, uint256 lineP,,) = vault.ilks("PAXG-A");
        (, uint256 scaleX,,,,, uint256 matX,, uint256 lineX,,) = vault.ilks("XAUT-A");
        assertEq(matP, 120e25);
        assertEq(chopP, 105e16);
        assertEq(lineP, 1_000e18);
        assertEq(scaleX, 1e12);
        assertEq(matX, 150e25); // par-priced peg: stricter
        assertEq(lineX, 100e18); //                and small

        (uint256 p, bool ok) = spotter.peek("PAXG-A");
        assertTrue(ok);
        assertEq(p, 1e18);
    }

    function testDeployPoolsScriptWiresTimelockPauserAndLockers() public {
        testDeployScriptWiresTimelockGuardianFlashAndDropsDeployer(); // etches + deploys the vault stack
        DeployGoldVault.Deployed memory v = lastVault;
        vmd.setEnv("BXAU", vmd.toString(address(v.bxau)));
        vmd.setEnv("TIMELOCK", vmd.toString(address(v.timelock)));

        DeployGoldPools.Deployed memory d = new DeployGoldPools().run();
        assertEq(d.paxgPool.owner(), address(v.timelock));
        assertEq(d.xautPool.owner(), address(v.timelock));
        assertEq(d.paxgPool.pauser(), GOV);
        assertEq(d.paxgPool.feeReceiver(), address(d.paxgLocker));
        assertEq(d.xautPool.feeReceiver(), address(d.xautLocker));
        assertEq(d.paxgPool.coin0(), address(v.bxau));
        assertEq(d.paxgPool.coin1(), 0x45804880De22913dAFE09f4980848ECE6EcbAf78);
        assertEq(d.paxgPool.A(), 200);
        assertEq(d.xautPool.A(), 100);
        assertEq(d.paxgPool.fee(), 4e6);
        assertEq(d.paxgPool.stakerShare(), 5e9);
    }
}
