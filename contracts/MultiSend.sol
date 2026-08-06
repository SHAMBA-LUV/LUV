// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title MultiSend
 * @notice Owner-operated multisend for ERC20 tokens and native MATIC on Polygon.
 * - Variable and uniform distributions
 * - Gas-efficient loops with unchecked increments
 * - Pausable & non-reentrant
 * - Recover functions for stuck balances
 *
 * SUITE NOTE (DeltaVerse multisend suite): this is the POLYGON REFERENCE version,
 * OpenZeppelin-based, kept verbatim as received. For Ethereum mainnet use LUVbus.sol
 * (same rail, zero dependencies, custom errors, calldata-lean modes, one-way retire
 * switch) — see deploy/multisend/README.md and docs/MULTISEND.md.
 */
contract MultiSend is Ownable2Step, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    uint256 public maxBatchSize = 500; // tune based on gas measurements on Polygon
    // Optional per-token default amount (in smallest unit)
    mapping(address => uint256) public defaultAmountPerRecipient;

    event MultiSendERC20(address indexed token, uint256 recipients, uint256 totalAmount);
    event MultiSendNative(uint256 recipients, uint256 totalAmount);
    event MaxBatchSizeUpdated(uint256 newMax);
    event WithdrawERC20(address indexed token, address indexed to, uint256 amount);
    event WithdrawNative(address indexed to, uint256 amount);
    event RecoverERC20(address indexed token, address indexed to, uint256 amount);
    event RecoverNative(address indexed to, uint256 amount);
    event DefaultAmountUpdated(address indexed token, uint256 amount);

    constructor() Ownable(msg.sender) {}

    // Admin controls
    function setMaxBatchSize(uint256 _max) external onlyOwner {
        require(_max > 0, "max=0");
        maxBatchSize = _max;
        emit MaxBatchSizeUpdated(_max);
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    // -------- Default amount config --------
    function setDefaultERC20Amount(address token, uint256 amount) external onlyOwner {
        require(token != address(0), "token=0");
        defaultAmountPerRecipient[token] = amount;
        emit DefaultAmountUpdated(token, amount);
    }

    // -------- ERC20 multisend (variable amounts) --------
    function multiSendERC20(
        address token,
        address[] calldata recipients,
        uint256[] calldata amounts
    ) external onlyOwner nonReentrant whenNotPaused {
        require(token != address(0), "token=0");
        uint256 n = recipients.length;
        require(n > 0 && n == amounts.length && n <= maxBatchSize, "length/batch");

        // Precompute total to avoid partial sends
        uint256 total;
        for (uint256 i = 0; i < n; ) {
            total += amounts[i];
            unchecked { ++i; }
        }
        IERC20 erc = IERC20(token);
        require(erc.balanceOf(address(this)) >= total, "insufficient balance");

        // Send
        for (uint256 i = 0; i < n; ) {
            erc.safeTransfer(recipients[i], amounts[i]);
            unchecked { ++i; }
        }
        emit MultiSendERC20(token, n, total);
    }

    // Uniform amount per recipient (cheaper)
    function multiSendERC20Uniform(
        address token,
        address[] calldata recipients,
        uint256 amount
    ) external onlyOwner nonReentrant whenNotPaused {
        require(token != address(0), "token=0");
        require(amount > 0, "amount=0");
        uint256 n = recipients.length;
        require(n > 0 && n <= maxBatchSize, "bad batch");

        uint256 total = amount * n;
        IERC20 erc = IERC20(token);
        require(erc.balanceOf(address(this)) >= total, "insufficient balance");

        for (uint256 i = 0; i < n; ) {
            erc.safeTransfer(recipients[i], amount);
            unchecked { ++i; }
        }
        emit MultiSendERC20(token, n, total);
    }

    // Use stored default amount for token
    function multiSendERC20UsingDefault(
        address token,
        address[] calldata recipients
    ) external onlyOwner nonReentrant whenNotPaused {
        uint256 amount = defaultAmountPerRecipient[token];
        require(amount > 0, "default=0");
        uint256 n = recipients.length;
        require(n > 0 && n <= maxBatchSize, "bad batch");

        uint256 total = amount * n;
        IERC20 erc = IERC20(token);
        require(erc.balanceOf(address(this)) >= total, "insufficient balance");

        for (uint256 i = 0; i < n; ) {
            erc.safeTransfer(recipients[i], amount);
            unchecked { ++i; }
        }
        emit MultiSendERC20(token, n, total);
    }

    // Split a total amount equally across recipients (distributes remainder to first addresses)
    function multiSendERC20EqualSplit(
        address token,
        address[] calldata recipients,
        uint256 totalAmount
    ) external onlyOwner nonReentrant whenNotPaused {
        require(token != address(0), "token=0");
        uint256 n = recipients.length;
        require(n > 0 && n <= maxBatchSize, "bad batch");
        require(totalAmount > 0, "total=0");

        IERC20 erc = IERC20(token);
        require(erc.balanceOf(address(this)) >= totalAmount, "insufficient balance");

        uint256 per = totalAmount / n;
        require(per > 0, "per=0");
        uint256 rem = totalAmount - per * n; // remainder

        for (uint256 i = 0; i < n; ) {
            uint256 amt = per + (i < rem ? 1 : 0);
            erc.safeTransfer(recipients[i], amt);
            unchecked { ++i; }
        }
        emit MultiSendERC20(token, n, totalAmount);
    }

    // -------- Native MATIC multisend (variable amounts) --------
    function multiSendNative(
        address[] calldata recipients,
        uint256[] calldata amounts
    ) external onlyOwner nonReentrant whenNotPaused {
        uint256 n = recipients.length;
        require(n > 0 && n == amounts.length && n <= maxBatchSize, "length/batch");

        uint256 total;
        for (uint256 i = 0; i < n; ) {
            total += amounts[i];
            unchecked { ++i; }
        }
        require(address(this).balance >= total, "insufficient native");

        for (uint256 i = 0; i < n; ) {
            (bool ok, ) = payable(recipients[i]).call{ value: amounts[i] }("");
            require(ok, "native transfer failed");
            unchecked { ++i; }
        }
        emit MultiSendNative(n, total);
    }

    // Uniform native
    function multiSendNativeUniform(
        address[] calldata recipients,
        uint256 amount
    ) external onlyOwner nonReentrant whenNotPaused {
        require(amount > 0, "amount=0");
        uint256 n = recipients.length;
        require(n > 0 && n <= maxBatchSize, "bad batch");

        uint256 total = amount * n;
        require(address(this).balance >= total, "insufficient native");

        for (uint256 i = 0; i < n; ) {
            (bool ok, ) = payable(recipients[i]).call{ value: amount }("");
            require(ok, "native transfer failed");
            unchecked { ++i; }
        }
        emit MultiSendNative(n, total);
    }

    // Split native total equally across recipients (distributes remainder wei to first addresses)
    function multiSendNativeEqualSplit(
        address[] calldata recipients,
        uint256 totalAmount
    ) external onlyOwner nonReentrant whenNotPaused {
        uint256 n = recipients.length;
        require(n > 0 && n <= maxBatchSize, "bad batch");
        require(totalAmount > 0, "total=0");
        require(address(this).balance >= totalAmount, "insufficient native");

        uint256 per = totalAmount / n;
        require(per > 0, "per=0");
        uint256 rem = totalAmount - per * n;

        for (uint256 i = 0; i < n; ) {
            uint256 amt = per + (i < rem ? 1 : 0);
            (bool ok, ) = payable(recipients[i]).call{ value: amt }("");
            require(ok, "native transfer failed");
            unchecked { ++i; }
        }
        emit MultiSendNative(n, totalAmount);
    }

    // Withdraw/sweep (partial)
    function withdrawERC20(address token, address to, uint256 amount) external onlyOwner nonReentrant {
        require(token != address(0) && to != address(0), "addr=0");
        IERC20(token).safeTransfer(to, amount);
        emit WithdrawERC20(token, to, amount);
    }

    function withdrawNative(address payable to, uint256 amount) external onlyOwner nonReentrant {
        require(to != address(0), "to=0");
        (bool ok, ) = to.call{ value: amount }("");
        require(ok, "withdraw failed");
        emit WithdrawNative(to, amount);
    }

    // Recover stuck full balances
    function recoverStuckERC20(address token, address to) external onlyOwner nonReentrant {
        require(token != address(0) && to != address(0), "addr=0");
        uint256 bal = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransfer(to, bal);
        emit RecoverERC20(token, to, bal);
    }

    function recoverStuckNative(address payable to) external onlyOwner nonReentrant {
        require(to != address(0), "to=0");
        uint256 bal = address(this).balance;
        (bool ok, ) = to.call{ value: bal }("");
        require(ok, "recover failed");
        emit RecoverNative(to, bal);
    }

    receive() external payable {}
}
