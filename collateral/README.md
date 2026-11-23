# collateral — MakerDAO-style collateralised gold

Lock **existing on-chain gold pegs** (PAXG, XAUT, …) and borrow **bXAU**, where **1 bXAU = one fine troy ounce
of gold**. Every number in the system is in ounces of gold, not dollars: what matters for solvency is how well
each peg holds its peg.

It is a self-contained Foundry project with no external libraries (not even forge-std),
Solidity 0.8.24.

| | |
|---|---|
| Version | 0.2.0 (review fixes; see [Changelog](#changelog)) |
| Tests | 27 Foundry tests, accounting invariant checked after every flow |
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
10. [Deployment](#deployment)
11. [Risk parameters](#risk-parameters)
12. [Security model and known limits](#security-model-and-known-limits)
13. [Tests](#tests)
14. [Changelog](#changelog)

---

## Layout

```
collateral/
├── src/
│   ├── BasketGold.sol      bXAU: the debt token (ERC-20, 18 dec). Only the vault can mint.
│   ├── PegSpotter.sol      Oracle: prices each peg in ounces using Chainlink.
│   └── GoldVault.sol       CDP engine: positions, fees, liquidation, surplus, shutdown.
├── script/
│   └── DeployGoldVault.s.sol   Mainnet deployment; hands admin to GOV and asserts the deployer is removed.
├── test/
│   ├── GoldVault.t.sol         26 behaviour tests.
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

---

## Quick start

```bash
curl -L https://foundry.paradigm.xyz | bash && foundryup   # once
unzip collateral.zip && cd collateral
make test           # or: forge test -vv
make build          # contract sizes
make gas            # gas report
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

**Liquidate**

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

**Housekeeping**

| Call | Effect |
|---|---|
| `drip(ilk)` | Accrues fees (the vault also does this on every action). |
| `poke(ilk)` | Refreshes `lastPrice`. |
| `heal()` | Cancels `sin` against `surplus`. |

All three are permissionless.

---

## Usage: governance

Governance is any address in `wards` on the vault, the `GOV` multisig after deployment.

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
| `cage()` | Emergency shutdown. Irreversible. |
| `sweep(ilk, to)` | After `thaw`, once all bXAU is gone, moves leftover fee collateral to the treasury. |
| `rely(addr)` / `deny(addr)` | Adds or removes a ward. |

**Spotter (owner)**

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
| Wards after deploy | The vault only. Governance has none, so it cannot print unbacked bXAU. |

### PegSpotter

| Function | Description |
|---|---|
| `peek(ilk) → (price, ok)` | Price in WAD oz per token. `ok = false` if the ilk is unknown or a feed is stale or invalid. Never reverts on feed errors. |
| `srcs(ilk)` | Returns `(feed, maxAge, dec, par)`. |
| `xauUsd`, `xauMaxAge`, `xauDec` | The XAU/USD feed, its staleness limit and its cached decimals. |

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
3. Gives `GOV` the vault wards and the spotter, then removes the deployer.
4. Asserts that the deployer holds **no** rights and that the wiring is correct. If any check fails, the whole
   run fails.

**After deploying**

1. Verify the contracts on Etherscan (`--verify` does this when `ETHERSCAN_API_KEY` is set).
2. From `GOV`, run a small `lock` and `draw` on each ilk, then `wipeAll` and `free`.
3. Point a keeper at the vault before raising any ceilings.

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

The global `Line` defaults to 1,100 oz (`GOLD_LINE_GLOBAL`).

**Why XAUT is stricter:** mainnet has no Chainlink XAUT/USD feed, so XAUT is priced at par. An XAUT depeg is
invisible on-chain: XAUT positions can never be liquidated on price, and the floor cannot fire. The small
ceiling and high ratio limit the damage. Once a feed exists, governance can call
`spotter.fileSrc("XAUT-A", feed, maxAge, 1e18)` and then raise the ceiling.

---

## Security model and known limits

**Trust**

- **Governance (`GOV`) is trusted and acts immediately.** It can swap the spotter, change ratios and cage the
  system. There is no built-in delay like Maker's OSM or pause proxy. Put `GOV` behind a timelock, for example
  a Safe with a delay module, before meaningful size goes in.
- **Spotter owner.** It controls price sources. Transfer it to the same timelocked `GOV`, or renounce it once
  the sources are final.
- **bXAU.** Governance holds no minting rights. Supply only grows through `draw`, against collateral, or
  `flap`, against accrued surplus.

**Mechanism limits**

- Liquidations use a fixed discount, not Dutch auctions, so price discovery in a crash depends on keepers.
  Keepers must already hold bXAU, because there is no flash-mint.
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

**Before mainnet:** get an independent audit, put a timelock on `GOV`, and have a keeper bot live.

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
| Deployment | The real script runs against etched mainnet addresses: wiring, parameters, deployer removed, governance not a bXAU minter |

Each flow also asserts the books identity, `debt + sin == supply · RAY + surplus`.

---

## Changelog

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
