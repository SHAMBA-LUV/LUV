// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title LUVLockerModern — the third LUVLocker: OpenZeppelin build of the CURRENT LIVE vault
 * @notice Successor line: LUVLocker (in-house, live) → LUVLockerOZ (OZ reference of the early
 *         vault) → LUVLockerModern (this: OZ v5 build with full live-feature parity PLUS the
 *         audit fixes from the 2026-08-03 review of the live contract).
 *
 *         What it locks:
 *           • LUV principal — reflection-earning lock ("spend the reflections, never the
 *             principal"): balance-index accounting turns the 3% trade reflections that land on
 *             this contract into harvestable interest while principal stays timelocked.
 *           • Any ERC-20 via asset timelocks — INCLUDING the Uniswap ETH/LUV LP token, which is
 *             how liquidity is provably locked: deposit the pair token under an unlock time and
 *             the pool depth cannot be pulled before it.
 *
 *         Audit fixes over the live contract (see docs/AUDIT_LUVLOCKER.md):
 *           A1  extendLock is SELF-ONLY. In the live vault the owner may extend ANY user's lock
 *               repeatedly (grief vector for third-party depositors). Here only the account
 *               itself can extend its lock — extend-only culture, minus the hostage risk.
 *           A2  Asset locks (incl. LP locks) gain extend-only extension — a liquidity lock can
 *               be lengthened as commitment proof, never shortened.
 *           A3  Asset locks accept an optional beneficiary — lock LP (or anything) FOR someone:
 *               only the beneficiary can withdraw at maturity.
 *           A4  Deposits are pausable for incident response; WITHDRAWALS ARE NEVER PAUSABLE —
 *               user exit paths stay open under every condition, owner included.
 *           A5  Ownable2Step — no fat-finger ownership loss on the vault that holds the locks.
 *
 *         Operational note (unchanged from live): for reflection interest to accrue, this
 *         contract must NOT be excluded from reflections on the LUV token.
 */
contract LUVLockerModern is Ownable2Step, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    IERC20 public immutable LUV;
    uint256 public lockDuration;
    uint256 public immutable minBlockDelta;
    uint256 public constant MAX_LOCK_DURATION = 3650 days;

    // ── LUV principal + reflection-interest accounting (staking-pool index) ──
    uint256 public constant ACC_SCALE = 1e27;
    uint256 public totalPrincipal;
    uint256 public accRewardPerPrincipal;
    uint256 public lastRewardBalance;

    struct UserInfo {
        uint256 principal;
        uint256 depositTime;
        uint256 depositBlock;
        uint256 unlockAt;
        uint256 rewardDebt;
        uint256 accrued;
        uint256 autoThreshold;
        address payout;
        bool lockInterest;
    }

    mapping(address => UserInfo) public users;

    // ── generic asset timelock (the liquidity-pair lock lives here) ──
    struct AssetLock {
        address token;
        uint256 amount;
        uint64 unlockAt;
        bool withdrawn;
    }

    mapping(address => AssetLock[]) private _assetLocks; // keyed by BENEFICIARY
    mapping(address => uint256) public totalAssetLocked;

    // ── events ──
    event Deposit(address indexed user, uint256 amount);
    event Withdraw(address indexed user, uint256 amount);
    event LockExtended(address indexed user, uint256 oldUnlockAt, uint256 newUnlockAt);
    event LockDurationSet(uint256 oldDuration, uint256 newDuration);
    event Harvest(address indexed user, address indexed payout, uint256 amount);
    event InterestCompounded(address indexed user, uint256 amount);
    event InterestModeSet(address indexed user, bool lockInterest);
    event AutoConfig(address indexed user, uint256 threshold, address payout);
    event Poked(address indexed caller, address indexed user, bool paid, uint256 amount);
    event AssetLocked(address indexed beneficiary, uint256 indexed lockId, address token, uint256 amount, uint64 unlockAt, address indexed funder);
    event AssetLockExtended(address indexed beneficiary, uint256 indexed lockId, uint64 oldUnlockAt, uint64 newUnlockAt);
    event AssetWithdrawn(address indexed beneficiary, uint256 indexed lockId, address token, uint256 amount);
    event Rescued(address indexed token, address indexed to, uint256 amount);

    error ZeroAddress();
    error AmountZero();
    error InsufficientPrincipal();
    error TimeLockActive();
    error NotShortenable();
    error DurationTooLong();
    error BlockLockActive();
    error NoRewards();
    error BadUnlockTime();
    error LockNotFound();
    error StillLocked();
    error AlreadyWithdrawn();
    error NothingToRescue();

    constructor(address luv, uint256 lockDuration_, uint256 minBlockDelta_) Ownable(msg.sender) {
        if (luv == address(0)) revert ZeroAddress();
        if (lockDuration_ == 0 || minBlockDelta_ == 0) revert AmountZero();
        if (lockDuration_ > MAX_LOCK_DURATION) revert DurationTooLong();
        LUV = IERC20(luv);
        lockDuration = lockDuration_;
        minBlockDelta = minBlockDelta_;
    }

    // ── owner: duration for FUTURE deposits + incident pause (deposits only) ──

    function setLockDuration(uint256 newDuration) external onlyOwner {
        if (newDuration == 0) revert AmountZero();
        if (newDuration > MAX_LOCK_DURATION) revert DurationTooLong();
        emit LockDurationSet(lockDuration, newDuration);
        lockDuration = newDuration;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ── locks: extend-only, SELF-ONLY (audit fix A1) ──

    function extendLock(uint256 newUnlockAt) external {
        UserInfo storage u = users[msg.sender];
        if (u.principal == 0) revert InsufficientPrincipal();
        if (newUnlockAt <= u.unlockAt) revert NotShortenable();
        if (newUnlockAt > block.timestamp + MAX_LOCK_DURATION) revert DurationTooLong();
        emit LockExtended(msg.sender, u.unlockAt, newUnlockAt);
        u.unlockAt = newUnlockAt;
    }

    // ── user config ──

    function setInterestMode(bool lockInterest_) external nonReentrant {
        _accrue();
        _settle(msg.sender);
        users[msg.sender].lockInterest = lockInterest_;
        _syncRewardBalance();
        emit InterestModeSet(msg.sender, lockInterest_);
    }

    function setAutoPayout(uint256 threshold, address payout) external nonReentrant {
        if (payout == address(0)) payout = msg.sender;
        _accrue();
        _settle(msg.sender);
        UserInfo storage u = users[msg.sender];
        u.autoThreshold = threshold;
        u.payout = payout;
        _maybeAutoPay(msg.sender);
        _syncRewardBalance();
        emit AutoConfig(msg.sender, threshold, payout);
    }

    // ── LUV principal ──

    function deposit(uint256 amount) external nonReentrant whenNotPaused {
        if (amount == 0) revert AmountZero();
        _accrue();
        _settle(msg.sender);

        // credit the amount that ACTUALLY arrived (fee-on-transfer safe) — never the
        // requested amount, or totalPrincipal drifts above the real balance and the
        // tail of withdrawers reverts.
        uint256 beforeBal = LUV.balanceOf(address(this));
        LUV.safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = LUV.balanceOf(address(this)) - beforeBal;
        if (received == 0) revert AmountZero();

        UserInfo storage u = users[msg.sender];
        u.principal += received;
        u.depositTime = block.timestamp;
        u.depositBlock = block.number;
        // NOTE (documented live behavior): any deposit refreshes the lock on the WHOLE
        // principal to at least now+lockDuration. Extend-only culture, stated plainly.
        uint256 fresh = block.timestamp + lockDuration;
        if (fresh > u.unlockAt) u.unlockAt = fresh;
        totalPrincipal += received;
        u.rewardDebt = (u.principal * accRewardPerPrincipal) / ACC_SCALE;

        _maybeAutoPay(msg.sender);
        _syncRewardBalance();
        emit Deposit(msg.sender, received);
    }

    function withdraw(uint256 amount) external nonReentrant {
        UserInfo storage u = users[msg.sender];
        if (u.principal < amount) revert InsufficientPrincipal();
        if (block.timestamp < u.unlockAt) revert TimeLockActive();
        if (block.number < u.depositBlock + minBlockDelta) revert BlockLockActive();

        _accrue();
        _settle(msg.sender);
        if (u.principal < amount) revert InsufficientPrincipal();

        _maybeAutoPay(msg.sender);

        u.principal -= amount;
        totalPrincipal -= amount;
        u.rewardDebt = (u.principal * accRewardPerPrincipal) / ACC_SCALE;

        LUV.safeTransfer(msg.sender, amount);
        _syncRewardBalance();
        emit Withdraw(msg.sender, amount);
    }

    function harvest() external nonReentrant {
        _accrue();
        _settle(msg.sender);
        uint256 paid = _payAccrued(msg.sender);
        if (paid == 0) revert NoRewards();
        _syncRewardBalance();
    }

    function poke(address user) external nonReentrant {
        _accrue();
        _settle(user);
        uint256 amountPaid = 0;
        UserInfo storage u = users[user];
        if (u.autoThreshold > 0 && u.accrued >= u.autoThreshold) {
            amountPaid = _payAccrued(user);
        }
        _syncRewardBalance();
        emit Poked(msg.sender, user, amountPaid > 0, amountPaid);
    }

    // ── multi-asset timelock: LP locks, beneficiary-aware (audit fixes A2, A3) ──

    /// @notice Lock any ERC-20 (including the ETH/LUV pair token) until `unlockAt`,
    ///         for `beneficiary` (default: the funder). Only the beneficiary withdraws.
    function lockAsset(address token, uint256 amount, uint64 unlockAt, address beneficiary)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 lockId)
    {
        if (token == address(0)) revert ZeroAddress();
        if (amount == 0) revert AmountZero();
        if (unlockAt <= block.timestamp) revert BadUnlockTime();
        if (beneficiary == address(0)) beneficiary = msg.sender;

        if (token == address(LUV)) _accrue();
        // measured delta — this path accepts ANY token, incl. fee-on-transfer / rebasing;
        // crediting the requested amount would let a later withdrawer pull another
        // locker's shortfall.
        uint256 beforeBal = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = IERC20(token).balanceOf(address(this)) - beforeBal;
        if (received == 0) revert AmountZero();

        lockId = _assetLocks[beneficiary].length;
        _assetLocks[beneficiary].push(AssetLock(token, received, unlockAt, false));
        totalAssetLocked[token] += received;

        if (token == address(LUV)) _syncRewardBalance();
        emit AssetLocked(beneficiary, lockId, token, received, unlockAt, msg.sender);
    }

    /// @notice Extend an asset lock — extend-only, beneficiary-only. The liquidity
    ///         lock can be lengthened as proof of commitment, never shortened.
    function extendAssetLock(uint256 lockId, uint64 newUnlockAt) external {
        AssetLock[] storage locks = _assetLocks[msg.sender];
        if (lockId >= locks.length) revert LockNotFound();
        AssetLock storage l = locks[lockId];
        if (l.withdrawn) revert AlreadyWithdrawn();
        if (newUnlockAt <= l.unlockAt) revert NotShortenable();
        if (newUnlockAt > block.timestamp + MAX_LOCK_DURATION) revert DurationTooLong();
        emit AssetLockExtended(msg.sender, lockId, l.unlockAt, newUnlockAt);
        l.unlockAt = newUnlockAt;
    }

    function withdrawAsset(uint256 lockId) external nonReentrant {
        AssetLock[] storage locks = _assetLocks[msg.sender];
        if (lockId >= locks.length) revert LockNotFound();
        AssetLock storage l = locks[lockId];
        if (l.withdrawn) revert AlreadyWithdrawn();
        if (block.timestamp < l.unlockAt) revert StillLocked();

        if (l.token == address(LUV)) _accrue();
        l.withdrawn = true;
        totalAssetLocked[l.token] -= l.amount;
        IERC20(l.token).safeTransfer(msg.sender, l.amount);
        if (l.token == address(LUV)) _syncRewardBalance();
        emit AssetWithdrawn(msg.sender, lockId, l.token, l.amount);
    }

    function assetLockCount(address beneficiary) external view returns (uint256) {
        return _assetLocks[beneficiary].length;
    }

    function assetLockAt(address beneficiary, uint256 lockId)
        external
        view
        returns (address token, uint256 amount, uint64 unlockAt, bool withdrawn)
    {
        AssetLock storage l = _assetLocks[beneficiary][lockId];
        return (l.token, l.amount, l.unlockAt, l.withdrawn);
    }

    // ── views (read-only-reentrancy guarded) ──

    modifier whenNotEntered() {
        require(!_reentrancyGuardEntered(), "reentrant read");
        _;
    }

    function isLocked(address user) external view whenNotEntered returns (bool) {
        UserInfo storage u = users[user];
        if (u.principal == 0) return false;
        return block.timestamp < u.unlockAt || block.number < u.depositBlock + minBlockDelta;
    }

    function pendingRewards(address user) external view whenNotEntered returns (uint256) {
        UserInfo storage u = users[user];
        uint256 acc = accRewardPerPrincipal;
        uint256 current = _rewardBalance();
        if (totalPrincipal > 0 && current > lastRewardBalance) {
            acc += ((current - lastRewardBalance) * ACC_SCALE) / totalPrincipal;
        }
        uint256 pending = 0;
        if (u.principal > 0) {
            uint256 accumulated = (u.principal * acc) / ACC_SCALE;
            if (accumulated > u.rewardDebt) pending = accumulated - u.rewardDebt;
        }
        if (u.lockInterest) pending = 0;
        return u.accrued + pending;
    }

    function surplus(address token) external view whenNotEntered returns (uint256) {
        return _surplus(token);
    }

    // ── owner: rescue SURPLUS ONLY (never principal, locks, or rewards) ──

    function rescue(address token, address to) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        if (token == address(LUV)) _accrue();
        uint256 amount = _surplus(token);
        if (amount == 0) revert NothingToRescue();
        IERC20(token).safeTransfer(to, amount);
        if (token == address(LUV)) _syncRewardBalance();
        emit Rescued(token, to, amount);
    }

    // ── internals ──

    function _surplus(address token) internal view returns (uint256) {
        uint256 bal = IERC20(token).balanceOf(address(this));
        uint256 owed = totalAssetLocked[token];
        if (token == address(LUV)) {
            uint256 reserved = totalPrincipal + owed + _rewardBalance();
            return bal > reserved ? bal - reserved : 0;
        }
        return bal > owed ? bal - owed : 0;
    }

    function _rewardBalance() internal view returns (uint256) {
        uint256 bal = LUV.balanceOf(address(this));
        uint256 reserved = totalPrincipal + totalAssetLocked[address(LUV)];
        return bal > reserved ? bal - reserved : 0;
    }

    function _accrue() internal {
        uint256 current = _rewardBalance();
        if (totalPrincipal > 0 && current > lastRewardBalance) {
            accRewardPerPrincipal += ((current - lastRewardBalance) * ACC_SCALE) / totalPrincipal;
        }
        lastRewardBalance = current;
    }

    function _settle(address user) internal {
        UserInfo storage u = users[user];
        if (u.principal == 0) {
            u.rewardDebt = 0;
            return;
        }
        uint256 accumulated = (u.principal * accRewardPerPrincipal) / ACC_SCALE;
        if (accumulated > u.rewardDebt) {
            uint256 pending = accumulated - u.rewardDebt;
            if (u.lockInterest) {
                u.principal += pending;
                totalPrincipal += pending;
                accumulated = (u.principal * accRewardPerPrincipal) / ACC_SCALE;
                emit InterestCompounded(user, pending);
            } else {
                u.accrued += pending;
            }
        }
        u.rewardDebt = accumulated;
    }

    function _maybeAutoPay(address user) internal {
        UserInfo storage u = users[user];
        if (u.autoThreshold > 0 && u.accrued >= u.autoThreshold) {
            _payAccrued(user);
        }
    }

    function _payAccrued(address user) internal returns (uint256 paid) {
        UserInfo storage u = users[user];
        uint256 amount = u.accrued;
        if (amount == 0) return 0;
        address to = u.payout == address(0) ? user : u.payout;

        uint256 available = _rewardBalance();
        if (amount > available) amount = available;
        if (amount == 0) return 0;

        u.accrued -= amount;
        LUV.safeTransfer(to, amount);
        emit Harvest(user, to, amount);
        return amount;
    }

    function _syncRewardBalance() internal {
        lastRewardBalance = _rewardBalance();
    }
}
