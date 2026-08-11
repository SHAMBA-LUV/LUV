# LUVdrip — a million LUV a day, earned by logging in

**Live substrate:** `substrate/luv-drip.js` (`DVLuvDrip`, the meter) · **ledger:**
`auth/src/actions/drip.js` (the server-side truth) · **rail:**
`IncentiveDistributor.redeemWithSignature` / `redeemBatch`.

## The rule

> **Log in, and a million LUV starts dripping.** It keeps dripping for the **entire 24 hours** that
> login armed — against the wall clock, tab open or closed, session alive or expired — until the
> whole **1,000,000 LUV** has landed. **The next million starts with the next log in.**

Logging in *is* the earning action. Nothing else is required, and nothing has to stay open.

| quantity | value |
|---|---|
| a day's drip | **1,000,000 LUV** (1e24 wei — *not* 1e27, *not* 1e30) |
| per second | **11.574074… LUV/s** ( = 1,000,000 ÷ 86,400 ) |
| per second, exact | **11,574,074,074,074,074,074.074 wei/s** (18-dp) |
| cadence | **one LUV every 86.4 ms** — a LUV lands ~11.57 times a second |
| window | **24 hours**, opened by a real sign-in |
| window cap | 1,000,000 LUV — the million fills the day and stops |
| next million | requires a **subsequent login** |

## The arithmetic — a pure function of time

Neither the meter nor the ledger counts per-second. What a window has earned is

```
window_wei = cap × min(now − window_started_at, 24h) ÷ 24h        (integer, floored)
```

so settling is **idempotent and drift-free**: ticking often, rarely, or never gives the same
answer, and no cron keeps LUV flowing. A closed tab, a slow frame, a page reload and a week
offline all resolve to the same number when the clock is next read. Full-width integer wei
throughout; rounding is display-only (cypherpunk4096: *precision without approximation*).

Because 86,400 = 2⁷·3³·5² and 3³ never divides a power of ten, the exact per-second rate does not
terminate — which is precisely why nothing is ever minted or credited per second. See
[the engine paper](https://luv.pythai.net/engine.html#s3) and [WEI_OF_LUV](WEI_OF_LUV.md).

## The window

* A **real sign-in** (the consent click / wallet signature — `upsertIdentity`) arms a window.
  A lingering session cookie is presence, not a login, and arms nothing.
* A login **inside** a still-flowing window changes nothing: that million is already flowing and
  keeps its own clock. Logging in five times in a day still earns one million that day.
* When the window's million is complete, the drip **stops** and waits. Three days away still
  yields one million, not three — the next million is the next login's to start.
* Social identities only. The Sybil unit is a social account; a wallet is free to mint endlessly.

## The tally

Settled LUV accumulates in **one number** (`drip_state.banked_wei`) that keeps growing across
windows, costs nothing to hold, and is never a queue of separate drops. It is delivered on-chain
only when someone decides it is worth a transaction.

## REDEEM — one transaction, two possible payers

The backend signs an EIP-712 **Redeem** voucher naming the recipient and the accumulated amount:

```
Redeem(address user,address token,uint256 amount,bytes32 redemptionId,uint256 deadline)
```

Submitting it is **permissionless**, so **whoever sends the transaction pays its gas** — and the
LUV lands on `user` either way:

| | who sends it | who pays the ETH | endpoint |
|---|---|---|---|
| **self-paid** | the participant's own wallet | **the participant** (their wallet requires ETH) | `POST /airdrop/drip/voucher` → `{ to, data, chainId, voucher }`, sent via `eth_sendTransaction` |
| **sponsored** | the LUV project's relayer | **the project** (the participant needs no ETH) | `POST /airdrop/redeem` (one participant) · `redeemBatch` (a whole pass) |

One rail, two payers, no roles: the signature is the whole authority.

```
log in → the million drips all day → the tally grows → REDEEM (one tx: your ETH, or ours)
```

While a voucher is live its amount is held out of the tally (`held_wei`) so the same LUV can never
be redeemed twice; if the participant never sends it, the voucher expires (`DRIP_VOUCHER_TTL_SECONDS`,
default 6h) and **the LUV returns to the tally untouched**. Nothing is ever lost by waiting, and a
retry re-offers the same voucher rather than stranding LUV in a second one.

The reconciler (`drip.reconcile()`, every `DRIP_RECONCILE_INTERVAL_MS`) settles pending vouchers
against the chain — a self-paid redemption is sent by the participant's own wallet, so the **chain**,
not the browser, is what confirms it landed.

## Sponsoring the gas

The project can pay the gas and redeem on behalf of **everyone** or a **selected set** (activity
rewards), periodically or on demand:

```sh
node src/actions/dripctl.js candidates            # who holds a redeemable tally
node src/actions/dripctl.js sponsor all [limit]   # everyone — one redeemBatch per 100
node src/actions/dripctl.js sponsor github:123 google:456   # a chosen set
node src/actions/dripctl.js status [identity]     # the ledger, or one participant's meter
node src/actions/dripctl.js reconcile
node src/actions/dripctl.js import-legacy [--dry] # fold pre-drip 'accrued' rows in, at 1M/day
```

`redeemBatch` settles up to 200 participants in one transaction and **skips** (never reverts on)
stale, expired or already-redeemed entries, so one bad voucher cannot wedge a sponsorship run.
Guardrails mirror the sponsored-claim path: `SPONSOR_MAX_GWEI` ceiling + relayer balance (`--force`
overrides the ceiling deliberately). A standing periodic pass is available but **off by default**
(`DRIP_SPONSOR_AUTO_INTERVAL_MS=0`) — sponsorship is a decision the operator makes, not a silent
spend that starts by itself.

## The reward amount is a VARIABLE — on-chain, retunable live

The day's amount and the asset it pays in live **on the distributor**, so the reward is governed
where every other reward is, and the chain is the final word:

```solidity
uint256 public dripPerDay;   // the day's amount, base units (deploy default: 1,000,000 LUV)
address public dripToken;    // the asset it pays in
function setDrip(address token, uint256 perDay) external onlyOwner;
```

The backend reads both (cached 60s) and falls back to `DRIP_DAILY_LUV` only when no distributor is
configured. **A window keeps the cap it was armed with**, so a retune never rewrites a day already
flowing — it takes effect on the next window a login arms. `GET /airdrop/drip` returns the current
window's figure as `dailyWei` and what the next login will arm as `nextDailyWei`.
`setDrip(token, 0)` **pauses** the drip: no new window is armed, and accumulated tallies are
untouched and still redeemable.

## Any ERC-20 — assets can be added and removed

The distributor is multi-token: it **holds LUV and any other ERC-20**, pays each action (and each
redemption) in the asset that action names, and keeps an enumerable registry of what it deals in.

```solidity
function addAsset(address token) external onlyOwner;             // register (idempotent)
function removeAsset(address token, address to) external onlyOwner; // sweep to `to` + deregister
function assets() external view returns (address[] memory);
function assetCount() external view returns (uint256);
function assetBalances() external view returns (address[] memory tokens, uint256[] memory balances);
mapping(address => bool) public isAsset;
```

- Funding an asset (`fund`), configuring an action that pays it (`setAction`), pointing the drip at
  it (`setDrip`) or paying it out all **register it automatically** — the registry never lies about
  what the contract holds.
- `removeAsset` sweeps the remaining balance to `to` (pass `address(0)` to leave it) and
  deregisters. It **refuses** while any ACTIVE action — or the drip itself — still pays in that
  asset, so a live reward can never be orphaned: deactivate those first. A removed asset can be
  added back at any time.
- A redemption may only name a **registered** asset — a further bound on the signer key.
- There is **no `receive()`**: the contract deals in ERC-20s only, so native ETH can never be sent
  here and stranded.

## Contract surface (IncentiveDistributor)

```solidity
function redeemWithSignature(address user, address token, uint256 amount,
                             bytes32 redemptionId, uint256 deadline, bytes signature) external;
function redeemBatch(Redemption[] calldata rs) external returns (uint256 delivered);
function redeemDigest(...) external view returns (bytes32);
function isRedeemed(bytes32 redemptionId) external view returns (bool);
function setRedeemBudgetPerDay(uint256 amount) external onlyOwner;   // 0 = unlimited
function redeemBudgetRemaining() external view returns (uint256);
```

The rail honours a **verified COLLECT**: whatever the backend has verified as earned — the daily
drip, and any other earning it credits to the tally — is delivered as one signed amount.

**Blast radius.** Unlike `claimWithSignature` (amount from the registry), the redeemed amount is
*signed* by the backend, so a compromised signer key could invent amounts. It is bounded three
ways — `maxRewardPerTx` per redemption, `redeemBudgetPerDay` across every redemption in a UTC day,
and single-use `redemptionId`s. **Set a per-day budget before funding the distributor** (audit D-H1).

## Configuration

| env | default | meaning |
|---|---|---|
| `DRIP_DAILY_LUV` | `1000000` | the day's drip, in whole LUV |
| `DRIP_MIN_REDEEM_LUV` | `1000000` | never spend a transaction on less |
| `DRIP_VOUCHER_TTL_SECONDS` | `21600` | how long a redemption voucher stays sendable |
| `DRIP_SPONSOR` | `true` | may the project sponsor gas at all |
| `DRIP_SPONSOR_BATCH_SIZE` | `100` | participants per sponsored transaction (≤200) |
| `DRIP_SPONSOR_AUTO_INTERVAL_MS` | `0` (off) | standing periodic sponsored pass |
| `DRIP_RECONCILE_INTERVAL_MS` | `60000` | how often pending vouchers are checked on-chain |

## API

```
GET  /airdrop/drip           → { dailyLuv, dailyWei, nextDailyWei, perSecond, windowStartedAt, windowEndsAt,
                                 windowWei, windowRemainingWei, capWei, flowing, full,
                                 accrued, heldWei, redeemedWei, windows, needsLogin,
                                 minRedeemWei, serverNow, voucher }
POST /airdrop/drip/voucher   → { to, data, chainId, voucher, amount }   # you send it, you pay
POST /airdrop/redeem         → { ok, txHash, redeemed, payer:'sponsor' } # we send it, we pay
GET  /airdrop/gas            → …, redeemGas, redeemFeeEth, redeemFeeUsd, sponsorActive
GET  /airdrop/drop           → DEPRECATED alias mapping the drip onto the old field names
POST /airdrop/return         → DEPRECATED no-op (there is nothing to claim)
```

## Integration

```html
<div data-luvdrip data-daily="1000000"></div>
<script src="substrate/luv-drip.js?v=3"></script>
```

```js
const meter = document.querySelector('[data-luvdrip]').__drip;   // or new DVLuvDrip.Drip({mount})
meter.sync(await (await fetch('/airdrop/drip')).json());  // server state — window + tally + skew
meter.windowLuv();      // LUV earned inside this window, right now
meter.remaining();      // seconds until this million is complete
meter.accruedWei();     // the accumulated tally (wei string)
meter.full();           // this window's million is complete — the next needs a login
```

Styling hooks: `.drip-flow(.on)`, `.drip-amt` / `.drip-unit` / `.drip-of`, `.drip-bar > span`,
`.drip-meta` / `.drip-mode`, `.drip-tally`, `.drip-buy` (the Uniswap USDC → LUV preset). The mount
gets `data-drip-full="1"` when the day's million is complete.

## Properties

- **A million a day, for logging in** — the amount is 1,000,000 LUV, the standard gesture.
- **The full 24 hours** — presence-free: the drip does not require the tab, the session, or attention.
- **One growing tally** — accumulation is a value, not a queue; it costs nothing until delivered.
- **The gas is honest** — delivering on-chain costs ETH, and the dashboard shows the tally's USD value
  next to the estimated fee so the choice to redeem is informed and the participant's own.
- **Nobody is excluded for lack of ETH** — the project can sponsor the identical voucher.
- **Reduced motion** — the value still advances; the visual cadence slows to 1 s.
- **thanks a million** — the drip is the acknowledgement, paid a LUV at a time, all day long.

## Tests

```sh
cd auth && npm run selftest:drip     # the arithmetic + the EIP-712 Redeem voucher (no db, no chain)
cd auth && npm run selftest:drip-e2e # the WHOLE flow against a real postgres + anvil: login arms a
                                     # million, it drips 24h unwatched, the tally accumulates, and
                                     # both rails deliver — the participant paying their own ETH,
                                     # and an ETH-less participant paid by a sponsored batch
forge test --match-path test/IncentiveDistributor.t.sol   # the on-chain rail: self-paid, sponsored,
                                     # replay, budget, batch-skip, signer rotation, the settable
                                     # drip rate, and the asset registry (add / pay / remove)
```

The e2e prints what actually happened, including the ETH the participant spent:

```
ok  - at 24 hours the tally is EXACTLY 1,000,000 LUV
ok  - the participant received 2,000,000 LUV on-chain
ok  - and PAID THE GAS themselves: 0.000141057535396601 ETH (138101 gas × 1021408501 wei)
ok  - the ETH-less participant received 1,000,000 LUV — gas paid by the project
```
