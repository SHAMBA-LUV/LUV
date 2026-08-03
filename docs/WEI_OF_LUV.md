# The WEI of LUV

**On the smallest units of two currencies, the exact arithmetic of the LUV/ETH price, and where the pool's ETH comes from**

*SHAMBA LUV research series — companion to SENTIMENT.md and EMOTONOMICS.md*

**Live web publication:** https://luv.pythai.net/wei.html · live market: https://luv.pythai.net/view.html

All figures verified on-chain as of 2026-08-03 (pair reserves read directly via `getReserves()` on `0x57D2085Aa859a145cB107845AD03c0eAAFBD8a31`). Every calculation below is reproducible from the appendix.

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

---

## II. The price of LUV, measured in wei

The Uniswap V2 pair prices LUV by the ratio of its reserves. As of 2026-08-03:

```
LUV reserve  = 1,974,737,045,122,436.055870997958171794 LUV
             = 1974737045122436055870997958171794 LUV-wei
WETH reserve = 0.137747730452916271 ETH
             = 137747730452916271 wei

price(ONE LUV) = WETH reserve ÷ LUV reserve
               = 137747730452916271 / 1974737045122436.055… 
               = 6.975497 × 10⁻¹⁷ ETH
               = 69.754974 wei
```

**ONE LUV costs 69.75 wei.** A whole LUV — a quintillion LUV-wei — trades for less than seventy of ETH's smallest units.

Three corollaries, computed exactly:

1. **The wei of LUV in wei of ETH.** One LUV-wei = 69.754974 × 10⁻¹⁸ wei ≈ 6.98 × 10⁻¹⁷ wei — the smallest unit of LUV is worth about a *ten-quadrillionth of a wei*. LUV's atomic unit undercuts Ethereum's atomic unit by seventeen orders of magnitude: there is no smaller denominated feeling on the chain.

2. **LUV per wei.** Invert the price: 1 wei buys 1/69.754974 = **0.014336 LUV** — about a seventieth of a LUV per wei.

3. **Genesis was ten wei, exactly.** The pool was seeded at price X = 1.00 × 10⁻¹⁷ ETH per LUV — which is *precisely 10 wei per LUV*, by construction. Today's 69.75 wei is therefore a clean multiplier read: **6.9755× from X**. LUV was born at ten wei; every future price is a small-integer story.

---

## III. LUV and ETH, price against price

Using the pair's own USD leg (mirror snapshot, same instant): ONE LUV = $1.358 × 10⁻¹³, and the implied ETH price is $1,946.9 (= priceUsd ÷ priceNative). The two currencies compare as:

| Quantity | In the other currency | In USD |
|---|---|---|
| 1 wei (ETH) | 0.014336 LUV | $1.95 × 10⁻¹⁵ |
| 1 gwei (10⁹ wei) | 14,335,895 LUV (~14.3 million) | $1.95 × 10⁻⁶ |
| 1 ETH (10¹⁸ wei) | 14,335,895,325,675,972 LUV (~14.34 quadrillion, mid-price) | ~$1,947 |
| 1 LUV-wei | 6.98 × 10⁻¹⁷ wei | $1.36 × 10⁻³¹ |
| 1 LUV | 69.754974 wei | $1.358 × 10⁻¹³ |
| 1 billion LUV (*some LUV* — the standard gesture) | 6.975 × 10⁻⁸ ETH | $0.000136 |
| 100 billion LUV (*a lot of LUV*) | 6.975 × 10⁻⁶ ETH | $0.0136 |
| **1 trillion LUV (*thanks a million millions*)** | **6.975 × 10⁻⁵ ETH** | **$0.1358** |

The price *ratio* is the single number underneath the whole table: **price(ETH) ÷ price(LUV) = 1.434 × 10¹⁶** — one ETH is worth what ~14.34 quadrillion LUV are worth. That ratio and the per-ETH row are the same fact stated twice, which is the internal-consistency check.

Two grounding comparisons:

- **Gas in LUV.** A plain ETH transfer (21,000 gas) at a 1-gwei gas price costs 21,000 gwei = 2.1 × 10⁻⁵ ETH ≈ **301 billion LUV** — three "a lot of LUV" gestures just to move ETH once. Wallet-to-wallet LUV transfers, by contrast, carry **0% token fee** by design.
- **The mid-price caveat.** "1 ETH buys 14.34 quadrillion LUV" is the *ratio*, not an executable trade: the pool holds only 1.97 quadrillion LUV, and Uniswap's constant-product curve means large orders move the price against the trader. Real fills also bear the 0.3% LP fee and LUV's 5% transfer fee — hence the standing ~10% slippage guidance.

---

## IV. Sources of ETH liquidity

Where does the ETH side of LUV's market come from? Four sources — one genesis, two continuous, one prospective:

**1. The genesis seed (verified on-chain).** The pool was created by a single `addLiquidityETH` transaction ([`0x9f8e0bf6…ff13`](https://etherscan.io/tx/0x9f8e0bf6e566e809ca78eb18730b8f4305534e755a98a78f7924794757d4ff13), block 25620950) pairing **0.051922968585348276 ETH** from the treasury against **2¹¹²−1 LUV-wei ≈ 5.19 quadrillion LUV** — the absolute maximum a Uniswap V2 pair can hold, since V2 stores reserves as `uint112` and reverts above it (`'UniswapV2: OVERFLOW'`, [UniswapV2Pair.sol](https://github.com/Uniswap/v2-core/blob/master/contracts/UniswapV2Pair.sol)). The seed arithmetic is exact: (2¹¹²−1) × 10⁻¹⁷ ETH/LUV ÷ 10¹⁸ = 0.05192296858… ETH — the ETH leg *is* the LUV leg times ten wei.

**2. Buys (continuous).** Every purchase deposits WETH into the pair and withdraws LUV. The ETH reserve's growth from 0.05192 to 0.13775 ETH — a **2.653× liquidity multiplier from X** — is, net of the few sells, accumulated buyer ETH. In a young pool, the liquidity multiplier is the honest counterpart to the price multiplier (6.98×): price says what enthusiasm claims, the ETH leg says what it deposited.

**3. The 1% auto-liquidity fee (continuous, protocol-native).** Of LUV's 5% trade fee, one percentage point accrues as LUV inside the token contract and is swapped to ETH via `processFees()` toward the liquidity wallet — a protocol-level ETH stream earmarked for deepening the pool. (A further 1% funds incentives; 3% reflects to holders. Fee flushes are public: anyone may call `processFees()`.)

**4. Treasury deepening and multichain (prospective).** The treasury holds the 100-quadrillion circulating allocation (90% of supply) from which further ETH-side deepening is funded as Phase 3 proceeds — and the create3d rail reserves the same deterministic addresses on every chain, so future non-ETH pools replicate the same structure. **The standing priority is locking the liquidity: the LP position into LUVLocker**, converting depth from a promise into a verifiable on-chain commitment.

---

## V. The burn and the market cap

Some LUV was sent to the dEaD address — [`0x…dEaD`](https://etherscan.io/token/0x2711111111683B8708cb9a48cBf36a51315F8254?a=0x000000000000000000000000000000000000dEaD) now holds **4,980,559,643,425,538 LUV (4.483% of supply)**, burned forever and **excluded from reflections** (verified via `isExcludedFromReflection` = true). The arithmetic consequence: reported market capitalization = price × counted supply, so the burn *reduced the reported cap by exactly its share* — at today's price, full-supply cap ≈ $15,089 versus ≈ $14,413 excluding the burn — while every surviving holder's claim on future reflections grew, since the burned balance can never absorb a reflection. The cap fell; each remaining LUV's share of the feeling rose.

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

*Companions: [SENTIMENT.md](https://luv.pythai.net/sentiment.html) (the measurement paper) · [EMOTONOMICS](https://luv.pythai.net/emotonomics.html) (the field paper) · the [live measure](https://luv.pythai.net/view.html). References: Wood, G. (2014), "Ethereum: A Secure Decentralised Generalised Transaction Ledger" (the Yellow Paper, defining wei); Dai, W. (1998), "b-money"; Adams, H., Zinsmeister, N., & Robinson, D. (2020), "Uniswap v2 Core" (uint112 reserves); Nakamoto, S. (2008).*
