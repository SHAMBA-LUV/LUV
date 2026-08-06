# ❤️ SHAMBA LUV (`LUV`)

> ## ✅ PHASE 1 — COMPLETE
> The gesture campaign delivered: social-login wallets provisioned, gestures sent, the airdrop
> closed. **Phase 2 — LUV trades live** on Uniswap V2 · **Phase 3 — the engine era** is underway
> at [luv.pythai.net](https://luv.pythai.net).
>
> <a href="https://etherscan.io/token/0x2711111111683B8708cb9a48cBf36a51315F8254"><picture><source media="(prefers-color-scheme: dark)" srcset="gfx/brand/etherscan_wordmark_light.svg"><img src="gfx/brand/etherscan_wordmark_dark.svg" height="16" alt="Etherscan"></picture></a>&nbsp; [**the live contract `0x2711…8254` — source verified ✓**](https://etherscan.io/token/0x2711111111683B8708cb9a48cBf36a51315F8254)
> &nbsp;·&nbsp; <a href="https://app.uniswap.org/swap?chain=ethereum&amp;inputCurrency=ETH&amp;outputCurrency=0x2711111111683B8708cb9a48cBf36a51315F8254"><img src="gfx/brand/uniswap_horizontal_pink.svg" height="18" alt="Uniswap"></a>&nbsp; [**trade LUV / ETH live**](https://app.uniswap.org/swap?chain=ethereum&amp;inputCurrency=ETH&amp;outputCurrency=0x2711111111683B8708cb9a48cBf36a51315F8254) *(set slippage ~10%)*

> **emotonomics — hold LUV, earn LUV.** A reflection token where simply holding grows your
> balance, and a *digital gesture* gives 1 trillion LUV to every real new signup.

The complete, corrected SHAMBA LUV project: the rewritten token, a signature-gated airdrop, a
self-hosted social-login → wallet → gesture backend, full tests, and a live-anvil deployment +
hard-test harness.

- **Supply:** **111 Quadrillion** — the repunit of ones (`111,111,111,111,111,111.111111111111111111`
  LUV, 18 decimals) · `SHAMBA` · `LUV` · **fixed at genesis, no mint function**.
- **Liquidity (actual, on-chain):** the design said 100Q in the pool; **one Uniswap V2 pair cannot
  hold it**. V2 reserves are `uint112`, so the pool was seeded at the **discovered Uniswap maximum —
  2¹¹²−1 LUV-wei = `5,192,296,858,534,827,628,530,496,329,220,095` ≈ 5.192 Quadrillion LUV**
  (one wei more reverts `UniswapV2: OVERFLOW`), paired with ETH at exactly **10 wei per LUV** at
  genesis. The pair: [`LUV/WETH 0x57D2…8a31`](https://etherscan.io/address/0x57D2085Aa859a145cB107845AD03c0eAAFBD8a31)
  · [pair holders](https://etherscan.io/token/0x57D2085Aa859a145cB107845AD03c0eAAFBD8a31#balances).
- **LP holding wallet & lock status:** the treasury
  [`0x10f7…d169` (bankon.eth)](https://etherscan.io/address/0x10f7ee226b16bea7f365dc1edef159fc1957d169)
  holds **100% of circulating LP** — confirmed on-chain: LP `totalSupply` − treasury balance =
  exactly the 1000-wei `MINIMUM_LIQUIDITY`. **The LP is not yet locked. Locking the liquidity and
  the LUVlocker supply-lock are the standing priority**, targeting
  [`LUVLocker 0xe07A…B898`](https://etherscan.io/address/0xe07ACAde4bE2bbc264EA702880ed988EBae9B898)
  — see [`docs/AUDIT_FULL_2026-08.md`](docs/AUDIT_FULL_2026-08.md) (the supply-lock routes through
  the fixed vault; the LP-lock is the lower-risk first move).
- **Allocation (actual → next):** the non-circulating remainder is held by the treasury today; the
  **marketing · development · community allocation wallets are being made actual next** — each
  component spends only by **2-of-3 DAIO consensus** (*consensus before custody*), and the
  marketing + community allocations deposit into the locker as published.
- **Primary chain:** Ethereum (router + WETH configurable → cross-chain ready).

## Fee model (rewards on buy/sell)
- **Wallet-to-wallet (EOA ↔ EOA) is always 0 fee** — share the LUV freely.
- The **5%** (3% reflection + 1% liquidity + 1% team) is a **trading reward** — it applies to
  **buys and sells** (a non-exempt contract counterparty, i.e. the DEX pair), never to ordinary
  transfers.
- **Bridges / infra are fee-exempt** exactly like the liquidity wallet (`setFeeExemption`), so
  bridging and protocol plumbing incur no fee.
- Unified **10-trillion payout**: reflection + team + liquidity distribute in one transaction.

Full details in [`LUV.md`](LUV.md) (every function + complete Node.js interaction). The full
security review of the live contract is in [`AUDIT.md`](AUDIT.md).

## Layout
```
contracts/   ShambaLuv.sol (corrected RFI token) · ShambaLuvAirdrop.sol (signature-gated, 1% cap)
             LUVbus.sol (the Ethereum batch rail — zero-dependency multisend, custom errors,
             calldata-lean modes ordered by cost, one-way retire switch, renounce + direct
             ownership handoff; owner should setFeeExemption(bus) on the token; operator
             console with diagnostics + ABI interaction: https://luv.pythai.net/luvbus.html)
             MultiSend.sol (Polygon reference original, OpenZeppelin — the multisend suite's
             second half; suite doc: docs/MULTISEND.md)
test/        19 forge tests (self-contained, no forge-std)
deploy/      anvil deploy + a 29-check live hard-test (deploy-and-test-anvil.mjs)
auth/        self-hosted social login → sovereign wallet → wallet-to-wallet 1T-LUV gesture
LUV.md       complete contract guide   ·   AUDIT.md   full audit + remediation
```

## The gesture (the 1-Quadrillion campaign)
A new signup signs in with a social account → the backend provisions a wallet → the treasury
**sends 1 trillion LUV wallet-to-wallet** (EOA→EOA, 0 fee, full trillion). One social identity =
one wallet = one gesture. The whole campaign is hard-capped at a **1-Quadrillion pool** drawn from
the treasury wallet's 2.777-Quadrillion allocation (1,000 gestures of 1 Trillion each). Self-hosted (cypherpunk2048 wallet hosting), no paid third-party
service. See [`auth/README.md`](auth/README.md).

## Build · test · deploy
```bash
forge build && forge test            # 19 unit tests
anvil & node deploy/deploy-and-test-anvil.mjs    # deploy + 29-check live hard test
node deploy/deploy-luv-anvil.mjs                 # LUV first-light rehearsal
```

> The legacy `LUV*.sol` deployed-contract record lives in the
> [SHAMBALUV](https://github.com/shamba-luv/SHAMBALUV) repo; this repo is the corrected,
> standalone project.

— *Share the ❤️.*
