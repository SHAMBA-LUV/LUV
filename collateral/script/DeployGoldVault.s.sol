// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BasketGold} from "../src/BasketGold.sol";
import {PegSpotter} from "../src/PegSpotter.sol";
import {GoldVault} from "../src/GoldVault.sol";

interface VmScript {
    function startBroadcast() external;
    function stopBroadcast() external;
    function envOr(string calldata, address) external view returns (address);
    function envOr(string calldata, uint256) external view returns (uint256);
}

/**
 * Deploy the gold basket CDP to Ethereum mainnet.
 *
 *   simulate:  GOV=0x… forge script script/DeployGoldVault.s.sol --rpc-url $ETH_RPC_URL --sender $DEPLOYER
 *   deploy:    GOV=0x… forge script script/DeployGoldVault.s.sol --rpc-url $ETH_RPC_URL --sender $DEPLOYER \
 *                  --account <keystore> --broadcast --verify
 *
 * Addresses were verified on-chain (Blockscout, 2026-11-07). Every risk parameter can be
 * overridden by an env var (see README). GOV (a multisig, ideally behind a timelock) receives
 * the vault wards and the spotter; the deployer key is removed and the script ASSERTS that it
 * holds no rights at the end, failing the whole run otherwise.
 */
contract DeployGoldVault {
    VmScript internal constant vm = VmScript(0x7109709ECfa91a80626fF3989D68f67F5b1DD12D);

    address constant PAXG = 0x45804880De22913dAFE09f4980848ECE6EcbAf78; // 18 dec, fee-on-transfer
    address constant XAUT = 0x68749665FF8D2d112Fa859AA293F07A622782F38; // 6 dec, no-return transfer
    address constant XAU_USD = 0x214eD9Da11D2fbe465a6fc601a91E62EbEc1a0D6; // Chainlink XAU / USD
    address constant PAXG_USD = 0x9944D86CEB9160aF5C5feB251FD671923323f8C3; // Chainlink PAXG / USD

    bytes32 constant ILK_PAXG = "PAXG-A";
    bytes32 constant ILK_XAUT = "XAUT-A";

    struct Risk {
        uint256 mat;
        uint256 chop;
        uint256 duty;
        uint256 line;
        uint256 dust;
        uint256 floor;
    }

    function run() external returns (BasketGold bxau, PegSpotter spotter, GoldVault vault) {
        address gov = vm.envOr("GOV", address(0));
        require(gov != address(0), "set GOV (multisig) env var");

        // PAXG is market-priced (PAXG/USD ÷ XAU/USD): normal risk.
        Risk memory paxg = Risk({
            mat: vm.envOr("PAXG_MAT", uint256(120e25)), // 120%
            chop: vm.envOr("PAXG_CHOP", uint256(105e16)), // 5%
            duty: vm.envOr("PAXG_DUTY", uint256(1000000000627937192491029810)), // 2% / yr
            line: vm.envOr("PAXG_LINE", uint256(1_000e18)), // 1,000 oz
            dust: vm.envOr("PAXG_DUST", uint256(1e18)), // 1 oz
            floor: vm.envOr("PAXG_FLOOR", uint256(97e16)) // no new debt < 0.97 oz/token
        });
        // XAUT has no Chainlink feed → priced at par, so a depeg is invisible on-chain and it
        // can never be liquidated on price. Small ceiling + high ratio until a feed exists.
        Risk memory xaut = Risk({
            mat: vm.envOr("XAUT_MAT", uint256(150e25)), // 150%
            chop: vm.envOr("XAUT_CHOP", uint256(105e16)),
            duty: vm.envOr("XAUT_DUTY", uint256(1000000000627937192491029810)),
            line: vm.envOr("XAUT_LINE", uint256(100e18)), // 100 oz
            dust: vm.envOr("XAUT_DUST", uint256(1e18)),
            floor: 0 // meaningless at par
        });
        uint256 Line = vm.envOr("GOLD_LINE_GLOBAL", uint256(1_100e18));
        uint32 xauAge = _u32(vm.envOr("XAU_MAX_AGE", uint256(26 hours)), "XAU_MAX_AGE"); // heartbeat 24h
        uint32 pegAge = _u32(vm.envOr("PAXG_MAX_AGE", uint256(26 hours)), "PAXG_MAX_AGE");

        vm.startBroadcast();

        spotter = new PegSpotter(XAU_USD, xauAge);
        spotter.fileSrc(ILK_PAXG, PAXG_USD, pegAge, 1e18);
        spotter.fileSrc(ILK_XAUT, address(0), 0, 1e18);

        bxau = new BasketGold();
        vault = new GoldVault(address(bxau), address(spotter));
        bxau.rely(address(vault));

        // The account that deployed holds the constructor wards; prove we have the right key
        // before removing it, so a sender/origin mismatch fails loudly instead of leaving a
        // hot key able to mint.
        address deployer = tx.origin;
        require(vault.wards(deployer) == 1 && bxau.wards(deployer) == 1, "deployer != tx.origin; pass --sender");

        vault.init(ILK_PAXG, PAXG);
        vault.init(ILK_XAUT, XAUT);
        _risk(vault, ILK_PAXG, paxg);
        _risk(vault, ILK_XAUT, xaut);
        vault.fileLine(Line);

        // bXAU gets NO governance ward: the vault is its only minter, so governance can never
        // print unbacked gold — only accrued surplus, through flap().
        vault.rely(gov);
        vault.deny(deployer);
        bxau.deny(deployer);
        spotter.transferOwnership(gov);

        vm.stopBroadcast();

        require(vault.wards(deployer) == 0, "deployer still a vault ward");
        require(bxau.wards(deployer) == 0, "deployer still a bXAU ward");
        require(bxau.wards(address(vault)) == 1 && vault.wards(gov) == 1, "wiring");
        require(spotter.owner() == gov, "spotter owner");
    }

    function _risk(GoldVault vault, bytes32 ilk, Risk memory r) internal {
        // chop before mat: the vault enforces chop ≤ mat at every step
        if (r.chop * 1e9 > 15e26) {
            vault.file(ilk, "mat", r.mat);
            vault.file(ilk, "chop", r.chop);
        } else {
            vault.file(ilk, "chop", r.chop);
            vault.file(ilk, "mat", r.mat);
        }
        vault.file(ilk, "duty", r.duty);
        vault.file(ilk, "line", r.line);
        vault.file(ilk, "dust", r.dust);
        vault.file(ilk, "floor", r.floor);
    }

    function _u32(uint256 v, string memory name) internal pure returns (uint32) {
        require(v > 0 && v <= type(uint32).max, name);
        return uint32(v);
    }
}
