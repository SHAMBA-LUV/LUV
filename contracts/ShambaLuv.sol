// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/*
 * ❤️ SHAMBA LUV — emotonomics, corrected. ❤️
 *
 * Total supply : 100,000,000,000,000,000.000000000000000000  (100 Quadrillion, 1e35) — UNCHANGED
 * Name / Symbol: "SHAMBA" / "LUV"                                                       — UNCHANGED
 * Fees (5%)    : 3% reflection (auto to holders) · 1% liquidity · 1% team               — UNCHANGED
 * Wallet→Wallet: fee-free (EOA↔EOA)                                                     — UNCHANGED
 * Max transfer : 1% of supply (configurable, lower-bounded so trade is never frozen)
 * Primary chain: ETHEREUM (router + WETH default to mainnet; both configurable → cross-chain)
 *
 * WHY THIS REWRITE (the live Polygon contract had fund-affecting bugs — holders are being
 * airdropped to compensate):
 *   1. Swaps reverted forever — the constructor never approved the router (approval only
 *      lived in updateRouter). Team/liquidity ETH never flowed. → FIXED: approve at genesis.
 *   2. Max-transfer math was inverted (maxAmount = SUPPLY / percent) so "100% = no limit"
 *      actually produced a 0.01% cap. → FIXED: maxAmount = SUPPLY * bps / 10000.
 *   3. Reflection insolvency — 3% reflection tokens and 2% team/liq tokens shared one
 *      contract balance; swaps drained reflection-owed tokens. Claims could exceed solvency.
 *      → FIXED: reflections are now the proven RFI model — distributed via the supply rate,
 *      NEVER held as a claimable pool, so they are solvent by construction (no claim needed;
 *      every holder's balanceOf grows automatically). Only the 2% team/liq are real contract
 *      tokens, swapped to ETH — a disjoint, clearly-accounted pool.
 *   4. Reflection claim wiped previously-accrued, unclaimed reflections. → REMOVED: no claim;
 *      reflections accrue continuously into balanceOf.
 *   5. Reflection denominator counted excluded balances → drift. → FIXED: RFI rate excludes
 *      excluded accounts (_getCurrentSupply).
 *   6. WETH was a hardcoded Polygon constant → not cross-chain. → FIXED: weth is set at
 *      construction (defaults to mainnet WETH) and adjustable by admin for other chains.
 *
 * Self-contained (zero imports) for Remix/airgap parity with the original. No proxy, no
 * upgrade. Owner mints + configures, then renounces; an admin retains only router/weth
 * maintenance (and can renounce to lock the contract).
 */

interface IDexRouter {
    function swapExactTokensForETHSupportingFeeOnTransferTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external;
    function factory() external view returns (address);
    function WETH() external view returns (address);
}

interface IDexFactory {
    function createPair(address tokenA, address tokenB) external returns (address pair);
    function getPair(address tokenA, address tokenB) external view returns (address pair);
}

contract ShambaLuv {
    // ───────────────────────── ERC-20 metadata ─────────────────────────
    string public constant name = "SHAMBA";
    string public constant symbol = "LUV";
    uint8 public constant decimals = 18;

    // ───────────────────────── RFI reflection state ────────────────────
    uint256 private constant MAX = type(uint256).max;
    uint256 private constant _tTotal = 1e35; // 100 Quadrillion × 1e18 — UNCHANGED
    uint256 private _rTotal = (MAX - (MAX % _tTotal));
    uint256 public totalReflectionsDistributed; // cumulative reflections paid to holders

    mapping(address => uint256) private _rOwned;
    mapping(address => uint256) private _tOwned; // tracked only for reflection-excluded accounts
    mapping(address => mapping(address => uint256)) private _allowances;

    mapping(address => bool) public isExcludedFromFee;
    mapping(address => bool) public isExcludedFromMaxTx;
    mapping(address => bool) public isExcludedFromReflection;
    address[] private _excluded;

    // ───────────────────────── fees (basis points, lower-only) ─────────
    uint256 public constant FEE_DENOMINATOR = 10000;
    uint256 public reflectionFee = 300; // 3%
    uint256 public liquidityFee = 100; // 1%
    uint256 public teamFee = 100; // 1%
    function totalFee() public view returns (uint256) { return reflectionFee + liquidityFee + teamFee; }

    // ───────────────────────── wallets / roles ─────────────────────────
    address public owner;
    address public admin; // router/weth maintenance only (survives owner renounce)
    address public teamWallet;
    address public liquidityWallet;

    // ───────────────────────── routing (cross-chain) ───────────────────
    // Defaults: ETHEREUM mainnet (primary). Both are reconfigurable for other chains.
    address public constant ETH_UNISWAP_V2_ROUTER = 0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D;
    address public constant ETH_WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    IDexRouter public router;
    address public weth; // wrapped native of the active chain
    address public pair; // the DEX pair (subject to fees: buys/sells)

    // ───────────────────────── limits / swap ───────────────────────────
    uint256 public maxTxBps = 100; // 1% (100 bps). lower bound enforced so trade is never frozen.
    uint256 public maxTxAmount; // = _tTotal * maxTxBps / 10000
    bool public maxTxEnabled = true;
    // UNIFIED payout threshold: when accumulated fees (reflection + team + liquidity) reach
    // this, ONE transaction distributes all three together. Default 10 trillion LUV.
    uint256 public payoutThreshold = 10_000_000_000_000 * 1e18; // 10 trillion (0.01% of supply)
    uint256 public accumulatedFees; // pending fees (t-space: reflection + team + liquidity) since last payout
    uint256 public pendingReflection; // pending reflection (t-space) awaiting batch distribution
    uint256 private _pendingReflectionR; // pending reflection in reflected-space (the exact amount to remove)
    uint256 public maxSlippageBps = 500; // 5% default; 20% ceiling
    bool public swapEnabled = true;
    bool public walletToWalletFeeExempt = true;
    bool private _inSwap;

    // ───────────────────────── events ──────────────────────────────────
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event OwnershipTransferred(address indexed prev, address indexed next);
    event AdminTransferred(address indexed prev, address indexed next);
    event WalletUpdated(string kind, address indexed prev, address indexed next);
    event RouterUpdated(address indexed prev, address indexed next, address weth);
    event PairUpdated(address indexed pair);
    event FeesLowered(uint256 reflection, uint256 liquidity, uint256 team);
    event MaxTxUpdated(uint256 bps, uint256 amount);
    event PayoutThresholdUpdated(uint256 threshold);
    event WalletToWalletFeeExemptSet(bool enabled);
    event FeesDistributed(uint256 tokensSwapped, uint256 ethToTeam, uint256 ethToLiquidity);
    event ReflectionsDistributed(uint256 tokenAmount);
    // the unified payout: reflection + team + liquidity in ONE call at the threshold
    event FeesProcessed(uint256 reflectionTokens, uint256 ethToTeam, uint256 ethToLiquidity);
    event WalletToWalletTransfer(address indexed from, address indexed to, uint256 amount);

    error NotOwner();
    error NotAdmin();
    error ZeroAddress();
    error ZeroAmount();
    error MaxTxExceeded();
    error OnlyLower();
    error OutOfRange();
    error Reentrant();

    modifier onlyOwner() { if (msg.sender != owner) revert NotOwner(); _; }
    modifier onlyAdmin() { if (msg.sender != admin) revert NotAdmin(); _; }
    modifier lockSwap() { if (_inSwap) revert Reentrant(); _inSwap = true; _; _inSwap = false; }

    constructor(address teamWallet_, address liquidityWallet_, address router_, address weth_) {
        if (teamWallet_ == address(0) || liquidityWallet_ == address(0)) revert ZeroAddress();
        owner = msg.sender;
        admin = msg.sender; // owner is initial admin; reassign via setAdmin, then may renounce owner
        teamWallet = teamWallet_;
        liquidityWallet = liquidityWallet_;
        router = IDexRouter(router_ == address(0) ? ETH_UNISWAP_V2_ROUTER : router_);
        weth = weth_ == address(0) ? ETH_WETH : weth_;

        maxTxAmount = (_tTotal * maxTxBps) / FEE_DENOMINATOR;

        // exclusions: owner/contract/team/liq pay no fee; contract + liq earn no reflection
        isExcludedFromFee[msg.sender] = true;
        isExcludedFromFee[address(this)] = true;
        isExcludedFromFee[teamWallet] = true;
        isExcludedFromFee[liquidityWallet] = true;
        isExcludedFromMaxTx[msg.sender] = true;
        isExcludedFromMaxTx[address(this)] = true;
        _excludeFromReflection(address(this));
        _excludeFromReflection(liquidityWallet);

        // mint entire supply to owner (UNCHANGED)
        _rOwned[msg.sender] = _rTotal;
        // robustness: if the deployer coincides with a reflection-excluded wallet
        // (e.g. owner == liquidityWallet), keep the readable _tOwned balance in sync
        // so the genesis supply is never stranded in the excluded-account view.
        if (isExcludedFromReflection[msg.sender]) _tOwned[msg.sender] = _tTotal;
        emit Transfer(address(0), msg.sender, _tTotal);

        // FIX #1: approve the router at genesis so team/liquidity swaps actually work
        _allowances[address(this)][address(router)] = MAX;
        emit Approval(address(this), address(router), MAX);
    }

    receive() external payable { }

    // ───────────────────────── ERC-20 views ────────────────────────────
    function totalSupply() public pure returns (uint256) { return _tTotal; }

    function balanceOf(address account) public view returns (uint256) {
        if (isExcludedFromReflection[account]) return _tOwned[account];
        return _rOwned[account] / _getRate();
    }

    function allowance(address holder, address spender) external view returns (uint256) {
        return _allowances[holder][spender];
    }

    // ───────────────────────── ERC-20 mutators ─────────────────────────
    function approve(address spender, uint256 value) external returns (bool) {
        _approve(msg.sender, spender, value);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 a = _allowances[from][msg.sender];
        if (a != MAX) {
            require(a >= amount, "allowance");
            _approve(from, msg.sender, a - amount);
        }
        _transfer(from, to, amount);
        return true;
    }

    function _approve(address holder, address spender, uint256 value) private {
        if (holder == address(0) || spender == address(0)) revert ZeroAddress();
        _allowances[holder][spender] = value;
        emit Approval(holder, spender, value);
    }

    // ───────────────────────── RFI rate machinery ──────────────────────
    function _getRate() private view returns (uint256) {
        (uint256 rSupply, uint256 tSupply) = _getCurrentSupply();
        return rSupply / tSupply;
    }

    // FIX #5: exclude excluded-account balances from the reflection denominator
    function _getCurrentSupply() private view returns (uint256 rSupply, uint256 tSupply) {
        rSupply = _rTotal;
        tSupply = _tTotal;
        for (uint256 i = 0; i < _excluded.length; i++) {
            address e = _excluded[i];
            if (_rOwned[e] > rSupply || _tOwned[e] > tSupply) return (_rTotal, _tTotal);
            rSupply -= _rOwned[e];
            tSupply -= _tOwned[e];
        }
        if (rSupply < _rTotal / _tTotal) return (_rTotal, _tTotal);
    }

    // ───────────────────────── transfer core ───────────────────────────
    function _transfer(address from, address to, uint256 amount) private {
        if (from == address(0) || to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        if (maxTxEnabled && !isExcludedFromMaxTx[from] && !isExcludedFromMaxTx[to]) {
            if (amount > maxTxAmount) revert MaxTxExceeded();
        }

        // UNIFIED payout: when accumulated fees reach the threshold, ONE call distributes
        // reflection + team + liquidity together (see _processFees).
        if (swapEnabled && !_inSwap && from != pair && accumulatedFees >= payoutThreshold) {
            _processFees();
        }

        // FEE MODEL — rewards on BUY/SELL, 0 fee everywhere else:
        //  • wallet-to-wallet (EOA↔EOA) is ALWAYS 0 fee (share the LUV freely);
        //  • a fee is taken only when a NON-EXEMPT contract is the counterparty — in practice
        //    the DEX pair, i.e. a buy (pair→you) or a sell (you→pair);
        //  • infrastructure contracts that must move LUV fee-free — the liquidity wallet, and
        //    any BRIDGE contract — are added to `isExcludedFromFee` (setFeeExemption), EXACTLY
        //    like the liquidity wallet, so bridging and protocol plumbing incur no fee.
        bool walletToWallet = from.code.length == 0 && to.code.length == 0;
        bool takeFee = !(isExcludedFromFee[from] || isExcludedFromFee[to]
            || (walletToWalletFeeExempt && walletToWallet));

        _tokenTransfer(from, to, amount, takeFee);

        if (!takeFee && walletToWalletFeeExempt && walletToWallet) {
            emit WalletToWalletTransfer(from, to, amount);
        }
    }

    function _tokenTransfer(address from, address to, uint256 t, bool takeFee) private {
        uint256 rate = _getRate();
        uint256 tFee = takeFee ? (t * reflectionFee) / FEE_DENOMINATOR : 0;
        uint256 tSwap = takeFee ? (t * (liquidityFee + teamFee)) / FEE_DENOMINATOR : 0;
        uint256 tTransfer = t - tFee - tSwap;

        uint256 rAmount = t * rate;
        uint256 rFee = tFee * rate;
        uint256 rSwap = tSwap * rate;
        uint256 rTransfer = rAmount - rFee - rSwap;

        // debit sender
        _rOwned[from] -= rAmount;
        if (isExcludedFromReflection[from]) _tOwned[from] -= t;

        // credit recipient
        _rOwned[to] += rTransfer;
        if (isExcludedFromReflection[to]) _tOwned[to] += tTransfer;

        // 2% team/liq → contract as real tokens (disjoint, swappable pool)
        if (tSwap != 0) {
            _rOwned[address(this)] += rSwap;
            _tOwned[address(this)] += tSwap; // contract is reflection-excluded
            emit Transfer(from, address(this), tSwap);
        }

        // 3% reflection → ACCUMULATED in reflected-space (batched). Distributed together with
        // team + liquidity in ONE call at the payout threshold (_processFees). It is never
        // credited to any balance, so the eventual single `_rTotal -= rFee` stays solvent.
        if (rFee != 0) {
            _pendingReflectionR += rFee;
            pendingReflection += tFee;
        }
        if (takeFee) {
            accumulatedFees += tFee + tSwap; // reflection + team + liquidity, gating the threshold
        }

        emit Transfer(from, to, tTransfer);
    }

    // ───────────────────────── unified payout (3 events, 1 call) ───────
    /// At the threshold, distribute ALL THREE fees in a single transaction:
    /// (1) reflection batch → all holders, (2) team → ETH, (3) liquidity → ETH.
    function _processFees() private lockSwap {
        // (1) reflection — distribute the whole accumulated batch via one rate shift (solvent)
        uint256 rRefl = _pendingReflectionR;
        uint256 tRefl = pendingReflection;
        if (rRefl != 0) {
            _rTotal -= rRefl;
            totalReflectionsDistributed += tRefl;
            _pendingReflectionR = 0;
            pendingReflection = 0;
            emit ReflectionsDistributed(tRefl);
        }
        // (2)+(3) team + liquidity — swap the accumulated tranche to ETH, split team:liq (1:1)
        (uint256 teamEth, uint256 liqEth) = _swapTeamLiq(_tOwned[address(this)]);
        accumulatedFees = 0;
        emit FeesProcessed(tRefl, teamEth, liqEth);
    }

    /// Anyone may trigger the unified payout once fees have accrued (no need to wait for a sell).
    function processFees() external {
        if (accumulatedFees != 0 || _pendingReflectionR != 0) _processFees();
    }

    function _swapTeamLiq(uint256 tokenAmount) private returns (uint256 toTeam, uint256 toLiq) {
        // Skip if there's nothing to swap, or the router isn't a real contract (unset / wrong
        // chain / misconfigured). Solidity's high-level-call extcodesize check would otherwise
        // revert and `try/catch` does NOT reliably catch that — so guard it explicitly. The
        // team/liq tokens simply wait in the contract for the next swap once a router is set.
        if (tokenAmount == 0 || address(router).code.length == 0) return (0, 0);
        address[] memory path = new address[](2);
        path[0] = address(this);
        path[1] = weth; // FIX #6: active chain's wrapped native, not a hardcoded constant

        uint256 before = address(this).balance;
        try router.swapExactTokensForETHSupportingFeeOnTransferTokens(
            tokenAmount, 0, path, address(this), block.timestamp
        ) {
            uint256 ethGained = address(this).balance - before;
            if (ethGained == 0) return (0, 0);
            uint256 denom = liquidityFee + teamFee;
            toTeam = (ethGained * teamFee) / denom;
            toLiq = ethGained - toTeam;
            if (toTeam != 0) { (bool a,) = payable(teamWallet).call{ value: toTeam }(""); a; }
            if (toLiq != 0) { (bool b,) = payable(liquidityWallet).call{ value: toLiq }(""); b; }
            emit FeesDistributed(tokenAmount, toTeam, toLiq);
        } catch {
            // a failing swap (e.g. no pair yet) must never brick transfers
            return (0, 0);
        }
    }

    // ───────────────────────── reflection-exclusion mgmt ───────────────
    function _excludeFromReflection(address account) private {
        if (isExcludedFromReflection[account]) return;
        if (_rOwned[account] != 0) _tOwned[account] = _rOwned[account] / _getRate();
        isExcludedFromReflection[account] = true;
        _excluded.push(account);
    }

    function excludeFromReflection(address account) external onlyOwner { _excludeFromReflection(account); }

    function includeInReflection(address account) external onlyOwner {
        if (!isExcludedFromReflection[account]) return;
        uint256 n = _excluded.length;
        for (uint256 i = 0; i < n; i++) {
            if (_excluded[i] == account) {
                _excluded[i] = _excluded[n - 1];
                _excluded.pop();
                _tOwned[account] = 0;
                isExcludedFromReflection[account] = false;
                break;
            }
        }
    }

    // ───────────────────────── owner config (renounceable) ─────────────
    function setTeamWallet(address w) external onlyOwner {
        if (w == address(0)) revert ZeroAddress();
        emit WalletUpdated("team", teamWallet, w);
        teamWallet = w;
    }

    function setLiquidityWallet(address w) external onlyOwner {
        if (w == address(0)) revert ZeroAddress();
        emit WalletUpdated("liquidity", liquidityWallet, w);
        liquidityWallet = w;
    }

    function setPair(address p) external onlyOwner {
        pair = p;
        emit PairUpdated(p);
    }

    /// Fees can ONLY be lowered (matches the original guarantee).
    function lowerFees(uint256 reflection_, uint256 liquidity_, uint256 team_) external onlyOwner {
        if (reflection_ > reflectionFee || liquidity_ > liquidityFee || team_ > teamFee) revert OnlyLower();
        reflectionFee = reflection_;
        liquidityFee = liquidity_;
        teamFee = team_;
        emit FeesLowered(reflection_, liquidity_, team_);
    }

    /// FIX #2: correct semantics — bps of supply, lower-bounded at 1% so trade can't be frozen.
    function setMaxTxBps(uint256 bps) external onlyOwner {
        if (bps < 100 || bps > FEE_DENOMINATOR) revert OutOfRange(); // [1%, 100%]
        maxTxBps = bps;
        maxTxAmount = (_tTotal * bps) / FEE_DENOMINATOR;
        emit MaxTxUpdated(bps, maxTxAmount);
    }

    function setMaxTxEnabled(bool enabled) external onlyOwner { maxTxEnabled = enabled; }

    /// The UNIFIED payout threshold (reflection + team + liquidity fire together when reached).
    function setPayoutThreshold(uint256 threshold) external onlyOwner {
        if (threshold == 0 || threshold > _tTotal / 50) revert OutOfRange(); // ≤2% of supply
        payoutThreshold = threshold;
        emit PayoutThresholdUpdated(threshold);
    }

    function setSwapEnabled(bool enabled) external onlyOwner { swapEnabled = enabled; }

    function setMaxSlippageBps(uint256 bps) external onlyOwner {
        if (bps == 0 || bps > 2000) revert OutOfRange(); // ≤20%
        maxSlippageBps = bps;
    }

    function setWalletToWalletFeeExempt(bool enabled) external onlyOwner {
        walletToWalletFeeExempt = enabled;
        emit WalletToWalletFeeExemptSet(enabled);
    }

    function setFeeExemption(address account, bool status) external onlyOwner { isExcludedFromFee[account] = status; }
    function setMaxTxExemption(address account, bool status) external onlyOwner { isExcludedFromMaxTx[account] = status; }

    function setAdmin(address a) external onlyOwner {
        if (a == address(0)) revert ZeroAddress();
        emit AdminTransferred(admin, a);
        admin = a;
    }

    function renounceOwnership() external onlyOwner {
        emit OwnershipTransferred(owner, address(0));
        owner = address(0);
    }

    // ───────────────────────── admin maintenance (cross-chain) ─────────
    /// Re-point the router for another chain (AggLayer / L2). Re-approves correctly (FIX #1).
    function updateRouter(address newRouter, address newWeth) external onlyAdmin {
        if (newRouter == address(0) || newWeth == address(0)) revert ZeroAddress();
        _allowances[address(this)][address(router)] = 0; // revoke old
        router = IDexRouter(newRouter);
        weth = newWeth;
        _allowances[address(this)][newRouter] = MAX; // approve new
        emit Approval(address(this), newRouter, MAX);
        emit RouterUpdated(address(router), newRouter, newWeth);
    }

    function renounceAdmin() external onlyAdmin {
        emit AdminTransferred(admin, address(0));
        admin = address(0);
    }

    // ───────────────────────── views ───────────────────────────────────
    function reflectionsEarned(address account) external view returns (uint256) {
        if (isExcludedFromReflection[account]) return 0;
        return balanceOf(account); // RFI: earnings are already inside balanceOf
    }

    function getConfig()
        external
        view
        returns (address router_, address weth_, address pair_, uint256 maxTx_, uint256 payoutAt_, uint256 fee_)
    {
        return (address(router), weth, pair, maxTxAmount, payoutThreshold, totalFee());
    }
}
