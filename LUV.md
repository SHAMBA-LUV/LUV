# SHAMBA LUV (`LUV`) — complete contract guide

> ❤️ **emotonomics** — *hold LUV, earn LUV.* A reflection token where simply holding grows
> your balance. This document explains **every aspect** of the corrected contract
> (`contracts/ShambaLuv.sol`), **every function**, and **how to interact with it from Node.js**
> end-to-end. Primary chain: **Ethereum** (cross-chain ready).

---

## 1. At a glance

| | |
| --- | --- |
| Name / Symbol | **SHAMBA** / **LUV** |
| Decimals | 18 |
| Total supply | **100,000,000,000,000,000 LUV** (100 Quadrillion = `1e35` base units) — fixed, minted at genesis |
| Fees (on buy/sell) | **5%** = 3% reflection + 1% liquidity + 1% team. Fees can only be **lowered**, never raised. |
| Payout model | **UNIFIED** — all three fees **accumulate** and distribute **together in one transaction** (reflection batch + team ETH + liquidity ETH). |
| Payout threshold | **10,000,000,000,000 LUV** (10 trillion = 0.01% of supply). When `accumulatedFees` reaches it, the next fee transfer fires the unified payout. Anyone may call `processFees()` to trigger early. |
| Wallet→Wallet (EOA↔EOA) | **fee-free** (toggleable) |
| Max transfer | **1%** of supply (configurable in basis points, lower-bounded at 1% so trading can never be frozen) |
| Reflection model | **RFI** — reflections distribute via the supply rate (no claim, solvent by construction), **batched** and applied at each unified payout. |
| Roles | `owner` (config, renounceable) + `admin` (router/weth maintenance for cross-chain, renounceable) |
| Routing | Uniswap-V2-style router + WETH, both set at deploy and re-pointable for other chains |

The mint, name, and symbol are **identical** to the original live token. Only the broken
internals were rewritten — see §3.

---

## 2. How emotonomics works (unified payout + RFI reflection)

When a **fee-charged** transfer happens (anyone buying/selling against the DEX pair, or any non-exempt
contract-involved transfer):

```
amount ──┬── 95%  → recipient
         ├── 3%   → REFLECTION  (ACCUMULATED in reflected-space, distributed at the next payout)
         └── 2%   → contract    (1% liquidity + 1% team, held as real tokens → swapped to ETH at payout)
```

**The three fees are no longer distributed continuously.** Instead they **accumulate** until the
combined pending fees (`accumulatedFees` = reflection + team + liquidity, tracked in token space)
reach `payoutThreshold` (default **10 trillion LUV**, 0.01% of supply). The next fee transfer
then runs `_processFees()` — **one transaction that distributes all three together**:

1. **Reflection batch** — the whole pending reflection tranche is applied in a single
   `_rTotal -= pendingReflectionR` (emits `ReflectionsDistributed`).
2. **Team ETH** — the contract's accumulated team+liquidity tokens are swapped to ETH and the
   team share is paid out.
3. **Liquidity ETH** — the remaining ETH is paid to the liquidity wallet (split **1:1** with team,
   since `teamFee == liquidityFee`). Steps 2–3 emit `FeesDistributed`.

The whole call emits `FeesProcessed(reflectionTokens, ethToTeam, ethToLiquidity)`. Anyone may call
the **permissionless** `processFees()` to trigger the unified payout early, without waiting for the
threshold or for someone else to sell.

**Reflection is still RFI — not a pool you claim from.** Internally every balance is stored in a
"reflected" unit `_rOwned`; the contract tracks a global `_rTotal`. A holder's visible balance is:

```
balanceOf(account) = _rOwned[account] / rate      where  rate = _rTotal / eligibleSupply
```

When the reflection batch distributes, the contract **decreases `_rTotal` once** for the whole
accumulated tranche. That single operation raises the `rate` for *everyone*, so every holder's
`balanceOf` ticks up proportionally — with **no claim**. Because the entire batch is one
`_rTotal` reduction, it remains **solvent by construction**: there is no separate token pot that
can be drained or under-funded. The only real tokens the contract custodies are the 2%
team/liquidity tranche, a **disjoint** balance swapped to ETH at payout. Between payouts the
pending reflection sits in `pendingReflection` (and the private `_pendingReflectionR`) — a single
sell therefore does **not** immediately raise other holders' balances; they rise at the next
payout.

`eligibleSupply` excludes reflection-excluded accounts (the contract itself, the liquidity
wallet) so their share is never mis-credited.

### Fee model — exactly where fees do and don't apply (and why bridging is free)

**The 5% is a trading reward — it applies to buys and sells, never to ordinary transfers.** Concretely:

| Transfer | Fee? | Why |
| --- | --- | --- |
| **Wallet → wallet (EOA ↔ EOA)** | **0 fee, always** | `walletToWallet` path — share the LUV freely, person to person |
| **Buy** (DEX pair → you) | **5%** | the pair is a non-exempt contract counterparty |
| **Sell** (you → DEX pair) | **5%** | same |
| **You → any fee-exempt address** | **0 fee** | either side being on `isExcludedFromFee` skips the fee |
| **You → a bridge / staking / infra contract that is fee-exempt** | **0 fee** | it's exempted exactly like the liquidity wallet |

The decision is: `takeFee = !( isExcludedFromFee[from] || isExcludedFromFee[to] || (EOA↔EOA) )`.
So a fee is taken only when a **non-exempt contract** is the counterparty — in practice the DEX
pair, i.e. **a buy or a sell**. Holding, sending to friends, and protocol plumbing are free.

**Bridging / cross-chain is fee-free** — the bridge contract is added to `isExcludedFromFee`
(`setFeeExemption(bridge, true)`) **exactly the same way the liquidity wallet is exempted at
construction**. Then locking/burning LUV into the bridge, and minting/releasing on the far side,
incur **no fee**. (Earlier framing that the fee "complicates bridging" was wrong: it's the same
one-line exemption as liquidity.) For a single unified price across chains, pair a burn-and-mint
bridge — LayerZero **OFT v2** / Chainlink **CCIP** / Axelar **ITS** — with that exemption: supply
stays unified, bridge moves are fee-free, and arbitrage converges the per-chain pool prices. The
reward (the 5%) keeps firing where it should — on **buys and sells**, on each chain's pool.

> Deployment checklist add: **fee-exempt every infra contract that must move LUV without a fee** —
> the liquidity wallet (done in the constructor), the airdrop contract, and any bridge endpoint —
> via `setFeeExemption(addr, true)`.

---

## 3. What was fixed (vs. the live Polygon contract)

The live contract had six fund-affecting bugs; holders are being **airdropped to compensate**.

1. **Swaps reverted forever** — the constructor never approved the router (approval only existed
   in `updateRouter`), so team/liquidity ETH never flowed. → **Fixed:** router approved at genesis
   (and on every `updateRouter`).
2. **Inverted max-transfer math** — `maxAmount = SUPPLY / percent`, so the "100% = no limit"
   setting actually produced a **0.01%** cap. → **Fixed:** `maxAmount = SUPPLY × bps / 10000`.
3. **Reflection insolvency** — 3% reflection and 2% team/liq shared one balance; the swap drained
   reflection-owed tokens. → **Fixed:** RFI (reflections via the rate, never a pool).
4. **Claim wiped accrued reflections** — `claimReflections` zeroed the holder's balance then paid
   only the new delta. → **Removed:** no claim; reflections live inside `balanceOf`.
5. **Reflection denominator counted excluded balances** → drift / stranded tokens. → **Fixed:**
   `_getCurrentSupply` subtracts excluded accounts.
6. **Hardcoded Polygon `WPOL` as WETH** → wrong swap path on every other chain. → **Fixed:**
   `weth` is set at construction and admin-updatable → genuinely cross-chain.

---

## 4. Constants & state (every variable)

**Metadata / supply**
- `name` `"SHAMBA"`, `symbol` `"LUV"`, `decimals` `18` — constants.
- `_tTotal` (private) = `1e35` — the fixed token supply. Exposed via `totalSupply()`.
- `_rTotal` (private) — the reflected-space total; decreases as reflections distribute.
- `totalReflectionsDistributed` — cumulative tokens reflected to holders (analytics).

**Balances / allowances** (private; read via `balanceOf` / `allowance`)
- `_rOwned[account]` — reflected balance (the source of truth for non-excluded holders).
- `_tOwned[account]` — plain token balance, tracked **only** for reflection-excluded accounts.
- `_allowances[owner][spender]` — ERC-20 allowances.

**Exclusions** (public mappings)
- `isExcludedFromFee[account]` — pays/charges no fee.
- `isExcludedFromMaxTx[account]` — bypasses the max-transfer cap.
- `isExcludedFromReflection[account]` — earns no reflections; balance read from `_tOwned`.

**Fees** (public, lower-only)
- `reflectionFee` = 300, `liquidityFee` = 100, `teamFee` = 100 (basis points; `FEE_DENOMINATOR` = 10000).
- `totalFee()` returns their sum (500 = 5%).

**Roles / wallets** (public)
- `owner` — configuration authority (renounceable).
- `admin` — router/weth maintenance only (survives owner renounce; renounceable).
- `teamWallet`, `liquidityWallet` — ETH fee recipients.

**Routing** (public)
- `ETH_UNISWAP_V2_ROUTER` / `ETH_WETH` — Ethereum-mainnet defaults (constants).
- `router` (IDexRouter), `weth` (active chain's wrapped native), `pair` (the DEX pair).

**Limits / payout** (public)
- `maxTxBps` (default 100 = 1%), `maxTxAmount` (= `_tTotal × maxTxBps / 10000`), `maxTxEnabled`.
- `payoutThreshold` — combined pending fees that trigger the **unified payout** (default
  **10 trillion LUV** = `10_000_000_000_000 × 1e18`, 0.01% of supply; settable in `(0, 2% of supply]`).
- `accumulatedFees` — pending fees in token space (reflection + team + liquidity) since the last
  payout; gates `payoutThreshold`. Reset to 0 by `_processFees`.
- `pendingReflection` — pending reflection (token space) awaiting the next batch distribution.
- `_pendingReflectionR` (private) — the same pending reflection in reflected-space (the exact
  amount removed from `_rTotal` at payout).
- `maxSlippageBps` (default 500 = 5%, ≤ 2000).
- `swapEnabled`, `walletToWalletFeeExempt`.

---

## 5. Every function

### 5.1 ERC-20 views
- **`name() → string`**, **`symbol() → string`**, **`decimals() → uint8`** — metadata.
- **`totalSupply() → uint256`** — always `1e35` (fixed).
- **`balanceOf(address account) → uint256`** — for normal holders returns `_rOwned/rate` (so it
  **includes earned reflections**); for reflection-excluded accounts returns `_tOwned`.
- **`allowance(address holder, address spender) → uint256`** — remaining approved amount.

### 5.2 ERC-20 mutators
- **`approve(address spender, uint256 value) → bool`** — set allowance; emits `Approval`.
- **`transfer(address to, uint256 amount) → bool`** — send tokens; applies fee logic (see `_transfer`).
- **`transferFrom(address from, address to, uint256 amount) → bool`** — spend allowance then transfer.
  Infinite allowance (`type(uint256).max`) is not decremented.

### 5.3 Unified payout (permissionless)
- **`processFees()`** — **permissionless**; anyone may call it to trigger the unified payout once
  fees have accrued (`accumulatedFees != 0` or there is pending reflection). No need to wait for the
  threshold or for someone else to sell. Internally calls `_processFees`.

### 5.4 Internal transfer & payout pipeline (not externally callable)
- **`_transfer(from, to, amount)`** — the gatekeeper: zero checks, **max-tx** enforcement (unless
  exempt), fires the **unified payout** (`_processFees`) when `accumulatedFees ≥ payoutThreshold`
  and we're not in a buy/`_inSwap`, decides `takeFee` (false for fee-exempt parties or EOA↔EOA when
  `walletToWalletFeeExempt`), then calls `_tokenTransfer`. Emits `WalletToWalletTransfer` for
  fee-free EOA transfers.
- **`_tokenTransfer(from, to, t, takeFee)`** — the RFI core: computes `tFee` (3%), `tSwap` (2%),
  `tTransfer` (95%) and their reflected counterparts; debits sender, credits recipient, routes the
  2% to the contract as real tokens, **accumulates** the 3% reflection into `pendingReflection` /
  `_pendingReflectionR` (NOT applied to `_rTotal` yet), and adds the 5% to `accumulatedFees`. Emits
  `Transfer` (and a second `Transfer` to the contract for the 2%). A single fee transfer does
  **not** raise other holders' balances — that happens at the next payout.
- **`_processFees()`** (`lockSwap`) — the unified payout, in ONE call: (1) applies the whole pending
  reflection batch via a single `_rTotal -= _pendingReflectionR` and emits `ReflectionsDistributed`;
  (2)+(3) calls `_swapTeamLiq` to swap the contract's team/liq tokens to ETH and pay team:liquidity
  1:1; resets `accumulatedFees` to 0; emits `FeesProcessed(reflectionTokens, ethToTeam, ethToLiquidity)`.
- **`_swapTeamLiq(tokenAmount)`** — swaps the contract's team/liq tokens to ETH via the router and
  splits the ETH `teamWallet : liquidityWallet` = `teamFee : liquidityFee` (1:1). Wrapped in
  `try/catch` so a missing pair can never brick transfers. Emits `FeesDistributed`.
- **`_getRate()` / `_getCurrentSupply()`** — compute the reflection rate over the
  **reflection-eligible** supply (excluded balances removed).

### 5.5 Reflection-exclusion management
- **`excludeFromReflection(address) onlyOwner`** — stop an account earning reflections (e.g. a CEX
  or a contract). Snapshots its current balance into `_tOwned`.
- **`includeInReflection(address) onlyOwner`** — reverse the above.
- *(internal `_excludeFromReflection` is used at construction for the contract + liquidity wallet.)*

### 5.6 Owner configuration (renounceable authority)
- **`setTeamWallet(address) onlyOwner`** / **`setLiquidityWallet(address) onlyOwner`** — update ETH
  fee recipients; emit `WalletUpdated`.
- **`setPair(address) onlyOwner`** — register the DEX pair (so buys/sells incur the fee and the
  swap-on-sell guard works); emits `PairUpdated`.
- **`lowerFees(reflection, liquidity, team) onlyOwner`** — each new value must be **≤** the current
  one (`OnlyLower`); emits `FeesLowered`.
- **`setMaxTxBps(uint256 bps) onlyOwner`** — set the max-transfer cap in **bps of supply**, range
  `[100, 10000]` = `[1%, 100%]` (`OutOfRange` otherwise). `10000` means the full supply (no limit) —
  the corrected semantics. Emits `MaxTxUpdated`.
- **`setMaxTxEnabled(bool) onlyOwner`** — toggle the cap entirely.
- **`setPayoutThreshold(uint256) onlyOwner`** — the **unified payout** threshold: the combined
  pending fees (reflection + team + liquidity) that fire all three together. Range `(0, 2% of
  supply]` (`OutOfRange` otherwise); default 10 trillion LUV. Emits `PayoutThresholdUpdated`.
- **`setSwapEnabled(bool) onlyOwner`** — turn the auto-payout on/off (trading itself is never paused).
- **`setMaxSlippageBps(uint256) onlyOwner`** — slippage ceiling for swaps, `(0, 2000]` = up to 20%.
- **`setWalletToWalletFeeExempt(bool) onlyOwner`** — toggle fee-free EOA↔EOA transfers.
- **`setFeeExemption(address, bool) onlyOwner`** / **`setMaxTxExemption(address, bool) onlyOwner`** —
  per-account exemptions.
- **`setAdmin(address) onlyOwner`** — assign the maintenance admin; emits `AdminTransferred`.
- **`renounceOwnership() onlyOwner`** — set `owner = address(0)`; locks all owner config forever.

### 5.7 Admin maintenance (cross-chain; survives owner renounce)
- **`updateRouter(address newRouter, address newWeth) onlyAdmin`** — re-point routing for another
  chain. **Revokes** the old router's approval and **approves** the new one (the genesis-approval
  fix, repeated correctly). Emits `RouterUpdated`.
- **`renounceAdmin() onlyAdmin`** — set `admin = address(0)`; locks the contract's routing in place.

### 5.8 Helper views
- **`totalFee() → uint256`** — current total fee in bps.
- **`reflectionsEarned(address) → uint256`** — convenience: returns `balanceOf` (reflections are
  already inside it) for non-excluded accounts, else 0.
- **`getConfig() → (router, weth, pair, maxTxAmount, payoutThreshold, totalFeeBps)`** — one-call
  status. The 5th value is now **`payoutThreshold`** (was `swapThreshold`).

### 5.9 Events
`Transfer`, `Approval` (ERC-20); `OwnershipTransferred`, `AdminTransferred`, `WalletUpdated`,
`RouterUpdated`, `PairUpdated`, `FeesLowered`, `MaxTxUpdated`, `PayoutThresholdUpdated`,
`WalletToWalletFeeExemptSet`, `ReflectionsDistributed` (tokenAmount), `FeesDistributed`
(tokensSwapped, ethToTeam, ethToLiquidity), `FeesProcessed` (reflectionTokens, ethToTeam,
ethToLiquidity — the unified payout), `WalletToWalletTransfer`.

### 5.10 Custom errors
`NotOwner`, `NotAdmin`, `ZeroAddress`, `ZeroAmount`, `MaxTxExceeded`, `OnlyLower`, `OutOfRange`,
`Reentrant`.

---

## 6. Deployment (Ethereum primary)

**Constructor:** `constructor(address teamWallet, address liquidityWallet, address router, address weth)`
- `router` / `weth` may be `address(0)` → they default to **Ethereum mainnet** Uniswap V2
  (`0x7a25…488D`) and WETH (`0xC02a…6Cc2`).
- The deployer becomes `owner` **and** initial `admin`, and receives the full `1e35` supply.
- **Use distinct team/liquidity wallets** (not the deployer): the liquidity wallet is
  reflection-excluded, so it should not also be your main holder address.

**Recommended post-deploy sequence:**
1. On the router's **factory**, `createPair(LUV, WETH)` → get the pair address.
2. `setPair(pair)`.
3. `approve(router, amount)` then `addLiquidityETH` on the router to seed the pool.
4. (optional) `setAdmin(yourMaintenanceMultisig)`.
5. `renounceOwnership()` once configured — `admin` still maintains routing for cross-chain.

For another chain (AggLayer/L2): deploy with that chain's router+WETH, **or** later call
`updateRouter(newRouter, newWeth)` from `admin`.

---

## 7. Node.js interaction (complete, with `ethers` v6)

These examples use the repo's **vendored** ethers (`vendor/ethers.umd.min.js`, clean-room, no CDN)
and the gathered ABI (`shambaluv/artifacts/ShambaLuv.json`). Swap in a mainnet RPC + your key for
production.

### 7.1 Setup
```js
const { createRequire } = require('module');
const require2 = createRequire(import.meta.url);              // if running as ESM; else plain require
const ethers = require2('../vendor/ethers.umd.min.js');
const art = require2('./artifacts/ShambaLuv.json');           // { abi, bytecode }

const RPC = process.env.RPC || 'https://ethereum.publicnode.com';
const provider = new ethers.JsonRpcProvider(RPC);
const signer  = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
```

### 7.2 Deploy
```js
const TEAM = '0x...team';
const LIQ  = '0x...liquidity';                 // distinct from your holder address
const factory = new ethers.ContractFactory(art.abi, art.bytecode.object, signer);
// router/weth = ZeroAddress → defaults to Ethereum mainnet
const luv = await factory.deploy(TEAM, LIQ, ethers.ZeroAddress, ethers.ZeroAddress);
await luv.waitForDeployment();
console.log('LUV at', await luv.getAddress());
```

### 7.3 Attach to a deployed token
```js
const luv = new ethers.Contract('0x...LUV', art.abi, signer);
```

### 7.4 Reads
```js
const [name, symbol, dec, supply] = await Promise.all([
  luv.name(), luv.symbol(), luv.decimals(), luv.totalSupply()
]);
const bal = await luv.balanceOf(await signer.getAddress());     // includes earned reflections
console.log(`${name} (${symbol}) supply=${ethers.formatUnits(supply, dec)}`);
console.log('my balance:', ethers.formatUnits(bal, dec));

// one-call status: [router, weth, pair, maxTxAmount, payoutThreshold, totalFeeBps]
const cfg = await luv.getConfig();
console.log('router', cfg[0], 'weth', cfg[1], 'pair', cfg[2]);
console.log('maxTx', ethers.formatUnits(cfg[3], 18), 'feeBps', cfg[5].toString());
console.log('payoutThreshold', ethers.formatUnits(cfg[4], 18), 'LUV');   // == payoutThreshold()

// unified-payout accounting: fees accumulate until they reach payoutThreshold (10 trillion LUV),
// then all three (reflection + team ETH + liquidity ETH) distribute together
console.log('payoutThreshold:', ethers.formatUnits(await luv.payoutThreshold(), 18), 'LUV');
console.log('accumulatedFees:', ethers.formatUnits(await luv.accumulatedFees(), 18), 'LUV (pending, gates the payout)');
console.log('pendingReflection:', ethers.formatUnits(await luv.pendingReflection(), 18), 'LUV (awaiting the next batch)');

// reflections accrue inside balanceOf (applied at each payout); reflectionsEarned() is a convenience alias
console.log('reflections (in balance):', (await luv.reflectionsEarned(await signer.getAddress())).toString());
console.log('total reflected so far:', (await luv.totalReflectionsDistributed()).toString());
```

### 7.5 Transfers
```js
// EOA → EOA is fee-free (while walletToWalletFeeExempt is on): recipient gets the full amount
const amount = ethers.parseUnits('1000000', 18);
await (await luv.transfer('0x...friend', amount)).wait();

// approve + transferFrom
await (await luv.approve('0x...spender', amount)).wait();
// (from the spender's signer:)
await (await luv.connect(spenderSigner).transferFrom(myAddr, dest, amount)).wait();
```

### 7.5b Trigger the unified payout (`processFees`, permissionless)
```js
// Fees (3% reflection + 1% team + 1% liquidity) accumulate until they reach payoutThreshold
// (10 trillion LUV). Anyone may fire the unified payout EARLY — no owner role needed:
const accrued = await luv.accumulatedFees();
if (accrued > 0n) {
  await (await luv.processFees()).wait();   // distributes reflection + team ETH + liquidity ETH together
  console.log('reflected so far:', (await luv.totalReflectionsDistributed()).toString());
  console.log('pendingReflection now:', (await luv.pendingReflection()).toString()); // → 0
}
```

### 7.6 Owner configuration (before renounce)
```js
await (await luv.setPair(pairAddress)).wait();                  // register the DEX pair
await (await luv.lowerFees(200, 50, 50)).wait();                // 2%/0.5%/0.5% — can only go down
await (await luv.setMaxTxBps(200)).wait();                      // 2% cap
await (await luv.setMaxTxBps(10000)).wait();                    // 100% = no limit (the corrected meaning)
await (await luv.setWalletToWalletFeeExempt(true)).wait();
await (await luv.setFeeExemption('0x...cex', true)).wait();
await (await luv.excludeFromReflection('0x...contract')).wait();
await (await luv.setPayoutThreshold(ethers.parseUnits('10000000000000', 18))).wait(); // 10 trillion LUV
await (await luv.setAdmin('0x...maintenanceMultisig')).wait();
await (await luv.renounceOwnership()).wait();                   // lock config forever
```

### 7.7 Admin maintenance — cross-chain (after owner renounce)
```js
// re-point routing on another chain (e.g. Polygon QuickSwap) — re-approves correctly
const QUICK = '0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff';
const WPOL  = '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270';
await (await luv.connect(adminSigner).updateRouter(QUICK, WPOL)).wait();
// confirm the new approval is max and the old one is revoked:
console.log('new approval', (await luv.allowance(await luv.getAddress(), QUICK)).toString());
```

### 7.8 Seed liquidity (Uniswap V2)
```js
const ROUTER = (await luv.getConfig())[0];
const routerAbi = [
  'function addLiquidityETH(address token,uint256 amountTokenDesired,uint256 amountTokenMin,uint256 amountETHMin,address to,uint256 deadline) payable returns (uint256,uint256,uint256)',
  'function factory() view returns (address)'
];
const router = new ethers.Contract(ROUTER, routerAbi, signer);
const factoryAddr = await router.factory();
const factory = new ethers.Contract(factoryAddr, [
  'function createPair(address,address) returns (address)',
  'function getPair(address,address) view returns (address)'
], signer);

const WETH = (await luv.getConfig())[1];
let pair = await factory.getPair(await luv.getAddress(), WETH);
if (pair === ethers.ZeroAddress) {
  await (await factory.createPair(await luv.getAddress(), WETH)).wait();
  pair = await factory.getPair(await luv.getAddress(), WETH);
}
await (await luv.setPair(pair)).wait();

const tokenAmt = ethers.parseUnits('1000000000000000', 18);    // 1 Quadrillion LUV
await (await luv.approve(ROUTER, tokenAmt)).wait();
await (await router.addLiquidityETH(
  await luv.getAddress(), tokenAmt, 0, 0, await signer.getAddress(),
  Math.floor(Date.now() / 1000) + 600,
  { value: ethers.parseEther('1') }                            // 1 ETH paired
)).wait();
```

### 7.9 Listen to events
```js
luv.on('Transfer', (from, to, value) =>
  console.log('Transfer', from, '→', to, ethers.formatUnits(value, 18)));
luv.on('ReflectionsDistributed', (tokenAmount) =>
  console.log('reflection batch applied:', ethers.formatUnits(tokenAmount, 18), 'LUV'));
luv.on('FeesDistributed', (tokensSwapped, ethTeam, ethLiq) =>
  console.log('fees → team', ethers.formatEther(ethTeam), 'liq', ethers.formatEther(ethLiq)));
luv.on('FeesProcessed', (reflectionTokens, ethTeam, ethLiq) =>            // the unified payout
  console.log('UNIFIED payout: refl', ethers.formatUnits(reflectionTokens, 18),
              'teamETH', ethers.formatEther(ethTeam), 'liqETH', ethers.formatEther(ethLiq)));
luv.on('WalletToWalletTransfer', (from, to, amt) =>
  console.log('fee-free EOA transfer', ethers.formatUnits(amt, 18)));

// historical:
const logs = await luv.queryFilter(luv.filters.FeesProcessed(), -10000, 'latest');
```

### 7.10 Watch reflections grow (no claim needed)
```js
const me = await signer.getAddress();
const before = await luv.balanceOf(me);
// Reflections are BATCHED in the unified model: your balance does NOT tick up on every fee-charged
// transfer. It JUMPS at each payout — when accumulatedFees reaches payoutThreshold (10 trillion
// LUV) and a fee transfer fires it, or when anyone calls processFees().
// ... wait for a payout (or call processFees() yourself once fees have accrued) ...
const after  = await luv.balanceOf(me);
console.log('earned by holding:', ethers.formatUnits(after - before, 18), 'LUV');
```

### 7.11 Anvil rehearsal (local)
```bash
anvil &
node shambaluv/deploy/deploy-luv-anvil.mjs    # deploys, verifies 1e35 mint + router-armed
```

---

## 8. Build / test

```bash
npm run build:shambaluv      # forge build (self-contained, via_ir)
npm run test:shambaluv       # 12 tests: metadata/genesis, payout-threshold default (10 trillion,
                             # getConfig()[4]==payoutThreshold), EOA fee-free, sell-fee accumulation
                             # (accumulatedFees/pendingReflection/contract balance), reflection
                             # BATCHED-not-continuous + RFI conservation (≤1 wei drift, strictly
                             # solvent, never exceeds 1e35), unified payout (all three in ONE call),
                             # payout tripped at threshold by a sell, max-tx fix, setPayoutThreshold
                             # bounds, fees lower-only, cross-chain router re-approve, renounce
```

The token is also a **deploy choice** in the DeltaVerse: `shambaluv/suites.json`,
`deploy/artifacts/community-luv/ShambaLuv.json`, and the `verse.html` tokens panel.

— *Share the ❤️. Hold LUV, earn LUV.*
