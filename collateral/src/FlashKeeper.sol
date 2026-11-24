// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/*
 * FlashKeeper — a capital-free liquidator for GoldVault.
 *
 *   run(job) → GoldFlash mints `amount` bXAU to this contract
 *            → vault.liquidate(ilk, urn, amount)          (bXAU in, discounted peg out)
 *            → router.call(swapData)                     (sell seized peg for bXAU on any DEX)
 *            → check: bXAU ≥ amount  and  peg profit ≥ minProfit
 *            → GoldFlash burns `amount`; the profit stays here for the owner to sweep
 *
 * The swap is a raw call to an owner-chosen router with calldata built off-chain (keeper/
 * keeper.mjs builds it), so it works with Uniswap, 1inch, 0x or any aggregator. The seized peg
 * is approved to the router for the duration of the swap only.
 *
 * Safety: only the owner can start a job; the callback only accepts calls from GoldFlash for
 * jobs this contract started; the router may not be the vault, the flash module or bXAU; the
 * whole transaction reverts unless the loan is repaid and the profit floor is met.
 */
interface IFlashBorrower {
    function onFlashLoan(address initiator, address token, uint256 amount, uint256 fee, bytes calldata data)
        external
        returns (bytes32);
}

interface IGoldFlashLender {
    function flashLoan(IFlashBorrower receiver, address token, uint256 amount, bytes calldata data)
        external
        returns (bool);
}

interface IGoldVaultKeeper {
    function bxau() external view returns (address);
    function liquidate(bytes32 ilk, address usr, uint256 maxWad) external returns (uint256 wad, uint256 gemOut);
    function ilks(bytes32 ilk)
        external
        view
        returns (address, uint256, uint256, uint256, uint256, uint256, uint256, uint256, uint256, uint256, uint256);
}

interface IERC20K {
    function balanceOf(address) external view returns (uint256);
}

contract FlashKeeper is IFlashBorrower {
    bytes32 internal constant CALLBACK_SUCCESS = keccak256("ERC3156FlashBorrower.onFlashLoan");

    struct Job {
        bytes32 ilk;
        address urn;
        uint256 amount; // bXAU to flash-mint and offer to liquidate()
        address router; // DEX / aggregator to sell the seized peg on
        bytes swapData; // calldata for router (sells ≤ gemOut of the peg for ≥ wad bXAU)
        uint256 minProfit; // peg units (native decimals) that must be left over
    }

    IGoldVaultKeeper public immutable vault;
    IGoldFlashLender public immutable flash;
    address public immutable bxau;
    address public owner;

    bool private _active; // set only while run() is in flight

    event OwnershipTransferred(address indexed from, address indexed to);
    event Liquidated(bytes32 indexed ilk, address indexed urn, uint256 wad, uint256 gemOut, uint256 profit);
    event Swept(address indexed token, address indexed to, uint256 amount);

    error NotOwner();
    error Untrusted();
    error BadRouter();
    error SwapFailed(bytes reason);
    error CannotRepay(uint256 have, uint256 need);
    error ProfitTooLow(uint256 profit, uint256 minProfit);
    error TransferFailed();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address vault_, address flash_, address owner_) {
        vault = IGoldVaultKeeper(vault_);
        flash = IGoldFlashLender(flash_);
        bxau = IGoldVaultKeeper(vault_).bxau();
        owner = owner_;
        emit OwnershipTransferred(address(0), owner_);
    }

    function transferOwnership(address to) external onlyOwner {
        emit OwnershipTransferred(owner, to);
        owner = to;
    }

    function run(Job calldata job) external onlyOwner {
        if (job.router == address(vault) || job.router == address(flash) || job.router == bxau) revert BadRouter();
        _active = true;
        flash.flashLoan(this, bxau, job.amount, abi.encode(job));
        _active = false;
    }

    function onFlashLoan(address initiator, address token, uint256 amount, uint256, bytes calldata data)
        external
        returns (bytes32)
    {
        if (msg.sender != address(flash) || initiator != address(this) || !_active || token != bxau) {
            revert Untrusted();
        }
        Job memory job = abi.decode(data, (Job));
        (address gem,,,,,,,,,,) = vault.ilks(job.ilk);
        uint256 gemBefore = IERC20K(gem).balanceOf(address(this));

        _approve(bxau, address(vault), amount);
        (uint256 wad, uint256 gemOut) = vault.liquidate(job.ilk, job.urn, amount);
        _approve(bxau, address(vault), 0);

        _approve(gem, job.router, gemOut);
        (bool ok, bytes memory ret) = job.router.call(job.swapData);
        if (!ok) revert SwapFailed(ret);
        _approve(gem, job.router, 0);

        uint256 have = IERC20K(bxau).balanceOf(address(this));
        if (have < amount) revert CannotRepay(have, amount);
        uint256 gemAfter = IERC20K(gem).balanceOf(address(this));
        uint256 profit = gemAfter > gemBefore ? gemAfter - gemBefore : 0;
        if (profit < job.minProfit) revert ProfitTooLow(profit, job.minProfit);

        _approve(bxau, address(flash), amount);
        emit Liquidated(job.ilk, job.urn, wad, gemOut, profit);
        return CALLBACK_SUCCESS;
    }

    /// Withdraw profits (peg or surplus bXAU).
    function sweep(address token, address to, uint256 amount) external onlyOwner {
        (bool ok, bytes memory ret) = token.call(abi.encodeWithSelector(0xa9059cbb, to, amount));
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert TransferFailed();
        emit Swept(token, to, amount);
    }

    function _approve(address token, address spender, uint256 amount) internal {
        (bool ok, bytes memory ret) = token.call(abi.encodeWithSelector(0x095ea7b3, spender, amount));
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert TransferFailed();
    }
}
