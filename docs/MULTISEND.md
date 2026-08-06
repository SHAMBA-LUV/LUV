# The multisend suite — LUVbus (Ethereum) + MultiSend (Polygon reference)

**Contracts:** [`contracts/LUVbus.sol`](../contracts/LUVbus.sol) ·
[`contracts/MultiSend.sol`](../contracts/MultiSend.sol) · operator console with diagnostics +
ABI interaction: https://luv.pythai.net/luvbus.html
**Suite home (ops):** DeltaVerse `deploy/multisend/` — bundle `deploy/suites/multisend.xml`,
registry `deploy/suites.json` → `settlement-multisend` (settlement / payment-infra, stage E12, aux)

One rail, two implementations. **Multichain doctrine (operator, 2026-08-05): LUV mints on
POL, ARB, OPT and 0G — `MultiSend.sol` is MAINTAINED as the batch rail on the expansion
chains, not a frozen reference.** **The rail is chain-aware: `chainId()` (`block.chainid`)
tells each deployment where it is — multisend just needs to know which chain it is on and
share its skill across the chains.** **LUVbus is the FOCUS unit** — the ETH-anchored
multisend deployed identically on every chain (MultiSend stays the import-based OZ
reference for builds that specifically want it); on every chain the wiring rule is the same — fee- and
maxTx-exempt the rail on that chain's LUV deployment before it carries LUV.



| | `LUVbus.sol` | `MultiSend.sol` |
|---|---|---|
| chain | **Ethereum mainnet** (LUV-first) | **POL · ARB · OPT · 0G** — the expansion chains (Polygon original, MAINTAINED) |
| dependencies | **zero** — Ownable2Step/Pausable/ReentrancyGuard/SafeTransfer inlined (cypherpunk4096) | OpenZeppelin (`Ownable2Step`, `SafeERC20`, `ReentrancyGuard`, `Pausable`) |
| reverts | custom errors (no revert strings in runtime) | require strings |
| native leg | ETH (`payable` batch entrypoints — fund with tx value) | the chain's gas coin — POL / ETH (ARB, OPT) / 0G |
| one-way switch | **`retire()` — pause ON forever**, no unpause; withdraw/recover stay live | — |
| ownership | two-step + `transferOwnershipToAddress` (direct) + `renounceOwnership` (one-way; **sweep first** — renounce kills withdrawals) | two-step |
| compile | solc 0.8.24+ (checked 0.8.36, optimizer 200) | solc 0.8.23 + OZ remapping |

## Ethereum gas doctrine (why LUVbus differs)

Calldata is the dominant cost on L1 — every nonzero byte is 16 gas, so a 500-seat
variable-amount batch pays for two full arrays. Choose the mode by cost, cheapest first:

1. `multiSendERC20UsingDefault(token, recipients[])` — addresses only; per-seat amount from storage
2. `multiSendERC20Uniform(token, recipients[], amount)` — addresses + one amount word
3. `multiSendERC20EqualSplit(token, recipients[], total)` — addresses + one total word (remainder wei to the first seats)
4. `multiSendERC20(token, recipients[], amounts[])` — both arrays; only when amounts truly vary

Batch ceiling: ~55k gas/seat worst-case (cold ERC20 transfer) against the ~30M block limit
⇒ the default `maxBatchSize = 500` is safe; retune with `setMaxBatchSize` after measuring
the actual token. Native ETH variants mirror all modes and accept funding via tx `value`.

## LUV wiring (required before the bus carries LUV)

LUVbus is a **contract counterparty** on ShambaLuv, so the token owner must exempt it or
every seat pays the trade fee:

```
LUV.setFeeExemption(bus, true)      // full amount per seat — 1 LUV === 1 LUV
LUV.setMaxTxExemption(bus, true)    // batches above 1% of supply in one tx
```

## Role in the LUVdrop suite

The LUVdrop pays per-participant through the IncentiveDistributor rail (voucher-signed
`claimWithSignature` / batched `distributeReward` on REDEEM — see
[`docs/LUVDROP_GO_LIVE.md`](LUVDROP_GO_LIVE.md) and [`docs/LUVDRIP.md`](LUVDRIP.md)). **LUVbus is the mass-drop
complement**: when a whole cohort must be paid in one transaction *outside* the
per-identity rail (compensation sweeps, partner drops, the 1B-gesture backlog), load the
bus, `setDefaultERC20Amount(LUV, seatAmount)`, and drive
`multiSendERC20UsingDefault(LUV, cohort[])`. The distributor stays the *earn* rail
(policy-gated, per-identity); the bus is the *broadcast* rail (owner-driven, cohort-wide).
Both must be fee-exempt; neither touches the other's accounting.

## One-way switches (operator discipline)

- `retire()` — binary switch to paused-forever. Use when the bus's campaign is done and the
  rail should provably never send again. Sweeps remain available after retirement.
- `renounceOwnership()` — kills **every** owner function including withdraw/recover.
  Sequence: `retire()` → sweep all balances → then (only if truly wanted) renounce.

## Deploy

- Rehearsal: `anvil` + any deployer; LUVbus has no constructor args (deployer = owner).
- Production: OVERLORD-signed like every settlement suite; verify on Etherscan (V2 REST,
  `chainid=1`) for the green checkmark, then wire the fee exemptions and, for LUV drops,
  set the default seat amount.
- Console: https://luv.pythai.net/luvbus.html (paste the deployed address; reads via the
  wallet provider, writes arm only for the owner).

## LUV as the bridge for chains

LUV is not merely deployed per chain — **LUV is the bridge unit between them**, by design:

- **One address on every chain.** The create3d rail makes the deployment deterministic —
  the initcode is the name — so LUV on POL is LUV on ARB is LUV on ETH: no lookup tables,
  no wrapped-token drift, nothing to misroute.
- **One lattice.** 18 decimals everywhere; **1 LUV === 1 LUV on every chain** — amounts
  cross without rescaling, and the denominations (the gesture, the trillion) mean the same
  thing on every side.
- **Fee-exempt plumbing.** The token exempts bridges and infra exactly like the liquidity
  wallet (`setFeeExemption`) — crossing carries no trade fee; the 5% belongs to market
  trades only.
- **Chain-aware rails on both sides.** LUVbus knows where it is (`chainId()`), so the same
  unit loads on the source chain and distributes on the destination; the allchain map keys
  every deployment by `(chainId, address)`.
- **Mechanism (pending).** Until a dedicated bridge unit ships and earns its green
  checkmark, crossings settle operator-side between the per-chain treasuries; when the
  bridge contract deploys it enters fee- and maxTx-exempt like the distributor. Stated
  plainly: the doctrine is live, the contract is roadmap.

## The allchain map

Each per-chain LUVbus deployment maps onto **agenticplace.pythai.net/allchain.html from the
database**: the deploy record (live-registry manifest: suite, contract, address, tx, verify
status) enters the AgenticPlace verified database (`agenticplace.pythai.net/allchain/api`),
keyed by `(chainId, address)` — the `chainId` the unit itself reports via `chainId()`. The
allchain board then renders the rail across every chain it lives on: one skill, every chain,
one map.
