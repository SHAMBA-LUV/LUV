// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/*
 * GoldStablePool — a 2-coin StableSwap pool (Curve invariant) for gold pegs, e.g. bXAU/PAXG.
 *
 * Why StableSwap: bXAU, PAXG and XAUT are all claims on one troy ounce, so a pool should trade
 * them near 1:1 with low slippage until it becomes heavily imbalanced. Curve's invariant
 *     A·n^n·Σx + D = A·D·n^n + D^(n+1) / (n^n·Πx)
 * does exactly that and is the most battle-tested design for pegged pairs. The maths below
 * follows Curve's 2-coin pools (get_D / get_y / get_y_D, imbalance fees, A ramping).
 *
 * Liquidity provision (anyone — third-party LPs earn the pool's fees):
 *   · PAIRED       addLiquidity([a0, a1], minMint)            balanced deposits pay ~no fee
 *   · SINGLE-ASSET addLiquidity([a, 0], minMint)              native: the imbalanced part pays
 *                                                             half the swap fee, like Curve
 *   · exit         removeLiquidity (proportional, no fee) or removeLiquidityOneCoin
 *
 * Fees: every swap pays `fee` (default 4 bps). Of each fee, `stakerShare` (default 50%) is set
 * aside for the fee receiver — GoldLiquidityLocker, which pays it to long-term LPs by tier — and
 * the rest stays in the pool, raising the LP token's virtual price for every LP.
 *
 * Best-practice choices:
 *   · withdrawals are never paused (pause only stops swaps and deposits)
 *   · first deposit needs both coins and burns MIN_LIQUIDITY LP to a dead address (no share-
 *     price inflation attack)
 *   · fee-on-transfer safe: credited amounts are measured by balance delta (PAXG has a fee)
 *   · tokens returning no bool are supported (XAUT)
 *   · A changes only by gradual ramp (≥ 1 day, ≤ 10× per ramp); fee capped at 1%
 *   · getVirtualPrice reverts while the pool is mid-call (read-only reentrancy guard)
 *   · every state-changing entry point takes a slippage bound, and output bounds are checked
 *     against what the recipient ACTUALLY received (after any token transfer fee)
 *
 * Self-contained (zero imports). The pool is its own LP token (ERC-20, 18 decimals).
 */
interface IERC20P {
    function balanceOf(address) external view returns (uint256);
    function decimals() external view returns (uint8);
}

contract GoldStablePool {
    uint256 internal constant N = 2;
    uint256 internal constant FEE_DENOM = 1e10;
    uint256 public constant MAX_FEE = 1e8; // 1%
    uint256 internal constant PRECISION = 1e18;
    uint256 public constant A_PRECISION = 100;
    uint256 public constant MAX_A = 1e6;
    uint256 public constant MAX_A_CHANGE = 10;
    uint256 public constant MIN_RAMP_TIME = 1 days;
    uint256 public constant MIN_LIQUIDITY = 1000;
    address internal constant DEAD = 0x000000000000000000000000000000000000dEaD;

    // ── coins ──
    address public immutable coin0;
    address public immutable coin1;
    uint256 internal immutable rate0; // 10 ** (36 - decimals): xp = balance · rate / 1e18
    uint256 internal immutable rate1;

    uint256[2] public balances; // pool-owned, native units (excludes stakerFees)
    uint256[2] public stakerFees; // set aside for feeReceiver, native units

    // ── parameters ──
    uint256 public fee; // per swap, of FEE_DENOM
    uint256 public stakerShare; // of each fee, of FEE_DENOM
    uint256 public initialA; // × A_PRECISION
    uint256 public futureA;
    uint256 public initialATime;
    uint256 public futureATime;

    address public owner; // GoldTimelock in production
    address public pauser; // GOV multisig: can pause instantly, cannot do anything else
    address public feeReceiver; // GoldLiquidityLocker
    bool public paused;

    // ── LP token ──
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    uint256 private _lock = 1;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event TokenExchange(address indexed buyer, uint256 i, uint256 dx, uint256 j, uint256 dy, uint256 fee);
    event AddLiquidity(address indexed provider, uint256[2] amounts, uint256[2] fees, uint256 mint, uint256 supply);
    event RemoveLiquidity(address indexed provider, uint256[2] amounts, uint256 burn, uint256 supply);
    event RemoveLiquidityOne(address indexed provider, uint256 burn, uint256 i, uint256 amount, uint256 supply);
    event CollectStakerFees(address indexed receiver, uint256 amount0, uint256 amount1);
    event RampA(uint256 oldA, uint256 newA, uint256 initialTime, uint256 futureTime);
    event StopRampA(uint256 A, uint256 t);
    event SetFee(uint256 fee, uint256 stakerShare);
    event SetFeeReceiver(address receiver);
    event SetPauser(address pauser);
    event Paused(bool paused);
    event OwnershipTransferred(address indexed from, address indexed to);

    error NotOwner();
    error NotPauser();
    error NotFeeReceiver();
    error IsPaused();
    error Reentrancy();
    error BadParam();
    error Slippage();
    error InitialDepositNeedsBoth();
    error DidNotConverge();
    error TransferFailed();
    error InsufficientBalance();
    error InsufficientAllowance();
    error Ramp();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier nonReentrant() {
        if (_lock != 1) revert Reentrancy();
        _lock = 2;
        _;
        _lock = 1;
    }

    modifier whenNotPaused() {
        if (paused) revert IsPaused();
        _;
    }

    constructor(
        address coin0_,
        address coin1_,
        uint256 A_,
        uint256 fee_,
        uint256 stakerShare_,
        address owner_,
        string memory name_,
        string memory symbol_
    ) {
        if (coin0_ == coin1_ || coin0_ == address(0) || coin1_ == address(0)) revert BadParam();
        if (A_ == 0 || A_ >= MAX_A || fee_ > MAX_FEE || stakerShare_ > FEE_DENOM) revert BadParam();
        uint8 d0 = IERC20P(coin0_).decimals();
        uint8 d1 = IERC20P(coin1_).decimals();
        if (d0 > 18 || d1 > 18) revert BadParam();
        coin0 = coin0_;
        coin1 = coin1_;
        rate0 = 10 ** (36 - uint256(d0));
        rate1 = 10 ** (36 - uint256(d1));
        initialA = A_ * A_PRECISION;
        futureA = A_ * A_PRECISION;
        fee = fee_;
        stakerShare = stakerShare_;
        owner = owner_;
        name = name_;
        symbol = symbol_;
        emit OwnershipTransferred(address(0), owner_);
        emit SetFee(fee_, stakerShare_);
    }

    // ═══════════════════════════════ liquidity ═══════════════════════════════

    /// Deposit any mix of the two coins (one side may be 0 = single-asset). Returns LP minted.
    function addLiquidity(uint256[2] calldata amounts, uint256 minMint)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 mint)
    {
        uint256 amp = _A();
        uint256[2] memory old = balances;
        uint256 supply = totalSupply;
        uint256 D0 = supply == 0 ? 0 : _getD(_xp(old), amp);

        uint256[2] memory nb = [old[0], old[1]]; // copy: memory arrays alias
        for (uint256 i; i < N; ++i) {
            if (amounts[i] > 0) nb[i] += _pull(i, amounts[i]);
            else if (supply == 0) revert InitialDepositNeedsBoth();
        }
        uint256 D1 = _getD(_xp(nb), amp);
        if (D1 <= D0) revert BadParam();

        uint256[2] memory fees;
        if (supply > 0) {
            uint256 baseFee = fee * N / (4 * (N - 1));
            for (uint256 i; i < N; ++i) {
                uint256 ideal = D1 * old[i] / D0;
                uint256 diff = ideal > nb[i] ? ideal - nb[i] : nb[i] - ideal;
                fees[i] = baseFee * diff / FEE_DENOM;
                uint256 sf = fees[i] * stakerShare / FEE_DENOM;
                stakerFees[i] += sf;
                balances[i] = nb[i] - sf;
                nb[i] -= fees[i];
            }
            uint256 D2 = _getD(_xp(nb), amp);
            mint = supply * (D2 - D0) / D0;
        } else {
            balances = nb;
            if (D1 <= MIN_LIQUIDITY * 1e6) revert BadParam(); // meaningful first deposit
            _mint(DEAD, MIN_LIQUIDITY);
            mint = D1 - MIN_LIQUIDITY;
        }
        if (mint < minMint) revert Slippage();
        _mint(msg.sender, mint);
        emit AddLiquidity(msg.sender, nb, fees, mint, totalSupply);
    }

    /// Burn LP for a proportional share of both coins. No fee. Works while paused.
    function removeLiquidity(uint256 amount, uint256[2] calldata minAmounts)
        external
        nonReentrant
        returns (uint256[2] memory out)
    {
        uint256 supply = totalSupply;
        for (uint256 i; i < N; ++i) {
            out[i] = balances[i] * amount / supply;
            balances[i] -= out[i];
        }
        _burn(msg.sender, amount);
        for (uint256 i; i < N; ++i) {
            _pushMin(i, msg.sender, out[i], minAmounts[i]);
        }
        emit RemoveLiquidity(msg.sender, out, amount, totalSupply);
    }

    /// Burn LP for a single coin (pays the imbalance fee). Works while paused.
    function removeLiquidityOneCoin(uint256 amount, uint256 i, uint256 minAmount)
        external
        nonReentrant
        returns (uint256 dy)
    {
        if (i >= N) revert BadParam();
        uint256 dyFee;
        (dy, dyFee) = _calcWithdrawOneCoin(amount, i);
        uint256 sf = dyFee * stakerShare / FEE_DENOM;
        balances[i] -= dy + sf;
        stakerFees[i] += sf;
        _burn(msg.sender, amount);
        _pushMin(i, msg.sender, dy, minAmount);
        emit RemoveLiquidityOne(msg.sender, amount, i, dy, totalSupply);
    }

    // ═════════════════════════════════ swaps ═════════════════════════════════

    /// Sell `dx` of coin i; msg.sender must actually receive at least `minDy` of coin j.
    /// The return value is the amount the pool sent (before any transfer fee of coin j).
    function exchange(uint256 i, uint256 j, uint256 dx, uint256 minDy)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 dy)
    {
        if (i == j || i >= N || j >= N) revert BadParam();
        uint256[2] memory old = balances;
        uint256[2] memory xp = _xp(old);
        uint256 got = _pull(i, dx);
        uint256 dyFee;
        uint256 stakerPart;
        (dy, dyFee, stakerPart) = _dy(i, j, got, xp);
        balances[i] = old[i] + got;
        balances[j] = old[j] - dy - stakerPart;
        stakerFees[j] += stakerPart;
        _pushMin(j, msg.sender, dy, minDy);
        emit TokenExchange(msg.sender, i, got, j, dy, dyFee);
    }

    // ═════════════════════════════════ views ═════════════════════════════════

    function coins(uint256 i) external view returns (address) {
        if (i >= N) revert BadParam();
        return i == 0 ? coin0 : coin1;
    }

    function A() external view returns (uint256) {
        return _A() / A_PRECISION;
    }

    function APrecise() external view returns (uint256) {
        return _A();
    }

    /// Value of one LP token in oz-equivalent units (WAD). Monotone non-decreasing from fees.
    function getVirtualPrice() external view returns (uint256) {
        if (_lock != 1) revert Reentrancy();
        uint256 supply = totalSupply;
        if (supply == 0) return PRECISION;
        return _getD(_xp(balances), _A()) * PRECISION / supply;
    }

    /// Output of exchange(i, j, dx) assuming the full dx arrives.
    function getDy(uint256 i, uint256 j, uint256 dx) external view returns (uint256 dy) {
        if (i == j || i >= N || j >= N) revert BadParam();
        (dy,,) = _dy(i, j, dx, _xp(balances));
    }

    /// Input of coin i needed to receive at least `dy` of coin j (inverse of getDy, rounded up).
    function getDx(uint256 i, uint256 j, uint256 dy) external view returns (uint256 dx) {
        if (i == j || i >= N || j >= N) revert BadParam();
        uint256[2] memory xp = _xp(balances);
        uint256 amp = _A();
        uint256 D = _getD(xp, amp);
        uint256 dyXp = (dy * _rate(j) + PRECISION - 1) / PRECISION;
        uint256 dyXpGross = dyXp * FEE_DENOM / (FEE_DENOM - fee) + 1;
        if (dyXpGross + 1 >= xp[j]) revert BadParam();
        uint256 y = xp[j] - dyXpGross - 1;
        uint256 x = _getY(y, amp, D);
        dx = ((x - xp[i]) * PRECISION + _rate(i) - 1) / _rate(i) + 1;
    }

    /// LP minted by addLiquidity(amounts), fees included, assuming no transfer fees.
    function calcTokenAmount(uint256[2] calldata amounts) external view returns (uint256) {
        uint256 amp = _A();
        uint256[2] memory old = balances;
        uint256 supply = totalSupply;
        uint256[2] memory nb = [old[0] + amounts[0], old[1] + amounts[1]];
        uint256 D1 = _getD(_xp(nb), amp);
        if (supply == 0) return D1 > MIN_LIQUIDITY ? D1 - MIN_LIQUIDITY : 0;
        uint256 D0 = _getD(_xp(old), amp);
        uint256 baseFee = fee * N / (4 * (N - 1));
        for (uint256 i; i < N; ++i) {
            uint256 ideal = D1 * old[i] / D0;
            uint256 diff = ideal > nb[i] ? ideal - nb[i] : nb[i] - ideal;
            nb[i] -= baseFee * diff / FEE_DENOM;
        }
        return supply * (_getD(_xp(nb), amp) - D0) / D0;
    }

    function calcWithdrawOneCoin(uint256 amount, uint256 i) external view returns (uint256 dy) {
        if (i >= N) revert BadParam();
        (dy,) = _calcWithdrawOneCoin(amount, i);
    }

    // ═════════════════════════════════ admin ═════════════════════════════════

    /// The only party that can take staker fees (GoldLiquidityLocker).
    function collectStakerFees() external nonReentrant returns (uint256 a0, uint256 a1) {
        if (msg.sender != feeReceiver) revert NotFeeReceiver();
        a0 = stakerFees[0];
        a1 = stakerFees[1];
        stakerFees[0] = 0;
        stakerFees[1] = 0;
        if (a0 != 0) _push(0, msg.sender, a0);
        if (a1 != 0) _push(1, msg.sender, a1);
        emit CollectStakerFees(msg.sender, a0, a1);
    }

    function setFee(uint256 fee_, uint256 stakerShare_) external onlyOwner {
        if (fee_ > MAX_FEE || stakerShare_ > FEE_DENOM) revert BadParam();
        fee = fee_;
        stakerShare = stakerShare_;
        emit SetFee(fee_, stakerShare_);
    }

    function setFeeReceiver(address r) external onlyOwner {
        feeReceiver = r;
        emit SetFeeReceiver(r);
    }

    function setPauser(address p) external onlyOwner {
        pauser = p;
        emit SetPauser(p);
    }

    function setPaused(bool p) external {
        if (msg.sender != pauser && msg.sender != owner) revert NotPauser();
        if (!p && msg.sender != owner) revert NotOwner(); // pauser can stop, only owner can resume
        paused = p;
        emit Paused(p);
    }

    function transferOwnership(address to) external onlyOwner {
        emit OwnershipTransferred(owner, to);
        owner = to;
    }

    function rampA(uint256 futureA_, uint256 futureTime) external onlyOwner {
        if (block.timestamp < initialATime + MIN_RAMP_TIME) revert Ramp();
        if (futureTime < block.timestamp + MIN_RAMP_TIME) revert Ramp();
        uint256 a0 = _A();
        uint256 a1 = futureA_ * A_PRECISION;
        if (futureA_ == 0 || futureA_ >= MAX_A) revert Ramp();
        if (a1 < a0 ? a1 * MAX_A_CHANGE < a0 : a1 > a0 * MAX_A_CHANGE) revert Ramp();
        initialA = a0;
        futureA = a1;
        initialATime = block.timestamp;
        futureATime = futureTime;
        emit RampA(a0, a1, block.timestamp, futureTime);
    }

    function stopRampA() external onlyOwner {
        uint256 a = _A();
        initialA = a;
        futureA = a;
        initialATime = block.timestamp;
        futureATime = block.timestamp;
        emit StopRampA(a, block.timestamp);
    }

    // ═══════════════════════════════ LP token ════════════════════════════════

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transfer(address to, uint256 value) external returns (bool) {
        _move(msg.sender, to, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 a = allowance[from][msg.sender];
        if (a != type(uint256).max) {
            if (a < value) revert InsufficientAllowance();
            allowance[from][msg.sender] = a - value;
        }
        _move(from, to, value);
        return true;
    }

    function _move(address from, address to, uint256 value) internal {
        if (to == address(0)) revert BadParam();
        uint256 b = balanceOf[from];
        if (b < value) revert InsufficientBalance();
        unchecked {
            balanceOf[from] = b - value;
            balanceOf[to] += value;
        }
        emit Transfer(from, to, value);
    }

    function _mint(address to, uint256 value) internal {
        totalSupply += value;
        unchecked {
            balanceOf[to] += value;
        }
        emit Transfer(address(0), to, value);
    }

    function _burn(address from, uint256 value) internal {
        uint256 b = balanceOf[from];
        if (b < value) revert InsufficientBalance();
        unchecked {
            balanceOf[from] = b - value;
            totalSupply -= value;
        }
        emit Transfer(from, address(0), value);
    }

    // ══════════════════════════════ StableSwap maths ═════════════════════════

    function _A() internal view returns (uint256) {
        uint256 t1 = futureATime;
        uint256 a1 = futureA;
        if (block.timestamp >= t1) return a1;
        uint256 a0 = initialA;
        uint256 t0 = initialATime;
        if (a1 > a0) return a0 + (a1 - a0) * (block.timestamp - t0) / (t1 - t0);
        return a0 - (a0 - a1) * (block.timestamp - t0) / (t1 - t0);
    }

    function _rate(uint256 i) internal view returns (uint256) {
        return i == 0 ? rate0 : rate1;
    }

    function _xp(uint256[2] memory b) internal view returns (uint256[2] memory xp) {
        xp[0] = b[0] * rate0 / PRECISION;
        xp[1] = b[1] * rate1 / PRECISION;
    }

    function _getD(uint256[2] memory xp, uint256 amp) internal pure returns (uint256) {
        uint256 S = xp[0] + xp[1];
        if (S == 0) return 0;
        uint256 D = S;
        uint256 Ann = amp * N;
        for (uint256 k; k < 255; ++k) {
            uint256 D_P = D * D / (xp[0] * N) * D / (xp[1] * N);
            uint256 Dprev = D;
            D = (Ann * S / A_PRECISION + D_P * N) * D / ((Ann - A_PRECISION) * D / A_PRECISION + (N + 1) * D_P);
            if (D > Dprev ? D - Dprev <= 1 : Dprev - D <= 1) return D;
        }
        revert DidNotConverge();
    }

    /// New (normalised) balance of the other coin when one coin's balance becomes x, D fixed.
    function _getY(uint256 x, uint256 amp, uint256 D) internal pure returns (uint256) {
        uint256 Ann = amp * N;
        uint256 c = D * D / (x * N);
        c = c * D * A_PRECISION / (Ann * N);
        uint256 b = x + D * A_PRECISION / Ann;
        return _solveY(c, b, D);
    }

    /// Balance of coin i that keeps the other balance and a target D.
    function _getYD(uint256 amp, uint256 i, uint256[2] memory xp, uint256 D) internal pure returns (uint256) {
        uint256 other = xp[1 - i];
        uint256 Ann = amp * N;
        uint256 c = D * D / (other * N);
        c = c * D * A_PRECISION / (Ann * N);
        uint256 b = other + D * A_PRECISION / Ann;
        return _solveY(c, b, D);
    }

    function _solveY(uint256 c, uint256 b, uint256 D) internal pure returns (uint256) {
        uint256 y = D;
        for (uint256 k; k < 255; ++k) {
            uint256 yPrev = y;
            y = (y * y + c) / (2 * y + b - D);
            if (y > yPrev ? y - yPrev <= 1 : yPrev - y <= 1) return y;
        }
        revert DidNotConverge();
    }

    function _dy(uint256 i, uint256 j, uint256 dx, uint256[2] memory xp)
        internal
        view
        returns (uint256 dy, uint256 dyFeeXp, uint256 stakerPart)
    {
        uint256 amp = _A();
        uint256 D = _getD(xp, amp);
        uint256 x = xp[i] + dx * _rate(i) / PRECISION;
        uint256 y = _getY(x, amp, D);
        uint256 dyXp = xp[j] - y - 1; // round against the trader
        dyFeeXp = dyXp * fee / FEE_DENOM;
        dy = (dyXp - dyFeeXp) * PRECISION / _rate(j);
        stakerPart = dyFeeXp * stakerShare / FEE_DENOM * PRECISION / _rate(j);
    }

    function _calcWithdrawOneCoin(uint256 amount, uint256 i) internal view returns (uint256 dy, uint256 dyFee) {
        uint256 amp = _A();
        uint256[2] memory xp = _xp(balances);
        uint256 D0 = _getD(xp, amp);
        uint256 supply = totalSupply;
        uint256 D1 = D0 - amount * D0 / supply;
        uint256 newY = _getYD(amp, i, xp, D1);
        uint256 baseFee = fee * N / (4 * (N - 1));
        uint256[2] memory xpReduced;
        for (uint256 k; k < N; ++k) {
            uint256 expected = k == i ? xp[k] * D1 / D0 - newY : xp[k] - xp[k] * D1 / D0;
            xpReduced[k] = xp[k] - baseFee * expected / FEE_DENOM;
        }
        uint256 dyXp = xpReduced[i] - _getYD(amp, i, xpReduced, D1) - 1;
        uint256 dy0 = xp[i] - newY;
        dy = dyXp * PRECISION / _rate(i);
        dyFee = dy0 > dyXp ? (dy0 - dyXp) * PRECISION / _rate(i) : 0;
    }

    // ═══════════════════════════════ transfers ═══════════════════════════════

    function _coin(uint256 i) internal view returns (address) {
        return i == 0 ? coin0 : coin1;
    }

    /// transferFrom msg.sender → pool; returns the amount actually received.
    function _pull(uint256 i, uint256 amount) internal returns (uint256) {
        address t = _coin(i);
        uint256 before = IERC20P(t).balanceOf(address(this));
        (bool ok, bytes memory ret) = t.call(abi.encodeWithSelector(0x23b872dd, msg.sender, address(this), amount));
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert TransferFailed();
        return IERC20P(t).balanceOf(address(this)) - before;
    }

    /// Send `amount` and require that `to` actually received at least `min` (fee-on-transfer safe).
    function _pushMin(uint256 i, address to, uint256 amount, uint256 min) internal {
        address t = _coin(i);
        uint256 before = IERC20P(t).balanceOf(to);
        _push(i, to, amount);
        if (IERC20P(t).balanceOf(to) - before < min) revert Slippage();
    }

    function _push(uint256 i, address to, uint256 amount) internal {
        if (amount == 0) return;
        (bool ok, bytes memory ret) = _coin(i).call(abi.encodeWithSelector(0xa9059cbb, to, amount));
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert TransferFailed();
    }
}
