// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/*
 * PegSpotter — prices each gold-peg collateral in OUNCES OF GOLD (not dollars).
 *
 * The debt token (bXAU) is denominated in troy ounces, so what matters for solvency is how
 * many ounces one collateral token is worth, i.e. how well each existing peg holds its peg:
 *
 *     price(ilk) = min( par ,  pegUSD / xauUSD * par / 1e18 )         [WAD, oz per token]
 *
 *   par     — ounces the issuer redeems per token (PAXG = XAUT = 1 oz → 1e18).
 *   pegUSD  — Chainlink feed for the peg token itself (e.g. PAXG / USD). Optional: with no
 *             feed the peg is taken at par ("from existing pegs").
 *   xauUSD  — Chainlink XAU / USD, shared by every ilk.
 *
 * The min(par, …) cap means a peg trading at a premium is never valued above the gold it
 * redeems for; a peg trading at a discount is valued at the discount, so depegs reduce
 * borrowing power and trigger liquidation as they should.
 *
 * Feeds older than `maxAge` or non-positive answers make peek() report ok=false; the vault
 * then refuses anything that needs a price (draw, free with debt, liquidate).
 *
 * Mainnet (verified on-chain 2026-11-07):
 *   XAU / USD   0x214eD9Da11D2fbe465a6fc601a91E62EbEc1a0D6
 *   PAXG / USD  0x9944D86CEB9160aF5C5feB251FD671923323f8C3
 */
interface IAggregatorV3 {
    function decimals() external view returns (uint8);
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

contract PegSpotter {
    uint256 internal constant WAD = 1e18;

    struct Src {
        address feed; // peg/USD aggregator, or address(0) = price at par
        uint32 maxAge; // staleness bound for `feed` (seconds)
        uint256 par; // oz per whole token, WAD
    }

    address public owner;
    address public xauUsd; // XAU / USD aggregator
    uint32 public xauMaxAge;
    mapping(bytes32 => Src) public srcs;

    event OwnershipTransferred(address indexed from, address indexed to);
    event FileXau(address feed, uint32 maxAge);
    event FileSrc(bytes32 indexed ilk, address feed, uint32 maxAge, uint256 par);

    error NotOwner();
    error BadPar();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address xauUsd_, uint32 xauMaxAge_) {
        owner = msg.sender;
        xauUsd = xauUsd_;
        xauMaxAge = xauMaxAge_;
        emit OwnershipTransferred(address(0), msg.sender);
        emit FileXau(xauUsd_, xauMaxAge_);
    }

    function transferOwnership(address to) external onlyOwner {
        emit OwnershipTransferred(owner, to);
        owner = to; // address(0) renounces: sources become immutable
    }

    function fileXau(address feed, uint32 maxAge) external onlyOwner {
        xauUsd = feed;
        xauMaxAge = maxAge;
        emit FileXau(feed, maxAge);
    }

    function fileSrc(bytes32 ilk, address feed, uint32 maxAge, uint256 par) external onlyOwner {
        if (par == 0) revert BadPar();
        srcs[ilk] = Src(feed, maxAge, par);
        emit FileSrc(ilk, feed, maxAge, par);
    }

    /// @return price oz of gold per whole collateral token (WAD)
    /// @return ok    false if the ilk is unknown or any feed it needs is stale / invalid
    function peek(bytes32 ilk) external view returns (uint256 price, bool ok) {
        Src memory s = srcs[ilk];
        if (s.par == 0) return (0, false);
        if (s.feed == address(0)) return (s.par, true);

        (uint256 peg, bool okPeg) = _read(s.feed, s.maxAge);
        (uint256 xau, bool okXau) = _read(xauUsd, xauMaxAge);
        if (!okPeg || !okXau) return (0, false);

        price = peg * s.par / xau; // both normalised to WAD
        if (price > s.par) price = s.par;
        ok = price > 0;
    }

    function _read(address feed, uint32 maxAge) internal view returns (uint256 wad, bool ok) {
        if (feed == address(0)) return (0, false);
        try IAggregatorV3(feed).latestRoundData() returns (uint80, int256 answer, uint256, uint256 updatedAt, uint80) {
            if (answer <= 0 || updatedAt == 0 || updatedAt > block.timestamp) return (0, false);
            if (block.timestamp - updatedAt > maxAge) return (0, false);
            try IAggregatorV3(feed).decimals() returns (uint8 d) {
                wad = d <= 18 ? uint256(answer) * 10 ** (18 - d) : uint256(answer) / 10 ** (d - 18);
                ok = wad > 0;
            } catch {
                return (0, false);
            }
        } catch {
            return (0, false);
        }
    }
}
