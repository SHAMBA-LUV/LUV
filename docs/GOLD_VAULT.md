# GoldVault — MakerDAO-style collateralised gold

Lock **existing gold pegs** (PAXG, XAUT, … the "basket"), draw **bXAU**, a debt token denominated in
**troy ounces**. It works like Maker's Dai system, except every number is in ounces of gold instead of dollars.

| Maker      | Here                                   | File |
|------------|----------------------------------------|------|
| Dai        | `BasketGold` (bXAU, 18 dec, 1 bXAU = 1 oz) | `contracts/gold/BasketGold.sol` |
| Vat + Joins| `GoldVault` storage, `lock/free/draw/wipe/wipeAll` | `contracts/gold/GoldVault.sol` |
| Jug        | `drip()`: `duty` per second compounds into `rate` | 〃 |
| Spotter/OSM| `PegSpotter.peek(ilk)`: oz per token    | `contracts/gold/PegSpotter.sol` |
| Dog/Clipper| `liquidate()`: fixed `chop` discount, partial fills allowed, dust-guarded | `GoldVault.sol` |
| Vow        | `surplus`, `sin`, `heal()`, `flap()`   | 〃 |
| End        | `cage()` → `skim()` → `thaw()` → `cash()` | 〃 |

## Pricing "from existing pegs"

```
price(ilk) = min(par, pegUSD / xauUSD · par)      // oz of gold per collateral token
```

- **PAXG-A**: Chainlink `PAXG/USD` divided by `XAU/USD`. A depeg lowers borrowing power and can trigger liquidations.
- **XAUT-A**: mainnet has no Chainlink XAUT/USD feed, so it is valued **at par** (1 token = 1 oz). Governance can
  add a feed later with `spotter.fileSrc`. Until then, an XAUT depeg is not seen on-chain. Keep XAUT's `line` small.
- A peg trading **above** spot gold is capped at par, so no one can borrow against a premium.
- `floor` blocks new debt once a peg trades below it (default 0.97 oz/token).
- A stale or invalid feed makes `peek` return `ok=false`. The vault then halts every action that needs a price:
  `draw`, `free` while debt is open, and `liquidate`.

## Safety

```
safe ⇔ ink · price / mat ≥ art · rate
```

With `mat` at 120%, 12 oz of PAXG at par supports at most 10 bXAU. Liquidators burn bXAU and receive collateral
worth `chop`× what they burned. If the collateral runs out first, the leftover debt is written to `sin`. It is
covered later from fee `surplus` by calling `heal()`.

The books always balance. The tests check this identity:
`debt + sin == bXAU.totalSupply · RAY + surplus`.

## Token quirks handled

- **PAXG** charges a transfer fee, so `lock` credits only what actually arrives (measured by balance delta).
- **XAUT** has 6 decimals, and its `transfer` returns no bool. Amounts are normalised to 18 decimals inside the
  vault, and transfers accept tokens that return nothing.

## Shutdown

1. `cage()` freezes everything at the current peg prices.
2. Anyone can call `skim(ilk, urn)` to move each urn's debt, valued in collateral, into the holders' pool.
3. Urn owners can then `free` any excess collateral.
4. `thaw()` runs once every urn is skimmed. It fixes how much of each peg one bXAU redeems for.
5. `cash(wad)` burns bXAU and pays out the holder's pro-rata share of **every** peg in the basket.

## Test & deploy (Foundry)

The repo's legacy `contracts/MultiSend.sol` and `contracts/oz/` import OpenZeppelin, which is not vendored here.
Scope the source dir to the gold contracts:

```bash
FOUNDRY_SRC=contracts/gold forge test --match-path test/GoldVault.t.sol      # 16 tests
GOV=<multisig> FOUNDRY_SRC=contracts/gold forge script script/DeployGoldVault.s.sol --rpc-url $ETH_RPC_URL           # simulate
GOV=<multisig> FOUNDRY_SRC=contracts/gold forge script script/DeployGoldVault.s.sol --rpc-url $ETH_RPC_URL --broadcast --verify
```

Launch defaults (each can be overridden by an environment variable):

| Parameter | Default |
|---|---|
| `mat` | 120% |
| `chop` | 5% |
| `duty` | 2%/yr |
| `line` | 1,000 oz per ilk |
| `Line` | 2,000 oz |
| `dust` | 1 oz |
| `floor` | 0.97 |
| Feed staleness limit | 26 h |

`GOV` receives the vault wards and ownership of the spotter. The deployer is denied at the end. bXAU gets **no**
governance ward: the vault is its only minter.

Mainnet addresses (verified on-chain on 2026-11-07):

| Contract | Address |
|---|---|
| PAXG | `0x45804880De22913dAFE09f4980848ECE6EcbAf78` |
| XAUT | `0x68749665FF8D2d112Fa859AA293F07A622782F38` |
| Chainlink XAU/USD | `0x214eD9Da11D2fbe465a6fc601a91E62EbEc1a0D6` |
| Chainlink PAXG/USD | `0x9944D86CEB9160aF5C5feB251FD671923323f8C3` |

## Trust assumptions & not-yet-done

- Governance changes take effect immediately. There is no timelock or Maker-style OSM delay. Through
  `fileSpotter` or `file`, governance can reprice collateral or change ratios. Put `GOV` behind a timelock before
  real size goes in.
- Liquidations use a fixed discount, not Dutch auctions. Keepers need bXAU on hand to liquidate (no flash-mint yet).
- Not audited.
