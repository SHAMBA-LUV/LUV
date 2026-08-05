# The daily LUVdrop — go-live runbook

**The offer (operator, 2026-08-05):** a **1 billion LUV signup bonus** (`welcome`, once ever)
and **1 billion LUV every day you return** (`return`, one drop per participant per 24h),
delivered through the IncentiveDistributor tasks rail. Each participant sees a live
`hh:mm:ss` countdown to their next drop on the dashboard; the drop collects itself the
moment the clock opens. No proof, no task — coming back IS the action.

## What is already live (code, deployed with this commit)

- Backend presence claims: `welcome` auto-fires on the consent click (`POST /auth/enter`),
  `return` fires when a participant's 24h window opens — via `POST /airdrop/return`, called
  automatically by the dashboard. Clock endpoint: `GET /airdrop/drop` (nextAt + serverNow).
  Social identities only (the Sybil unit); MetaMask sessions see no drop panel.
- Per-participant clock: first drop = signup + 24h, then last drop + 24h. The server clock
  drives the countdown; the contract's own `return` cooldown (86400s) enforces the same
  spacing at payout, so the backend can never out-pace the chain.
- Rows enter `approved` directly (presence needs no review); the payout worker relays
  `claimWithSignature` every 60s and leaves rows waiting whenever `canPerform` says the
  on-chain window hasn't opened yet.

## What ONLY bankon.eth can do (required before any LUV moves)

All four transactions go to the **IncentiveDistributor**
`0x607E477AB12406A3294A7Ba63817103f92D8f806` except the funding transfer (to the LUV token).
Etherscan → Contract → Write, or send raw calldata. Order matters only in that **funding
should come last** (nothing pays until then, which is the safe direction).

1. **Retune `welcome` to 1 billion** (currently 1 trillion, one-time):
   `setAction("welcome", 0x2711111111683B8708cb9a48cBf36a51315F8254, 1000000000000000000000000000, 0, 0, true, true)`
   ```
   0xfabea92e00000000000000000000000000000000000000000000000000000000000000e00000000000000000000000002711111111683b8708cb9a48cbf36a51315f82540000000000000000000000000000000000000000033b2e3c9fd0803ce80000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000777656c636f6d6500000000000000000000000000000000000000000000000000
   ```
2. **Create `return` — 1 billion, 1/day, 24h cooldown:**
   `setAction("return", 0x2711…8254, 1000000000000000000000000000, 1, 86400, false, true)`
   ```
   0xfabea92e00000000000000000000000000000000000000000000000000000000000000e00000000000000000000000002711111111683b8708cb9a48cbf36a51315f82540000000000000000000000000000000000000000033b2e3c9fd0803ce80000000000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000001518000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000672657475726e0000000000000000000000000000000000000000000000000000
   ```
3. **Point the contract at the platform voucher signer** (currently `signer` == owner, so
   NO backend payout can clear until this is sent). Same dedicated key as the airdrop
   contract — `0xD7c34d28c748ceF3F83539268C07b417B86543Ff`:
   `setSigner(0xD7c34d28c748ceF3F83539268C07b417B86543Ff)`
   ```
   0x6c19e783000000000000000000000000d7c34d28c748cef3f83539268c07b417b86543ff
   ```
4. **Grant the relayer the `distributor` role — the REDEEM rail runs on it.** Drops
   ACCRUE off-chain (a 1B drop is worth far less than its gas); the participant redeems
   the accumulated total in ONE `distributeReward(user, total)` tx, and only the
   `distributor` role may call it. Relayer: `0xe7a4c0BC457e0D722595Da55E86724B81B20D685`:
   `setDistributor(0xe7a4c0BC457e0D722595Da55E86724B81B20D685, true)`
   ```
   0xd59ba0df000000000000000000000000e7a4c0bc457e0d722595da55e86724b81b20d6850000000000000000000000000000000000000000000000000000000000000001
   ```
   Note: `distributeReward` records under the `interaction` action (legacy backend ABI) and
   is capped by `maxRewardPerTx` = 1T LUV per tx (= 1000 accumulated drops; overflow simply
   stays accrued for the next redeem). The dashboard shows the participant the USD value of
   their accumulated LUV next to the estimated redeem gas, so redeeming is an informed,
   participant-timed choice — never an automatic gas burn.
5. **(Standing item) retune `tweet` to the published 50B / 3-per-day / 1h terms:**
   `setAction("tweet", 0x2711…8254, 50000000000000000000000000000, 3, 3600, false, true)`
   ```
   0xfabea92e00000000000000000000000000000000000000000000000000000000000000e00000000000000000000000002711111111683b8708cb9a48cbf36a51315f82540000000000000000000000000000000000000000a18f07d736b90be55000000000000000000000000000000000000000000000000000000000000000000000030000000000000000000000000000000000000000000000000000000000000e100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000057477656574000000000000000000000000000000000000000000000000000000
   ```
6. **Fund the distributor — it holds 0 LUV today.** ERC-20 transfer **to the LUV token**
   `0x2711111111683B8708cb9a48cBf36a51315F8254` from the treasury. A 10-trillion start
   covers 10,000 drops (wallet→contract transfer, 0 fee; top up any time; `withdraw`
   recovers unspent LUV):
   `transfer(0x607E477AB12406A3294A7Ba63817103f92D8f806, 10000000000000000000000000000000)`
   ```
   0xa9059cbb000000000000000000000000607e477ab12406a3294a7ba63817103f92d8f806000000000000000000000000000000000000007e37be2022c0914b2680000000
   ```
   ⚠ The distributor must stay **fee-excluded and reflection-positioned exactly as deployed**
   (deploy wiring) so contract→wallet payouts arrive whole.

## Verify after sending

- `getAction("return")` → (LUV, 1e27, 1, 86400, false, true); `signer()` → `0xD7c3…43Ff`;
  LUV `balanceOf(0x607E…f806)` ≥ funding amount.
- Sign in fresh on https://luv.pythai.net/ → consent → dashboard shows the LUVdrop panel;
  the first `welcome` payout lands with the next 60s sweep (watch `RewardClaimed` events
  and `journalctl -u luv.service`).
- The countdown reads `hh:mm:ss` to the participant's own next drop and self-collects at
  zero.
