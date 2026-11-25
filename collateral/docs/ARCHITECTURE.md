# Architecture

How the contracts and bots fit together. For usage, see the [README](../README.md).

## Components

```
                         ┌────────────────────────── governance ───────────────────────────┐
                         │  GOV multisig                                                   │
                         │    ├─ schedules ─▶ GoldTimelock ──(after delay)──▶ owner/ward of│
                         │    │                 vault · spotter · flash · both pools       │
                         │    ├─ fire() ────▶ GoldGuardian ──▶ vault.cage()   (instant)    │
                         │    └─ setPaused(true) ──▶ pools                    (instant)    │
                         └─────────────────────────────────────────────────────────────────┘

  borrower ──lock/draw/wipe/free──▶ ┌───────────┐ ──mint/burn──▶ ┌────────────┐
  keeper ─────liquidate──────────▶ │ GoldVault │                │ BasketGold │  bXAU (1 = 1 oz)
  holder ─────cash (shutdown)────▶ └─────┬─────┘ ◀─mint/burn─── └────────────┘
                                         │ peek(ilk)                 ▲ flash-mint (net zero)
                                   ┌─────▼──────┐              ┌─────┴─────┐
   Chainlink XAU/USD, PAXG/USD ──▶ │ PegSpotter │              │ GoldFlash │ ◀── FlashKeeper
                                   └────────────┘              └───────────┘        │ sells seized
                                                                                    ▼ collateral
  LP ──add/remove liquidity──▶ ┌────────────────┐ ──staker fees──▶ ┌─────────────────────┐
  trader ──exchange──────────▶ │ GoldStablePool │                  │ GoldLiquidityLocker │
                               │ (bXAU / peg)   │ ◀──LP tokens──── │ Bronze/Silver/Gold  │ ◀── LP
                               └────────────────┘                  └─────────────────────┘
```

| Contract | Role | Privileged roles |
|---|---|---|
| `BasketGold` | bXAU, the debt token. | Minters: `GoldVault`, `GoldFlash`. No governance minter. |
| `PegSpotter` | Prices each collateral in ounces from Chainlink feeds. | Owner: timelock. |
| `GoldVault` | Positions, fees, liquidation, surplus, shutdown. | Wards: timelock (everything), guardian (cage only). |
| `GoldTimelock` | Delays every governance call. | Admin: `GOV`. Delay and admin change only through itself. |
| `GoldGuardian` | Instant shutdown. | Owner: `GOV`. |
| `GoldFlash` | ERC-3156 flash-mint of bXAU. | Owner: timelock (ceiling only). |
| `FlashKeeper` | Capital-free liquidator, one per keeper operator. | Owner: the operator. |
| `GoldStablePool` | StableSwap market for bXAU against a peg; its own LP token. | Owner: timelock. Pauser: `GOV` (pause only). Fee receiver: locker. |
| `GoldLiquidityLocker` | Three-tier lock sharing the pool's staker fees. | None. Immutable. |

## Main flows

**Borrow.** `lock` credits collateral by balance delta. `draw` drips fees, reads the price, checks the
depeg floor, both ceilings, dust and the liquidation ratio, then mints bXAU.

**Liquidate.** `liquidate` requires the position to be unsafe at the current price with fees included.
The keeper burns bXAU and receives collateral worth `chop` times as much. If the collateral cannot cover
the discount but still covers the debt, the keeper repays everything and takes everything. Only when the
collateral is worth less than the debt is the remainder written to `sin`.

**Flash liquidation.** `FlashKeeper.run` → `GoldFlash.flashLoan` mints bXAU → `vault.liquidate` →
sell collateral in `GoldStablePool.exchange` → profit and repayment checks → `GoldFlash` burns the loan.
Any failure reverts the whole transaction.

**Fees to LPs.** Each pool fee is split. One part stays in pool balances and raises the LP token's
virtual price. The other part accrues in `stakerFees`; the locker collects it whenever anyone interacts
with the locker and credits it per unit of tier weight.

**Shutdown.** `cage` tags each collateral at its oracle price or the last good price. `skim` settles
each position's debt into the redemption pool. `thaw` opens redemptions. `cash` pays a pro-rata share of
the remaining pool. `sweep` returns leftover fee collateral once no bXAU remains.

## Units

| Unit | Scale | Used for |
|---|---|---|
| WAD | 1e18 | Token amounts, prices, `chop`, ceilings. |
| RAY | 1e27 | `rate`, `duty`, `mat`. |
| RAD | 1e45 | `debt`, `surplus`, `sin`. |
| Pool fee | 1e10 | `fee`, `stakerShare`. |
| Pool A | ×100 | `initialA`, `futureA`. |
| Locker weight | bps of LP | Tier multipliers 10,000 / 20,000 / 30,000. |

## Off-chain

| Bot | Reads | Writes |
|---|---|---|
| `keeper.mjs` | `Lock` events, `isSafe`, `owed`, `peek`, pool quotes | `liquidate` or `FlashKeeper.run` |
| `monitor.mjs` | All governance and pool events, health views | Nothing on-chain; stdout and webhook |
