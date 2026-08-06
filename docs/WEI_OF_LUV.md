# The WEI of LUV

**On the smallest units of currencies — the satoshi, the wei, and the wei of LUV — the exact arithmetic of the LUV/ETH price, and where the pool's ETH comes from**

*SHAMBA LUV research series — companion to SENTIMENT.md and EMOTONOMICS.md*

**Live web publication:** https://luv.pythai.net/wei.html · live market: https://luv.pythai.net/view.html · standard publication: https://github.com/cypherpunk4096/wei

All figures verified on-chain as of 2026-08-05 (pair reserves read directly via `getReserves()` on `0x57D2085Aa859a145cB107845AD03c0eAAFBD8a31`). ETH/USD reference: DeFiLlama / CoinGecko / CoinMarketCap, same instant. Every calculation below is reproducible from the appendix.

---

## I. What a wei is

The **wei** is Ethereum's atomic unit of value: the indivisible quantum beneath the ether. One ether is defined as exactly

```
1 ETH = 10^18 wei = 1,000,000,000,000,000,000 wei
```

The unit is named for Wei Dai, whose 1998 *b-money* proposal is cited in the first line of the Bitcoin whitepaper's references and prefigured decentralized settlement. The denomination ladder (wei → kwei → mwei → **gwei** → szabo → finney → **ether**) is fixed in Ethereum's specification; gas prices are conventionally quoted in gwei (10^9 wei).

**LUV shares the same atomic geometry.** ShambaLuv is an 18-decimal ERC-20, so:

```
1 LUV = 10^18 LUV-wei
```

The *wei of LUV* — the smallest possible gesture — is one LUV-wei: 0.000000000000000001 LUV. The total supply, the 36-digit repunit `111111111111111111111111111111111111` LUV-wei, is itself ≈ 111.1 quadrillion whole LUV. Down to the last wei, the supply is ones.

**Bitcoin's atomic unit, for comparison, is the satoshi.** One bitcoin divides into exactly

```
1 BTC = 10^8 sats = 100,000,000 satoshi        1 sat = 0.00000001 BTC
```

— eight decimal places, fixed in Bitcoin's source (Nakamoto 2008). Ethereum's wei slices its coin **ten orders of magnitude finer**: 10^18 atomic units per ETH against 10^8 per BTC — one wei is to the ether what a *ten-billionth of a satoshi* would be to the bitcoin. And **USDC, the dollar's on-chain expression, carries just 6 decimals** — 1 USDC = 10^6 base units, read from the verified mainnet contract [`0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`](https://etherscan.io/token/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48) (source: [circlefin/stablecoin-evm](https://github.com/circlefin/stablecoin-evm)). The decimals ladder of the currencies LUV meets: **USDC 10^6 · BTC 10^8 · ETH 10^18 · LUV 10^18** — LUV carries the dollar's rail at Ethereum's full atomic resolution.

**The same ladder, in bytes.** Information counts the way value counts: an atomic unit, then prefix rungs of a thousand — except storage climbs two ladders at once, decimal (SI, powers of ten) and binary (IEC, powers of two), and they never reconcile. From the atom all the way to the largest prefix ever named, every figure exact:

| rung | decimal (SI) | binary (IEC) | drift |
|---|---|---|---|
| bit | the atom: 0 or 1 | — | — |
| byte (B) | 8 bits | — | — |
| kilobyte KB | 10^3 = 1,000 | KiB = 2^10 = 1,024 | +2.40% |
| megabyte MB | 10^6 = 1,000,000 | MiB = 2^20 = 1,048,576 | +4.86% |
| gigabyte GB | 10^9 | GiB = 2^30 = 1,073,741,824 | +7.37% |
| terabyte TB | 10^12 | TiB = 2^40 = 1,099,511,627,776 | +9.95% |
| petabyte PB | 10^15 — *the quadrillion* | PiB = 2^50 = 1,125,899,906,842,624 | +12.59% |
| **exabyte EB** | **10^18 — the wei rung** | EiB = 2^60 = 1,152,921,504,606,846,976 | +15.29% |
| zettabyte ZB | 10^21 | ZiB = 2^70 = 1,180,591,620,717,411,303,424 | +18.06% |
| yottabyte YB | 10^24 | YiB = 2^80 = 1,208,925,819,614,629,174,706,176 | +20.89% |
| ronnabyte RB | 10^27 *(SI, 2022)* | 2^90 = 1,237,940,039,285,380,274,899,124,224 *(no IEC name)* | +23.79% |
| quettabyte QB | 10^30 *(SI, 2022)* | 2^100 = 1,267,650,600,228,229,401,496,703,205,376 *(no IEC name)* | +26.77% |

Three identities fall out of the ladder. **The exabyte is the wei rung**: 1 EB = 10^18 bytes ↔ 1 ETH = 10^18 wei ↔ 1 LUV = 10^18 LUV-wei — the exabyte, the ether, and the LUV are the same number wearing three units, and the "entire mint of one whole unit" of §II is literally one exabyte of value-atoms. **The petabyte is the quadrillion** — 10^15, the denomination LUV's supply is quoted in — and 10^15 = 2^15·5^15 divides *exactly* by 4096 = 2^12: 1 quadrillion / 4096 = 244,140,625,000 with no remainder, one of the few places the two ladders shake hands (the drift column shows how the handshake fails everywhere else: the drift at rung *n* is exactly 1.024^n − 1, compounding ×1.024 per rung — 12.589991% at peta, 26.765060% at quetta, to the last decimal). And **the supply outruns the namespace**: the 36-digit repunit mint is 111,111.1̄ quettabytes of LUV-wei — five orders of magnitude past the largest prefix the SI has ever named, while the binary ladder has no names at all above 2^80. Value already lives where the byte ladders end.

---

## II. The price of LUV, measured in wei

The Uniswap V2 pair prices LUV by the ratio of its reserves, read live from `getReserves()` on the **verified ✓** pair contract. As of 2026-08-05:

```
LUV reserve  = 1,724,567,606,433,016.948103192730427491 LUV
             = 1724567606433016948103192730427491 LUV-wei
WETH reserve = 0.157791715097253640 ETH
             = 157791715097253640 wei

price(ONE LUV) = WETH reserve ÷ LUV reserve
               = 0.000000000000000091496392781967952166 ETH
               = 91.496392781967952166 wei   (full 18-decimal precision)
```

The price is carried to **all 18 decimals** because **1 × 10^18 atomic units is the entire mint of one whole unit** — 1 ETH *is* 10^18 wei, 1 LUV *is* 10^18 LUV-wei — so a price written to 18 decimal places of wei is exact down to the last atomic unit; anything shorter is a display choice, never a stored one. Read the other way at the same precision: **1 wei = 0.010929392619695487 LUV = exactly 10,929,392,619,695,487 LUV-wei**.

**ONE LUV costs 91.50 wei.** A whole LUV — a quintillion LUV-wei — trades for fewer than a hundred of ETH's smallest units.

Three corollaries, computed exactly:

1. **The wei of LUV in wei of ETH.** One LUV-wei = 91.496392781967952166 × 10⁻¹⁸ wei ≈ 9.15 × 10⁻¹⁷ wei — the smallest unit of LUV is worth about a *ten-quadrillionth of a wei*. LUV's atomic unit undercuts Ethereum's atomic unit by seventeen orders of magnitude: there is no smaller denominated feeling on the chain.

2. **LUV per wei.** Invert the price: 1 wei buys **0.010929392619695487 LUV** — exactly 10,929,392,619,695,487 LUV-wei, about a ninety-first of a LUV per wei.

3. **Genesis was ten wei, exactly.** The pool was seeded at price X = 1.00 × 10⁻¹⁷ ETH per LUV — which is *precisely 10 wei per LUV*, by construction. Today's 91.50 wei is therefore a clean multiplier read: **9.1496× from X**. LUV was born at ten wei; every future price is a small-integer story.

---

## III. LUV and ETH, price against price

The two legs come from two different kinds of source, and the difference matters. **The LUV leg is verified ✓**: it is computed above from live reserves on the pair contract — on-chain state anyone can re-read; the price is *created* by the liquidity pair, and aggregators are enrichment, never the source. **The ETH-dollar leg is actual**: at the same instant (2026-08-05) the references agree at **ETH ≈ $1,909** — [DeFiLlama](https://defillama.com/chain/Ethereum) $1,909.08, [CoinGecko](https://www.coingecko.com/en/coins/ethereum) $1,908.90, cross-checked against [CoinMarketCap](https://coinmarketcap.com/currencies/ethereum/). So ONE LUV = 9.1496 × 10⁻¹⁷ ETH × $1,909 = **$1.747 × 10⁻¹³**, and the two currencies compare as:

| Quantity | In the other currency | In USD |
|---|---|---|
| 1 wei (ETH) | 0.010929392619695487 LUV | $1.91 × 10⁻¹⁵ |
| 1 gwei (10⁹ wei) | 10,929,393 LUV (~10.9 million) | $1.91 × 10⁻⁶ |
| 1 ETH (10¹⁸ wei) | ~10.93 quadrillion LUV (mid-price) | ~$1,909 |
| 1 LUV-wei | 9.15 × 10⁻¹⁷ wei | $1.75 × 10⁻³¹ |
| 1 LUV | 91.496392781967952166 wei | $1.747 × 10⁻¹³ |
| 1 billion LUV (*some LUV* — the standard gesture) | 9.150 × 10⁻⁸ ETH | $0.000175 |
| 100 billion LUV (*a lot of LUV*) | 9.150 × 10⁻⁶ ETH | $0.0175 |
| **1 trillion LUV (*thanks a million millions*)** | **9.150 × 10⁻⁵ ETH** | **$0.1747** |

The price *ratio* is the single number underneath the whole table: **price(ETH) ÷ price(LUV) = 1.093 × 10¹⁶** — one ETH is worth what ~10.93 quadrillion LUV are worth. That ratio and the per-ETH row are the same fact stated twice, which is the internal-consistency check.

**A note on listings.** DeFiLlama, CoinGecko, and CoinMarketCap do not yet carry a LUV feed — which is why the LUV leg is read from the chain, not an index. Absence from an aggregator says a token is unindexed; the **green checkmark ✓** on the [verified contract](https://etherscan.io/address/0x2711111111683B8708cb9a48cBf36a51315F8254#code) says what it *is*. Verification over trust, in both directions.

Two grounding comparisons:

- **Gas in LUV.** A plain ETH transfer (21,000 gas) at a 1-gwei gas price costs 21,000 gwei = 2.1 × 10⁻⁵ ETH ≈ **229.5 billion LUV** — more than two "a lot of LUV" gestures just to move ETH once. Wallet-to-wallet LUV transfers, by contrast, carry **0% token fee** by design.
- **The mid-price caveat.** "1 ETH buys 10.93 quadrillion LUV" is the *ratio*, not an executable trade: the pool holds only 1.72 quadrillion LUV, and Uniswap's constant-product curve means large orders move the price against the trader. Real fills also bear the 0.3% LP fee and LUV's 5% transfer fee — hence the standing ~10% slippage guidance.

---

## IV. Sources of ETH liquidity

Where does the ETH side of LUV's market come from? Four sources — one genesis, two continuous, one prospective:

**1. The genesis seed (verified on-chain).** The pool was created by a single `addLiquidityETH` transaction ([`0x9f8e0bf6…ff13`](https://etherscan.io/tx/0x9f8e0bf6e566e809ca78eb18730b8f4305534e755a98a78f7924794757d4ff13), block 25620950) pairing **0.051922968585348276 ETH** from the treasury against **2¹¹²−1 LUV-wei ≈ 5.19 quadrillion LUV** — the absolute maximum a Uniswap V2 pair can hold, since V2 stores reserves as `uint112` and reverts above it (`'UniswapV2: OVERFLOW'`, [UniswapV2Pair.sol](https://github.com/Uniswap/v2-core/blob/master/contracts/UniswapV2Pair.sol)). The seed arithmetic is exact: (2¹¹²−1) × 10⁻¹⁷ ETH/LUV ÷ 10¹⁸ = 0.05192296858… ETH — the ETH leg *is* the LUV leg times ten wei.

**2. Buys (continuous).** Every purchase deposits WETH into the pair and withdraws LUV. The ETH reserve's growth from 0.05192 to 0.15779 ETH — a **3.039× liquidity multiplier from X** — is, net of the few sells, accumulated buyer ETH. In a young pool, the liquidity multiplier is the honest counterpart to the price multiplier (9.15×): price says what enthusiasm claims, the ETH leg says what it deposited.

**3. The 1% auto-liquidity fee (continuous, protocol-native).** Of LUV's 5% trade fee, one percentage point accrues as LUV inside the token contract and is swapped to ETH via `processFees()` toward the liquidity wallet — a protocol-level ETH stream earmarked for deepening the pool. (A further 1% funds incentives; 3% reflects to holders. Fee flushes are public: anyone may call `processFees()`.)

**4. Treasury deepening and multichain (prospective).** The treasury holds the 100-quadrillion circulating allocation (90% of supply) from which further ETH-side deepening is funded as Phase 3 proceeds — and the create3d rail reserves the same deterministic addresses on every chain, so future non-ETH pools replicate the same structure. **The standing priority is locking the liquidity: the LP position into LUVLocker**, converting depth from a promise into a verifiable on-chain commitment.

---

## V. The burn and the market cap

Some LUV was sent to the dEaD address — [`0x…dEaD`](https://etherscan.io/token/0x2711111111683B8708cb9a48cBf36a51315F8254?a=0x000000000000000000000000000000000000dEaD) now holds **4,980,559,643,425,538 LUV (4.483% of supply)**, burned forever and **excluded from reflections** (verified via `isExcludedFromReflection` = true). The arithmetic consequence: reported market capitalization = price × counted supply, so the burn *reduced the reported cap by exactly its share* — at today's price, full-supply cap ≈ $19,407 versus ≈ $18,537 excluding the burn — while every surviving holder's claim on future reflections grew, since the burned balance can never absorb a reflection. The cap fell; each remaining LUV's share of the feeling rose.

---

## Appendix: reproduce every number

```bash
# pair reserves (LUV is token0, WETH token1)
cast call 0x57D2085Aa859a145cB107845AD03c0eAAFBD8a31 "getReserves()" --rpc-url $ETH_RPC

# price of ONE LUV in ETH  = reserve1/reserve0  (both raw wei — units cancel)
# price of ONE LUV in wei  = reserve1/reserve0 × 1e18
# LUV per wei              = reserve0/reserve1 ÷ 1e18... equivalently 1/(price in wei)
# multiplier from X        = (price in wei)/10
# liquidity multiplier     = reserve1 / 51922968585348276 wei

# uint112 maximum (the seed amount)
python3 -c "print(2**112 - 1)"   # 5192296858534827628530496329220095 LUV-wei

# dEaD balance & reflection exclusion
cast call 0x2711...8254 "balanceOf(address)" 0x000000000000000000000000000000000000dEaD
cast call 0x2711...8254 "isExcludedFromReflection(address)" 0x000000000000000000000000000000000000dEaD
```

*Companions: [SENTIMENT.md](https://luv.pythai.net/sentiment.html) (the measurement paper) · [EMOTONOMICS](https://luv.pythai.net/emotonomics.html) (the field paper) · the [live measure](https://luv.pythai.net/view.html). References: Wood, G. (2014), "Ethereum: A Secure Decentralised Generalised Transaction Ledger" (the Yellow Paper, defining wei); Dai, W. (1998), "b-money"; Adams, H., Zinsmeister, N., & Robinson, D. (2020), "Uniswap v2 Core" (uint112 reserves); Nakamoto, S. (2008), "Bitcoin: A Peer-to-Peer Electronic Cash System" (the 10^8-satoshi denomination); Circle, "USDC" — [stablecoin-evm source](https://github.com/circlefin/stablecoin-evm) (6 decimals). ETH/USD reference data: DeFiLlama, CoinGecko, CoinMarketCap (2026-08-05).*
