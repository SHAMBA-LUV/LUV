# Security policy — SHAMBA LUV

## Reporting a vulnerability

Email **luv@pythai.net** with "SECURITY" in the subject. Include the contract address,
the affected function, and a reproduction if you have one. You will get an
acknowledgement; please give us time to remediate before publishing.

Do not open a public GitHub issue for a vulnerability in a live, funded contract.

## What is published, and what is not

The contracts are **open source and verified on Etherscan** — the green checkmark, where
the published source is compiled and matched against the deployed bytecode. That does not
change. Anyone can read every line of what is deployed:

| contract | address | source |
|---|---|---|
| ShambaLuv (token) | `0x2711111111683B8708cb9a48cBf36a51315F8254` | `contracts/ShambaLuv.sol` |
| ShambaLuvAirdrop | see the repository | `contracts/ShambaLuvAirdrop.sol` |
| LUVbus · MultiSend | see the repository | `contracts/LUVbus.sol`, `contracts/MultiSend.sol` |

**Detailed audit findings are not published while they are live and unfixed.** They are
held under OVERLORD access at [`contractaudit.html`](https://luv.pythai.net/contractaudit.html).

This is a deliberate policy change, and it is worth stating the reasoning plainly rather
than quietly. A full severity-ranked audit was previously published in this repository
while several of its findings affected **deployed, funded contracts that had not yet been
remediated**. A public, indexed, step-by-step description of how to exploit a live
contract holding real value is not transparency — it is a loaded weapon left on a table.
Responsible disclosure means the fix precedes the disclosure.

What this policy is *not*: it is not a claim that the contracts are flawless, and it is
not an invitation to assume they are. **Open findings exist.** Treat the absence of
published detail as a reason for caution, not for comfort.

## What we still publish, because it costs no one anything

- **The source.** Every deployed contract, verified on the explorer.
- **The green test suite** — [`docs/passed.md`](docs/passed.md): 174 curated tests, each
  checkmarked. Measures and results as they actually ran, not as we would like them read.
- **The build profile**, so anyone can reproduce the bytecode: solc 0.8.24, optimizer on
  at 200 runs, `viaIR` off, EVM version cancun ([`foundry.toml`](foundry.toml)).
- **The properties that matter to a holder**, verifiable directly on chain: no blacklist,
  no pause on transfers, no mint, no sell-block; fees are lower-only. Do not take these
  on our word — call the contract.

## Honest posture

- **Ownership is not renounced.** The owner can adjust parameters within the contract's
  limits. Verify current state before sizing a position.
- **Automated scanners flag every fee-on-transfer token by reflex.** The answer is the
  verified source, not a counter-badge.
- **"Verified" is a reserved word here.** It means the green checkmark and nothing else —
  never an audit we commissioned, a self-assessment, or a screenshot.

## Scope

In scope: the deployed contracts above, `luv.pythai.net`, and the authentication backend.
Out of scope: third-party infrastructure (Etherscan, Uniswap, RPC providers, wallets),
social engineering, and denial of service against public RPC endpoints.

## A note on history

Removing a file from the default branch does not remove it from git history, from forks,
or from anything that already mirrored it. Where previously published material described
live exposures, the durable remedy is remediation of the contracts themselves, not
deletion of the document. That work is tracked under OVERLORD access.
