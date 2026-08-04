# Lock the LP into LUVLocker — the operating instructions

**Derived from the full security audit** (`docs/AUDIT_LUVLOCKER.md`, 2026-08-03) ·
**Executed and signed with LUV** — the treasury signer `0x10f7Ee226B16bea7f365Dc1eDEF159Fc1957D169`.
Everything below is public-blockchain information, verifiable by anyone.

---

## The hierarchy of the operation

This runbook follows the DeltaVerse operating hierarchy (the OVERLORD protocol: reads are public,
writes require wallet + signature, and each tier holds exactly the power it needs):

| tier | who | role in this operation |
|---|---|---|
| **OVERLORD** | the root signer `0x10f7…D169` | The **only** tier that signs. Executes §3's two transactions (rehearsal + lock). Deployment, treasury, and the lock are OVERLORD privileges — an agent never holds funded keys; the OVERLORD signs in-wallet or in-session. |
| **OVERSEER** | the operational steward, appointed by the OVERLORD | Receives the **handoff** (§5) once the lock confirms: custody of *process*, never of *keys*. Diarizes maturity, plans the A2 re-lock, monitors the vault, runs the fee flushes, publishes the proofs. |
| **recognized participant** | anyone who has entered the gate — connected a wallet or social identity and signed in (no gas) | May verify every claim independently, earn LUV through the tasks rail for attesting and amplifying the lock proof, and be delegated verification duties. |
| **participant** | everyone — no login, no permission | May read the chain, check the lock (§4), call the public `processFees()`, and trade. The lock exists precisely so this tier never has to trust the tiers above it. |

---

## 0. What is being locked, exactly

The Uniswap V2 pair `0x57D2085Aa859a145cB107845AD03c0eAAFBD8a31` is itself an ERC-20 (UNI-V2). Its LP
tokens **are** the claim on the pool's LUV + ETH. On-chain as of 2026-08-03:

```
LP totalSupply           = 16,419,484,360,707,141,173,122,139  (raw, 18 dec)
treasury LP balance      = 16,419,484,360,707,141,173,121,139
difference               =                              1,000  (Uniswap's MINIMUM_LIQUIDITY,
                                                                unowned forever by design)
```

**The treasury holds 100% of the circulating LP.** Locking it in LUVLocker
(`0xe07ACAde4bE2bbc264EA702880ed988EBae9B898`) makes the liquidity provably unremovable until the
unlock date — the audit confirms the vault's owner cannot reach locked assets (`rescue` moves
**surplus only**; principal and asset locks are structurally unreachable).

## 1. What the audit says you must decide FIRST

The audit's findings bear directly on this operation — read them as pre-flight, not trivia:

- **A2 (LOW): asset locks in the live vault are NOT extendable.** `AssetLock.unlockAt` is immutable.
  Whatever horizon is chosen at `lockAsset` is final; lengthening commitment later means waiting for
  maturity, withdrawing, and re-locking — a visible trust gap while unlocked. **Therefore: choose the
  horizon deliberately.** The duration cap is 3650 days.
- **A3 (LOW/UX): the lock binds to the funder.** Only the address that calls `lockAsset` can withdraw
  at maturity. Executing from the treasury signer means the treasury signer is the beneficiary —
  correct for this operation, but stated so nobody assumes otherwise.
- **A1/A4/A5** concern reflection locks, pausing, and ownership transfer — none block this operation.
- **The successor option.** `LUVLockerModern.sol` (in-repo, compiles clean) fixes A1–A5: extend-only
  `extendAssetLock`, optional beneficiary, pausable deposits with **never-pausable exits**. If the
  commitment story requires *extendable* LP locks, deploy LUVLockerModern first and lock there
  instead — same instructions, new address. If a fixed horizon is acceptable, the live vault is
  sound today: fee-on-transfer-safe accounting, reentrancy-guarded, owner-contained (all verified in
  the audit's "what holds up" table).

**The instruction as given: lock into the live LUVLocker.** Horizon recommendation: **365 days**
(re-lock annually — each re-lock is a fresh public gesture of commitment; A2 makes longer horizons
irreversible, and irreversibility should be bought consciously).

## 2. The transactions (treasury signer only)

Anyone can *read* these; only `0x10f7…D169` can *execute* them. Two calls, plus a rehearsal:

```bash
PAIR=0x57D2085Aa859a145cB107845AD03c0eAAFBD8a31
LOCKER=0xe07ACAde4bE2bbc264EA702880ed988EBae9B898
AMOUNT=16419484360707141173121139        # full treasury LP balance (re-read at execution!)
UNLOCK=$(( $(date +%s) + 365*24*3600 ))  # 365 days from execution

# ── rehearsal: lock 0.001 LP first, end-to-end, before committing the whole position ──
cast send $PAIR  "approve(address,uint256)" $LOCKER 1000000000000000 --from 0x10f7…D169
cast send $LOCKER "lockAsset(address,uint256,uint64)" $PAIR 1000000000000000 $UNLOCK --from 0x10f7…D169
# verify the AssetLocked(user, lockId, token, amount, unlockAt) event before proceeding

# ── the lock ──
cast send $PAIR  "approve(address,uint256)" $LOCKER $AMOUNT --from 0x10f7…D169
cast send $LOCKER "lockAsset(address,uint256,uint64)" $PAIR $AMOUNT $UNLOCK --from 0x10f7…D169
```

Etherscan path (no CLI): pair contract → *Write* → `approve(locker, amount)`; then LUVLocker →
*Write* → `lockAsset(pair, amount, unlockAt)`. UNI-V2 is not fee-on-transfer, so the credited amount
equals the sent amount (and the vault credits the **measured delta** regardless — audit-verified).

## 3. Verification — the proof anyone can check

After execution, the lock is public fact:

1. **The `AssetLocked` event** on LUVLocker names user, lockId, token (= the pair), amount, unlockAt.
2. **`balanceOf`**: the pair's `balanceOf(LUVLocker)` equals the locked amount; the treasury's LP
   balance drops to ~0.
3. **The claim to publish**: *"100% of circulating LUV/ETH liquidity is locked in LUVLocker until
   〈date〉 — tx 〈hash〉"* — with the two tx links. Add the LP row to the holders ledger on
   view.html and the lock line to docs.html and the FAQ.
4. **What locking does NOT do**: it does not pause trading (the pool trades exactly as before), does
   not touch the token contract, and does not change fees. It removes exactly one power — the
   ability to withdraw the pooled LUV + ETH before the unlock date — from everyone, including the
   treasury itself.

## 4. Standing cautions (from the audit, restated)

- The unlock date is **immutable** (A2). Diarize maturity; plan the re-lock before it arrives.
- Withdrawal at maturity is **funder-only** (A3). Guard the treasury key accordingly — the LP lock
  is now one more reason the signer must never be exposed.
- The vault's owner powers cannot reach the lock (audit: owner containment ✅) — but ownership of
  LUVLocker is single-step (A5); do not transfer it casually.
- When LUVLockerModern deploys, migrate at maturity, not before: maturity → withdraw → lock into
  Modern with `extendAssetLock` available — closing the A2 gap permanently.

## 5. The handoff to the OVERSEER

The OVERLORD's part ends when the `AssetLocked` event confirms. From that block forward, the
operation belongs to the OVERSEER — process, not keys:

1. **Record**: append the two tx hashes + lockId to the live proof (`LUV_LIVE_PROOF` addendum,
   docs.html audits row, the FAQ contract ledger, the view.html holders panel LP row).
2. **Diarize maturity**: the unlock date is immutable (A2). Calendar it at T−30d and T−7d; the
   re-lock plan (or the LUVLockerModern migration, §4) must be published *before* maturity so the
   trust gap at re-lock is announced, not discovered.
3. **Monitor**: `balanceOf(LUVLocker)` on the pair must equal the locked amount every time it is
   read; any deviation is an incident. The vault must remain reflection-included (documented
   operational invariant) for its LUV-side interest accounting.
4. **Keep the public rails honest**: fee flushes (`processFees()`), the market mirror, and the
   holders ledger stay current — recognized participants verify against them, and their attestations
   through the tasks rail earn LUV (Phase 3: attention is capital).
5. **Escalate up, never around**: anything requiring a signature returns to the OVERLORD. The
   OVERSEER never holds, requests, or proxies the treasury key.

---

## 6. The second lock — the non-circulating supply, earning while it waits

The LP lock (§2) removes the rug vector and clears the scanners' honeypot/liquidity flags. The
**second lock** puts the treasury's non-circulating LUV to work: LUVLocker's `deposit()` rail locks
LUV principal under an **extend-only** timer (`extendLock` can lengthen, never shorten) — and the
vault is **reflection-included**, so locked principal earns the 3% reflection flow pro-rata the
whole time it is locked. Locked supply is not idle supply; it is the largest holder being paid to
hold, publicly.

Pre-flight, verified on-chain 2026-08-04:

```
treasury LUV               = 100,000,000,000,000,000 LUV  (100Q — the non-circulating supply)
LUVLocker LUV              = 0        ← the FAQ already claims marketing+community are locked;
                                        this deposit MAKES that claim true
lockDuration (deposit rail)= 7,776,000 s = 90 days (owner may setLockDuration(31536000) for 365d first)
locker reflection-excluded = false  ✓ (earns — operational invariant: keep it included)
locker fee-excluded        = true   ✓ (deposits arrive whole)
treasury / locker maxTx    = exempt ✓ (single-tx deposits of any size)
```

The transactions (treasury signer only; amounts in raw 18-dec units):

```bash
LUV=0x2711111111683B8708cb9a48cBf36a51315F8254
LOCKER=0xe07ACAde4bE2bbc264EA702880ed988EBae9B898
DIST=0x607E477AB12406A3294A7Ba63817103f92D8f806

# 0 (optional, recommended): a 1-year deposit horizon before funding
cast send $LOCKER "setLockDuration(uint256)" 31536000 --from 0x10f7…D169

# 1. the published minimum — marketing (2.777Q) + community (2.778Q) = 5.555Q LUV
AMOUNT=5555000000000000000000000000000000
cast send $LUV    "approve(address,uint256)" $LOCKER $AMOUNT --from 0x10f7…D169
cast send $LOCKER "deposit(uint256)" $AMOUNT              --from 0x10f7…D169

# 2. the reward loop — reflections earned by the locked principal auto-fund the earn rail:
#    payout = the IncentiveDistributor, so the vault's interest pays the community's rewards
cast send $LOCKER "setAutoPayout(uint256,address)" 50000000000000000000000000000 $DIST --from 0x10f7…D169
#    (threshold = 50B LUV — each time accrued interest reaches one tweet-reward, it ships)
#    Alternative: setInterestMode(true) locks the interest with the principal (compounds instead).
```

Scaling up is the same `approve` + `deposit` with a larger amount — the extend-only timer and the
funder-only withdrawal (§4 cautions) apply identically. The loop this closes is emotonomic: the
locked non-circulating supply attends the market, the market pays it reflections, and the
reflections pay the gestures — yield follows attention to its source, automatically.

---

**Signed with LUV ❤**
*the treasury signer · `0x10f7Ee226B16bea7f365Dc1eDEF159Fc1957D169` · per the full security audit
`docs/AUDIT_LUVLOCKER.md` · SHAMBA LUV, 2026*
