# LUVLocker — Review & Audit of the Liquidity/Reflection Lock Vault

**Scope:** `contracts/LUVLocker.sol` (live, in-house primitives) — the vault that holds
(a) locked LUV principal earning reflection interest and (b) generic ERC-20 timelocks,
including the **Uniswap ETH/LUV pair token**, which is how liquidity is provably locked.
**Date:** 2026-08-03. **Successor authored from this review:** `LUVLockerModern.sol`
(OpenZeppelin v5 build; compiles clean, forge exit 0).

## What holds up (verified by review)

| area | verdict |
|---|---|
| Fee-on-transfer safety | ✅ Both deposit paths credit the **measured balance delta**, never the requested amount — totalPrincipal cannot drift above real balance; a later withdrawer cannot pull another locker's shortfall |
| Reflection-interest accounting | ✅ Staking-pool index (`accRewardPerPrincipal`, 1e27 scale): reward = balance − principal − assetLocked; accrue-then-settle ordering consistent at every mutator |
| Under-reserve payouts | ✅ `_payAccrued` caps at the actual reward balance — harvests can starve, never revert-lock or over-pay |
| Owner containment | ✅ `rescue` can move **surplus only** — principal, asset locks, and accrued rewards are structurally unreachable by the owner |
| Reentrancy | ✅ nonReentrant on every mutator; **read-only reentrancy guard** on views (`whenNotEntered`) — view-consuming integrators cannot be fed mid-transaction state |
| Lock semantics | ✅ Extend-only (`NotShortenable`), capped at 3650 days; block-delta gate defeats same-block deposit/withdraw games |

## Findings (fixed in LUVLockerModern)

**A1 — Owner can extend ANY user's lock (grief vector) · MEDIUM.**
`extendLock(user, t)` allows `owner` to repeatedly push any depositor's unlock time
(+10 years each call). For the treasury's own self-locks this is the intended
extend-only culture; for third-party depositors it is a hostage mechanism.
*Fix:* extension is **self-only** in the modern vault.

**A2 — Asset locks (incl. LP locks) cannot be extended · LOW.**
`AssetLock.unlockAt` is immutable, so a liquidity lock cannot be lengthened as
commitment proof without withdrawing at maturity and re-locking (a trust gap while
unlocked). *Fix:* `extendAssetLock` — extend-only, beneficiary-only.

**A3 — Asset locks bind to funder only · LOW/UX.**
Locks are keyed to `msg.sender`; the treasury cannot lock LP *for* the community
wallet. *Fix:* optional `beneficiary` on `lockAsset`; only the beneficiary withdraws.

**A4 — No incident brake · INFO.**
No pause of any kind. *Fix (trust-preserving):* deposits/lockAsset are `Pausable`;
**withdraw/harvest are NEVER pausable** — exit paths stay open under every condition,
owner included.

**A5 — Single-step ownership · INFO.**
In-house `Owned` transfers ownership in one call. *Fix:* `Ownable2Step`.

## Documented behaviors (intentional, stated plainly)

- **Deposit refreshes the whole lock**: any new deposit re-locks the entire principal
  to ≥ now+lockDuration. Extend-only culture; a UX foot-gun if unstated — now stated.
- **Reflection dependency**: interest accrues only while the vault is **not** excluded
  from reflections on the LUV token. Operational invariant, checkable on-chain.
- **Index dust**: floor-division dust from the reward index remains in the vault and
  re-enters the reward balance — standard staking-index behavior, bounded and benign.

## The successor

`src/oz/LUVLockerModern.sol` — OpenZeppelin v5 (`SafeERC20`, `Ownable2Step`,
`ReentrancyGuard`, `Pausable`) with full live-feature parity (mutable capped duration,
interest modes, auto-payout + poke, multi-asset timelocks, surplus-only rescue,
read-only-reentrancy-guarded views) plus fixes A1–A5. Lineage:
LUVLocker (live, in-house) → LUVLockerOZ (OZ reference of the early vault) →
**LUVLockerModern** (OZ build of the current live vault + this audit).
