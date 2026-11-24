// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/*
 * GoldFlash — ERC-3156 flash-mint of bXAU (Maker's DssFlash, simplified).
 *
 * Mints up to `max` bXAU to a receiver, calls its onFlashLoan, then burns the same amount
 * back (the receiver must approve this contract). Net supply change per call is zero, so the
 * vault's books identity holds at the end of every transaction. Fee is zero.
 *
 * Purpose: keepers can liquidate without holding bXAU first — flash-mint, liquidate, sell
 * part of the seized peg for bXAU, repay, keep the discount.
 *
 * Disabled once the vault is caged (bXAU then only ever shrinks, via cash()).
 */
interface IERC3156FlashBorrower {
    function onFlashLoan(address initiator, address token, uint256 amount, uint256 fee, bytes calldata data)
        external
        returns (bytes32);
}

interface IBasketGoldMint {
    function mint(address to, uint256 value) external;
    function burn(address from, uint256 value) external;
}

interface IVaultLive {
    function live() external view returns (uint256);
}

contract GoldFlash {
    bytes32 public constant CALLBACK_SUCCESS = keccak256("ERC3156FlashBorrower.onFlashLoan");

    IBasketGoldMint public immutable bxau;
    IVaultLive public immutable vault;
    address public owner;
    uint256 public max; // per-call ceiling, bXAU WAD

    uint256 private _lock = 1;

    event OwnershipTransferred(address indexed from, address indexed to);
    event SetMax(uint256 max);
    event FlashLoan(address indexed receiver, address indexed initiator, uint256 amount);

    error NotOwner();
    error UnsupportedToken();
    error OverMax();
    error CallbackFailed();
    error Reentrancy();
    error NotLive();

    constructor(address bxau_, address vault_, address owner_) {
        bxau = IBasketGoldMint(bxau_);
        vault = IVaultLive(vault_);
        owner = owner_;
        emit OwnershipTransferred(address(0), owner_);
    }

    function transferOwnership(address to) external {
        if (msg.sender != owner) revert NotOwner();
        emit OwnershipTransferred(owner, to);
        owner = to;
    }

    function setMax(uint256 max_) external {
        if (msg.sender != owner) revert NotOwner();
        max = max_;
        emit SetMax(max_);
    }

    // ── ERC-3156 lender ──

    function maxFlashLoan(address token) external view returns (uint256) {
        return token == address(bxau) && vault.live() == 1 ? max : 0;
    }

    function flashFee(address token, uint256) external view returns (uint256) {
        if (token != address(bxau)) revert UnsupportedToken();
        return 0;
    }

    function flashLoan(IERC3156FlashBorrower receiver, address token, uint256 amount, bytes calldata data)
        external
        returns (bool)
    {
        if (_lock != 1) revert Reentrancy();
        _lock = 2;
        if (token != address(bxau)) revert UnsupportedToken();
        if (vault.live() != 1) revert NotLive();
        if (amount > max) revert OverMax();

        bxau.mint(address(receiver), amount);
        if (receiver.onFlashLoan(msg.sender, token, amount, 0, data) != CALLBACK_SUCCESS) revert CallbackFailed();
        bxau.burn(address(receiver), amount); // spends the receiver's allowance to this contract

        emit FlashLoan(address(receiver), msg.sender, amount);
        _lock = 1;
        return true;
    }
}
