# The daily LUVdrip — go-live runbook

**The offer (operator, 2026-08-11 — SUPERSEDES the 1-billion terms):**

> **A million LUV a day, earned by LOGGING IN.** One sign-in arms a 24-hour window in which
> **1,000,000 LUV** drips continuously — 11.574074… LUV/s, wall-clock, tab open or closed —
> until the whole million has landed. **The next million starts with the next log in.**
> The tally accumulates, and is delivered on-chain in one transaction whose gas is paid
> **by the participant from their own wallet**, or **sponsored by the LUV project**.

Mechanics, arithmetic and API: [`docs/LUVDRIP.md`](LUVDRIP.md).

## What is already live (code, deployed with this commit)

- **The ledger**: `auth/src/actions/drip.js` + `drip_state` / `drip_redemptions`. A real
  sign-in (`upsertIdentity`, i.e. the consent click / wallet signature) arms the window; a
  login inside a still-flowing window changes nothing. Social identities only (the Sybil
  unit); MetaMask sessions see no drip panel.
- **Presence-free accrual**: `window_wei = cap × min(now − start, 24h) ÷ 24h`, settled on
  read. No cron keeps LUV flowing, and a closed tab costs the participant nothing.
- **The meter**: `substrate/luv-drip.js` v2 (`?v=3`), server-synced, counting against the
  server clock so meter and ledger never disagree.
- **Two redeem rails**: `POST /airdrop/drip/voucher` (self-paid — the participant's wallet
  submits and spends its ETH) and `POST /airdrop/redeem` (sponsored — the relayer submits
  and the project pays). Operator pass: `node src/actions/dripctl.js sponsor all|<keys…>`.
- **Reconciler**: pending vouchers are checked against the chain every 60s; expired ones
  return their LUV to the tally.

## ⚠ The redeem rail needs a NEW distributor deployment

The live IncentiveDistributor `0x607E477AB12406A3294A7Ba63817103f92D8f806` **does not carry
`redeemWithSignature` / `redeemBatch`** — they were added to
[`IncentiveDistributor.sol`](../contracts/IncentiveDistributor.sol) for this drip, and the
contract is deliberately non-upgradeable (cypherpunk4096: no proxies, no admin backdoors).
It has never been funded and has never paid anything, so **now is the cheapest moment to
redeploy**. Constructor: `(defaultToken = LUV, signer_ = 0xD7c34d28c748ceF3F83539268C07b417B86543Ff)`.

Until the new distributor is deployed and `INCENTIVE_DISTRIBUTOR_ADDRESS` points at it, the
drip still **accrues** correctly for every participant — only delivery waits.

Selectors on the new rail: `redeemWithSignature` `0x0fbc675b` · `redeemBatch` `0x77fefaf3` ·
`setDrip` `0xbf08b69d` · `addAsset` `0x298410e5` · `removeAsset` `0xd34c35cb`.

⚠ **Build profile: solc 0.8.24, optimizer on (200 runs), `via_ir` OFF.** This repo's own
`foundry.toml` sets `via_ir = true`, which together with the optimizer miscompiles
`_eligible` — build and verify the distributor with via_ir disabled (as the DeltaVerse suite
does). The test suite for this contract lives with that build profile: 70 tests, including the
whole redeem rail, the settable drip rate and the asset registry.

## What ONLY bankon.eth can do (required before any LUV moves)

All transactions go to the **new IncentiveDistributor** except the funding transfer (to the
LUV token). Order matters only in that **funding should come last** — nothing pays until then,
which is the safe direction.

1. **Deploy** the updated `IncentiveDistributor` (see above) and set
   `INCENTIVE_DISTRIBUTOR_ADDRESS` in `luv.env`, then `systemctl restart luv`.

2. **Retune `welcome` to a million** (the deploy seeds it at 1 trillion, one-time):
   `setAction("welcome", 0x2711111111683B8708cb9a48cBf36a51315F8254, 1000000000000000000000000, 0, 0, true, true)`
   ```
   0xfabea92e00000000000000000000000000000000000000000000000000000000000000e00000000000000000000000002711111111683b8708cb9a48cbf36a51315f825400000000000000000000000000000000000000000000d3c21bcecceda10000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000777656c636f6d6500000000000000000000000000000000000000000000000000
   ```

3. **Create `return` — a million, 1/day, 24h cooldown** (the published daily figure; the drip
   itself pays through the redeem rail, not this action):
   `setAction("return", 0x2711…8254, 1000000000000000000000000, 1, 86400, false, true)`
   ```
   0xfabea92e00000000000000000000000000000000000000000000000000000000000000e00000000000000000000000002711111111683b8708cb9a48cbf36a51315f825400000000000000000000000000000000000000000000d3c21bcecceda10000000000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000001518000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000672657475726e0000000000000000000000000000000000000000000000000000
   ```

4. **Point the contract at the platform voucher signer** — the same dedicated key as the
   airdrop contract, and the key that signs every redemption. Nothing clears until this lands:
   `setSigner(0xD7c34d28c748ceF3F83539268C07b417B86543Ff)`
   ```
   0x6c19e783000000000000000000000000d7c34d28c748cef3f83539268c07b417b86543ff
   ```

5. **Bound the signer key's blast radius — do this BEFORE funding** (audit D-H1). The redeemed
   amount is signed rather than read from the registry, so cap it two ways:
   - per transaction — **1,000,000,000 LUV** (1,000 days of drip; the deploy default is 1T):
     `setMaxRewardPerTx(1000000000000000000000000000)`
     ```
     0x5128f6e30000000000000000000000000000000000000000033b2e3c9fd0803ce8000000
     ```
   - per UTC day, across **all** participants — **10,000,000,000 LUV** (10,000 participant-days;
     size it at a few × the expected daily redemption volume, 0 = unlimited):
     `setRedeemBudgetPerDay(10000000000000000000000000000)`
     ```
     0xc86228320000000000000000000000000000000000000000204fce5e3e25026110000000
     ```
   A batch that runs past the day's budget delivers what fits and **skips** the rest — the
   leftovers keep their unused ids and settle on the next pass.

6. **Publish the drip's rate on-chain — the reward is a VARIABLE.** The deploy already seeds
   `dripPerDay = 1,000,000 LUV` in the LUV asset; send this only to confirm it explicitly, or
   whenever the rate is retuned. The backend reads it live (cached 60s) and arms each new
   window with it; a window already flowing keeps the amount it was armed with, and
   `setDrip(token, 0)` pauses the drip without touching anyone's accumulated tally:
   `setDrip(0x2711…8254, 1000000000000000000000000)`
   ```
   0xbf08b69d0000000000000000000000002711111111683b8708cb9a48cbf36a51315f825400000000000000000000000000000000000000000000d3c21bcecceda1000000
   ```

7. **Grant the relayer the `distributor` role** — only needed for the *legacy* push paths
   (`distribute` / `distributeReward`). **The redeem rail does not need it**: submitting a
   voucher is permissionless, which is exactly why the participant can pay their own gas and
   why the project can sponsor the identical voucher. Relayer
   `0xe7a4c0BC457e0D722595Da55E86724B81B20D685`:
   `setDistributor(0xe7a4c0BC457e0D722595Da55E86724B81B20D685, true)`
   ```
   0xd59ba0df000000000000000000000000e7a4c0bc457e0d722595da55e86724b81b20d6850000000000000000000000000000000000000000000000000000000000000001
   ```

8. **Retune `tweet` to the sliding-scale terms: 3,333,333,333 LUV per tweet, 8h between
   tweets, 3/day** — 3 tweets/day earn 9,999,999,999 LUV; with the day's million the ceiling
   is 10,000,999,999. The scale slides with price; retune as LUV appreciates:
   `setAction("tweet", 0x2711…8254, 3333333333000000000000000000, 3, 28800, false, true)`
   ```
   0xfabea92e00000000000000000000000000000000000000000000000000000000000000e00000000000000000000000002711111111683b8708cb9a48cbf36a51315f825400000000000000000000000000000000000000000ac544ca1016c3e478340000000000000000000000000000000000000000000000000000000000000000000300000000000000000000000000000000000000000000000000000000000070800000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000057477656574000000000000000000000000000000000000000000000000000000
   ```
   The backend additionally enforces the **daily-login timer** (`ACTIONS_DAILY_LOGIN_GATE`,
   on by default): earn submissions only count on days the participant actually signed in —
   a lingering session cookie doesn't start the day's timer (`identities.last_login_at`,
   stamped by the consent click / wallet signature).

9. **Fund the distributor — it holds 0 LUV today.** ERC-20 transfer **to the LUV token**
   `0x2711111111683B8708cb9a48cBf36a51315F8254` from the treasury, naming the NEW distributor
   as recipient. At a million a day, 10 trillion LUV covers 10,000,000 participant-days
   (wallet→contract transfer, 0 fee; top up any time; `withdraw` recovers unspent LUV):
   `transfer(<new distributor>, 10000000000000000000000000000000)`

   ⚠ The distributor must be **fee-exempt** (`LUV.setFeeExemption(dist, true)`) and
   **maxTx-exempt** (`LUV.setMaxTxExemption(dist, true)`) so contract→wallet payouts arrive whole.

## Assets — LUV and anything else, added and removed

The distributor holds **LUV and any other ERC-20**, and keeps an enumerable registry of what it
deals in (`assets()`, `assetBalances()`, `isAsset(token)`). Funding an asset, configuring an action
that pays it, or pointing the drip at it registers it automatically; `addAsset(token)` declares one
up front (selector `0x298410e5`), and `removeAsset(token, to)` sweeps the remaining balance to `to`
and deregisters it (`0xd34c35cb`) — refused while an ACTIVE action, or the drip itself, still pays
in it, so a live reward is never orphaned. A removed asset can be added back at any time. There is
no `receive()`: the contract deals in ERC-20s only, so native ETH can never be stranded in it.

To run a partner campaign in another token: `addAsset(PARTNER)` → transfer the budget in →
`setAction("partner-quest", PARTNER, amount, …)`. To wind it down:
`setActionActive("partner-quest", false)` → `removeAsset(PARTNER, treasury)`.

## Verify after sending

- `getAction("return")` → (LUV, **1e24**, 1, 86400, false, true); `signer()` → `0xD7c3…43Ff`;
  `maxRewardPerTx()` and `redeemBudgetRemaining()` non-zero; LUV `balanceOf(<dist>)` ≥ funding.
- `node src/actions/dripctl.js status` → participants, windows armed, accumulated, redeemed.
- Sign in fresh on https://luv.pythai.net/ → consent → the dashboard shows the LUVdrip meter
  filling and a countdown to the completion of today's million.
- Redeem end-to-end **both ways**: press *REDEEM — I'll send it* from a wallet holding ETH, and
  run `node src/actions/dripctl.js sponsor <identity>` for the sponsored path. Watch the
  `Redeemed(user, redemptionId, token, amount, payer)` events — `payer` shows who paid the gas.

## Legacy balances

Participants who accrued under the old lump model have `action_submissions` rows in status
`accrued`, written at the (superseded) 1e27 figure. They are **not** imported automatically.
To honour them at the corrected rate — each daily drop counted as one day of drip, 1,000,000 LUV:

```sh
node src/actions/dripctl.js import-legacy --dry   # see exactly what would be credited
node src/actions/dripctl.js import-legacy         # credit it; rows become 'migrated'
```

## The broadcast rail — multisend suite (LUVbus)

The distributor above is the **earn rail**: per-identity, policy-gated, voucher-signed.
The LUVdrop suite also carries a **broadcast rail** for cohort-wide sends that don't fit
per-identity policy — compensation sweeps, partner drops, clearing a gesture backlog in
one transaction:

- **Contract:** [`contracts/LUVbus.sol`](../contracts/LUVbus.sol) — Ethereum batch
  multisend, zero dependencies, custom errors, calldata-lean modes ordered by cost
  (`UsingDefault` cheapest → `Uniform` → `EqualSplit` → variable), one-way `retire()`
  switch, renounce + direct ownership handoff. Polygon reference:
  [`contracts/MultiSend.sol`](../contracts/MultiSend.sol) · suite doc:
  [`docs/MULTISEND.md`](MULTISEND.md) (ops home: DeltaVerse `deploy/multisend/`).
- **Console:** https://luv.pythai.net/luvbus.html — diagnostics + ABI interaction via the
  wallet provider only.
- **Owner wiring (same discipline as the distributor):** after deploying the bus,
  `LUV.setFeeExemption(bus, true)` + `LUV.setMaxTxExemption(bus, true)`, then
  `LUVbus.setDefaultERC20Amount(LUV, seatAmount)` so cohort drops ride the
  addresses-only mode. Fund the bus **last**, drive
  `multiSendERC20UsingDefault(LUV, cohort[])`, and `withdrawERC20`/`retire()` when the
  campaign closes.
- **Boundary:** the bus never replaces the distributor — earn stays policy-gated and
  per-identity; the bus is owner-driven and cohort-wide. Both fee-exempt, separate
  accounting.
