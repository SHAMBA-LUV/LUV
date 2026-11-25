// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/*
 * GoldLiquidityLocker — tiered fee rewards for long-term liquidity in a GoldStablePool.
 *
 * Every LP of the pool already earns the part of each swap fee that stays in the pool (it lifts
 * the LP token's virtual price). On top of that, `stakerShare` of every fee is paid to THIS
 * contract and shared among LPs who lock their LP tokens, weighted by lock tier:
 *
 *     tier      lock      weight per LP     share of the staker stream
 *     BRONZE    30 days   1×                proportional to weight
 *     SILVER   180 days   2×
 *     GOLD     365 days   3×
 *
 * The tiers are constants: governance cannot change the deal after you lock.
 *
 * Ways in (each creates a position with its own id, tier and unlock time):
 *   · lock(lp, tier)                         lock LP tokens you already hold
 *   · provide([a0, a1], minLp, tier)         ASSET PAIRING: deposit both coins → LP → lock
 *   · provideSingle(i, amount, minLp, tier)  SINGLE ASSET: deposit one coin → LP → lock
 *
 * Ways out: claim(ids) any time; after unlock, withdraw(id) returns the LP (plus rewards) or
 * withdrawOneCoin(id, i, min) redeems it straight to one coin. relock(id, tier) extends a
 * position into the same or a longer tier. Once a position's lock has expired its boost ends:
 * anyone may kick(id) it down to the base 1× weight, so expired boosts never dilute active ones.
 *
 * Accounting is MasterChef-style per weight (two reward tokens: the pool's two coins). Fees that
 * arrive while nothing is locked are held and paid out to the next lockers, never stranded.
 * Rewards are measured by balance delta (PAXG charges a transfer fee).
 */
interface IGoldStablePool {
    function coins(uint256) external view returns (address);
    function stakerFees(uint256) external view returns (uint256);
    function collectStakerFees() external returns (uint256, uint256);
    function addLiquidity(uint256[2] calldata amounts, uint256 minMint) external returns (uint256);
    function removeLiquidityOneCoin(uint256 amount, uint256 i, uint256 minAmount) external returns (uint256);
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

interface IERC20L {
    function balanceOf(address) external view returns (uint256);
}

contract GoldLiquidityLocker {
    uint256 internal constant ACC = 1e36;
    uint256 internal constant BPS = 10_000;
    uint256 public constant BASE_MULT = 10_000; // weight after a lock expires (1×)
    uint8 public constant BRONZE = 0;
    uint8 public constant SILVER = 1;
    uint8 public constant GOLD = 2;

    struct Position {
        address owner;
        uint8 tier;
        uint64 unlockAt;
        uint256 amount; // LP locked
        uint256 weight; // amount × multiplier
        uint256 debt0; // reward debt, coin0
        uint256 debt1; // reward debt, coin1
    }

    IGoldStablePool public immutable pool;
    address public immutable coin0;
    address public immutable coin1;

    mapping(uint256 => Position) public positions;
    mapping(address => uint256[]) internal _positionsOf;
    uint256 public nextId = 1;

    uint256 public totalLocked; // LP
    uint256 public totalWeight;
    uint256 public acc0; // reward per weight × ACC
    uint256 public acc1;
    uint256 public undistributed0; // arrived while totalWeight == 0
    uint256 public undistributed1;

    uint256 private _lock = 1;

    event Locked(uint256 indexed id, address indexed owner, uint8 tier, uint256 amount, uint256 unlockAt);
    event Relocked(uint256 indexed id, uint8 tier, uint256 unlockAt);
    event Kicked(uint256 indexed id);
    event Claimed(uint256 indexed id, address indexed owner, uint256 amount0, uint256 amount1);
    event Withdrawn(uint256 indexed id, address indexed owner, uint256 amount);
    event Harvested(uint256 amount0, uint256 amount1);

    error Reentrancy();
    error BadTier();
    error NotOwner();
    error StillLocked();
    error NotExpired();
    error ZeroAmount();
    error TransferFailed();

    modifier nonReentrant() {
        if (_lock != 1) revert Reentrancy();
        _lock = 2;
        _;
        _lock = 1;
    }

    constructor(address pool_) {
        pool = IGoldStablePool(pool_);
        coin0 = IGoldStablePool(pool_).coins(0);
        coin1 = IGoldStablePool(pool_).coins(1);
    }

    /// (lock duration, weight multiplier in bps) of a tier.
    function tierInfo(uint8 tier) public pure returns (uint64 duration, uint256 multBps) {
        if (tier == BRONZE) return (30 days, 10_000);
        if (tier == SILVER) return (180 days, 20_000);
        if (tier == GOLD) return (365 days, 30_000);
        revert BadTier();
    }

    // ═════════════════════════════════ entry ═════════════════════════════════

    function lock(uint256 lpAmount, uint8 tier) external nonReentrant returns (uint256 id) {
        if (lpAmount == 0) revert ZeroAmount();
        _harvest();
        if (!pool.transferFrom(msg.sender, address(this), lpAmount)) revert TransferFailed();
        id = _open(msg.sender, lpAmount, tier);
    }

    /// Asset pairing: deposit both coins (any ratio; balanced pays ~no pool fee), lock the LP.
    function provide(uint256[2] calldata amounts, uint256 minLp, uint8 tier)
        external
        nonReentrant
        returns (uint256 id, uint256 lp)
    {
        _harvest();
        lp = _provide(amounts, minLp);
        id = _open(msg.sender, lp, tier);
    }

    /// Single asset: deposit only coin i, lock the LP.
    function provideSingle(uint256 i, uint256 amount, uint256 minLp, uint8 tier)
        external
        nonReentrant
        returns (uint256 id, uint256 lp)
    {
        if (i > 1) revert BadTier();
        _harvest();
        uint256[2] memory amounts;
        amounts[i] = amount;
        lp = _provide(amounts, minLp);
        id = _open(msg.sender, lp, tier);
    }

    // ═════════════════════════════════ exit ══════════════════════════════════

    function claim(uint256[] calldata ids) external nonReentrant {
        _harvest();
        for (uint256 k; k < ids.length; ++k) {
            Position storage p = positions[ids[k]];
            if (p.owner != msg.sender) revert NotOwner();
            _settle(ids[k], p);
        }
    }

    /// After unlock: rewards + LP tokens back to the owner.
    function withdraw(uint256 id) external nonReentrant returns (uint256 amount) {
        amount = _close(id);
        if (!pool.transfer(msg.sender, amount)) revert TransferFailed();
    }

    /// After unlock: rewards + the LP redeemed straight to one coin.
    function withdrawOneCoin(uint256 id, uint256 i, uint256 minOut) external nonReentrant returns (uint256 out) {
        uint256 amount = _close(id);
        address coin = i == 0 ? coin0 : coin1;
        uint256 before = IERC20L(coin).balanceOf(address(this));
        pool.removeLiquidityOneCoin(amount, i, minOut);
        out = IERC20L(coin).balanceOf(address(this)) - before;
        _send(coin, msg.sender, out);
    }

    /// Extend a position into the same or a longer tier (never shortens an existing lock).
    function relock(uint256 id, uint8 tier) external nonReentrant {
        Position storage p = positions[id];
        if (p.owner != msg.sender) revert NotOwner();
        if (tier < p.tier) revert BadTier();
        (uint64 d, uint256 m) = tierInfo(tier);
        _harvest();
        _settle(id, p);
        uint64 until = uint64(block.timestamp) + d;
        if (until < p.unlockAt) until = p.unlockAt;
        _reweight(p, p.amount * m / BPS);
        p.tier = tier;
        p.unlockAt = until;
        emit Relocked(id, tier, until);
    }

    /// Permissionless: drop an expired position's boost to the base 1× weight.
    function kick(uint256 id) external nonReentrant {
        Position storage p = positions[id];
        uint256 base = p.amount * BASE_MULT / BPS;
        if (p.owner == address(0) || block.timestamp < p.unlockAt || p.weight <= base) revert NotExpired();
        _harvest();
        _settle(id, p);
        _reweight(p, base);
        emit Kicked(id);
    }

    // ═════════════════════════════════ views ═════════════════════════════════

    function positionsOf(address owner) external view returns (uint256[] memory) {
        return _positionsOf[owner];
    }

    /// Claimable rewards right now (includes fees still waiting in the pool).
    function pending(uint256 id) external view returns (uint256 r0, uint256 r1) {
        Position storage p = positions[id];
        uint256 a0 = acc0;
        uint256 a1 = acc1;
        if (totalWeight > 0) {
            a0 += (pool.stakerFees(0) + undistributed0) * ACC / totalWeight;
            a1 += (pool.stakerFees(1) + undistributed1) * ACC / totalWeight;
        }
        r0 = p.weight * a0 / ACC - p.debt0;
        r1 = p.weight * a1 / ACC - p.debt1;
    }

    // ═══════════════════════════════ internals ═══════════════════════════════

    function _harvest() internal {
        uint256 b0 = IERC20L(coin0).balanceOf(address(this));
        uint256 b1 = IERC20L(coin1).balanceOf(address(this));
        try pool.collectStakerFees() {} catch {} // never let a misconfigured pool brick exits
        uint256 g0 = IERC20L(coin0).balanceOf(address(this)) - b0 + undistributed0;
        uint256 g1 = IERC20L(coin1).balanceOf(address(this)) - b1 + undistributed1;
        if (g0 == 0 && g1 == 0) return;
        uint256 tw = totalWeight;
        if (tw == 0) {
            undistributed0 = g0;
            undistributed1 = g1;
            return;
        }
        acc0 += g0 * ACC / tw;
        acc1 += g1 * ACC / tw;
        undistributed0 = 0;
        undistributed1 = 0;
        emit Harvested(g0, g1);
    }

    function _provide(uint256[2] memory amounts, uint256 minLp) internal returns (uint256 lp) {
        uint256[2] memory got;
        address[2] memory c = [coin0, coin1];
        for (uint256 i; i < 2; ++i) {
            if (amounts[i] == 0) continue;
            uint256 before = IERC20L(c[i]).balanceOf(address(this));
            _call(c[i], abi.encodeWithSelector(0x23b872dd, msg.sender, address(this), amounts[i]));
            got[i] = IERC20L(c[i]).balanceOf(address(this)) - before;
            _call(c[i], abi.encodeWithSelector(0x095ea7b3, address(pool), got[i]));
        }
        lp = pool.addLiquidity(got, minLp);
        for (uint256 i; i < 2; ++i) {
            if (got[i] != 0) _call(c[i], abi.encodeWithSelector(0x095ea7b3, address(pool), 0));
        }
    }

    function _open(address owner, uint256 amount, uint8 tier) internal returns (uint256 id) {
        (uint64 d, uint256 m) = tierInfo(tier);
        id = nextId++;
        uint256 w = amount * m / BPS;
        uint64 until = uint64(block.timestamp) + d;
        positions[id] = Position(owner, tier, until, amount, w, w * acc0 / ACC, w * acc1 / ACC);
        _positionsOf[owner].push(id);
        totalLocked += amount;
        totalWeight += w;
        emit Locked(id, owner, tier, amount, until);
    }

    function _close(uint256 id) internal returns (uint256 amount) {
        Position storage p = positions[id];
        if (p.owner != msg.sender) revert NotOwner();
        if (block.timestamp < p.unlockAt) revert StillLocked();
        _harvest();
        _settle(id, p);
        amount = p.amount;
        totalLocked -= amount;
        totalWeight -= p.weight;
        delete positions[id];
        emit Withdrawn(id, msg.sender, amount);
    }

    function _settle(uint256 id, Position storage p) internal {
        uint256 e0 = p.weight * acc0 / ACC;
        uint256 e1 = p.weight * acc1 / ACC;
        uint256 r0 = e0 - p.debt0;
        uint256 r1 = e1 - p.debt1;
        p.debt0 = e0;
        p.debt1 = e1;
        if (r0 != 0) _send(coin0, p.owner, r0);
        if (r1 != 0) _send(coin1, p.owner, r1);
        if (r0 != 0 || r1 != 0) emit Claimed(id, p.owner, r0, r1);
    }

    /// Change weight of an already-settled position.
    function _reweight(Position storage p, uint256 w) internal {
        totalWeight = totalWeight - p.weight + w;
        p.weight = w;
        p.debt0 = w * acc0 / ACC;
        p.debt1 = w * acc1 / ACC;
    }

    function _send(address token, address to, uint256 amount) internal {
        _call(token, abi.encodeWithSelector(0xa9059cbb, to, amount));
    }

    function _call(address token, bytes memory data) internal {
        (bool ok, bytes memory ret) = token.call(data);
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert TransferFailed();
    }
}
