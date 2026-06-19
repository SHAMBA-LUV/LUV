# ❤️ SHAMBA LUV (`LUV`)

> **emotonomics — hold LUV, earn LUV.** A reflection token where simply holding grows your
> balance, and a *digital gesture* gives 1 trillion LUV to every real new signup.

The complete, corrected SHAMBA LUV project: the rewritten token, a signature-gated airdrop, a
self-hosted social-login → wallet → gesture backend, full tests, and a live-anvil deployment +
hard-test harness.

- **Mint / name / symbol unchanged:** 100 Quadrillion (`1e35`) · `SHAMBA` · `LUV`, 18 decimals.
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
test/        19 forge tests (self-contained, no forge-std)
deploy/      anvil deploy + a 29-check live hard-test (deploy-and-test-anvil.mjs)
auth/        self-hosted social login → sovereign wallet → wallet-to-wallet 1T-LUV gesture
LUV.md       complete contract guide   ·   AUDIT.md   full audit + remediation
```

## The gesture (1% of supply)
A new signup signs in with a social account → the backend provisions a wallet → the treasury
**sends 1 trillion LUV wallet-to-wallet** (EOA→EOA, 0 fee, full trillion). One social identity =
one wallet = one gesture. The whole campaign is hard-capped at **1% of supply** (1 Quadrillion =
1,000 trillion = 1,000 gestures). Self-hosted (cypherpunk2048 wallet hosting), no paid third-party
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
