// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20Min, Owned, Guarded, Pausable, SafeToken, EIP712Verifier} from "./base/InHouse.sol";

contract IncentiveDistributor is Owned, Guarded, Pausable, EIP712Verifier {
    using SafeToken for address;

    // ───────────────────────── action registry ─────────────────────────

    struct ActionType {
        address token;
        uint256 reward;
        uint32 dailyLimit;
        uint32 cooldown;
        bool oneTime;
        bool active;
        bool exists;
    }

    mapping(bytes32 => ActionType) private _actions;
    bytes32[] private _actionIds;
    mapping(bytes32 => string) public actionName;

    // ───────────────────────── roles ─────────────────────────

    mapping(address => bool) public isDistributor;
    address public signer;

    // ───────────────────────── accounting ─────────────────────────

    struct UserActionStat {
        uint256 earned;
        uint64 count;
        uint32 countToday;
        uint64 dayStart;
        uint64 lastAt;
    }

    mapping(address => mapping(bytes32 => UserActionStat)) private _userAction;
    mapping(address => uint256) public userActionsCompleted;
    mapping(address => mapping(address => uint256)) public userEarnedByToken;

    mapping(bytes32 => bool) private _claimed;
    mapping(address => uint256) public distributedByToken;
    mapping(bytes32 => uint256) public actionCompletions;
    uint256 public totalActionsCompleted;
    uint256 public totalRewardsDistributed;

    // Per-transaction reward ceiling (0 = unlimited). Bounds the blast radius of ANY payout path — most
    // importantly the legacy distributeReward(), whose caller-supplied amount would otherwise let a
    // compromised distributor key drain the pool in one call. Operators MUST set this at deploy.
    uint256 public maxRewardPerTx;

    // ───────────────────────── the asset registry ─────────────────────────
    //
    // The distributor is MULTI-TOKEN: it holds LUV and ANY other ERC-20, and pays each action
    // (and each redemption) in the asset that action names. The registry is the enumerable
    // truth of which assets this contract deals in — assets can be ADDED and REMOVED by the
    // owner at any time, and anything paid or funded registers itself so the list never lies.
    // Removing an asset sweeps its balance out and deregisters it; a removed asset can be
    // added back at any time. NOTE: no `receive()` — the contract deals in ERC-20s only, so
    // native ETH can never be sent here and stranded.

    address[] private _assets;
    mapping(address => bool) public isAsset;
    mapping(address => uint256) private _assetIndex; // 1-based; 0 = not registered

    // ───────────────────────── the drip: an owner-settable rate ─────────────────────────
    //
    // The LUVdrip's published amount lives HERE, on-chain, so the reward is a VARIABLE the
    // owner can retune (like every action reward) and the chain stays the final word. The
    // backend reads it and drips that much per 24-hour window; a redemption then honours the
    // participant's VERIFIED COLLECT — their earned tally — through the redeem rail below.

    address public dripToken;   // which asset the drip pays in
    uint256 public dripPerDay;  // how much, per login-armed 24h window (base units)

    // ───────────────────────── the REDEEM rail (verified COLLECT of earned balances) ─────────────────────────

    mapping(bytes32 => bool) private _redeemed;  // redemptionId => settled (replay guard)
    uint256 public redeemBudgetPerDay;           // total redeemable per UTC day across ALL users, 0 = unlimited
    uint256 public redeemedToday;                // spent inside the current UTC day
    uint64 public redeemDayStart;                // that day's bucket start

    /// One signed redemption. Batched so a sponsor can settle many participants in one transaction.
    struct Redemption {
        address user;
        address token;
        uint256 amount;
        bytes32 redemptionId;
        uint256 deadline;
        bytes signature;
    }

    // ───────────────────────── EIP-712 ─────────────────────────

    bytes32 private constant ACTION_TYPEHASH =
        keccak256("Action(address user,bytes32 actionType,bytes32 actionId,uint256 deadline)");

    bytes32 private constant REDEEM_TYPEHASH =
        keccak256("Redeem(address user,address token,uint256 amount,bytes32 redemptionId,uint256 deadline)");

    /// Redemptions book their stats under this synthetic type — the accrued drip is not a registry
    /// action (its amount is the accumulated tally, not a configured reward), but it is still counted.
    bytes32 private constant DRIP_TYPE = keccak256("drip");

    // ───────────────────────── events ─────────────────────────

    event ActionConfigured(
        bytes32 indexed id,
        string name,
        address token,
        uint256 reward,
        uint32 dailyLimit,
        uint32 cooldown,
        bool oneTime,
        bool active
    );
    event ActionStatusSet(bytes32 indexed id, bool active);
    event RewardPaid(address indexed user, bytes32 indexed actionType, bytes32 indexed actionKey, address token, uint256 amount);
    event DistributorSet(address indexed who, bool allowed);
    event SignerUpdated(address indexed prev, address indexed next);
    event Funded(address indexed token, address indexed from, uint256 amount);
    event Withdrawn(address indexed token, address indexed to, uint256 amount);
    event MaxRewardPerTxSet(uint256 amount);
    /// `payer` is whoever paid the gas: the participant themselves, or a sponsor settling on their behalf.
    event Redeemed(address indexed user, bytes32 indexed redemptionId, address token, uint256 amount, address payer);
    event RedeemBudgetPerDaySet(uint256 amount);
    event AssetAdded(address indexed token);
    event AssetRemoved(address indexed token, address indexed to, uint256 swept);
    event DripSet(address indexed token, uint256 perDay);

    // ───────────────────────── errors ─────────────────────────

    error NotDistributor();
    error UnknownAction();
    error InactiveAction();
    error ActionAlreadyClaimed();
    error OneTimeAlreadyDone();
    error DailyLimitReached();
    error CooldownActive();
    error Expired();
    error WrongSigner();
    error ZeroAmount();
    error LengthMismatch();
    error BatchTooLarge();
    error NameEmpty();
    error ExceedsMaxReward();
    error AlreadyRedeemed();
    error RedeemBudgetExhausted();
    error BadSignatureLength();
    error UnknownAsset();
    error AssetInUse();

    modifier onlyDistributor() {
        if (msg.sender != owner && !isDistributor[msg.sender]) revert NotDistributor();
        _;
    }

    // ───────────────────────── construction ─────────────────────────

    constructor(address defaultToken, address signer_)
        Owned(msg.sender)
        EIP712Verifier("IncentiveDistributor", "2")
    {
        if (defaultToken == address(0) || signer_ == address(0)) revert ZeroAddress();
        signer = signer_;
        isDistributor[msg.sender] = true;
        // safe-by-default blast-radius cap = 1 trillion LUV (the largest seeded reward, the welcome gesture).
        // A fresh deployment is bounded before any owner tx lands; governance retunes via setMaxRewardPerTx.
        maxRewardPerTx = 1_000_000_000_000 * 1e18;

        // The LUVdrip's published rate, on-chain and retunable: ONE MILLION LUV per
        // login-armed 24-hour window (operator, 2026-08-11). setDrip changes it live.
        dripToken = defaultToken;
        dripPerDay = 1_000_000 * 1e18;
        emit DripSet(defaultToken, dripPerDay);

        _setAction("welcome", defaultToken, 1_000_000_000_000 * 1e18, 0, 0, true, true);
        _setAction("tweet", defaultToken, 500_000_000_000 * 1e18, 10, 300, false, true);
        _setAction("post", defaultToken, 500_000_000_000 * 1e18, 10, 300, false, true);
        _setAction("interaction", defaultToken, 50_000_000_000 * 1e18, 20, 60, false, true);
    }

    // ───────────────────────── admin: action registry ─────────────────────────

    function setAction(
        string calldata name,
        address token,
        uint256 reward,
        uint32 dailyLimit,
        uint32 cooldown,
        bool oneTime,
        bool active
    ) external onlyOwner {
        _setAction(name, token, reward, dailyLimit, cooldown, oneTime, active);
    }

    function setActionActive(string calldata name, bool active) external onlyOwner {
        bytes32 id = keccak256(bytes(name));
        if (!_actions[id].exists) revert UnknownAction();
        _actions[id].active = active;
        emit ActionStatusSet(id, active);
    }

    function _setAction(
        string memory name,
        address token,
        uint256 reward,
        uint32 dailyLimit,
        uint32 cooldown,
        bool oneTime,
        bool active
    ) private {
        if (bytes(name).length == 0) revert NameEmpty();
        if (token == address(0)) revert ZeroAddress();
        if (reward == 0) revert ZeroAmount();
        _trackAsset(token); // an action's reward asset is, by definition, one we deal in
        bytes32 id = keccak256(bytes(name));
        if (!_actions[id].exists) {
            _actionIds.push(id);
            actionName[id] = name;
        }
        _actions[id] = ActionType(token, reward, dailyLimit, cooldown, oneTime, active, true);
        emit ActionConfigured(id, name, token, reward, dailyLimit, cooldown, oneTime, active);
    }

    // ───────────────────────── admin: roles / funds / pause ─────────────────────────

    function setDistributor(address who, bool allowed) external onlyOwner {
        if (who == address(0)) revert ZeroAddress();
        isDistributor[who] = allowed;
        emit DistributorSet(who, allowed);
    }

    function setSigner(address s) external onlyOwner {
        if (s == address(0)) revert ZeroAddress();
        emit SignerUpdated(signer, s);
        signer = s;
    }

    function setMaxRewardPerTx(uint256 m) external onlyOwner {
        maxRewardPerTx = m;
        emit MaxRewardPerTxSet(m);
    }

    /// The LUVdrip's reward is a VARIABLE, retunable live: how much drips per login-armed
    /// 24-hour window, and in which asset. The backend reads this and the chain is the final
    /// word. Setting it registers the asset. `perDay = 0` pauses the published rate.
    function setDrip(address token, uint256 perDay) external onlyOwner {
        if (token == address(0)) revert ZeroAddress();
        _trackAsset(token);
        dripToken = token;
        dripPerDay = perDay;
        emit DripSet(token, perDay);
    }

    // ───────────────────────── admin: the asset registry ─────────────────────────

    /// Register an ERC-20 this distributor deals in. Idempotent. Funding an asset or paying
    /// with it registers it automatically, so this is only needed to declare one up front.
    function addAsset(address token) external onlyOwner {
        if (token == address(0)) revert ZeroAddress();
        _trackAsset(token);
    }

    /// Deregister an asset and sweep its balance to `to` (pass address(0) to leave the balance
    /// where it is). Refuses while any ACTIVE action still pays in it, so a live reward can
    /// never be orphaned — deactivate those actions first. A removed asset can be re-added.
    function removeAsset(address token, address to) external onlyOwner {
        uint256 idx = _assetIndex[token];
        if (idx == 0) revert UnknownAsset();
        uint256 n = _actionIds.length;
        for (uint256 i = 0; i < n; i++) {
            ActionType storage a = _actions[_actionIds[i]];
            if (a.active && a.token == token) revert AssetInUse();
        }
        if (dripToken == token) revert AssetInUse();

        uint256 swept = 0;
        if (to != address(0)) {
            swept = IERC20Min(token).balanceOf(address(this));
            if (swept != 0) token.safeTransfer(to, swept);
        }
        // swap-and-pop the enumeration
        uint256 last = _assets.length;
        if (idx != last) {
            address moved = _assets[last - 1];
            _assets[idx - 1] = moved;
            _assetIndex[moved] = idx;
        }
        _assets.pop();
        delete _assetIndex[token];
        isAsset[token] = false;
        emit AssetRemoved(token, to, swept);
    }

    function _trackAsset(address token) private {
        if (_assetIndex[token] != 0) return;
        _assets.push(token);
        _assetIndex[token] = _assets.length;
        isAsset[token] = true;
        emit AssetAdded(token);
    }

    /// Every asset this distributor currently deals in.
    function assets() external view returns (address[] memory) {
        return _assets;
    }

    function assetCount() external view returns (uint256) {
        return _assets.length;
    }

    function assetAt(uint256 i) external view returns (address) {
        return _assets[i];
    }

    /// The whole treasury in one call: every registered asset and what the contract holds of it.
    function assetBalances() external view returns (address[] memory tokens, uint256[] memory balances) {
        uint256 n = _assets.length;
        tokens = new address[](n);
        balances = new uint256[](n);
        for (uint256 i = 0; i < n; i++) {
            tokens[i] = _assets[i];
            balances[i] = IERC20Min(_assets[i]).balanceOf(address(this));
        }
    }

    /// Fund the distributor with any ERC-20 (requires an allowance). A plain `transfer` to this
    /// address works too — use `addAsset` to declare the asset when funding that way.
    function fund(address token, uint256 amount) external {
        token.safeTransferFrom(msg.sender, address(this), amount);
        _trackAsset(token);
        emit Funded(token, msg.sender, amount);
    }

    function withdraw(address token, address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        token.safeTransfer(to, amount);
        emit Withdrawn(token, to, amount);
    }

    function setPaused(bool p) external onlyOwner {
        _setPaused(p);
    }

    // ───────────────────────── distribution: relayer ─────────────────────────

    function distribute(address user, string calldata actionType, string calldata actionId)
        external
        whenNotPaused
        nonReentrant
        onlyDistributor
    {
        _payout(user, keccak256(bytes(actionType)), _key(actionId));
    }

    function distributeBatch(
        address[] calldata recipients,
        string[] calldata actionTypes_,
        string[] calldata actionIds
    ) external whenNotPaused nonReentrant onlyDistributor {
        uint256 n = recipients.length;
        if (n > 200) revert BatchTooLarge();
        if (n != actionTypes_.length || n != actionIds.length) revert LengthMismatch();
        for (uint256 i = 0; i < n; i++) {
            bytes32 typeId = keccak256(bytes(actionTypes_[i]));
            bytes32 k = _key(actionIds[i]);
            if (_claimed[k]) continue;
            if (!_eligible(recipients[i], typeId)) continue;
            _payout(recipients[i], typeId, k);
        }
    }

    // ───────────────────────── distribution: signed voucher ─────────────────────────

    function claimWithSignature(
        address user,
        string calldata actionType,
        string calldata actionId,
        uint256 deadline,
        bytes calldata signature
    ) external whenNotPaused nonReentrant {
        if (block.timestamp > deadline) revert Expired();
        bytes32 typeId = keccak256(bytes(actionType));
        bytes32 k = _key(actionId);
        bytes32 digest = _hashTypedData(keccak256(abi.encode(ACTION_TYPEHASH, user, typeId, k, deadline)));
        if (_recoverSigner(digest, signature) != signer) revert WrongSigner();
        _payout(user, typeId, k);
    }

    function claimDigest(address user, string calldata actionType, string calldata actionId, uint256 deadline)
        external
        view
        returns (bytes32)
    {
        return _hashTypedData(
            keccak256(
                abi.encode(ACTION_TYPEHASH, user, keccak256(bytes(actionType)), _key(actionId), deadline)
            )
        );
    }

    // ───────────────────────── distribution: the REDEEM rail ─────────────────────────
    //
    // This rail HONOURS A VERIFIED COLLECT: the participant's earned tally, whatever earned it —
    // the daily LUVdrip (a million a day, dripped across the full 24 hours a login arms, at the
    // owner-settable `dripPerDay` rate above) and any other verified earning the backend has
    // credited. The tally accrues OFF-CHAIN and lands ON-CHAIN in ONE transaction, when it is
    // judged worth the gas. The backend signs a voucher naming the recipient, the ASSET (any
    // registered ERC-20 — this contract holds LUV and whatever else it is funded with) and the
    // collected amount; the voucher does not care who submits it, so WHOEVER SENDS THE
    // TRANSACTION PAYS THE GAS and the reward always lands on `user`:
    //   • the participant submits it from their own wallet  → the participant spends their own ETH
    //     (their wallet needs ETH; this is the ordinary, self-sovereign path), or
    //   • the project (or anyone) submits the same voucher — one at a time or in a redeemBatch —
    //     → the gas is SPONSORED and the participant needs no ETH at all.
    // One rail, two payers. Submitting needs no role: the signature is the whole authority.
    //
    // BLAST RADIUS. Unlike claimWithSignature (amount comes from the registry), the amount here is
    // signed by the backend, so a compromised signer key could invent amounts. It is bounded three
    // ways: `maxRewardPerTx` per redemption, `redeemBudgetPerDay` across every redemption in a UTC
    // day, and single-use `redemptionId`s. Operators MUST set a per-day budget before funding.

    /// Cap the total redeemable per UTC day across all participants (0 = unlimited).
    function setRedeemBudgetPerDay(uint256 amount) external onlyOwner {
        redeemBudgetPerDay = amount;
        emit RedeemBudgetPerDaySet(amount);
    }

    /// Deliver one backend-signed accrued balance. Permissionless: the participant pays their own
    /// gas, or a sponsor pays it for them — the voucher is identical either way.
    function redeemWithSignature(
        address user,
        address token,
        uint256 amount,
        bytes32 redemptionId,
        uint256 deadline,
        bytes calldata signature
    ) external whenNotPaused nonReentrant {
        _redeem(user, token, amount, redemptionId, deadline, signature, false);
    }

    /// Sponsored sweep: settle many participants in one transaction, the sender paying for all of
    /// them. Invalid/expired/already-redeemed entries are SKIPPED (never reverted on) so one stale
    /// voucher can't wedge a whole sponsorship run. Returns how many were delivered.
    function redeemBatch(Redemption[] calldata rs)
        external
        whenNotPaused
        nonReentrant
        returns (uint256 delivered)
    {
        uint256 n = rs.length;
        if (n > 200) revert BatchTooLarge();
        for (uint256 i = 0; i < n; i++) {
            if (_redeem(rs[i].user, rs[i].token, rs[i].amount, rs[i].redemptionId, rs[i].deadline, rs[i].signature, true)) {
                delivered++;
            }
        }
    }

    /// Off-chain helper: the exact digest the backend must sign for redeemWithSignature/redeemBatch.
    function redeemDigest(address user, address token, uint256 amount, bytes32 redemptionId, uint256 deadline)
        external
        view
        returns (bytes32)
    {
        return _hashTypedData(keccak256(abi.encode(REDEEM_TYPEHASH, user, token, amount, redemptionId, deadline)));
    }

    function isRedeemed(bytes32 redemptionId) external view returns (bool) {
        return _redeemed[redemptionId];
    }

    /// What the day's redeem budget still allows (type(uint256).max when unlimited).
    function redeemBudgetRemaining() external view returns (uint256) {
        if (redeemBudgetPerDay == 0) return type(uint256).max;
        uint64 dayStart = uint64(block.timestamp - (block.timestamp % 1 days));
        uint256 spent = dayStart > redeemDayStart ? 0 : redeemedToday;
        return spent >= redeemBudgetPerDay ? 0 : redeemBudgetPerDay - spent;
    }

    /// `skip` = batch mode: a failing entry returns false instead of reverting the whole call.
    function _redeem(
        address user,
        address token,
        uint256 amount,
        bytes32 redemptionId,
        uint256 deadline,
        bytes calldata signature,
        bool skip
    ) private returns (bool) {
        if (block.timestamp > deadline) { if (skip) return false; revert Expired(); }
        if (amount == 0) { if (skip) return false; revert ZeroAmount(); }
        if (token == address(0) || user == address(0)) { if (skip) return false; revert ZeroAddress(); }
        // only an asset this distributor deals in — a further bound on the signer key
        if (!isAsset[token]) { if (skip) return false; revert UnknownAsset(); }
        if (_redeemed[redemptionId]) { if (skip) return false; revert AlreadyRedeemed(); }
        if (maxRewardPerTx != 0 && amount > maxRewardPerTx) { if (skip) return false; revert ExceedsMaxReward(); }
        // length-check before _recoverSigner so a malformed voucher is skippable in batch mode
        if (signature.length != 65) { if (skip) return false; revert BadSignatureLength(); }
        bytes32 digest =
            _hashTypedData(keccak256(abi.encode(REDEEM_TYPEHASH, user, token, amount, redemptionId, deadline)));
        if (_recoverSigner(digest, signature) != signer) { if (skip) return false; revert WrongSigner(); }
        if (!_spendRedeemBudget(amount, skip)) return false;

        _redeemed[redemptionId] = true;
        _pay(user, DRIP_TYPE, redemptionId, token, amount);
        emit Redeemed(user, redemptionId, token, amount, msg.sender);
        return true;
    }

    function _spendRedeemBudget(uint256 amount, bool skip) private returns (bool) {
        uint256 budget = redeemBudgetPerDay;
        if (budget == 0) return true;
        uint64 dayStart = uint64(block.timestamp - (block.timestamp % 1 days));
        uint256 spent = dayStart > redeemDayStart ? 0 : redeemedToday;
        if (spent + amount > budget) { if (skip) return false; revert RedeemBudgetExhausted(); }
        if (dayStart > redeemDayStart) redeemDayStart = dayStart;
        redeemedToday = spent + amount;
        return true;
    }

    // ───────────────────────── distribution: legacy backend ABI ─────────────────────────

    function distributeReward(address user, uint256 amount)
        external
        whenNotPaused
        nonReentrant
        onlyDistributor
        returns (bool)
    {
        bytes32 typeId = keccak256("interaction");
        ActionType storage a = _actions[typeId];
        if (!a.exists) revert UnknownAction();
        if (!a.active) revert InactiveAction();
        if (amount == 0) revert ZeroAmount();
        _pay(user, typeId, bytes32(0), a.token, amount);
        return true;
    }

    function distributeWelcome(address user) external whenNotPaused nonReentrant onlyDistributor {
        _payout(user, keccak256("welcome"), keccak256(abi.encodePacked("welcome:", user)));
    }

    // ───────────────────────── internals ─────────────────────────

    // NOTE (audit M3): the replay key is keccak256(actionId) alone. actionIds MUST therefore be globally
    // unique across all users AND action types — a hard backend invariant (the auth backend namespaces
    // per submission). A non-namespaced id lets a relayer pre-burn an id a pending voucher will use.
    // Keyed on actionId (not user+type) so the isActionClaimed(actionId) view + backend ABI stay valid.
    function _key(string calldata actionId) private pure returns (bytes32) {
        return keccak256(bytes(actionId));
    }

    function _payout(address user, bytes32 typeId, bytes32 actionKey) private {
        ActionType storage a = _actions[typeId];
        if (!a.exists) revert UnknownAction();
        if (!a.active) revert InactiveAction();
        if (_claimed[actionKey]) revert ActionAlreadyClaimed();
        _claimed[actionKey] = true;

        UserActionStat storage s = _userAction[user][typeId];
        if (a.oneTime && s.count > 0) revert OneTimeAlreadyDone();
        if (a.cooldown != 0 && s.lastAt != 0 && block.timestamp < s.lastAt + a.cooldown) revert CooldownActive();
        if (a.dailyLimit != 0) {
            _rollDay(s);
            if (s.countToday >= a.dailyLimit) revert DailyLimitReached();
        }
        _pay(user, typeId, actionKey, a.token, a.reward);
    }

    function _pay(address user, bytes32 typeId, bytes32 actionKey, address token, uint256 amount) private {
        if (user == address(0)) revert ZeroAddress();
        if (maxRewardPerTx != 0 && amount > maxRewardPerTx) revert ExceedsMaxReward();

        UserActionStat storage s = _userAction[user][typeId];
        _rollDay(s);
        s.earned += amount;
        s.count += 1;
        s.countToday += 1;
        s.lastAt = uint64(block.timestamp);

        userActionsCompleted[user] += 1;
        userEarnedByToken[user][token] += amount;
        actionCompletions[typeId] += 1;
        totalActionsCompleted += 1;
        totalRewardsDistributed += amount;
        distributedByToken[token] += amount;

        token.safeTransfer(user, amount);
        emit RewardPaid(user, typeId, actionKey, token, amount);
    }

    function _rollDay(UserActionStat storage s) private {
        uint64 dayStart = uint64(block.timestamp - (block.timestamp % 1 days));
        if (dayStart > s.dayStart) {
            s.dayStart = dayStart;
            s.countToday = 0;
        }
    }

    function _eligible(address user, bytes32 typeId) private view returns (bool) {
        ActionType storage a = _actions[typeId];
        if (!a.exists || !a.active) return false;
        UserActionStat storage s = _userAction[user][typeId];
        if (a.oneTime && s.count > 0) return false;
        if (a.cooldown != 0 && s.lastAt != 0 && block.timestamp < s.lastAt + a.cooldown) return false;
        if (a.dailyLimit != 0) {
            uint64 dayStart = uint64(block.timestamp - (block.timestamp % 1 days));
            uint32 today = dayStart > s.dayStart ? 0 : s.countToday;
            if (today >= a.dailyLimit) return false;
        }
        return true;
    }

    // ───────────────────────── views: admin UI ─────────────────────────

    function actionCount() external view returns (uint256) {
        return _actionIds.length;
    }

    function actionIdAt(uint256 index) external view returns (bytes32) {
        return _actionIds[index];
    }

    function getAction(string calldata name)
        external
        view
        returns (address token, uint256 reward, uint32 dailyLimit, uint32 cooldown, bool oneTime, bool active)
    {
        ActionType storage a = _actions[keccak256(bytes(name))];
        if (!a.exists) revert UnknownAction();
        return (a.token, a.reward, a.dailyLimit, a.cooldown, a.oneTime, a.active);
    }

    function getAllActions()
        external
        view
        returns (
            string[] memory names,
            address[] memory tokens,
            uint256[] memory rewards,
            uint32[] memory dailyLimits,
            uint32[] memory cooldowns,
            bool[] memory oneTimes,
            bool[] memory actives,
            uint256[] memory completions
        )
    {
        uint256 n = _actionIds.length;
        names = new string[](n);
        tokens = new address[](n);
        rewards = new uint256[](n);
        dailyLimits = new uint32[](n);
        cooldowns = new uint32[](n);
        oneTimes = new bool[](n);
        actives = new bool[](n);
        completions = new uint256[](n);
        for (uint256 i = 0; i < n; i++) {
            bytes32 id = _actionIds[i];
            ActionType storage a = _actions[id];
            names[i] = actionName[id];
            tokens[i] = a.token;
            rewards[i] = a.reward;
            dailyLimits[i] = a.dailyLimit;
            cooldowns[i] = a.cooldown;
            oneTimes[i] = a.oneTime;
            actives[i] = a.active;
            completions[i] = actionCompletions[id];
        }
    }

    function canPerform(address user, string calldata actionType) external view returns (bool) {
        return _eligible(user, keccak256(bytes(actionType)));
    }

    function getUserActionStats(address user, string calldata actionType)
        external
        view
        returns (uint256 earned, uint64 count, uint32 countToday, uint64 lastAt)
    {
        UserActionStat storage s = _userAction[user][keccak256(bytes(actionType))];
        uint64 dayStart = uint64(block.timestamp - (block.timestamp % 1 days));
        uint32 today = dayStart > s.dayStart ? 0 : s.countToday;
        return (s.earned, s.count, today, s.lastAt);
    }

    // ───────────────────────── views: legacy backend ABI ─────────────────────────

    function isActionClaimed(string calldata actionId) external view returns (bool) {
        return _claimed[_key(actionId)];
    }

    function getUserStats(address user)
        external
        view
        returns (uint256 rewardsEarned, uint256 actionsCompleted, uint256 actionsToday, uint256 nextRewardAmount)
    {
        bytes32 typeId = keccak256("interaction");
        ActionType storage a = _actions[typeId];
        UserActionStat storage s = _userAction[user][typeId];
        uint64 dayStart = uint64(block.timestamp - (block.timestamp % 1 days));
        uint32 today = dayStart > s.dayStart ? 0 : s.countToday;
        uint256 earned = a.exists ? userEarnedByToken[user][a.token] : 0;
        bool can = a.exists && _eligible(user, typeId);
        return (earned, userActionsCompleted[user], today, can ? a.reward : 0);
    }

    function getContractStats()
        external
        view
        returns (uint256 totalRewards, uint256 totalActions, uint256 currentBalance)
    {
        bytes32 typeId = keccak256("interaction");
        ActionType storage a = _actions[typeId];
        uint256 bal = a.exists ? IERC20Min(a.token).balanceOf(address(this)) : 0;
        return (totalRewardsDistributed, totalActionsCompleted, bal);
    }

    function tokenBalance(address token) external view returns (uint256) {
        return IERC20Min(token).balanceOf(address(this));
    }
}
