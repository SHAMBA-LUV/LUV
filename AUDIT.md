# SHAMBA LUV cryptosystem — full audit & remediation

Audit of every repo under **github.com/shamba-luv** (owned by codephreak), with the fixes
landed in this local clean-house (`/home/hacker/DeltaVerse/shambaluv/`). The live token has
fund-affecting bugs; **holders are being airdropped to compensate**, and the giveaway is
re-architected as a **self-hosted social-login gesture** with **cypherpunk2048-standard wallet
hosting** (sovereign, clean-room — no paid third-party service).

Live deployment (Polygon, chainId 137, 2025-08-05):
- LUV token `0x1035760d0f60B35B63660ac0774ef363eAa5456e`
- ShambaLuvAirdrop (old) `0x583F6D336E777c461FbfbeE3349D7D2dA9dc5e51`
- MultiSend `0xDe55B9C14B1a355AEF70787667713560C76cd5f9`

---

## 1. `SHAMBALUV` — the token (`contracts/LUV8.sol`) · CRITICAL

`ShambaLuv is ERC20, Ownable, ReentrancyGuard` (OZ). Supply `1e35` (100 Quadrillion), fees
3%/1%/1%, pull-based reflection claim, full timelock. **Unaudited, no tests committed.**

| # | Finding | Severity | Line(s) | Status |
| --- | --- | --- | --- | --- |
| 1 | **Constructor never approves the router** (approval only in `updateRouter`) → `_swapBackV2` `transferFrom` against zero allowance reverts; team/liquidity ETH never flows | High | ctor 331-355; approve 803-804 | **FIXED** — approve at genesis |
| 2 | **Inverted max-tx math** `maxAmount = SUPPLY / percent` → "100% = no limit" yields 0.01% cap | High | 350, 915 | **FIXED** — `SUPPLY*bps/10000` |
| 3 | **Reflection insolvency** — all 5% sent to contract (430), 3% *also* owed via `reflectionIndex`; `_maybeSwapBack` swaps 2/5 of the **whole** balance, draining reflection-owed tokens | Critical | 430, 459, 596 | **FIXED** — RFI: reflections via the rate, disjoint 2% swap pool |
| 4 | **`claimReflections` loses funds** — zeroes `reflectionBalance` then transfers only the new delta | High | 530-535, 548-549 | **FIXED** — no claim; RFI accrues into `balanceOf` |
| 5 | **Reflection denominator counts excluded balances** (`_localTotalSupply` never reduced) → under-distribution/drift | Medium | 354, 459 | **FIXED** — `_getCurrentSupply` excludes them |
| 6 | **WETH hardcoded to Polygon WPOL** → wrong swap path on every other chain; `updateRouter` can't change it | High (cross-chain) | 189, 614, 658 | **FIXED** — `weth` set at construction + admin-updatable |
| 7 | **No `try/catch` on swap** → a failed swap reverts the user's transfer, bricking transfers once balance ≥ threshold | High | `_swapBackV2/V3` | **FIXED** — swap wrapped in try/catch |
| 8 | **`clearStuckBalance`/`clearEntireStuckBalance` let admin transfer the contract's OWN LUV** → rug vector surviving owner renounce | High | 1257-1291 | **REMOVED** — no such function |
| 9 | Reflection accounting desync (collected vs distributed never reconcile) | Low | — | Dissolved by RFI |
| 10 | Loose pragma `>=0.5.0 ^0.8.0 …`; SPDX `UNLICENSED` vs README "MIT" | Low | 2 | **FIXED** — `^0.8.24`, MIT |

**Remediation:** `contracts/ShambaLuv.sol` — a self-contained RFI rewrite, **mint/name/symbol
unchanged** (1e35 / SHAMBA / LUV), ETH-primary + cross-chain, **unified 10-trillion payout**
(reflection + team + liquidity in one tx), fees lower-only, **12 tests pass**. See `LUV.md`.

---

## 2. `ShambaLuvAirdrop` (the claim contract) · CRITICAL design flaw

**Sybil-trivial:** `claimAirdrop()` lets *any* address pull 1 trillion LUV, gated only by
`hasClaimed[wallet]`. One person with N wallets drains it; all anti-abuse is off-chain and
bypassable. Owner has full custody (`withdraw`/`emergencyWithdraw`/`rescueAllTokens`).

**Remediation:** `contracts/ShambaLuvAirdrop.sol` — **signature-gated**. Only an EIP-712 voucher
signed by the backend `signer` releases LUV; one claim per `nonce` **and** per wallet; a hard
**campaign cap = 1% of supply = 1 Quadrillion LUV (1,000 trillion)** so the giveaway can never
exceed 1% even if over-funded (1,000 gestures of 1 trillion). The Sybil gate becomes "one real
social identity = one claim", enforced on-chain by the signature + off-chain by identity (not
wallet). **7 tests pass.** Deployment note: the airdrop contract **must be set fee-exempt** in
the LUV token so recipients receive the full trillion.

---

## 3. `MultiSend` (Polygon batch sender) · LOW — keep, minor hardening

Well-built: `Ownable2Step` + `ReentrancyGuard` + `Pausable` + `SafeERC20`, loops bounded by
`maxBatchSize` (500). Suitable for pushing the compensation airdrop to the known holder list.

| Finding | Severity | Fix |
| --- | --- | --- |
| All-or-nothing batches — one reverting recipient fails the whole chunk | Medium (liveness) | Prefer ERC-20 mode; pre-filter recipients to clean EOAs; chunk ≤500. (Optional: a skip-on-fail variant.) |
| Optimizer disabled (runs=0) | Low (gas only) | Enable optimizer |
| Owner full custody of deposited funds | Info | Expected for an owner-operated sender |

**Action:** use **MultiSend (push)** — *not* the claim contract — for the compensation airdrop to
the snapshot of existing holders.

---

## 4. `luvdat` / `dataluv` backends · HIGH — superseded

Express + PostgreSQL anti-Sybil bookkeeping. Audited flaws:

| Finding | Severity |
| --- | --- |
| **No auth on any route** (`JWT_SECRET`/`API_KEY` defined but unused) — `/ips/ban`, claim recording, analytics all open | Critical |
| **Client-supplied IP & device fingerprint trusted** (from request body) → per-IP/device caps trivially bypassed | Critical (Sybil) |
| Open CORS (`!origin` allowed; substring `localhost` match; dev bypass) | High |
| Rate limit raised to 10,000/15min ("prevent 429s") — self-defeating | Medium |
| Hardcoded IP salt fallback `'shamba_luv_salt_2024'` | Medium |
| DB `ssl rejectUnauthorized:false` in prod (accepts any cert) | Medium |
| PII in logs (raw IPs, full request bodies); outbound port-scans of user IPs | Medium |

**Remediation:** **replaced** by the new self-hosted service (`auth/`) — see §6. Every flaw above
is explicitly fixed there (JWT auth on all state routes, IP from `req.ip`, strict CORS allowlist,
sane rate limits, env-only `IP_SALT`, configurable DB SSL, no port-scanning, no PII logging).

---

## 5. `luvdrop` (UI) · LOW

React 18 + Vite + **wagmi/viem** (README says ethers — doc drift). User/admin signing is
client-side via the connected wallet (good). `fund-airdrop.js` reads an owner key from `.env`
(naive `split('=')`; ensure `.env` is gitignored — repo `.gitignore` is suspiciously tiny).
Default public RPC (rate-limit fragility). **Actions:** verify `.env` ignored; set a real RPC;
fix the README stack note. (UI is superseded by the `auth/` flow for new signups.)

`web3.js` and `modular-contracts` are upstream library forks — no changes needed. `.github` is the
org profile.

---

## 6. The new giveaway — self-hosted social-login gesture (cypherpunk2048 wallet hosting)

`auth/` — **social login → sovereign wallet → 1-trillion-LUV gesture**, fully self-hosted (no paid
third-party auth/wallet service, no monthly fee). Flow: user signs in (Google/Discord/GitHub; Apple/X
pluggable) → backend provisions a **cypherpunk2048-standard** wallet for that identity → the
**treasury/relayer wallet (EOA) sends 1 trillion LUV WALLET-TO-WALLET to the user's wallet (EOA)**.

**Why wallet-to-wallet:** the LUV token already makes EOA↔EOA transfers **0-fee**
(`walletToWalletFeeExempt`). So the gesture is a direct EOA→EOA transfer — **full trillion arrives,
no fee, no fee-exemption, no contract distributor** (a contract sender would incur the fee; so MultiSend or
an on-chain `claim()` are *not* the primary path). The relayer pays only the simple-transfer gas.
**One social identity = one wallet = one gesture**, enforced in Postgres (unique identity) + a treasury
funded with exactly the **1%-of-supply cap (1 Quadrillion = 1000 trillion = 1000 gestures)** + an
off-chain running total. `airdrop/gesture.js` is the primary path; `airdrop/voucher.js` +
`ShambaLuvAirdrop.sol` remain an **optional on-chain self-serve PULL** (contract→EOA, fee-charged unless that
contract is fee-exempt) — EIP-712 byte-matches the contract (verified by `auth/test/voucher-selftest.mjs`).

**Wallet hosting — cypherpunk2048 standard.** Sovereign + self-hosted + clean-room: every key lives
in our own infrastructure with no remote dependency. Keys are AES-256-GCM encrypted at rest with a
per-identity key derived via scrypt from an env-only secret + the identity key, so DB ciphertext alone
is inert. The cypherpunk2048 **target** is operator-cannot-spend: a passkey/MPC key-share (the user
holds a share) and/or ERC-4337 user-owned smart accounts, so no operator can ever move a user's funds.
The airdrop path never needs the user's key — only the backend voucher `signer` signs the gesture.

---

## Remediation summary

| Repo | Verdict | Outcome |
| --- | --- | --- |
| SHAMBALUV (token) | 10 issues (1 critical) | Rewritten `ShambaLuv.sol`, 12 tests ✓ |
| ShambaLuvAirdrop | Sybil-trivial | Rewritten signature-gated + 1% cap, 7 tests ✓ |
| MultiSend | sound | Keep for compensation push; minor notes |
| luvdat/dataluv backend | no-auth, Sybil-bypass | Replaced by `auth/` (hardened) |
| luvdrop UI | minor | notes; superseded for new signups |
| web3.js / modular-contracts / .github | forks/profile | no change |

Everything is local in `/home/hacker/DeltaVerse/shambaluv/` (clean-room "bring it home"), ready to
land back to github.com/shamba-luv.
