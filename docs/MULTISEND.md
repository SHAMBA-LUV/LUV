# The multisend suite — LUVbus (Ethereum) + MultiSend (Polygon reference)

**Contracts:** [`contracts/LUVbus.sol`](../contracts/LUVbus.sol) ·
[`contracts/MultiSend.sol`](../contracts/MultiSend.sol) · operator console with diagnostics +
ABI interaction: https://luv.pythai.net/luvbus.html
**Suite home (ops):** DeltaVerse `deploy/multisend/` — bundle `deploy/suites/multisend.xml`,
registry `deploy/suites.json` → `settlement-multisend` (settlement / payment-infra, stage E12, aux)

One rail, two implementations:

| | `LUVbus.sol` | `MultiSend.sol` |
|---|---|---|
| chain | **Ethereum mainnet** (LUV-first) | **Polygon** (reference original) |
| dependencies | **zero** — Ownable2Step/Pausable/ReentrancyGuard/SafeTransfer inlined (cypherpunk4096) | OpenZeppelin (`Ownable2Step`, `SafeERC20`, `ReentrancyGuard`, `Pausable`) |
| reverts | custom errors (no revert strings in runtime) | require strings |
| native leg | ETH (`payable` batch entrypoints — fund with tx value) | MATIC |
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
