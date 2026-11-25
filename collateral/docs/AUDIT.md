# Audit brief

Prepared for an independent reviewer. The code has **not** been audited.

## Scope

| File | Lines | Notes |
|---|---|---|
| `src/GoldVault.sol` | ~620 | Core accounting. Highest priority. |
| `src/GoldStablePool.sol` | ~570 | Curve 2-coin StableSwap maths, re-implemented in Solidity. |
| `src/GoldLiquidityLocker.sol` | ~340 | Reward accounting over two reward tokens. |
| `src/PegSpotter.sol` | ~130 | Chainlink reads, staleness, par cap. |
| `src/GoldFlash.sol` | ~100 | ERC-3156 lender with mint rights. |
| `src/FlashKeeper.sol` | ~145 | Arbitrary external call to an owner-chosen router. |
| `src/GoldTimelock.sol` | ~100 | |
| `src/BasketGold.sol` | ~115 | |
| `src/GoldGuardian.sol` | ~45 | |
| `script/*.s.sol` | | Deployment wiring and its assertions. |

Out of scope: `test/`, `keeper/` (off-chain; cannot move user funds).

Compiler: Solidity 0.8.24, optimizer 200 runs, `via_ir`. No external libraries.

## Invariants

Each is enforced by a property test in `test/fuzz/` (500 runs by default; CI runs 5,000).

| # | Invariant | Test |
|---|---|---|
| V1 | `debt + sin == bXAU.totalSupply · RAY + surplus` while live | `VaultFuzz.testFuzz_AccountingInvariants` |
| V2 | For each ilk, `Art == Σ urn.art` | same |
| V3 | `debt == Σ Art · rate` | same |
| V4 | The vault holds at least `Σ ink + pool` of each collateral | same |
| V5 | A successful `draw` leaves the position at or above `mat` | `testFuzz_DrawRespectsRatio` |
| V6 | `sin` grows only when collateral is worth less than the debt | `testFuzz_NoBadDebtWhileSolvent` |
| V7 | After any history, shutdown completes: all collateral can be freed and all bXAU cashed | `testFuzz_ShutdownRedeemsEverything` |
| P1 | LP virtual price never decreases | `PoolFuzz.testFuzz_VirtualPriceMonotoneAndSolvent` |
| P2 | Pool token balances cover `balances + stakerFees` | same |
| P3 | Proportional withdrawal never reverts | same |
| P4 | Swap round trips and single-asset in/out never return more value than put in | `testFuzz_SwapRoundTripNeverProfits`, `testFuzz_SingleAssetInOutNeverProfits` |
| P5 | `getDy`, `calcTokenAmount`, `calcWithdrawOneCoin` equal execution; `getDx` covers the target | `testFuzz_QuotesMatchExecution`, `testFuzz_GetDxCoversRequestedOutput` |
| L1 | `totalWeight == Σ weight`, `totalLocked == Σ amount == LP held` | `LockerFuzz.testFuzz_RewardsConservedAndExitsAlwaysWork` |
| L2 | Total rewards paid never exceed rewards harvested; every expired position can exit | same |

## Bugs already found and fixed

| Version | Finding | Fix |
|---|---|---|
| 0.2.0 | Ten review findings in the vault and deploy script (bad debt from solvent positions, par fallback at shutdown, unbounded fee bricking shutdown, stuck collateral, lost redemption dust, and others). | See `CHANGELOG.md`. |
| 0.5.0 | `addLiquidity` aliased a memory array and charged balanced deposits an imbalance fee. | Explicit copy. |
| 0.6.0 | **Locker could be 1 wei short.** The "reward debt" formula can over-pay by 1 wei per settlement, so the last withdrawal could revert and lock LP tokens. Found by fuzzing. | Rewards are now `weight × Δacc`, rounded down. `emergencyWithdraw` added so principal never depends on a reward transfer. |
| 0.6.1 | Pool minimum-out limits were checked before the output token's transfer fee, so a user could receive slightly less than their minimum. | Limits are checked on the amount actually received. |

## Trust assumptions

- `GOV` is trusted, with a public delay on everything except shutdown and pool pause.
- Chainlink XAU/USD and PAXG/USD are trusted within their staleness bounds. There is no additional
  price delay.
- XAUT is valued at par inside the vault. A depeg is not visible on-chain; its ceiling is small and its
  ratio high for that reason.
- PAXG and XAUT are upgradeable, pausable tokens with blacklists. If an issuer freezes the vault or a
  pool, that collateral is stuck. This risk is inherited and cannot be removed in code.

## Where we would look first

1. **`GoldVault.liquidate` rounding** across the three branches (partial, full, exhausted collateral),
   especially with 6-decimal collateral and `gemOut` truncation.
2. **`GoldVault.skim` / `cash`** with fee-on-transfer collateral: PAXG's fee is paid by recipients.
3. **`GoldStablePool` maths** against Curve's reference for extreme imbalance and A ramps mid-trade.
   `getDx` is our own addition and is not in Curve's 2-coin pools.
4. **Fee-on-transfer on pool outputs.** Since 0.6.1 minimums are checked on the recipient's balance
   delta. Check that no path still compares against the pre-fee amount.
5. **`GoldLiquidityLocker._harvest`** balance-delta accounting when a coin is sent to the locker directly.
6. **`FlashKeeper`** arbitrary router call: approvals are scoped to the seized amount and reset.
7. **`GoldFlash`** holding mint rights: the only path is mint, callback, burn of the same amount.
8. **Read-only reentrancy** through `getVirtualPrice` and the vault's views.

## Known limits (accepted)

- Fixed-discount liquidations, not auctions.
- Fees accrue only when someone calls `drip` or acts on the ilk; views compensate with `rateNow`.
- Locker positions are not transferable and there is no early exit.
- Locker `pending` ignores PAXG's transfer fee on fees still sitting in the pool, so it can overstate by
  that fee.
- The monitor is advisory. Nothing on-chain depends on it.

## Running everything

```bash
forge fmt --check && forge build --sizes && forge test -vv
FOUNDRY_FUZZ_RUNS=5000 forge test --match-path 'test/fuzz/*'
make e2e
```
