// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/*
 * GoldPsm — peg stability module (Maker's DssPsm, adapted): swap a gold peg and bXAU 1:1.
 *
 *   sellGem(amount)  give PAXG → receive bXAU  (1:1 minus `tin`)     caps bXAU's price ABOVE 1 oz
 *   buyGem(amount)   give bXAU → receive PAXG  (1:1 plus `tout`)     floors bXAU's price BELOW 1 oz
 *
 * Without it nothing anchors bXAU tightly: borrowers only mint when bXAU trades far enough
 * above an ounce to justify 120% collateral. With it, arbitrage keeps bXAU within
 * [1 − tout, 1 + tin] of the peg token.
 *
 * How it stays inside the vault's books (as in Maker): the PSM is an ordinary urn owner in a
 * dedicated ilk (e.g. "PSM-PAXG-A") configured with a 100% ratio, zero fee, zero dust and a par
 * price. Every bXAU it mints is vault debt backed 1:1 by collateral locked in that urn, counted
 * against the ilk's debt ceiling, and settled like any other urn at shutdown.
 *
 * Depeg guard (not in Maker's PSM): a PSM takes the peg at par, so a depegging token would be
 * dumped into it for good bXAU. sellGem therefore requires the peg's MARKET price — read from
 * the vault's spotter for `pegIlk` (e.g. "PAXG-A") — to be fresh and at least `floor`
 * (e.g. 0.995 oz). buyGem is never blocked: holders can always redeem.
 *
 * Fees (`tin`, `tout`, each ≤ 1%) accumulate as bXAU here; anyone may collect() them to the
 * treasury. Amounts are measured by balance delta throughout (PAXG charges a transfer fee).
 *
 * The PSM ilk's stability fee MUST stay zero: the 1:1 accounting assumes rate == 1.
 */
interface IPsmVault {
    function bxau() external view returns (address);
    function spotter() external view returns (address);
    function urns(bytes32 ilk, address usr) external view returns (uint256 ink, uint256 art);
    function ilks(bytes32 ilk)
        external
        view
        returns (address, uint256, uint256, uint256, uint256, uint256, uint256, uint256, uint256, uint256, uint256);
    function lock(bytes32 ilk, uint256 amount) external;
    function free(bytes32 ilk, uint256 amount) external;
    function draw(bytes32 ilk, uint256 wad) external;
    function wipe(bytes32 ilk, uint256 wad) external;
}

interface IPsmSpotter {
    function peek(bytes32 ilk) external view returns (uint256 price, bool ok);
}

interface IPsmToken {
    function balanceOf(address) external view returns (uint256);
    function approve(address, uint256) external returns (bool);
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
}

contract GoldPsm {
    uint256 internal constant WAD = 1e18;
    uint256 public constant MAX_FEE = 1e16; // 1%

    IPsmVault public immutable vault;
    IPsmToken public immutable bxau;
    address public immutable gem;
    bytes32 public immutable ilk; // this PSM's own ilk in the vault
    bytes32 public immutable pegIlk; // market-priced ilk of the same gem (0 = no depeg guard)
    uint256 internal immutable scale;

    address public owner; // GoldTimelock
    address public treasury;
    uint256 public tin; // fee on sellGem  [WAD fraction]
    uint256 public tout; // fee on buyGem  [WAD fraction]
    uint256 public floor; // min market price of the peg for sellGem  [WAD oz/token]

    uint256 private _lock = 1;

    event SellGem(address indexed usr, uint256 gemIn, uint256 bxauOut, uint256 fee);
    event BuyGem(address indexed usr, uint256 gemOut, uint256 bxauIn, uint256 fee);
    event Collect(address indexed treasury, uint256 amount);
    event SetFees(uint256 tin, uint256 tout);
    event SetFloor(uint256 floor);
    event SetTreasury(address treasury);
    event OwnershipTransferred(address indexed from, address indexed to);

    error NotOwner();
    error BadParam();
    error Depegged();
    error Slippage();
    error Reentrancy();
    error TransferFailed();

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

    constructor(
        address vault_,
        bytes32 ilk_,
        bytes32 pegIlk_,
        address owner_,
        address treasury_,
        uint256 tin_,
        uint256 tout_,
        uint256 floor_
    ) {
        if (tin_ > MAX_FEE || tout_ > MAX_FEE || treasury_ == address(0)) revert BadParam();
        vault = IPsmVault(vault_);
        bxau = IPsmToken(IPsmVault(vault_).bxau());
        ilk = ilk_;
        pegIlk = pegIlk_;
        (address g, uint256 s,,,,,,,,,) = IPsmVault(vault_).ilks(ilk_);
        if (g == address(0)) revert BadParam(); // the ilk must be initialised first
        gem = g;
        scale = s;
        owner = owner_;
        treasury = treasury_;
        tin = tin_;
        tout = tout_;
        floor = floor_;
        IPsmToken(IPsmVault(vault_).bxau()).approve(vault_, type(uint256).max); // vault burns on wipe
        emit OwnershipTransferred(address(0), owner_);
        emit SetFees(tin_, tout_);
        emit SetFloor(floor_);
        emit SetTreasury(treasury_);
    }

    // ═════════════════════════════════ swaps ═════════════════════════════════

    /// Give `gemAmt` of the peg (native units), receive bXAU 1:1 minus `tin`.
    function sellGem(uint256 gemAmt, uint256 minBxauOut) external nonReentrant returns (uint256 out) {
        if (!pegHealthy()) revert Depegged();
        uint256 got = _pullGem(gemAmt);
        _call(gem, abi.encodeWithSelector(0x095ea7b3, address(vault), got));
        (uint256 ink0,) = vault.urns(ilk, address(this));
        vault.lock(ilk, got);
        (uint256 ink1,) = vault.urns(ilk, address(this));
        uint256 wad = ink1 - ink0; // oz actually credited (after any transfer fee)
        vault.draw(ilk, wad);
        uint256 fee = wad * tin / WAD;
        out = wad - fee;
        if (out < minBxauOut) revert Slippage();
        if (!bxau.transfer(msg.sender, out)) revert TransferFailed();
        emit SellGem(msg.sender, gemAmt, out, fee);
    }

    /// Receive `gemAmt` of the peg (native units, before its own transfer fee), pay bXAU 1:1
    /// plus `tout`. Never blocked by the depeg guard.
    function buyGem(uint256 gemAmt, uint256 maxBxauIn) external nonReentrant returns (uint256 bxauIn) {
        uint256 wad = gemAmt * scale;
        uint256 fee = wad * tout / WAD;
        bxauIn = wad + fee;
        if (bxauIn > maxBxauIn) revert Slippage();
        if (!bxau.transferFrom(msg.sender, address(this), bxauIn)) revert TransferFailed();
        vault.wipe(ilk, wad);
        uint256 before = IPsmToken(gem).balanceOf(address(this));
        vault.free(ilk, gemAmt);
        uint256 got = IPsmToken(gem).balanceOf(address(this)) - before;
        _call(gem, abi.encodeWithSelector(0xa9059cbb, msg.sender, got));
        emit BuyGem(msg.sender, gemAmt, bxauIn, fee);
    }

    /// Send accumulated bXAU fees to the treasury. Permissionless.
    function collect() external nonReentrant returns (uint256 amount) {
        amount = bxau.balanceOf(address(this));
        if (amount != 0 && !bxau.transfer(treasury, amount)) revert TransferFailed();
        emit Collect(treasury, amount);
    }

    // ═════════════════════════════════ views ═════════════════════════════════

    /// Whether sellGem is open: the peg's market price is fresh and at or above `floor`.
    function pegHealthy() public view returns (bool) {
        if (pegIlk == bytes32(0)) return true;
        try IPsmSpotter(vault.spotter()).peek(pegIlk) returns (uint256 price, bool ok) {
            return ok && price >= floor;
        } catch {
            return false;
        }
    }

    /// Peg tokens currently backing PSM-minted bXAU (native units) = what buyGem can pay out.
    function reserves() external view returns (uint256) {
        (uint256 ink,) = vault.urns(ilk, address(this));
        return ink / scale;
    }

    // ═════════════════════════════════ admin ═════════════════════════════════

    function setFees(uint256 tin_, uint256 tout_) external onlyOwner {
        if (tin_ > MAX_FEE || tout_ > MAX_FEE) revert BadParam();
        tin = tin_;
        tout = tout_;
        emit SetFees(tin_, tout_);
    }

    function setFloor(uint256 floor_) external onlyOwner {
        floor = floor_;
        emit SetFloor(floor_);
    }

    function setTreasury(address t) external onlyOwner {
        if (t == address(0)) revert BadParam();
        treasury = t;
        emit SetTreasury(t);
    }

    function transferOwnership(address to) external onlyOwner {
        emit OwnershipTransferred(owner, to);
        owner = to;
    }

    // ═══════════════════════════════ internals ═══════════════════════════════

    function _pullGem(uint256 amount) internal returns (uint256) {
        uint256 before = IPsmToken(gem).balanceOf(address(this));
        _call(gem, abi.encodeWithSelector(0x23b872dd, msg.sender, address(this), amount));
        return IPsmToken(gem).balanceOf(address(this)) - before;
    }

    function _call(address token, bytes memory data) internal {
        (bool ok, bytes memory ret) = token.call(data);
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert TransferFailed();
    }
}
