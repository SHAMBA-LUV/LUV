// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BasketGold} from "../contracts/gold/BasketGold.sol";
import {PegSpotter} from "../contracts/gold/PegSpotter.sol";
import {GoldVault} from "../contracts/gold/GoldVault.sol";

interface VmScript {
    function startBroadcast() external;
    function stopBroadcast() external;
    function envOr(string calldata, address) external view returns (address);
    function envOr(string calldata, uint256) external view returns (uint256);
}

/**
 * Deploy the gold basket CDP to Ethereum mainnet.
 *
 *   simulate:  forge script script/DeployGoldVault.s.sol --rpc-url $ETH_RPC_URL
 *   deploy:    forge script script/DeployGoldVault.s.sol --rpc-url $ETH_RPC_URL --broadcast --verify
 *
 * Addresses below were verified on-chain (Blockscout, 2026-11-07). Risk parameters are
 * conservative launch defaults; override any with env vars. GOV (a multisig) receives the
 * vault wards and spotter ownership; the deployer is denied at the end — nothing stays on a
 * hot key.
 */
contract DeployGoldVault {
    VmScript internal constant vm = VmScript(0x7109709ECfa91a80626fF3989D68f67F5b1DD12D);

    address constant PAXG = 0x45804880De22913dAFE09f4980848ECE6EcbAf78; // 18 dec, fee-on-transfer
    address constant XAUT = 0x68749665FF8D2d112Fa859AA293F07A622782F38; // 6 dec, no-return transfer
    address constant XAU_USD = 0x214eD9Da11D2fbe465a6fc601a91E62EbEc1a0D6; // Chainlink XAU / USD
    address constant PAXG_USD = 0x9944D86CEB9160aF5C5feB251FD671923323f8C3; // Chainlink PAXG / USD

    bytes32 constant ILK_PAXG = "PAXG-A";
    bytes32 constant ILK_XAUT = "XAUT-A";

    function run() external returns (BasketGold bxau, PegSpotter spotter, GoldVault vault) {
        address gov = vm.envOr("GOV", address(0));
        require(gov != address(0), "set GOV (multisig) env var");

        uint256 mat = vm.envOr("GOLD_MAT", uint256(120e25)); // 120%
        uint256 chop = vm.envOr("GOLD_CHOP", uint256(105e16)); // 5% penalty
        uint256 duty = vm.envOr("GOLD_DUTY", uint256(1000000000627937192491029810)); // 2% / yr
        uint256 line = vm.envOr("GOLD_LINE", uint256(1_000e18)); // 1,000 oz per ilk
        uint256 Line = vm.envOr("GOLD_LINE_GLOBAL", uint256(2_000e18));
        uint256 dust = vm.envOr("GOLD_DUST", uint256(1e18)); // 1 oz min debt
        uint256 floor = vm.envOr("GOLD_FLOOR", uint256(97e16)); // no new debt under 0.97 oz/token
        uint256 xauAge = vm.envOr("XAU_MAX_AGE", uint256(26 hours)); // XAU/USD heartbeat 24h
        uint256 pegAge = vm.envOr("PAXG_MAX_AGE", uint256(26 hours));

        vm.startBroadcast();

        spotter = new PegSpotter(XAU_USD, uint32(xauAge));
        spotter.fileSrc(ILK_PAXG, PAXG_USD, uint32(pegAge), 1e18);
        spotter.fileSrc(ILK_XAUT, address(0), 0, 1e18); // no XAUT/USD Chainlink feed: par

        bxau = new BasketGold();
        vault = new GoldVault(address(bxau), address(spotter));
        bxau.rely(address(vault));

        vault.init(ILK_PAXG, PAXG, 18);
        vault.init(ILK_XAUT, XAUT, 6);
        bytes32[2] memory ids = [ILK_PAXG, ILK_XAUT];
        for (uint256 k; k < 2; ++k) {
            vault.file(ids[k], "mat", mat);
            vault.file(ids[k], "chop", chop);
            vault.file(ids[k], "duty", duty);
            vault.file(ids[k], "line", line);
            vault.file(ids[k], "dust", dust);
            vault.file(ids[k], "floor", floor);
        }
        vault.fileLine(Line);

        // hand admin to governance, drop the deployer (tx.origin = the broadcasting key).
        // bXAU gets NO governance ward: the vault is its only minter, so governance can
        // never print unbacked gold — it can only mint accrued surplus through flap().
        address deployer = tx.origin;
        vault.rely(gov);
        vault.deny(deployer);
        bxau.deny(deployer);
        spotter.transferOwnership(gov);

        vm.stopBroadcast();
    }
}
