# collateral — MakerDAO-style collateralised gold

Lock **existing on-chain gold pegs** (PAXG, XAUT, …) and borrow **bXAU**, where **1 bXAU = one fine troy ounce
of gold**. Every number in the system is in ounces of gold, not dollars: what matters for solvency is how well
each peg holds its peg.

It is a self-contained Foundry project with no external libraries (not even forge-std),
Solidity 0.8.24.

| | |
|---|---|
| Version | 0.4.0 (keeper bot, monitor, FlashKeeper; see [Changelog](#changelog)) |
| Tests | 43 Foundry tests plus 14 end-to-end checks on a live local chain |
| Chain | Ethereum mainnet (addresses verified on-chain on 2026-11-07) |
| Status | **Not audited. Not deployed.** |

---

## Contents

1. [Layout](#layout)
2. [Quick start](#quick-start)
3. [How it works](#how-it-works)
4. [Units and the core formulas](#units-and-the-core-formulas)
5. [Usage: borrowers](#usage-borrowers)
6. [Usage: keepers](#usage-keepers)
7. [Usage: governance](#usage-governance)
8. [Emergency shutdown](#emergency-shutdown)
9. [Contract reference](#contract-reference)
10. [Keeper bot and monitor](#keeper-bot-and-monitor)
11. [Deployment](#deployment)
12. [Risk parameters](#risk-parameters)
13. [Security model and known limits](#security-model-and-known-limits)
14. [Tests](#tests)
15. [Changelog](#changelog)

---

## Layout

```
collateral/
├── src/
│   ├── BasketGold.sol      bXAU: the debt token (ERC-20, 18 dec). Only the vault can mint.
│   ├── PegSpotter.sol      Oracle: prices each peg in ounces using Chainlink.
│   ├── GoldVault.sol       CDP engine: positions, fees, liquidation, surplus, shutdown.
│   ├── GoldTimelock.sol    Governance delay: GOV schedules, anyone executes after the delay.
│   ├── GoldGuardian.sol    Emergency brake: GOV can cage() instantly, and nothing else.
│   ├── GoldFlash.sol       ERC-3156 flash-mint of bXAU for keepers (zero fee, net-zero supply).
│   └── FlashKeeper.sol     Capital-free liquidator: flash-mint → liquidate → sell on any DEX → repay.
├── keeper/                 Off-chain bots (Node ≥ 18, ethers 6)
│   ├── keeper.mjs          Finds unsafe urns and liquidates them (direct, or via FlashKeeper).
│   ├── monitor.mjs         Governance and health alerts to stdout and a webhook.
│   ├── e2e.mjs             Runs both against a local anvil with the full system deployed.
│   └── lib.mjs, package.json
├── script/
│   └── DeployGoldVault.s.sol   Mainnet deployment; sets up the authority layout and asserts it.
├── test/
│   ├── GoldVault.t.sol         26 behaviour tests.
│   ├── GoldGovernance.t.sol    11 tests: timelock, guardian, flash-mint, flash-liquidation.
│   ├── FlashKeeper.t.sol       5 tests: profit, profit floor, repayment, access, router rules.
│   ├── DeployGoldVault.t.sol   Runs the real deploy script against stand-ins etched at mainnet addresses.
│   ├── GoldMocks.sol           PAXG-like (fee-on-transfer), XAUT-like (6 dec, no-return) and feed mocks.
│   └── TwTest.sol              Minimal test base (no forge-std).
├── foundry.toml
├── Makefile
└── README.md
```

Maker equivalents:

| Maker | Here |
|---|---|
| Dai | `BasketGold` (bXAU) |
| Vat, GemJoin, DaiJoin | `GoldVault` storage with `lock`, `free`, `draw`, `wipe`, `wipeAll` |
| Jug | `drip()` |
| Spotter / OSM | `PegSpotter.peek()` plus `GoldVault.poke()` and `lastPrice` |
| Dog / Clipper | `liquidate()`: fixed discount, partial fills allowed |
| Vow | `surplus`, `sin`, `heal()`, `flap()` |
| End | `cage()`, `skim()`, `thaw()`, `cash()`, `sweep()` |
| DSPause | `GoldTimelock` |
| ESM | `GoldGuardian` |
| DssFlash | `GoldFlash` |

---

## Quick start

```bash
curl -L https://foundry.paradigm.xyz | bash && foundryup   # once
unzip collateral.zip && cd collateral
make test           # or: forge test -vv
make build          # contract sizes
make gas            # gas report
make e2e            # keeper + monitor end-to-end on a local anvil (needs Node ≥ 18)
```

---

## How it works

1. **Lock.** A borrower deposits a gold peg into a position (an *urn*) for that peg's *ilk*, for example
   `PAXG-A`.
2. **Draw.** They mint bXAU up to the locked ounces divided by the liquidation ratio `mat`. With `mat` at 120%,
   12 oz of PAXG at par supports up to 10 bXAU.
3. **Fees.** Debt grows by the stability fee `duty`, compounding every second. Fees accrue to `surplus`.
4. **Repay.** `wipe` or `wipeAll` burns bXAU, after which `free` returns the collateral.
5. **Liquidation.** If a peg slips, or fees grow the debt past the ratio, any keeper can repay the debt with
   bXAU and receive the collateral at a `chop` discount.
6. **Shutdown.** Governance can `cage` the system. Positions are then settled at the cage price and bXAU holders
   redeem a pro-rata share of every peg in the basket.

### Pricing "from existing pegs"

```
price(ilk) = min( par,  pegUSD / xauUSD · par )        // oz of gold per whole collateral token
```

| Input | Meaning |
|---|---|
| `par` | Ounces the issuer redeems per token. PAXG and XAUT are both 1 oz, so `1e18`. |
| `pegUSD` | Chainlink feed for the peg token, for example PAXG/USD. Optional: with no feed the peg is priced at par. |
| `xauUSD` | Chainlink XAU/USD, shared by every ilk. |

- **Premium capped.** A peg trading above spot gold is valued at par, so nobody borrows against a premium.
- **Discount passed through.** A depeg lowers borrowing power and can trigger liquidation.
- **Depeg floor.** Below `floor` (for example 0.97 oz/token) no new debt can be drawn.
- **Stale feeds halt pricing.** A feed older than its `maxAge`, a non-positive answer or a reverting spotter
  reads as *oracle down*. `draw`, `free` with open debt, and `liquidate` then revert with `OracleDown`.
  `lock`, `wipe` and `wipeAll` keep working, so users can always add collateral or repay.
- **Last good price.** Every successful price read is stored as `lastPrice[ilk]`. Keepers can refresh it with
  `poke(ilk)`. `cage()` falls back to it if the oracle is down at shutdown.

---

## Units and the core formulas

Maker's fixed-point units:

| Name | Scale | Used for |
|---|---|---|
| WAD | 1e18 | bXAU amounts, `ink`, `art`, `price`, `chop`, `line`, `dust`, `floor` |
| RAY | 1e27 | `rate`, `duty`, `mat` |
| RAD | 1e45 | `debt`, `surplus`, `sin` (WAD × RAY) |

| Quantity | Formula |
|---|---|
| Collateral in an urn | `ink` = native amount × `scale`, where `scale = 10^(18 − token decimals)` |
| Debt of an urn, in oz | `art · rate / RAY` (rounded up when repaying in full) |
| Safety | `safe ⇔ ink · price · RAY / mat ≥ art · rate` |
| Fee accrual | `rate ← rate · duty^(now − rho)` |
| Books identity | `debt + sin == bXAU.totalSupply · RAY + surplus` |

Every RAD of debt is either a bXAU in circulation, accrued surplus, or written-off bad debt. The tests assert
the books identity after each flow.

---

## Usage: borrowers

The examples use `cast` with `VAULT`, `BXAU`, `PAXG` and `XAUT` set to the deployed addresses. Ilk names are
`bytes32`:

```bash
ILK=$(cast --format-bytes32-string "PAXG-A")
```

**Open a position**

```bash
cast send $PAXG  "approve(address,uint256)" $VAULT 12000000000000000000          # 12 PAXG
cast send $VAULT "lock(bytes32,uint256)"    $ILK   12000000000000000000          # native units
cast send $VAULT "draw(bytes32,uint256)"    $ILK    9000000000000000000          # 9 bXAU
```

- PAXG charges a 0.02% transfer fee, so `lock` credits only what actually arrives.
- XAUT has 6 decimals: 12 XAUT is `12000000`.

**Check it**

```bash
cast call $VAULT "urns(bytes32,address)(uint256,uint256)" $ILK $ME   # ink, art
cast call $VAULT "owed(bytes32,address)(uint256)"         $ILK $ME   # oz owed now, fees included
cast call $VAULT "isSafe(bytes32,address)(bool)"          $ILK $ME   # would liquidate() reject it?
```

**Repay and withdraw**

```bash
cast send $BXAU  "approve(address,uint256)" $VAULT $(cast max-uint)
cast send $VAULT "wipe(bytes32,uint256)"    $ILK 4000000000000000000   # partial; the rest must stay ≥ dust
cast send $VAULT "wipeAll(bytes32)"         $ILK                       # close: burns owed() exactly
cast send $VAULT "free(bytes32,uint256)"    $ILK 12000000000000000000  # native units; must stay safe while in debt
```

`wipeAll` usually needs slightly more bXAU than you drew, because fees accrue. Buy or borrow the difference
first.

**Reverts you may see**

| Error | Meaning |
|---|---|
| `NotSafe` | The position would fall below `mat`. |
| `Dusty` | The debt left behind would be below `dust`. |
| `CeilingExceeded` | The ilk `line` or the global `Line` is full. |
| `Depegged` | The peg is trading below `floor`, so no new debt. |
| `OracleDown` | A feed is stale or invalid. |
| `NotLive` | The system has been caged. |

---

## Usage: keepers

**Find unsafe positions.** Index `Lock` and `Draw` events, then call `isSafe(ilk, urn)`. It includes fees that
have not been dripped yet, so it matches what `liquidate` will accept.

**Liquidate.** You need bXAU to burn, either held already or flash-minted (see below).

```bash
cast send $BXAU  "approve(address,uint256)" $VAULT $(cast max-uint)
cast send $VAULT "liquidate(bytes32,address,uint256)(uint256,uint256)" $ILK $URN $(cast max-uint)
```

Every oz of bXAU you burn buys `chop` oz worth of collateral. For example, with `chop` at 1.05 and PAXG at
0.90 oz, burning 10 bXAU returns 10 × 1.05 / 0.90 = 11.67 PAXG.

| Case | What happens |
|---|---|
| Partial | Pass `maxWad` below the debt. The remainder must be ≥ `dust`, otherwise `Dusty`. |
| Collateral worth ≥ debt but < debt × chop | You repay the **whole** debt and receive **all** collateral. Your bonus shrinks to value/debt and the protocol books no loss. |
| Collateral worth < debt (true insolvency) | You repay value / chop for all of it. The rest is written to `sin`. |
| `maxWad` too low | If taking all the collateral would require burning more than `maxWad`, the call reverts with `OverMax`. |

**Liquidate with no bXAU (flash-mint).** `GoldFlash` is a standard ERC-3156 lender, so any ERC-3156 borrower
works. Your contract's `onFlashLoan`:

1. Approves the vault and calls `liquidate(ilk, urn, amount)`. It receives the seized collateral.
2. Sells enough of that collateral on a DEX to buy back the `wad` the vault burned.
3. Approves `GoldFlash` for `amount` and returns `keccak256("ERC3156FlashBorrower.onFlashLoan")`.

`GoldFlash` then burns `amount` from your contract and you keep the rest of the collateral.
For a ready-made version, deploy `src/FlashKeeper.sol` and run the [keeper bot](#keeper-bot-and-monitor),
which builds the swap and drives it.

```solidity
flash.flashLoan(myKeeper, address(bxau), amount, abi.encode(ilk, urn));
```

| Flash rule | |
|---|---|
| Fee | 0 |
| Per-call ceiling | `max` (500 oz at launch, settable via the timelock). `maxFlashLoan(bXAU)` returns it. |
| After cage | Disabled: `maxFlashLoan` returns 0 and `flashLoan` reverts with `NotLive`. |
| Reentrancy | Nested flash loans revert. |
| Supply | Minted and burned in the same transaction, so net supply change is zero. |

In your callback, check `msg.sender == flash` and that `initiator` is your own contract, so nobody else can
trigger it.

**Housekeeping**

| Call | Effect |
|---|---|
| `drip(ilk)` | Accrues fees (the vault also does this on every action). |
| `poke(ilk)` | Refreshes `lastPrice`. |
| `heal()` | Cancels `sin` against `surplus`. |

All three are permissionless.

---

## Usage: governance

After deployment, authority is split three ways:

| Who | Holds | Can do |
|---|---|---|
| `GoldTimelock` (admin = `GOV`) | Vault ward, spotter owner, flash owner | Everything in the tables below, **after a public delay** (2 days at launch) |
| `GoldGuardian` (owner = `GOV`) | Vault ward | `cage()` **instantly**, and nothing else |
| `GOV` itself | Nothing directly | Schedules or cancels timelock calls and fires the guardian |

Nobody in governance can mint bXAU. Its only minters are the vault and the flash module.

**Making a change.** Encode the call, schedule it, wait for the delay, then execute. Anyone can execute.

```bash
TL=<timelock>; DATA=$(cast calldata "file(bytes32,bytes32,uint256)" $ILK $(cast --format-bytes32-string line) 2000000000000000000000)
ETA=$(( $(date +%s) + 2*24*3600 + 600 ))
cast send $TL "schedule(address,uint256,bytes,uint256)" $VAULT 0 $DATA $ETA     # from GOV
# … wait until ETA (and within 14 days of it) …
cast send $TL "execute(address,uint256,bytes,uint256)"  $VAULT 0 $DATA $ETA     # anyone
cast send $TL "cancel(address,uint256,bytes,uint256)"   $VAULT 0 $DATA $ETA     # GOV, any time before execution
```

| Timelock rule | |
|---|---|
| `eta` | Must be ≥ now + `delay`. |
| Execution window | `eta` to `eta + GRACE` (14 days). After that the call expires. |
| `setDelay` / `setAdmin` | Callable only by the timelock itself, through the same schedule and wait. `delay` ≤ 30 days. |
| Watching | Users and monitors watch `Schedule` events to see changes coming. |

**Emergency.** `GOV` calls `guardian.fire()`, which runs `vault.cage()` immediately. That can only freeze the
system and start [shutdown](#emergency-shutdown); it cannot move funds anywhere else.

**Vault functions (through the timelock)**

| Call | Effect |
|---|---|
| `init(ilk, gem)` | Adds a peg. Decimals are read from the token. Defaults: no fee, 150% `mat`, 13% `chop`, zero `line`. |
| `file(ilk, "duty", ray)` | Sets the stability fee per second. Must be between `RAY` and `MAX_DUTY` (about 100%/yr). Settles at the old rate first. |
| `file(ilk, "mat", ray)` | Sets the liquidation ratio. Must be ≥ `RAY` and ≥ `chop`. |
| `file(ilk, "chop", wad)` | Sets the liquidation penalty. Must be ≥ `WAD` and ≤ `mat`. Set `chop` before lowering `mat`. |
| `file(ilk, "line" / "dust" / "floor", wad)` | Sets the ilk ceiling, minimum debt and depeg floor, in oz. |
| `fileLine(wad)` | Sets the global ceiling in oz. |
| `fileSpotter(addr)` | Swaps the oracle. **Powerful**: put it behind a timelock. |
| `flap(to, wad)` | Mints accrued surplus as bXAU to the treasury. Requires `sin == 0`, so call `heal()` first. |
| `cage()` | Emergency shutdown. Irreversible. Normally fired through the guardian. |
| `sweep(ilk, to)` | After `thaw`, once all bXAU is gone, moves leftover fee collateral to the treasury. |
| `rely(addr)` / `deny(addr)` | Adds or removes a ward. |

**Flash module (owner = timelock)**

| Call | Effect |
|---|---|
| `setMax(wad)` | Sets the per-call flash-mint ceiling. |
| `transferOwnership(addr)` | Hands the module to a new owner. |

**Spotter (owner = timelock)**

| Call | Effect |
|---|---|
| `fileXau(feed, maxAge)` | Sets the XAU/USD feed. |
| `fileSrc(ilk, feed, maxAge, par)` | Configures an ilk's price source. Use `feed = 0x0` for a par price. Feeds must be contracts, and their `decimals()` is cached. |
| `transferOwnership(addr)` | Hands the spotter to a new owner. `address(0)` freezes the spotter. |

**Common fee values** (from Maker's rate table; duty is per second, in RAY):

| APY | duty |
|---|---|
| 0.5% | `1000000000158153903837946257` |
| 1% | `1000000000315522921573372069` |
| 2% | `1000000000627937192491029810` |
| 5% | `1000000001547125957863212448` |

---

## Emergency shutdown

```
cage()  →  skim(ilk, urn) for every indebted urn  →  urn owners free() the excess
        →  thaw()  →  holders cash(wad)  →  governance sweep()s any leftover
```

1. **`cage()`** (governance). Drips every ilk, then tags each one at its oracle price, or at `lastPrice` if the
   oracle is down. A reverting spotter cannot block it. All borrowing, repaying, liquidation and fee changes
   stop.
2. **`skim(ilk, urn)`** (anyone). Converts the urn's debt into collateral at the tag price, in whole token units,
   and moves it into `pool[ilk]`. After that, `free` returns whatever is left to the urn owner.
3. **`thaw()`** (anyone). Allowed only once every ilk's `Art` is 0, meaning every urn has been skimmed. It opens
   redemptions.
4. **`cash(wad)`** (bXAU holders). Burns bXAU and pays the holder's share of the **remaining** pool of every
   peg, using `pool × wad / remainingSupply`.
   - Rounding dust is never lost: it stays for later redeemers, and the last one receives everything.
   - Call `quoteCash(wad)` to preview the payout.
   - An amount too small to buy one unit of any peg reverts with `NothingToCash`.
5. **`sweep(ilk, to)`** (governance). Allowed once supply is 0. Collects pool collateral that backs fees that
   were never minted.

---

## Contract reference

### BasketGold (bXAU)

| | |
|---|---|
| Token | ERC-20, `name` "Basket Gold", `symbol` "bXAU", 18 decimals. |
| `mint(to, v)`, `burn(from, v)` | Wards only. `burn` needs the holder's allowance unless `from == msg.sender`. |
| Wards after deploy | The vault and `GoldFlash`. Governance has none, so it cannot print unbacked bXAU. |

### PegSpotter

| Function | Description |
|---|---|
| `peek(ilk) → (price, ok)` | Price in WAD oz per token. `ok = false` if the ilk is unknown or a feed is stale or invalid. Never reverts on feed errors. |
| `srcs(ilk)` | Returns `(feed, maxAge, dec, par)`. |
| `xauUsd`, `xauMaxAge`, `xauDec` | The XAU/USD feed, its staleness limit and its cached decimals. |

### GoldTimelock

| Function | Who | Notes |
|---|---|---|
| `schedule(target, value, data, eta) → id` | admin | `eta ≥ now + delay` |
| `cancel(target, value, data, eta)` | admin | |
| `execute(target, value, data, eta) → ret` | anyone | `eta ≤ now ≤ eta + GRACE`. Bubbles up reverts as `CallFailed(reason)`. |
| `setDelay(d)`, `setAdmin(a)` | the timelock itself | `d ≤ MAX_DELAY` (30 days) |
| `hashOf(...)`, `queued(id)`, `delay`, `admin`, `GRACE` | view | |

### GoldGuardian

| Function | Who | Notes |
|---|---|---|
| `fire()` | owner | Calls `vault.cage()`. |
| `transferOwnership(to)` | owner | |

### GoldFlash (ERC-3156)

| Function | Notes |
|---|---|
| `flashLoan(receiver, token, amount, data)` | bXAU only, `amount ≤ max`, live only, no nesting |
| `maxFlashLoan(token)` | `max`, or 0 for other tokens and after cage |
| `flashFee(token, amount)` | 0 (reverts for other tokens) |
| `setMax(wad)`, `transferOwnership(to)` | owner |

### GoldVault: state

| Field | Description |
|---|---|
| `ilks(ilk)` | `(gem, scale, Art, rate, rho, duty, mat, chop, line, dust, floor)` |
| `urns(ilk, usr)` | `(ink, art)` |
| `lastPrice(ilk)` | Last good oracle price. |
| `Line`, `debt`, `surplus`, `sin` | Global ceiling and the accounting totals. |
| `live`, `thawed`, `tag(ilk)`, `pool(ilk)` | Shutdown state. |
| `MAX_DUTY` | The fee cap. |

### GoldVault: functions

| Function | Who | Notes |
|---|---|---|
| `lock(ilk, amt)` | anyone | Native units. Fee-on-transfer safe. Live only. |
| `free(ilk, amt)` | urn owner | Native units. Must stay safe while in debt. After cage, only once skimmed. |
| `draw(ilk, wad)` | urn owner | Mints bXAU. Checks floor, both ceilings, dust and safety. |
| `wipe(ilk, wad)` | urn owner | Burns bXAU. The remainder must be 0 or ≥ dust. |
| `wipeAll(ilk) → wad` | urn owner | Burns the exact debt, fees included. |
| `liquidate(ilk, usr, maxWad) → (wad, gemOut)` | keeper | See [keepers](#usage-keepers). |
| `drip(ilk)`, `poke(ilk)`, `heal()` | anyone | Housekeeping. |
| `flap(to, wad)` | ward | Mints surplus as bXAU. |
| `init`, `file`, `fileLine`, `fileSpotter`, `rely`, `deny` | ward | Administration. |
| `cage()` | ward | Shutdown. |
| `skim(ilk, usr)`, `thaw()` | anyone | Shutdown settlement. |
| `cash(wad)` | holder | Redemption. |
| `sweep(ilk, to)` | ward | Post-thaw leftovers. |
| `rateNow(ilk)`, `owed(ilk, usr)`, `isSafe(ilk, usr)`, `quoteCash(wad)`, `ilkCount()` | view | `rateNow`, `owed` and `isSafe` include fees not yet dripped. |

**Events:** `Init`, `File`, `FileGlobal`, `FileSpotter`, `Poke`, `Drip`, `Lock`, `Free`, `Draw`, `Wipe`,
`Liquidate`, `Heal`, `Flap`, `Cage`, `Skim`, `Thaw`, `Cash`, `Sweep`, `Rely`, `Deny`.

---

## Keeper bot and monitor

Both bots live in `keeper/`. Install them with `cd keeper && npm ci`. They read the chain over any JSON-RPC
endpoint and need no indexer.

### keeper.mjs: liquidations

Each pass works like this:

1. Discovers every urn from the vault's `Lock` events.
2. Checks each with `isSafe`, which includes fees not yet dripped.
3. For each unsafe urn, predicts the bXAU it would burn and the collateral it would receive, using the same
   maths as `liquidate()`.
4. Picks a strategy:
   - **Direct:** the signer already holds enough bXAU, so it calls `liquidate` itself.
   - **Flash:** a `FlashKeeper` and a route are configured, so it builds the DEX swap, checks the estimated
     profit and calls `FlashKeeper.run`.
   - **Report only:** neither is available.

Every transaction is simulated first and skipped if the simulation would revert. **The default is a dry run**;
pass `--execute` to send transactions.

```bash
cd keeper
RPC_URL=… VAULT=0x… node keeper.mjs --once                         # dry run: print the plan
RPC_URL=… VAULT=0x… PRIVATE_KEY=… FLASH_KEEPER=0x… ROUTER=0x… ROUTE=./myroute.mjs \
  node keeper.mjs --execute                                           # loop every INTERVAL s
```

| Env | Meaning |
|---|---|
| `RPC_URL`, `VAULT` | Required. |
| `PRIVATE_KEY` | Signer. Needed only with `--execute`. Use a dedicated hot key holding only gas money. |
| `FLASH_KEEPER`, `ROUTER`, `ROUTE` | Enable capital-free liquidation (see below). |
| `FROM_BLOCK` | First block to scan. Set it to the vault's deploy block. |
| `INTERVAL` | Seconds between passes. Default 30. |
| `MIN_PROFIT` | Minimum collateral profit per flash job, in token units. Default 0, meaning any profit. |
| `BUFFER_BPS` | Extra bXAU on top of `owed`, covering fees that accrue before inclusion. Default 10 (0.10%). |

**Setting up flash liquidation**

1. Deploy your own `FlashKeeper`. You are its owner, and only you can run jobs or withdraw profit with `sweep`:
   ```bash
   forge create src/FlashKeeper.sol:FlashKeeper --rpc-url $ETH_RPC_URL --account keeper \
     --constructor-args $VAULT $FLASH $(cast wallet address --account keeper)
   ```
2. Pick a `ROUTER`, the DEX or aggregator that will buy the seized collateral for bXAU.
3. Write a `ROUTE` module. It returns the calldata the `FlashKeeper` sends to the router:
   ```js
   // myroute.mjs: e.g. call an aggregator quote API, or encode a Uniswap exactOutput swap
   export default async ({ provider, gem, bxau, router, gemOut, bxauNeeded }) => {
     // sell at most gemOut of `gem` for at least bxauNeeded of `bxau`, recipient = msg.sender
     return { data: '0x…', gemIn: /* collateral the swap will spend */ 0n };
   };
   ```

`ROUTE=mockswap` is the built-in route used by the end-to-end test. Inside `FlashKeeper`, the whole
transaction reverts unless the flash loan is repaid and the profit is at least `minProfit`. A bad route can
cost gas, never principal.

### monitor.mjs: governance and health

The timelock only protects users if someone is reading its queue. Run the monitor beside the keeper:

```bash
RPC_URL=… VAULT=0x… TIMELOCK=0x… GUARDIAN=0x… FLASH=0x… WEBHOOK_URL=https://hooks… node monitor.mjs
```

| Severity | Raised for |
|---|---|
| **CRIT** | Guardian fired or vault caged; a new bXAU minter; vault ward changes; oracle replaced; an oracle down while it backs debt; books out of balance; a **scheduled** call that changes authority, the oracle or the delay |
| **WARN** | Any other scheduled governance call; bad debt appearing; an ilk ceiling over `UTIL_WARN`% used (default 90); price-source, delay or owner changes |
| **INFO** | Executed or cancelled calls; parameter changes; liquidations; flap; recoveries |

- Scheduled calls are decoded into readable form, for example
  `vault.fileSpotter(0x…) — executable from 2026-11-27T…`.
- Health alerts fire only when a check changes state, so a stuck condition doesn't spam you.
- WARN and CRIT alerts are POSTed as JSON to `WEBHOOK_URL` with a `text` field, which works with Slack and
  Discord.
- `--once` runs a single pass and exits with code 2 if any CRIT alert was raised, which makes it easy to run
  from cron or CI.

### e2e.mjs

`make e2e`, or `forge build && cd keeper && npm ci && node e2e.mjs`, does the following:

1. Starts anvil and deploys the whole system with the production authority layout.
2. Opens positions and depegs PAXG.
3. Checks that:
   - the keeper's dry run plans exactly one flash liquidation and sends nothing;
   - with `--execute`, a keeper holding **zero** bXAU clears the debt and keeps the profit;
   - the monitor decodes a scheduled oracle swap as CRIT, flags the guardian's shutdown, and deduplicates
     health alerts.

Set `RPC_URL` to use an existing node, or `ANVIL` to point at a specific binary.

## Deployment

**Mainnet addresses used** (each verified on-chain on 2026-11-07):

| Contract | Address | Notes |
|---|---|---|
| PAXG | `0x45804880De22913dAFE09f4980848ECE6EcbAf78` | 18 dec, transfer fee, EIP-1967 proxy |
| XAUT | `0x68749665FF8D2d112Fa859AA293F07A622782F38` | 6 dec, Tether-style (transfer returns nothing) |
| Chainlink XAU/USD | `0x214eD9Da11D2fbe465a6fc601a91E62EbEc1a0D6` | |
| Chainlink PAXG/USD | `0x9944D86CEB9160aF5C5feB251FD671923323f8C3` | |

**Steps**

```bash
cast wallet import deployer --interactive               # keystore; never paste keys on the command line
export ETH_RPC_URL=https://…                            # your mainnet RPC
make simulate GOV=0xYourMultisig SENDER=0xDeployerAddr  # fork dry-run: prints every tx
make deploy   GOV=0xYourMultisig SENDER=0xDeployerAddr ACCOUNT=deployer
```

**What the script does**

1. Deploys `PegSpotter`, `BasketGold` and `GoldVault`, makes the vault bXAU's minter and configures both ilks.
2. Checks that the broadcasting key really holds the constructor wards. If it doesn't, the run fails with
   `deployer != tx.origin; pass --sender`.
3. Deploys `GoldTimelock` (admin `GOV`, delay `TIMELOCK_DELAY`, default 2 days), `GoldGuardian` (owner `GOV`)
   and `GoldFlash` (max `FLASH_MAX`, default 500 oz), and makes the flash module a bXAU minter.
4. Hands over: the timelock gets a vault ward and ownership of the spotter and flash module, the guardian gets a
   vault ward, and the deployer is removed.
5. Asserts the final layout. If any check fails, the whole run fails:
   - the deployer holds nothing;
   - `GOV` is **not** a direct ward;
   - neither `GOV` nor the timelock can mint bXAU;
   - every owner and ward is as intended.

**After deploying**

1. Verify the contracts on Etherscan (`--verify` does this when `ETHERSCAN_API_KEY` is set).
2. From `GOV`, run a small `lock` and `draw` on each ilk, then `wipeAll` and `free`.
3. Start [`monitor.mjs`](#monitormjs-governance-and-health) with `TIMELOCK`, `GUARDIAN`, `FLASH` and a
   webhook.
4. Deploy a `FlashKeeper`, write a route for a real bXAU market, and run [`keeper.mjs`](#keepermjs-liquidations)
   in dry-run mode first.
5. Only then raise ceilings. That is a timelocked change, so schedule it early.

---

## Risk parameters

Launch defaults from the deploy script. Every one can be overridden with the environment variable shown.

| Parameter | PAXG-A | XAUT-A | Env var |
|---|---|---|---|
| `mat`, liquidation ratio | 120% | **150%** | `PAXG_MAT` / `XAUT_MAT` (RAY) |
| `chop`, penalty | 5% | 5% | `PAXG_CHOP` / `XAUT_CHOP` (WAD) |
| `duty`, fee | 2%/yr | 2%/yr | `PAXG_DUTY` / `XAUT_DUTY` (RAY) |
| `line`, ceiling | 1,000 oz | **100 oz** | `PAXG_LINE` / `XAUT_LINE` (WAD) |
| `dust`, minimum debt | 1 oz | 1 oz | `PAXG_DUST` / `XAUT_DUST` (WAD) |
| `floor`, depeg guard | 0.97 | n/a (par) | `PAXG_FLOOR` |
| Price source | PAXG/USD ÷ XAU/USD | **par** | |
| Feed max age | 26 h | n/a | `PAXG_MAX_AGE`, `XAU_MAX_AGE` (s) |

The global `Line` defaults to 1,100 oz (`GOLD_LINE_GLOBAL`). The timelock delay defaults to 2 days
(`TIMELOCK_DELAY`, seconds, at most 30 days) and the flash-mint ceiling to 500 oz (`FLASH_MAX`, WAD).

**Why XAUT is stricter:** mainnet has no Chainlink XAUT/USD feed, so XAUT is priced at par. An XAUT depeg is
invisible on-chain: XAUT positions can never be liquidated on price, and the floor cannot fire. The small
ceiling and high ratio limit the damage. Once a feed exists, governance can call
`spotter.fileSrc("XAUT-A", feed, maxAge, 1e18)` and then raise the ceiling.

---

## Security model and known limits

**Trust**

- **Governance (`GOV`) is trusted but delayed.** Every governance power, including swapping the spotter,
  changing ratios, `flap` and the flash ceiling, goes through `GoldTimelock`. Each change is public for `delay`
  (2 days) before it can execute, so users can leave first. The only instant power is the guardian's `cage()`,
  which can freeze the system but not redirect funds.
- **The timelock admin is `GOV`.** Whoever controls the multisig can still schedule anything, so the delay
  protects users only if someone is watching `Schedule` events. Run a monitor.
- **bXAU.** Governance holds no minting rights. Supply only grows through `draw` (against collateral) or `flap`
  (against accrued surplus). The flash module mints and burns within one transaction.
- **There is no price delay like Maker's OSM.** A fresh Chainlink price takes effect immediately.

**Mechanism limits**

- Liquidations use a fixed discount, not Dutch auctions, so price discovery in a crash depends on keepers.
  Keepers can use `GoldFlash`, but a flash liquidation still needs a market where the seized peg can be sold
  for bXAU.
- XAUT is valued at par. See [Risk parameters](#risk-parameters).
- Oracle risk is Chainlink's. A feed outage freezes priced actions, but users can still repay and add
  collateral.
- Rounding always favours the system: `draw` rounds debt up, `wipe` rounds it down, and the safety check uses a
  floored `spot`.

**Defences in code**

- A reentrancy lock on every function that moves tokens.
- Collateral credit is measured by balance delta, and transfers tolerate tokens that return no bool.
- `chop ≤ mat` is enforced, and `duty ≤ MAX_DUTY` (about 100%/yr), so fees can't overflow and brick shutdown.
- `cage()` survives a reverting oracle by falling back to the last good price.
- `init` reads decimals from the token itself.

**Before mainnet:**
- Get an independent audit.
- Run `keeper/monitor.mjs` with a webhook.
- Run `keeper/keeper.mjs` with a `FlashKeeper`, plus a bXAU market and a route for it so flash liquidations
  can close.

---

## Tests

```bash
forge test -vv
```

| Area | Tests |
|---|---|
| Positions | Fee-on-transfer lock; 6-decimal no-return peg; drawing up to `mat`; free must stay safe; dust; ilk and global ceilings |
| Fees and surplus | 5%/yr accrual over a year; `wipeAll`; `heal`; `flap`; `MAX_DUTY` cap with no overflow over 10 years |
| Oracle | Premium capped at par; depeg floor; stale feed halts priced actions; spotter rejects code-less feeds |
| Liquidation | Full; partial with dust guard; buffer-band liquidation books no bad debt; true insolvency goes to `sin`; `OverMax`; safe urns protected; views include undripped fees |
| Shutdown | Cage → skim → free → thaw → cash across both pegs; cage survives a reverting spotter at the last good price; zero-supply thaw plus `sweep`; cash dust is never lost |
| Admin | Ward-only functions; `init` reads decimals; `chop ≤ mat` |
| Governance | Timelock delay, expiry, cancel and admin rules; `GOV` can't act directly; delay and admin changeable only through the timelock; spotter is timelocked; guardian cages instantly |
| Flash-mint | Net-zero supply; bad callback return, missing approval and reentrancy rejected; ceiling, token and cage limits; a keeper holding zero bXAU flash-liquidates for profit |
| FlashKeeper | Liquidates and keeps the profit; profit floor; under-selling cannot repay; only the owner can run or sweep; strangers can't trigger the callback; system contracts refused as router |
| Bots, end to end (`make e2e`) | 14 checks on anvil: urn discovery, dry run, flash execution with zero capital, decoded CRIT schedule alert, guardian shutdown alert, alert deduplication |
| Deployment | The real script runs against etched mainnet addresses: timelock, guardian and flash wiring; parameters; deployer removed; `GOV` not a direct ward; governance not a bXAU minter |

Each flow also asserts the books identity, `debt + sin == supply · RAY + surplus`.

---

## Changelog

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
