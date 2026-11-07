// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/*
 * GoldVault — a MakerDAO-style CDP engine for COLLATERALISED GOLD.
 *
 * Collateral is a BASKET of existing on-chain gold pegs (PAXG, XAUT, … each an "ilk"); the
 * debt token is bXAU, denominated in troy ounces. Lock pegs, draw bXAU up to 1/mat of the
 * locked ounces, pay a stability fee, get liquidated if a peg slips. The Maker pieces map as:
 *
 *   Vat  (ilks, urns, rate, Art, line, Line, dust)  → this contract's storage
 *   GemJoin / DaiJoin                                → lock / free / draw / wipe
 *   Jug  (duty, rho, drip)                           → drip()
 *   Spotter (mat, spot)                              → PegSpotter + mat here
 *   Dog/Clipper (chop, bark)                         → liquidate(): fixed-discount, partial-OK
 *   Vow  (surplus, sin, heal, flap)                  → surplus / sin / heal() / flap()
 *   End  (cage, skim, thaw/flow, cash)               → cage() / skim() / thaw() / cash()
 *
 * Units (Maker's): WAD = 1e18, RAY = 1e27, RAD = WAD·RAY.
 *   ink    collateral, normalised to 18 decimals                     (WAD)
 *   art    normalised debt; real debt = art · rate                   (WAD · RAY = RAD)
 *   price  oz of gold per whole collateral token, from PegSpotter    (WAD)
 *   safe   ⇔  ink · price · RAY / mat  ≥  art · rate
 *
 * Token handling: collateral received is measured by balance delta (PAXG charges a transfer
 * fee); transfers tolerate tokens that return no bool (XAUT is a Tether-style token).
 *
 * Self-contained (zero imports), Foundry tested in test/GoldVault.t.sol.
 */
interface IGem {
    function balanceOf(address) external view returns (uint256);
}

interface IBasketGold {
    function mint(address to, uint256 value) external;
    function burn(address from, uint256 value) external;
    function totalSupply() external view returns (uint256);
}

interface ISpotter {
    function peek(bytes32 ilk) external view returns (uint256 price, bool ok);
}

contract GoldVault {
    uint256 internal constant WAD = 1e18;
    uint256 internal constant RAY = 1e27;

    struct Ilk {
        address gem; // collateral token
        uint256 scale; // 10 ** (18 - gem.decimals)
        uint256 Art; // total normalised debt            [WAD]
        uint256 rate; // accumulated stability fee      [RAY]
        uint256 rho; // last drip
        uint256 duty; // per-second fee multiplier       [RAY]
        uint256 mat; // liquidation ratio               [RAY]  e.g. 1.10e27 = 110%
        uint256 chop; // liquidation penalty            [WAD]  e.g. 1.04e18 = 4%
        uint256 line; // ilk debt ceiling               [WAD oz]
        uint256 dust; // min debt per urn               [WAD oz]
        uint256 floor; // min peg price to draw          [WAD oz/token] depeg guard
    }

    struct Urn {
        uint256 ink; // [WAD]
        uint256 art; // [WAD]
    }

    IBasketGold public immutable bxau;
    ISpotter public spotter;

    mapping(address => uint256) public wards;
    mapping(bytes32 => Ilk) public ilks;
    mapping(bytes32 => mapping(address => Urn)) public urns;
    bytes32[] public ilkList;

    uint256 public Line; // global debt ceiling   [WAD oz]
    uint256 public debt; // Σ Art · rate          [RAD]
    uint256 public surplus; // fees + rounding     [RAD]
    uint256 public sin; // bad debt               [RAD]

    // shutdown (End)
    uint256 public live = 1;
    bool public thawed;
    mapping(bytes32 => uint256) public tag; // gem WAD per oz at cage
    mapping(bytes32 => uint256) public pool; // gem WAD held for bXAU holders
    mapping(bytes32 => uint256) public fix; // gem WAD per bXAU at thaw

    uint256 private _lock = 1;

    event Rely(address indexed usr);
    event Deny(address indexed usr);
    event Init(bytes32 indexed ilk, address gem, uint8 decimals);
    event File(bytes32 indexed ilk, bytes32 indexed what, uint256 data);
    event FileGlobal(bytes32 indexed what, uint256 data);
    event FileSpotter(address spotter);
    event Drip(bytes32 indexed ilk, uint256 rate, uint256 fee);
    event Lock(bytes32 indexed ilk, address indexed usr, uint256 amount);
    event Free(bytes32 indexed ilk, address indexed usr, uint256 amount);
    event Draw(bytes32 indexed ilk, address indexed usr, uint256 wad);
    event Wipe(bytes32 indexed ilk, address indexed usr, uint256 wad);
    event Liquidate(
        bytes32 indexed ilk, address indexed usr, address indexed keeper, uint256 wad, uint256 gemOut, uint256 badDebt
    );
    event Heal(uint256 rad);
    event Flap(address indexed to, uint256 wad);
    event Cage();
    event Skim(bytes32 indexed ilk, address indexed usr, uint256 taken, uint256 shortfall);
    event Thaw(uint256 supply);
    event Cash(address indexed usr, uint256 wad);

    error NotAuthorized();
    error NotLive();
    error StillLive();
    error UnknownIlk();
    error IlkExists();
    error BadParam();
    error Reentrancy();
    error OracleDown();
    error Depegged();
    error NotSafe();
    error Safe();
    error CeilingExceeded();
    error Dusty();
    error Insufficient();
    error TransferFailed();
    error AlreadyThawed();
    error NotThawed();
    error Unskimmed();
    error NoSupply();

    modifier auth() {
        if (wards[msg.sender] != 1) revert NotAuthorized();
        _;
    }

    modifier nonReentrant() {
        if (_lock != 1) revert Reentrancy();
        _lock = 2;
        _;
        _lock = 1;
    }

    modifier whenLive() {
        if (live != 1) revert NotLive();
        _;
    }

    constructor(address bxau_, address spotter_) {
        bxau = IBasketGold(bxau_);
        spotter = ISpotter(spotter_);
        wards[msg.sender] = 1;
        emit Rely(msg.sender);
        emit FileSpotter(spotter_);
    }

    // ───────────────────────────────── admin ─────────────────────────────────

    function rely(address usr) external auth {
        wards[usr] = 1;
        emit Rely(usr);
    }

    function deny(address usr) external auth {
        wards[usr] = 0;
        emit Deny(usr);
    }

    function fileSpotter(address s) external auth whenLive {
        spotter = ISpotter(s);
        emit FileSpotter(s);
    }

    function fileLine(uint256 wad) external auth whenLive {
        Line = wad;
        emit FileGlobal("Line", wad);
    }

    /// Register a gold-peg collateral. Defaults: no fee, 150% mat, 13% chop, zero ceiling
    /// (no borrowing until governance files a line).
    function init(bytes32 ilk, address gem, uint8 decimals) external auth whenLive {
        if (ilks[ilk].rate != 0) revert IlkExists();
        if (gem == address(0) || decimals > 18) revert BadParam();
        Ilk storage i = ilks[ilk];
        i.gem = gem;
        i.scale = 10 ** (18 - decimals);
        i.rate = RAY;
        i.rho = block.timestamp;
        i.duty = RAY;
        i.mat = 15e26;
        i.chop = 113e16;
        ilkList.push(ilk);
        emit Init(ilk, gem, decimals);
    }

    function file(bytes32 ilk, bytes32 what, uint256 data) external auth whenLive {
        Ilk storage i = ilks[ilk];
        if (i.rate == 0) revert UnknownIlk();
        if (what == "duty") {
            if (data < RAY) revert BadParam();
            _drip(ilk); // settle at the old rate first
            i.duty = data;
        } else if (what == "mat") {
            if (data < RAY) revert BadParam();
            i.mat = data;
        } else if (what == "chop") {
            if (data < WAD) revert BadParam();
            i.chop = data;
        } else if (what == "line") {
            i.line = data;
        } else if (what == "dust") {
            i.dust = data;
        } else if (what == "floor") {
            i.floor = data;
        } else {
            revert BadParam();
        }
        emit File(ilk, what, data);
    }

    // ─────────────────────────────── stability fee ───────────────────────────

    function drip(bytes32 ilk) external whenLive returns (uint256) {
        if (ilks[ilk].rate == 0) revert UnknownIlk();
        return _drip(ilk);
    }

    function _drip(bytes32 ilk) internal returns (uint256 rate) {
        Ilk storage i = ilks[ilk];
        rate = i.rate;
        if (block.timestamp == i.rho) return rate;
        uint256 next = _rpow(i.duty, block.timestamp - i.rho) * rate / RAY;
        i.rho = block.timestamp;
        if (next == rate) return rate;
        uint256 fee = i.Art * (next - rate);
        i.rate = next;
        debt += fee;
        surplus += fee;
        emit Drip(ilk, next, fee);
        return next;
    }

    // ──────────────────────────────── positions ──────────────────────────────

    /// Deposit `amount` of the ilk's gem (native decimals). Fee-on-transfer safe.
    function lock(bytes32 ilk, uint256 amount) external nonReentrant whenLive {
        Ilk storage i = ilks[ilk];
        if (i.rate == 0) revert UnknownIlk();
        uint256 before = IGem(i.gem).balanceOf(address(this));
        _safeTransferFrom(i.gem, msg.sender, address(this), amount);
        uint256 got = IGem(i.gem).balanceOf(address(this)) - before;
        urns[ilk][msg.sender].ink += got * i.scale;
        emit Lock(ilk, msg.sender, got);
    }

    /// Withdraw `amount` of gem (native decimals). While live the urn must stay safe; after
    /// cage the urn must have been skimmed (art == 0).
    function free(bytes32 ilk, uint256 amount) external nonReentrant {
        Ilk storage i = ilks[ilk];
        if (i.rate == 0) revert UnknownIlk();
        Urn storage u = urns[ilk][msg.sender];
        uint256 w = amount * i.scale;
        if (u.ink < w) revert Insufficient();
        u.ink -= w;
        if (u.art != 0) {
            if (live != 1) revert Unskimmed();
            uint256 rate = _drip(ilk);
            (uint256 price, bool ok) = spotter.peek(ilk);
            if (!ok) revert OracleDown();
            if (!_safe(u.ink, u.art, rate, price, i.mat)) revert NotSafe();
        }
        _safeTransfer(i.gem, msg.sender, amount);
        emit Free(ilk, msg.sender, amount);
    }

    /// Mint `wad` bXAU against the caller's urn.
    function draw(bytes32 ilk, uint256 wad) external nonReentrant whenLive {
        Ilk storage i = ilks[ilk];
        if (i.rate == 0) revert UnknownIlk();
        uint256 rate = _drip(ilk);
        (uint256 price, bool ok) = spotter.peek(ilk);
        if (!ok) revert OracleDown();
        if (price < i.floor) revert Depegged();

        uint256 dart = _divUp(wad * RAY, rate);
        Urn storage u = urns[ilk][msg.sender];
        u.art += dart;
        i.Art += dart;
        debt += dart * rate;
        surplus += dart * rate - wad * RAY; // round-up remainder

        if (i.Art * rate > i.line * RAY) revert CeilingExceeded();
        if (debt > Line * RAY) revert CeilingExceeded();
        if (u.art * rate < i.dust * RAY) revert Dusty();
        if (!_safe(u.ink, u.art, rate, price, i.mat)) revert NotSafe();

        bxau.mint(msg.sender, wad);
        emit Draw(ilk, msg.sender, wad);
    }

    /// Repay `wad` bXAU (caller must have approved the vault). Use wipeAll to close fully.
    function wipe(bytes32 ilk, uint256 wad) external nonReentrant whenLive {
        Ilk storage i = ilks[ilk];
        if (i.rate == 0) revert UnknownIlk();
        uint256 rate = _drip(ilk);
        Urn storage u = urns[ilk][msg.sender];
        uint256 dart = wad * RAY / rate;
        if (dart > u.art) revert Insufficient();
        u.art -= dart;
        if (u.art != 0 && u.art * rate < i.dust * RAY) revert Dusty();
        i.Art -= dart;
        debt -= dart * rate;
        surplus += wad * RAY - dart * rate; // round-down remainder
        bxau.burn(msg.sender, wad);
        emit Wipe(ilk, msg.sender, wad);
    }

    /// Repay the caller's entire debt in this ilk. Returns the bXAU burned.
    function wipeAll(bytes32 ilk) external nonReentrant whenLive returns (uint256 wad) {
        Ilk storage i = ilks[ilk];
        if (i.rate == 0) revert UnknownIlk();
        uint256 rate = _drip(ilk);
        Urn storage u = urns[ilk][msg.sender];
        uint256 art = u.art;
        uint256 rad = art * rate;
        wad = _divUp(rad, RAY);
        u.art = 0;
        i.Art -= art;
        debt -= rad;
        surplus += wad * RAY - rad;
        bxau.burn(msg.sender, wad);
        emit Wipe(ilk, msg.sender, wad);
    }

    // ─────────────────────────────── liquidation ─────────────────────────────

    /// Repay up to `maxWad` of an unsafe urn's debt and receive its collateral at a `chop`
    /// discount: every oz of bXAU burned buys chop oz worth of gem. Partial liquidations are
    /// allowed as long as the remainder is not dust. If the collateral runs out first, the
    /// residual debt is written off to `sin`.
    function liquidate(bytes32 ilk, address usr, uint256 maxWad)
        external
        nonReentrant
        whenLive
        returns (uint256 wad, uint256 gemOut)
    {
        Ilk storage i = ilks[ilk];
        if (i.rate == 0) revert UnknownIlk();
        uint256 rate = _drip(ilk);
        (uint256 price, bool ok) = spotter.peek(ilk);
        if (!ok) revert OracleDown();
        Urn storage u = urns[ilk][usr];
        if (u.art == 0 || _safe(u.ink, u.art, rate, price, i.mat)) revert Safe();

        uint256 tab = _divUp(u.art * rate, RAY);
        wad = maxWad < tab ? maxWad : tab;
        if (wad < tab && (tab - wad) < i.dust) revert Dusty();

        uint256 seize = wad * i.chop / price; // gem WAD
        if (seize >= u.ink) {
            seize = u.ink;
            wad = _divUp(seize * price, i.chop);
            if (wad > tab) wad = tab;
        }
        gemOut = seize / i.scale;
        seize = gemOut * i.scale;

        uint256 dart = wad == tab ? u.art : wad * RAY / rate;
        u.ink -= seize;
        u.art -= dart;
        i.Art -= dart;
        debt -= dart * rate;
        surplus += wad * RAY - dart * rate;

        uint256 bad;
        if (u.ink == 0 && u.art != 0) {
            bad = u.art * rate;
            i.Art -= u.art;
            u.art = 0;
            debt -= bad;
            sin += bad;
        }

        bxau.burn(msg.sender, wad);
        if (gemOut != 0) _safeTransfer(i.gem, msg.sender, gemOut);
        emit Liquidate(ilk, usr, msg.sender, wad, gemOut, bad);
    }

    // ──────────────────────────────── accounting ─────────────────────────────

    /// Cancel bad debt against accrued surplus.
    function heal() external {
        uint256 rad = surplus < sin ? surplus : sin;
        surplus -= rad;
        sin -= rad;
        emit Heal(rad);
    }

    /// Mint accrued surplus (net of bad debt) as bXAU to the treasury.
    function flap(address to, uint256 wad) external auth whenLive {
        if (sin != 0) revert Insufficient(); // heal first
        if (surplus < wad * RAY) revert Insufficient();
        surplus -= wad * RAY;
        bxau.mint(to, wad);
        emit Flap(to, wad);
    }

    // ─────────────────────────────── shutdown (End) ──────────────────────────

    /// Freeze the system at current peg prices. Ilks whose oracle is down are tagged at par
    /// (1 token per oz), i.e. "from existing pegs".
    function cage() external auth whenLive {
        uint256 n = ilkList.length;
        for (uint256 k; k < n; ++k) {
            bytes32 ilk = ilkList[k];
            _drip(ilk);
            (uint256 price, bool ok) = spotter.peek(ilk);
            tag[ilk] = ok ? WAD * WAD / price : WAD;
        }
        live = 0;
        emit Cage();
    }

    /// Settle an urn after cage: its debt is converted to collateral at the cage price and
    /// moved into the bXAU holders' pool. Permissionless.
    function skim(bytes32 ilk, address usr) external {
        if (live == 1) revert StillLive();
        if (thawed) revert AlreadyThawed();
        Ilk storage i = ilks[ilk];
        if (i.rate == 0) revert UnknownIlk();
        Urn storage u = urns[ilk][usr];
        uint256 art = u.art;
        if (art == 0) return;
        uint256 rad = art * i.rate;
        uint256 owe = _divUp(_divUp(_divUp(rad, RAY) * tag[ilk], WAD), i.scale) * i.scale; // whole native units
        uint256 take = owe < u.ink ? owe : u.ink;
        u.ink -= take;
        u.art = 0;
        i.Art -= art;
        debt -= rad;
        pool[ilk] += take;
        emit Skim(ilk, usr, take, owe - take);
    }

    /// Once every urn has been skimmed, fix the per-bXAU redemption basket.
    function thaw() external {
        if (live == 1) revert StillLive();
        if (thawed) revert AlreadyThawed();
        uint256 n = ilkList.length;
        for (uint256 k; k < n; ++k) {
            if (ilks[ilkList[k]].Art != 0) revert Unskimmed();
        }
        uint256 supply = bxau.totalSupply();
        if (supply == 0) revert NoSupply();
        for (uint256 k; k < n; ++k) {
            bytes32 ilk = ilkList[k];
            fix[ilk] = pool[ilk] * WAD / supply;
        }
        thawed = true;
        emit Thaw(supply);
    }

    /// Burn `wad` bXAU for its pro-rata share of every peg in the basket.
    function cash(uint256 wad) external nonReentrant {
        if (!thawed) revert NotThawed();
        bxau.burn(msg.sender, wad);
        uint256 n = ilkList.length;
        for (uint256 k; k < n; ++k) {
            bytes32 ilk = ilkList[k];
            Ilk storage i = ilks[ilk];
            uint256 native = wad * fix[ilk] / WAD / i.scale;
            if (native == 0) continue;
            pool[ilk] -= native * i.scale;
            _safeTransfer(i.gem, msg.sender, native);
        }
        emit Cash(msg.sender, wad);
    }

    // ─────────────────────────────────── views ───────────────────────────────

    function ilkCount() external view returns (uint256) {
        return ilkList.length;
    }

    /// Debt of an urn in oz (rounded up), at the last dripped rate.
    function owed(bytes32 ilk, address usr) external view returns (uint256) {
        return _divUp(urns[ilk][usr].art * ilks[ilk].rate, RAY);
    }

    /// Whether an urn is safe at the current oracle price (false if the oracle is down).
    function isSafe(bytes32 ilk, address usr) external view returns (bool) {
        Ilk storage i = ilks[ilk];
        Urn storage u = urns[ilk][usr];
        if (u.art == 0) return true;
        (uint256 price, bool ok) = spotter.peek(ilk);
        if (!ok) return false;
        return _safe(u.ink, u.art, i.rate, price, i.mat);
    }

    // ────────────────────────────────── internal ─────────────────────────────

    function _safe(uint256 ink, uint256 art, uint256 rate, uint256 price, uint256 mat) internal pure returns (bool) {
        uint256 spot = price * RAY / mat; // oz per gem, discounted by mat [WAD]
        // ink[WAD] · spot[WAD] · 1e9  ==  RAD scale
        return ink * spot * 1e9 >= art * rate;
    }

    function _divUp(uint256 x, uint256 y) internal pure returns (uint256) {
        return x == 0 ? 0 : (x - 1) / y + 1;
    }

    function _rpow(uint256 x, uint256 n) internal pure returns (uint256 z) {
        z = n % 2 != 0 ? x : RAY;
        for (n /= 2; n != 0; n /= 2) {
            x = (x * x + RAY / 2) / RAY;
            if (n % 2 != 0) z = (z * x + RAY / 2) / RAY;
        }
    }

    function _safeTransfer(address token, address to, uint256 amount) internal {
        (bool ok, bytes memory ret) = token.call(abi.encodeWithSelector(0xa9059cbb, to, amount));
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert TransferFailed();
    }

    function _safeTransferFrom(address token, address from, address to, uint256 amount) internal {
        (bool ok, bytes memory ret) = token.call(abi.encodeWithSelector(0x23b872dd, from, to, amount));
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert TransferFailed();
    }
}
