# SHAMBA LUV — Full Security Audit, 2026-08

**Scope:** the in-house contract suite in `~/DeltaVerse/shambaluv/contracts/` — `ShambaLuv.sol`
(the live LUV token), `IncentiveDistributor.sol`, `LUVLocker.sol` (+ `LUVLockerModern`/`Door`
variants), and the periphery (`ShambaLuvAirdrop`, `LuvBatchGesture`, `LuvLauncher`, `MerkleDrop`,
`SimpleDrop`, `RewardToken`, `aa/*`), plus `base/InHouse.sol`.

**Method:** four parallel deep-audit agents (one per contract cluster), each writing and running
proof-of-concept exploits against isolated copies; `slither` static analysis (99 results, triaged);
16 new adversarial scenario tests added to the committed suite (`docs/passed.md`); and on-chain
live-state verification of every finding claimed to affect a deployed contract.

**Not an independent audit.** This is a self-audit by construction and execution. It found real,
exploitable defects; treat the "act now" items as blocking.

> **A note on the bankonvault rewrite.** The owner-less `~/bankonvault/luv-locker` + `liq-locker`
> modules are a separate re-implementation of the locker (see `bankonvault/README.md`). The
> **LUVLocker C-1 and M-3 findings below were reproduced there and FIXED on 2026-08-05**; the
> **live** `LUVLocker` at `0xe07A…B898` remains unfixed. These are distinct from the mindX
> `bankon_vault` / `vault_bankon` (Python), which are modular but not this codebase.

---

## 1. Executive summary — master findings table

Severity reflects **real-world** impact after live-state verification. "Live" = affects a
mainnet-deployed contract now; "pre-deploy" = the contract is not deployed, so the finding blocks
deployment rather than threatening funds today.

| # | Sev | Contract | Finding | Status |
|---|-----|----------|---------|--------|
| **C-1** | 🔴 **Critical** | LUVLocker *(live `0xe07A…B898`)* | Reflection pool stealable: `deposit`/`lockAsset` credit the measured balance delta, but LUV rebases **up** during a transfer, so the delta includes the vault's reflection share — credited as the depositor's principal | **LIVE, unfixed.** Blocks the pending supply-lock. Fixed in bankonvault rewrite |
| **A-H1** | 🔴 **High** | ShambaLuvAirdrop *(live `0xdf2C…DEf3`)* | `claim()` never enforces `claimAmount`; ceiling is the whole budget. One signer signature drains the balance | **LIVE + FUNDED (~1.02Q LUV), unpaused. Act now** |
| **L-H1** | 🟠 **High** | LUVLocker *(live)* | `acc_reward_per_principal` is attacker-inflatable when `total_principal` is small → `principal*acc` overflow → deposits/exits brick (DoS / principal freeze) | **LIVE**, exploitable on a fresh/drained vault; fixed in rewrite |
| **T-H2** | 🟠 **High** | ShambaLuv *(live, immutable)* | Unbounded `_excluded` array looped on every `balanceOf`/transfer → the un-renounced owner can brick the token irreversibly | **LIVE**, owner-only; only `renounce`/multisig mitigates |
| **T-H3** | 🟠 **High** | ShambaLuv *(live)* | `processFees()` `minOut` is derived from spot in the same tx → non-binding; permissionless flush is an open sandwich | **LIVE**, MEV; scales with pool depth |
| **D-H1** | 🟠 **High** | IncentiveDistributor *(live `0x607E…f806`)* | `distributeReward()` bypasses dedup / `oneTime` / cooldown / daily-limit; no global spend budget | **LIVE but UNFUNDED (holds 0 LUV)** — armed only when funded |
| **B-H3** | 🟠 **High** | LuvBatchGesture *(live `0xc734…B4dD`)* | Hot `operator` key + standing **1e33** treasury allowance = ~0.9%-of-supply drain if the key leaks | **LIVE** (allowance verified on-chain) |
| **T-H1** | 🟢 High→**moot(live)** | ShambaLuv | `setPair` doesn't auto-exclude the pair from reflection → reflections credited to the pair are `skim()`-able | **Mitigated live**: `isExcludedFromReflection(pair)==true`. Latent footgun on any future `setPair`/new chain |
| M-* | 🟡 Medium | all | policy/accounting/UX issues — see §3–§6 | mix of live and pre-deploy |
| H-2..M-11 | — | MerkleDrop / SimpleDrop | no per-campaign escrow, self-invalidating drops, 12% branch coverage | **pre-deploy** (not deployed) |

**Two items need an OVERLORD signature now** (§2). Everything else is either unfunded, owner-only
(mitigated by the pending move to a timelocked multisig), or pre-deployment.

---

## 2. Act now — the two live, funded exposures

### 2.1 Neutralize the airdrop contract (A-H1)
`ShambaLuvAirdrop 0xdf2C…DEf3` is **unpaused and holds ~1.02 quadrillion LUV** (verified on-chain
2026-08-05). Its `claim()` checks only `AIRDROP_CAP` (= the whole budget), not `claimAmount`, so a
single valid voucher from the signer key transfers the entire balance. `AIRDROP_CLOSED=true` is a
backend flag only — the contract honors any signer-signed voucher.

**Owner action (owner = treasury `0x10f7…D169`):** `pause()` **or** `withdraw()` the 1.02Q back to
treasury until a fixed contract ships. Either closes it immediately.

### 2.2 Do not fund the supply-lock through the live LUVLocker (C-1)
The pending lock runbook (`docs/LOCK_THE_LP.md` §6) deposits ~5.555Q LUV via the live
`LUVLocker.deposit`/`lockAsset`. Both use the uncapped measured-delta credit that C-1 exploits: a
bot watching `accumulatedFees >= payoutThreshold` can `lockAsset(LUV, 1, …)` the instant fees flush
and absorb the vault's reflection share as its own principal. **The LP lock (§2 of the runbook) is
lower-risk** (LP is not the rebasing token) **but the LUV supply-lock (§6) should wait** for the
fixed contract (the `bankonvault/luv-locker` rewrite, C-1/M-3 patched 2026-08-05) or a seed-first,
monitored deposit. See L-H1 too: seed the vault with a large first deposit to defuse index inflation.

---

## 3. ShambaLuv (the live token, immutable at `0x2711…8254`)

Agent-verified with 18 PoCs. The token has **no honeypot switches** — no blacklist, pause, mint, or
sell-block; fees are lower-only (`lowerFees` reverts `OnlyLower`); `maxTxBps` has a 1% floor. That is
genuinely better than most fee-on-transfer tokens and worth stating plainly.

- **T-H1 — pair reflection skim. Moot on the live config.** `setPair` never calls
  `excludeFromReflection`, so a pair left included leaks reflections to `skim()`. **On-chain the pair
  IS excluded** (owner did it as a separate tx), so no live exploit. It remains a latent footgun: any
  future `setPair`, or a deploy on a new chain, reintroduces it. Fix in any redeploy: exclude the
  pair inside `setPair`.
- **T-H2 — unbounded `_excluded` (High, live).** `balanceOf` costs ~3.2k gas per excluded entry;
  ~9,300 entries make a single `balanceOf` exceed a block, and the unwind path is itself O(n), so the
  state is unrecoverable. Owner-only, un-renounced. Mitigation: move ownership to a timelocked
  multisig or renounce; a redeploy should cap the array or track excluded totals incrementally.
- **T-H3 — non-binding `minOut` (High, live).** The `getAmountsOut` quote is taken in the same tx as
  the swap, so `minOut = 0.95×spot` can never bind; permissionless `processFees()` is sandwichable.
  Scales with the planned liquidity deepening. Redeploy fix: oracle/TWAP floor or caller-supplied
  `minOut`.
- **Mediums (live, mostly operational):** contract wallets (incl. this repo's own `LuvAccount` AA
  wallets) pay 5% where EOAs pay 0 (`from.code.length` heuristic — M-6/M-7); auto-`_processFees`
  fires inside a user's sell and can revert it (M-8, a honeypot-detector trigger); a failed swap
  zeroes `accumulatedFees` and can strand LUV with no rescue (M-2); `updateRouter` grants MAX
  allowance (M-3, admin-only). Full detail and line numbers in the agent report; these need a
  migration to fix, so they are accepted-risk on the immutable deployment and addressed in any v2.
- **Proved sound:** `tSupply==0` brick is unreachable; reentrancy in `_processFees` respects CEI;
  the classic reflect.finance phantom-mint is fixed (line 333); arithmetic is checked, no `unchecked`.

## 4. IncentiveDistributor (live `0x607E…f806`, holds 0 LUV)

**No Criticals.** The cryptography is correct: EIP-712 binds all four fields, the domain separator
rebuilds on chainId change (no cross-chain replay), signatures are non-malleable (low-s, v∈{27,28},
`ecrecover(0)` rejected), `actionId` dedup is airtight, CEI holds, `nonReentrant` blocks a hostile-token
callback. The risk is the policy layer:

- **D-H1 (High, armed-when-funded):** `distributeReward()` reaches `_pay` directly, skipping dedup /
  `oneTime` / cooldown / daily-limit; `maxRewardPerTx` (1e30, verified) is per-*payout* not per-*tx*,
  so `distributeBatch` exceeds it ×200; and there is no global spend budget, so one hot signer/distributor
  key empties the pool. **The distributor currently holds 0 LUV** (funding is staged last per
  `docs/LUVDROP_GO_LIVE.md`), so it is not yet a live loss — but the single highest-value fix is a
  global rolling spend budget in `_pay` before funding.
- **Mediums:** dedup key isn't namespaced by user/type (M-1, backend currently compensates);
  `distributeBatch` reverts wholesale on `user==0`/over-cap instead of skipping (M-2); fixed
  UTC-midnight window allows a 2× daily-limit burst (M-3); `countToday` accrues while `dailyLimit==0`
  (M-4).
- **Correction to `foundry.toml`:** the `via_ir` prohibition comment is a **misdiagnosis** — the
  contract compiles correctly under `via_ir`; the two "failing" tests are a `vm.warp(block.timestamp+N)`
  -in-loop harness bug (the IR optimizer legitimately CSEs `TIMESTAMP`). Fix the tests, retract the
  claim. `base/InHouse.sol` signature core is **16% branch-covered** — backfill the Tier-1 signature
  tests (the agent wrote 9 passing ones; port them).

## 5. LUVLocker (live `0xe07A…B898`)

- **C-1 (Critical) — §2.2.** Confirmed with a PoC crediting ~270B LUV to a 1-wei depositor from a
  single reflection. Fixed in the bankonvault rewrite (cap `received` at `amount`; `_accrue` the
  surplus to the index).
- **L-H1 (High) — index inflation.** With `total_principal` near zero, a 1-wei deposit + a donation
  sets `acc_reward_per_principal` arbitrarily high; the next normal deposit overflows
  `principal*acc` and reverts, bricking deposits (and a tuned version freezes a victim's principal).
  My scenario test `test_KNOWN_first_depositor_inflation_bricks_deposits` proves it; `test_seed_first_defuses_inflation`
  proves the mitigation. **Seed the vault with a large first deposit before opening it.**
- **M-3 (Medium):** a reflection landing during the vault's own outgoing transfer is orphaned by the
  trailing resync. Fixed in the rewrite (`_sync`→`_accrue`).
- **Prior audit A1–A5:** A1/A2/A3/A4 confirmed (owner-power hostage, non-extendable asset locks,
  funder-bound, no brake); **A5 refuted** — `Owned` has been two-step since 2026-07-16. None of A1–A5
  is the vault's real risk; C-1 and L-H1 are. The owner-less rewrite removes the owner findings by
  subtraction and fixes C-1/M-3.

## 6. Periphery

**Live:** `ShambaLuvAirdrop` (A-H1 §2.1; also M-10 `renounceOwnership` strands funds),
`LuvBatchGesture` (B-H3 hot operator key, 1e33 allowance verified; M-2 contract recipients silently
get 95% booked as 100% — affects AA-onboarded users), `LuvPaymaster` (M-9 no spend policy — signer
compromise drains the deposit), `LuvLauncher` (M-3 interim owner is a function-less contract until
treasury accepts; M-4 hardcodes ETH-mainnet router/WETH on every chain).

**Not deployed (pre-deploy blockers, not live risk):** `MerkleDrop` (H-2 no per-campaign escrow →
campaigns cannibalize each other and wedge; M-1 `recoverToken` rugs live campaigns; M-11 root-swap;
**12% branch coverage**), `SimpleDrop` (M-7 single-use, M-8 self-invalidating), `RewardToken` (test
token, no findings).

**Proved sound (probed adversarially):** merkle leaf second-preimage (72 vs 64-byte lengths), proof
theft (`msg.sender` bound into the leaf), cross-campaign proof reuse, reentrancy throughout (all
`nonReentrant` + CEI, which matters because LUV's `_transfer` can reenter via `_processFees`), the
CREATE3 launch rail (address independent of ctor args, per-deployer salt namespacing), the AA factory
counterfactual-collision resistance, `validateUserOp`, and the paymaster signature binding.

---

## 7. Static analysis (slither) — triage

99 results across 27 contracts. The headline detectors are **false positives in context**:
`weak-prng` is `block.timestamp % 86400` day-bucketing (not randomness); `arbitrary-send-eth` targets
owner-set team/liquidity wallets; the `reentrancy-*` hits are guarded by `nonReentrant` / the
reflection-index CEI pattern. The genuinely useful signals — costly-loop on `_excluded` (T-H2),
unchecked low-level calls in `_swapTeamLiq` (M-2/M-4) — are already captured above. Full output:
saved with the audit working set.

## 8. New-test backlog (ranked)

1. **Distributor `base/InHouse.sol` signature core** (16% branches) — malleability, `ecrecover(0)`,
   chainId-fork rebuild, `sig.length != 65`. The agent wrote 9 passing tests; port them.
2. **MerkleDrop** — no test ever passes a **non-empty merkle proof**; the verify loop is unexecuted
   under test. Add real multi-level trees before any deployment.
3. **Token allowance path** — `approve`/`transferFrom` allowance branches have zero coverage (the
   path every DEX/router uses); the `_swapTeamLiq` cap-binding and `catch` branches are untested
   (add a router with `getAmountsOut` so `minOut` is exercised).
4. **LUVLocker** — donation/index-inflation, reflection-during-credit (C-1) and during-payout (M-3),
   overflow bounds on `principal*acc`. (These now exist as passing regression tests in the
   bankonvault rewrite; port the shape back if the live vault is ever migrated.)
5. **Scenario tests already added to this repo** (16, all passing) — see `docs/passed.md` §2/§4/§6.

## 9. Recommended order

1. **§2.1** pause/withdraw the airdrop (live, funded). **§2.2** hold the LUV supply-lock.
2. Move token + distributor + batch-gesture ownership to a **timelocked multisig** (caps T-H2, and
   the un-renounced-EOA blast radius across the suite).
3. Add the distributor **global spend budget** before funding it.
4. Reduce the batch-gesture allowance to a per-campaign tranche (B-H3).
5. For the locker: deploy/lock through the **fixed** contract, or seed-first + monitor.
6. Backfill the §8 tests; fix the `via_ir` misdiagnosis in `foundry.toml`.

*Companion: `docs/passed.md` (174/174 curated suite, incl. the 16 new scenario tests). Live-state
reads and per-agent detail retained in the audit working set. Generated 2026-08-05.*
