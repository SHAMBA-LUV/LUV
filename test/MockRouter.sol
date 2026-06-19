// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * MockRouter — minimal IDexRouter stand-in for the SHAMBA LUV test suite.
 *
 * On swapExactTokensForETHSupportingFeeOnTransferTokens it pulls `amountIn` tokens
 * from msg.sender via transferFrom (the SHAMBA contract pre-approved this router at
 * genesis) and pays ETH back to `to`. Pre-fund the mock with ETH via vm.deal.
 *
 * ETH payout is `amountIn / RATE` wei, capped at the mock's balance, so a single
 * swap of ~2% of a 1e35 supply still yields a sane, fundable amount of ETH while
 * keeping a deterministic 1-token → fixed-rate relationship.
 */
interface IERC20Min {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

contract MockRouter {
    address public factoryAddr;
    address public wethAddr;
    uint256 public rate; // amountIn / rate = wei paid out

    uint256 public lastAmountIn;
    uint256 public lastEthOut;
    uint256 public swapCount;

    constructor(address weth_) {
        factoryAddr = address(0xFAC7);
        wethAddr = weth_;
        rate = 1e18; // 1e18 token-units → 1 wei (so 2% of 1e35 ≈ 2e33 → 2e15 wei = 0.002 ETH)
    }

    receive() external payable {}

    function setRate(uint256 r) external {
        rate = r;
    }

    function factory() external view returns (address) {
        return factoryAddr;
    }

    function WETH() external view returns (address) {
        return wethAddr;
    }

    function swapExactTokensForETHSupportingFeeOnTransferTokens(
        uint256 amountIn,
        uint256 /*amountOutMin*/,
        address[] calldata path,
        address to,
        uint256 /*deadline*/
    ) external {
        // pull the tokens the SHAMBA contract is selling
        IERC20Min token = IERC20Min(path[0]);
        token.transferFrom(msg.sender, address(this), amountIn);

        // pay ETH back to `to`
        uint256 ethOut = rate == 0 ? 0 : amountIn / rate;
        uint256 bal = address(this).balance;
        if (ethOut > bal) ethOut = bal;

        lastAmountIn = amountIn;
        lastEthOut = ethOut;
        swapCount++;

        if (ethOut > 0) {
            (bool ok,) = payable(to).call{value: ethOut}("");
            require(ok, "eth send failed");
        }
    }
}
