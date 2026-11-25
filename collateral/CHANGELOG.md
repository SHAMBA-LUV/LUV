# Changelog

### 0.7.0

Peg stability module.

| Area | Change |
|---|---|
| `GoldPsm` | Swaps PAXG and bXAU 1:1 for a 0.10% fee each way, which anchors bXAU's price. Implemented as an ordinary urn in a dedicated `PSM-PAXG-A` ilk (100% ratio, zero fee, par price), so every bXAU it mints is on the vault's books and counts against a 500 oz ceiling. Holds no minting rights. |
| Depeg guard | Minting through the PSM requires PAXG's market price to be fresh and at least 0.995 oz. Redemption is never blocked. |
| Deployment | `DeployGoldVault.s.sol` configures the PSM ilk and deploys the PSM, owned by the timelock. Global ceiling raised to 1,600 oz. |
| Monitor | `PSM=` adds alerts for fee, floor and treasury changes and for the mint gate closing. |
| Tests | 10 unit tests and 1 property test for the PSM (93 total); end-to-end run now has 21 checks. |
| Fix: bot gas margin | The bots sent transactions with the exact gas estimate. The vault needs slightly more gas when a transaction is mined in a later second than it was estimated in, so about 1 run in 30 of the end-to-end test ran out of gas. This was the unexplained intermittent failure noted in 0.5.0. Every bot transaction now carries a 30% gas margin (`GAS_MARGIN_PCT`). |

### 0.6.1

Patch release.

| Area | Change |
|---|---|
| Fix: pool slippage limits | `exchange`, `removeLiquidity` and `removeLiquidityOneCoin` checked the minimum-out against the amount the pool sent. With a fee-on-transfer output token (PAXG), the user could receive up to that fee less than their minimum. The check now uses the amount the recipient actually received. |
| Fix: locker `withdrawOneCoin` | `minOut` and the return value are now the amount the owner actually receives, after both transfer hops. |
| Tests | 2 new unit tests (82 total). |

### 0.6.0

Property testing and project material.

| Area | Change |
|---|---|
| Fuzz tests | 10 property tests in `test/fuzz/` covering 16 invariants across the vault, pool and locker (500 runs each by default, 5,000 in CI). |
| Fix: locker rounding | The reward formula could over-pay by 1 wei per settlement, which could make the last withdrawal revert and lock LP tokens. Rewards are now `weight × Δacc`, rounded down. Found by the new fuzz tests. |
| `emergencyWithdraw` | After unlock, LP can be withdrawn without any reward transfer; forfeited rewards go to the remaining lockers. |
| Docs | `docs/ARCHITECTURE.md`, `docs/AUDIT.md` (scope, invariants, findings, focus areas), `CHANGELOG.md`, `LICENSE` (MIT), `.env.example`. |
| CI | `.github/workflows/ci.yml`: format, build, tests, deep fuzz, end-to-end. |
| Packaging | The archive is now `collateralized.zip`. |

### 0.5.0

Liquidity pools and long-term LP rewards.

| Area | Change |
|---|---|
| `GoldStablePool` | 2-coin Curve StableSwap with its own LP token: paired and single-asset deposits, proportional and single-coin exits, `getDx` inverse quotes, 4 bps fee split 50/50 between all LPs and locked LPs. A ramping, fee cap, withdrawals never pausable, first-depositor protection, fee-on-transfer and no-return tokens supported, read-only reentrancy guard. |
| `GoldLiquidityLocker` | Immutable three-tier lock: Bronze 30 d at 1×, Silver 180 d at 2×, Gold 365 d at 3×. Pairing and single-asset zaps, claim, relock, kick of expired boosts, withdraw to LP or one coin, carry-over of fees with no lockers. |
| Deployment | `DeployGoldPools.s.sol` deploys bXAU/PAXG (A 200) and bXAU/XAUT (A 100); the timelock owns them and `GOV` may only pause. |
| Keeper | `ROUTE=stablepool` sells seized pegs into the pool. |
| Monitor | `POOLS=` adds pause, fee, A-ramp and receiver alerts plus an imbalance (depeg) warning. |
| End to end | Now uses the real pool and a third-party Gold-tier LP (17 checks). |
| Fix during development | `addLiquidity` copied a memory array by reference, which charged balanced deposits an imbalance fee. Caught by tests before release. |

### 0.4.0

Operations tooling.

| Area | Change |
|---|---|
| `FlashKeeper.sol` | A production capital-free liquidator for any DEX router. Owner-only, rejects untrusted callbacks and system routers, enforces a profit floor, repays or reverts. |
| `keeper/keeper.mjs` | Liquidation bot: event-based urn discovery, prediction matching `liquidate()`, direct or flash strategy, simulation before sending, dry run by default, pluggable routes. |
| `keeper/monitor.mjs` | Governance and health monitor: decoded timelock queue, severity levels, webhook delivery, deduplicated health checks, exit code for cron. |
| `keeper/e2e.mjs` | Both bots verified against a live anvil chain (14 checks). |
| Mocks | `MockSwap` moved into `test/GoldMocks.sol`. |

### 0.3.0

Governance and keeper infrastructure.

| Area | Change |
|---|---|
| `GoldTimelock` | All governance goes through a public delay: 2 days by default, 14-day execution window, delay ≤ 30 days. The delay and admin can only change through the timelock itself. |
| `GoldGuardian` | `GOV` can trigger an instant `cage()` and nothing else. |
| `GoldFlash` | ERC-3156 flash-mint of bXAU: zero fee, per-call ceiling, disabled after cage, reentrancy-locked. Keepers no longer need to hold bXAU. |
| Deploy script | Builds this authority layout and asserts it: `GOV` is never a direct ward and governance can't mint. |
| Tests | 11 new tests, including an end-to-end flash liquidation. |

### 0.2.0

Fixes from the code review of 0.1.0.

| Area | Change |
|---|---|
| XAUT | Gets its own 100 oz ceiling and 150% ratio, because it is priced at par and cannot be liquidated on price. |
| Liquidation | In the band where collateral is worth more than the debt but less than debt × chop, the keeper now repays the whole debt and the protocol books no bad debt. `chop ≤ mat` is enforced. `maxWad` is respected (`OverMax`). |
| Cage with oracle down | `cage()` falls back to the last good price, not 1 token = 1 oz. `poke()` lets keepers refresh that price. |
| Duty | Capped at `MAX_DUTY`, about 100%/yr. Spotter calls are wrapped, so one ilk or oracle can no longer block `cage()`. |
| Zero supply at thaw | `thaw()` no longer reverts when supply is 0. Governance can `sweep` the leftover collateral. |
| Cash rounding | `cash()` pays against the remaining pool, so rounding dust goes to later redeemers instead of being lost. Added `quoteCash`. |
| Deploy script | Asserts the deployer holds no rights and that the wiring is correct; range-checks the max ages. |
| `init` | Reads decimals from the token. |
| Views | `owed` and `isSafe` include fees not yet dripped (`rateNow`). |
| Spotter | Caches feed decimals and rejects feeds without code. |
| Project | Now a standalone Foundry project in `collateral/`. |

### 0.1.0

Initial CDP: bXAU, PegSpotter and GoldVault, with PAXG-A and XAUT-A.
