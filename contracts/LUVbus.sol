// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/*
 * ❤️ LUVbus — the Ethereum batch rail. ❤️
 *
 * Owner-operated multisend for ERC20 (LUV first) and native ETH, ported to Ethereum
 * mainnet from the Polygon MultiSend and rebuilt for LOWEST FEE at any recipient count.
 *
 * Ethereum-mainnet gas doctrine (why this differs from the Polygon original):
 *   - CALLDATA IS THE ENEMY on L1: every nonzero byte costs 16 gas, so a 500-address
 *     variable-amount batch pays for two arrays. Prefer, in order:
 *       1. multiSendERC20UsingDefault  — addresses only, amount from storage (cheapest/recipient)
 *       2. multiSendERC20Uniform      — addresses + one amount word
 *       3. multiSendERC20EqualSplit   — addresses + one total word
 *       4. multiSendERC20             — both arrays (only when amounts truly vary)
 *   - CUSTOM ERRORS replace require-strings (no string data in the runtime, cheaper reverts).
 *   - ZERO DEPENDENCIES (cypherpunk4096): Ownable2Step / Pausable / ReentrancyGuard /
 *     SafeTransfer are inlined below — no imports, nothing to resolve, bytecode is the truth.
 *   - Batch ceiling: ~55k gas/recipient worst-case (cold ERC20 transfer) against the ~30M
 *     block limit ⇒ 500 is safe; tune with setMaxBatchSize after measuring your token.
 *
 * LUV note: ShambaLuv charges 0 fee wallet-to-wallet but LUVbus is a contract counterparty —
 * the owner should setFeeExemption(bus, true) on the token so every seat on the bus
 * receives the full amount. 1 LUV === 1 LUV.
 */

interface IERC20 {
    function transfer(address to, uint256 value) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

contract LUVbus {
    // ── errors (cheaper than strings) ────────────────────────────────────────
    error NotOwner();
    error NotPendingOwner();
    error ZeroAddress();
    error ZeroAmount();
    error BadBatch();          // empty, length mismatch, or over maxBatchSize
    error InsufficientBalance();
    error TransferFailed();
    error NoDefault();
    error PerSeatZero();
    error IsPaused();
    error Reentrancy();
    error IsRetired();

    // ── ownership: two-step, inlined ─────────────────────────────────────────
    address public owner;
    address public pendingOwner;

    // ── pause + reentrancy, inlined ──────────────────────────────────────────
    bool public paused;
    bool public retired;   // ONE-WAY binary switch: once true, the bus is paused forever
    uint256 private _entered = 1;

    uint256 public maxBatchSize = 500; // tuned for Ethereum block gas; adjust after measuring
    mapping(address => uint256) public defaultAmountPerRecipient; // per-token default seat price

    event MultiSendERC20(address indexed token, uint256 recipients, uint256 totalAmount);
    event MultiSendNative(uint256 recipients, uint256 totalAmount);
    event MaxBatchSizeUpdated(uint256 newMax);
    event WithdrawERC20(address indexed token, address indexed to, uint256 amount);
    event WithdrawNative(address indexed to, uint256 amount);
    event DefaultAmountUpdated(address indexed token, uint256 amount);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event PausedSet(bool paused);
    event RetiredForever();

    modifier onlyOwner() { if (msg.sender != owner) revert NotOwner(); _; }
    modifier nonReentrant() { if (_entered != 1) revert Reentrancy(); _entered = 2; _; _entered = 1; }
    modifier whenNotPaused() { if (paused) revert IsPaused(); _; }

    constructor() { owner = msg.sender; emit OwnershipTransferred(address(0), msg.sender); }

    function transferOwnership(address newOwner) external onlyOwner {
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }
    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotPendingOwner();
        emit OwnershipTransferred(owner, msg.sender);
        owner = msg.sender;
        pendingOwner = address(0);
    }
    /// Direct one-transaction ownership handoff to an address (skips the two-step dance).
    /// Use the two-step transferOwnership/acceptOwnership when the receiver is unverified.
    function transferOwnershipToAddress(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
        pendingOwner = address(0);
    }
    /// ONE-WAY: renounce ownership forever. WARNING — every onlyOwner function dies with it,
    /// including withdraw/recover: sweep all balances off the bus BEFORE renouncing.
    function renounceOwnership() external onlyOwner {
        emit OwnershipTransferred(owner, address(0));
        owner = address(0);
        pendingOwner = address(0);
    }

    // ── admin ────────────────────────────────────────────────────────────────
    function setMaxBatchSize(uint256 _max) external onlyOwner {
        if (_max == 0) revert ZeroAmount();
        maxBatchSize = _max;
        emit MaxBatchSizeUpdated(_max);
    }
    function setPaused(bool _paused) external onlyOwner {
        if (retired) revert IsRetired();
        paused = _paused;
        emit PausedSet(_paused);
    }
    /// ONE-WAY binary switch: flips pause to ON permanently. No unpause exists past this
    /// point — the bus is retired for sending, forever. Withdraw/recover stay live so no
    /// balance is ever stranded.
    function retire() external onlyOwner {
        retired = true;
        paused = true;
        emit PausedSet(true);
        emit RetiredForever();
    }
    function setDefaultERC20Amount(address token, uint256 amount) external onlyOwner {
        if (token == address(0)) revert ZeroAddress();
        defaultAmountPerRecipient[token] = amount;
        emit DefaultAmountUpdated(token, amount);
    }

    // ── safe transfer (handles non-standard ERC20s), inlined ─────────────────
    function _safeTransfer(address token, address to, uint256 value) private {
        (bool ok, bytes memory data) = token.call(abi.encodeCall(IERC20.transfer, (to, value)));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }

    // ── ERC20 multisend: variable amounts (heaviest calldata — last resort) ──
    function multiSendERC20(
        address token,
        address[] calldata recipients,
        uint256[] calldata amounts
    ) external onlyOwner nonReentrant whenNotPaused {
        if (token == address(0)) revert ZeroAddress();
        uint256 n = recipients.length;
        if (n == 0 || n != amounts.length || n > maxBatchSize) revert BadBatch();

        uint256 total;
        for (uint256 i = 0; i < n; ) {
            total += amounts[i];
            unchecked { ++i; }
        }
        if (IERC20(token).balanceOf(address(this)) < total) revert InsufficientBalance();

        for (uint256 i = 0; i < n; ) {
            _safeTransfer(token, recipients[i], amounts[i]);
            unchecked { ++i; }
        }
        emit MultiSendERC20(token, n, total);
    }

    // ── ERC20 uniform: one amount word for the whole bus ─────────────────────
    function multiSendERC20Uniform(
        address token,
        address[] calldata recipients,
        uint256 amount
    ) external onlyOwner nonReentrant whenNotPaused {
        if (token == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        uint256 n = recipients.length;
        if (n == 0 || n > maxBatchSize) revert BadBatch();

        uint256 total = amount * n;
        if (IERC20(token).balanceOf(address(this)) < total) revert InsufficientBalance();

        for (uint256 i = 0; i < n; ) {
            _safeTransfer(token, recipients[i], amount);
            unchecked { ++i; }
        }
        emit MultiSendERC20(token, n, total);
    }

    // ── ERC20 using stored default: addresses-only calldata (cheapest) ───────
    function multiSendERC20UsingDefault(
        address token,
        address[] calldata recipients
    ) external onlyOwner nonReentrant whenNotPaused {
        uint256 amount = defaultAmountPerRecipient[token];
        if (amount == 0) revert NoDefault();
        uint256 n = recipients.length;
        if (n == 0 || n > maxBatchSize) revert BadBatch();

        uint256 total = amount * n;
        if (IERC20(token).balanceOf(address(this)) < total) revert InsufficientBalance();

        for (uint256 i = 0; i < n; ) {
            _safeTransfer(token, recipients[i], amount);
            unchecked { ++i; }
        }
        emit MultiSendERC20(token, n, total);
    }

    // ── ERC20 equal split of a total (remainder wei to the first seats) ──────
    function multiSendERC20EqualSplit(
        address token,
        address[] calldata recipients,
        uint256 totalAmount
    ) external onlyOwner nonReentrant whenNotPaused {
        if (token == address(0)) revert ZeroAddress();
        if (totalAmount == 0) revert ZeroAmount();
        uint256 n = recipients.length;
        if (n == 0 || n > maxBatchSize) revert BadBatch();
        if (IERC20(token).balanceOf(address(this)) < totalAmount) revert InsufficientBalance();

        uint256 per = totalAmount / n;
        if (per == 0) revert PerSeatZero();
        uint256 rem = totalAmount - per * n;

        for (uint256 i = 0; i < n; ) {
            _safeTransfer(token, recipients[i], per + (i < rem ? 1 : 0));
            unchecked { ++i; }
        }
        emit MultiSendERC20(token, n, totalAmount);
    }

    // ── native ETH multisend: variable amounts ───────────────────────────────
    function multiSendNative(
        address[] calldata recipients,
        uint256[] calldata amounts
    ) external payable onlyOwner nonReentrant whenNotPaused {
        uint256 n = recipients.length;
        if (n == 0 || n != amounts.length || n > maxBatchSize) revert BadBatch();

        uint256 total;
        for (uint256 i = 0; i < n; ) {
            total += amounts[i];
            unchecked { ++i; }
        }
        if (address(this).balance < total) revert InsufficientBalance();

        for (uint256 i = 0; i < n; ) {
            (bool ok, ) = payable(recipients[i]).call{ value: amounts[i] }("");
            if (!ok) revert TransferFailed();
            unchecked { ++i; }
        }
        emit MultiSendNative(n, total);
    }

    // ── native ETH uniform ───────────────────────────────────────────────────
    function multiSendNativeUniform(
        address[] calldata recipients,
        uint256 amount
    ) external payable onlyOwner nonReentrant whenNotPaused {
        if (amount == 0) revert ZeroAmount();
        uint256 n = recipients.length;
        if (n == 0 || n > maxBatchSize) revert BadBatch();

        uint256 total = amount * n;
        if (address(this).balance < total) revert InsufficientBalance();

        for (uint256 i = 0; i < n; ) {
            (bool ok, ) = payable(recipients[i]).call{ value: amount }("");
            if (!ok) revert TransferFailed();
            unchecked { ++i; }
        }
        emit MultiSendNative(n, total);
    }

    // ── native ETH equal split (remainder wei to the first seats) ────────────
    function multiSendNativeEqualSplit(
        address[] calldata recipients,
        uint256 totalAmount
    ) external payable onlyOwner nonReentrant whenNotPaused {
        if (totalAmount == 0) revert ZeroAmount();
        uint256 n = recipients.length;
        if (n == 0 || n > maxBatchSize) revert BadBatch();
        if (address(this).balance < totalAmount) revert InsufficientBalance();

        uint256 per = totalAmount / n;
        if (per == 0) revert PerSeatZero();
        uint256 rem = totalAmount - per * n;

        for (uint256 i = 0; i < n; ) {
            (bool ok, ) = payable(recipients[i]).call{ value: per + (i < rem ? 1 : 0) }("");
            if (!ok) revert TransferFailed();
            unchecked { ++i; }
        }
        emit MultiSendNative(n, totalAmount);
    }

    // ── withdraw / sweep ─────────────────────────────────────────────────────
    function withdrawERC20(address token, address to, uint256 amount) external onlyOwner nonReentrant {
        if (token == address(0) || to == address(0)) revert ZeroAddress();
        _safeTransfer(token, to, amount);
        emit WithdrawERC20(token, to, amount);
    }
    function withdrawNative(address payable to, uint256 amount) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        (bool ok, ) = to.call{ value: amount }("");
        if (!ok) revert TransferFailed();
        emit WithdrawNative(to, amount);
    }
    function recoverStuckERC20(address token, address to) external onlyOwner nonReentrant {
        if (token == address(0) || to == address(0)) revert ZeroAddress();
        uint256 bal = IERC20(token).balanceOf(address(this));
        _safeTransfer(token, to, bal);
        emit WithdrawERC20(token, to, bal);
    }
    function recoverStuckNative(address payable to) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        uint256 bal = address(this).balance;
        (bool ok, ) = to.call{ value: bal }("");
        if (!ok) revert TransferFailed();
        emit WithdrawNative(to, bal);
    }

    receive() external payable {}
}
