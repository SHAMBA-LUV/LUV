// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {GoldStablePool} from "../src/GoldStablePool.sol";
import {GoldLiquidityLocker} from "../src/GoldLiquidityLocker.sol";

interface VmPools {
    function startBroadcast() external;
    function stopBroadcast() external;
    function envAddress(string calldata) external view returns (address);
    function envOr(string calldata, uint256) external view returns (uint256);
}

/**
 * Deploy the bXAU liquidity pools and their tiered-reward lockers (run after DeployGoldVault).
 *
 *   BXAU=0x… TIMELOCK=0x… GOV=0x… forge script script/DeployGoldPools.s.sol \
 *       --rpc-url $ETH_RPC_URL --sender $DEPLOYER [--account <keystore> --broadcast --verify]
 *
 * Creates two StableSwap pools — bXAU/PAXG and bXAU/XAUT — each with a GoldLiquidityLocker as
 * its fee receiver. Final authority (asserted; the run fails otherwise):
 *   pool owner  → GoldTimelock (fee, A ramp, fee receiver, unpause: all delayed)
 *   pool pauser → GOV (can pause swaps/deposits instantly; withdrawals can never be paused)
 *   lockers     → no owner at all (tiers and accounting are immutable)
 */
contract DeployGoldPools {
    VmPools internal constant vm = VmPools(0x7109709ECfa91a80626fF3989D68f67F5b1DD12D);

    address constant PAXG = 0x45804880De22913dAFE09f4980848ECE6EcbAf78;
    address constant XAUT = 0x68749665FF8D2d112Fa859AA293F07A622782F38;

    struct Deployed {
        GoldStablePool paxgPool;
        GoldLiquidityLocker paxgLocker;
        GoldStablePool xautPool;
        GoldLiquidityLocker xautLocker;
    }

    function run() external returns (Deployed memory d) {
        address bxau = vm.envAddress("BXAU");
        address timelock = vm.envAddress("TIMELOCK");
        address gov = vm.envAddress("GOV");
        uint256 A = vm.envOr("POOL_A", uint256(200));
        uint256 fee = vm.envOr("POOL_FEE", uint256(4e6)); // 4 bps (of 1e10)
        uint256 share = vm.envOr("POOL_STAKER_SHARE", uint256(5e9)); // 50% of fees to lockers
        // XAUT is priced at par inside the vault, so its pool gets a lower A: price moves sooner
        // as it becomes imbalanced, which is the market's depeg signal.
        uint256 aX = vm.envOr("POOL_A_XAUT", uint256(100));

        vm.startBroadcast();
        address deployer = tx.origin;
        d.paxgPool = new GoldStablePool(bxau, PAXG, A, fee, share, deployer, "bXAU/PAXG StableSwap", "bXAU-PAXG");
        d.xautPool = new GoldStablePool(bxau, XAUT, aX, fee, share, deployer, "bXAU/XAUT StableSwap", "bXAU-XAUT");
        d.paxgLocker = new GoldLiquidityLocker(address(d.paxgPool));
        d.xautLocker = new GoldLiquidityLocker(address(d.xautPool));
        _wire(d.paxgPool, address(d.paxgLocker), gov, timelock);
        _wire(d.xautPool, address(d.xautLocker), gov, timelock);
        vm.stopBroadcast();

        _check(d.paxgPool, address(d.paxgLocker), gov, timelock);
        _check(d.xautPool, address(d.xautLocker), gov, timelock);
    }

    function _wire(GoldStablePool pool, address locker, address gov, address timelock) internal {
        pool.setFeeReceiver(locker);
        pool.setPauser(gov);
        pool.transferOwnership(timelock);
    }

    function _check(GoldStablePool pool, address locker, address gov, address timelock) internal view {
        require(pool.owner() == timelock, "pool owner");
        require(pool.pauser() == gov, "pool pauser");
        require(pool.feeReceiver() == locker, "fee receiver");
        require(address(GoldLiquidityLocker(locker).pool()) == address(pool), "locker pool");
    }
}
