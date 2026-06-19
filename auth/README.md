# SHAMBA LUV — self-hosted social-login → wallet → airdrop backend

> ❤️ The off-chain Sybil gate for the gesture. A user signs in with a social account, the backend
> provisions a wallet for that identity, and the **treasury wallet sends 1 trillion LUV
> WALLET-TO-WALLET** to it. Because the LUV token makes EOA↔EOA transfers **0-fee**, the gesture is a
> direct EOA→EOA transfer — **full trillion, no fee, no fee-exemption, no contract distributor**
> (`src/airdrop/gesture.js`). The relayer pays only the simple-transfer gas. **One social identity =
> one wallet = one gesture.** (An optional on-chain self-serve *pull* path via the signature-gated
> `ShambaLuvAirdrop` contract lives in `src/airdrop/voucher.js`, but that path is contract→EOA and is
> fee-charged unless the contract is fee-exempt — so wallet-to-wallet is primary.)
>
> **Fully self-hosted** (Node + Express + PostgreSQL + ethers v6) — no paid third-party auth or
> wallet service, **no monthly fee**. Wallet hosting is built to the **cypherpunk2048 standard**:
> sovereign, clean-room, no remote dependency — every key lives in *your* infrastructure under
> *your* secret, with the standard's target of operator-cannot-spend (see §3).

---

## 1. The flow

```
  ┌────────────┐   OAuth    ┌─────────────────────────────────────────────┐
  │  Browser   │ ─────────▶ │  /auth/<provider>  →  provider  →  callback   │
  │  (dapp/app)│ ◀───────── │  callback: upsert identity                    │
  └────────────┘  JWT cookie│            ├─ provision embedded wallet       │
                            │            └─ run airdrop (first login)       │
                            └───────────────────────┬───────────────────────┘
                                                     │
                       sign EIP-712 Claim voucher    │   relay claim() (relayer pays gas)
                       (VOUCHER_SIGNER key)           ▼
                                            ┌───────────────────────┐
                                            │  ShambaLuvAirdrop.sol  │  → transfers 1T LUV
                                            │  verifies signer,      │     to the recipient
                                            │  usedNonce, hasClaimed │
                                            └───────────────────────┘
```

1. **Social login.** `GET /auth/google` (or `/discord`, `/github`) starts OAuth. The provider
   redirects to `/auth/<provider>/callback`.
2. **Identity.** The callback normalizes the profile to a stable **identity key**
   `${provider}:${providerUserId}` and upserts an `identities` row. The identity key — not the
   wallet — is the Sybil unit.
3. **Provision.** On first login the backend generates an ethers `Wallet`, encrypts the private
   key at rest (AES-256-GCM, per-user key), and stores `{address, ciphertext, iv, tag}` in
   `wallets`. Idempotent: one wallet per identity.
4. **The gesture.** The backend allocates a unique `uint256` nonce, builds the EIP-712 `Claim`
   voucher, signs it with `VOUCHER_SIGNER_PRIVATE_KEY`, and **relays** `claim(recipient, amount,
   nonce, deadline, signature)` with the `RELAYER` wallet (pays gas). The claim is recorded in
   `airdrop_claims` (unique per identity, unique nonce). Already-claimed / cap-reached are handled
   gracefully.
5. **Session.** A signed JWT is set as an httpOnly cookie (and accepted as `Authorization:
   Bearer` for Tauri / API clients). `GET /auth/me` and `GET /airdrop/status` report the wallet
   address and claim state.

---

## 2. How it maps to the on-chain contract

`contracts/ShambaLuvAirdrop.sol` is **signature-gated**: only a voucher signed by its configured
`signer` releases LUV, and it enforces one claim per `nonce` **and** per `recipient`, with a hard
campaign cap `AIRDROP_CAP = 1e33` (1% of supply). The backend matches it **exactly**:

| Contract | Backend |
| --- | --- |
| EIP-712 domain `name="ShambaLuvAirdrop"`, `version="1"`, `chainId`, `verifyingContract` | `src/eip712.js` `buildDomain({chainId, verifyingContract})` |
| `Claim(address recipient,uint256 amount,uint256 nonce,uint256 deadline)` | `CLAIM_TYPES` in `src/eip712.js` (same names + order) |
| `signer` (the voucher key) | `VOUCHER_SIGNER_PRIVATE_KEY` — its address **must equal** `airdrop.signer()` |
| `usedNonce[nonce]` (one voucher per nonce) | unique 256-bit nonce + `airdrop_claims.nonce UNIQUE` |
| `hasClaimed[recipient]` (one claim per wallet) | `airdrop_claims.identity_key UNIQUE` + on-chain guard |
| `claimAmount` default 1e30 (1 trillion LUV) | `CLAIM_AMOUNT` env, default `1e30` |
| `AIRDROP_CAP = 1e33` | preflight check + on-chain revert mapped to `cap_reached` |
| `claim(...)` releases via `_safeTransfer` | relayed by `src/airdrop/voucher.js` |

`test/voucher-selftest.mjs` proves the equivalence: it signs a voucher with a known key and shows
`ethers.verifyTypedData(...) == signer`, and recomputes the Solidity `DOMAIN_SEPARATOR` /
`structHash` / `"\x19\x01"||DS||structHash` digest and matches it to ethers'. **All checks pass.**

> **Deployment step (outside this backend):** the airdrop contract must be **fee-exempt** in the
> LUV token (`setFeeExemption(airdrop, true)`), and set as the airdrop's `signer` =
> `VOUCHER_SIGNER` address. The backend assumes recipients receive the full 1 trillion LUV.

---

## 3. Wallet hosting — the cypherpunk2048 standard

Wallet hosting is **sovereign, self-hosted, and clean-room** — no remote custody service, no
remote dependency. Each user's EVM private key is generated in *our own* infrastructure and stored
**encrypted at rest** with AES-256-GCM; the per-user encryption key is derived via `scrypt` from
the env-only master `WALLET_ENCRYPTION_KEY` plus the user's identity key, so the database
ciphertext alone is inert without the master secret.

**The cypherpunk2048 standard's target is operator-cannot-spend.** This first cut keeps the master
secret server-side (so the operator *could* technically decrypt) only to make the gifted airdrop
balance frictionless; the standard it is being brought to removes that authority entirely. The
path — already shaped into the DB columns and the `src/wallet/provision.js` interface so it
migrates without a schema change — is to split key custody so the operator never holds spend
authority: a passkey/WebAuthn or user-secret key-share (2-of-2), MPC/TSS, and/or **ERC-4337
user-owned smart accounts** (the DeltaVerse `twengine/contracts/wallet` stack) with the user as
sole owner. (Note: the airdrop itself never requires the user's key — the
recipient signs nothing; only the backend `signer` signs the voucher.)

---

## 4. Security (fixes vs. the old dataluv/luvdat backend)

- **Auth on every state-changing route.** `/airdrop/trigger` (and `/airdrop/status`) require a
  valid JWT session (`requireAuth`). The old backend had **no** auth.
- **IP from `req.ip`.** `trust proxy` is configured so `req.ip` is the real client IP; the IP is
  **never** read from the request body. Rate-limit keying uses `req.ip`.
- **Strict CORS.** Exact-origin allowlist from `CORS_ALLOWLIST`. No substring matching, no
  `!origin` auto-allow for credentialed routes.
- **Sane rate limits.** 100/15min general, 20/15min on `/auth`, 10/15min on `/airdrop`.
- **Real `IP_SALT`.** Required from env — **no hardcoded fallback** (boot fails if missing).
- **No outbound port-scanning of users.** Removed entirely.
- **No PII in logs.** No raw IPs or full request bodies are logged; errors log only `.message`.
- **Parameterized SQL only** (`src/db.js`). **Secrets only from env** (`src/config.js`,
  fails fast on missing required vars). **JSON body limit** 16kb. **helmet** on.

---

## 5. Setup

```bash
cd shambaluv/auth
npm install                      # ethers also resolves to the repo's vendored bundle at runtime
cp .env.example .env             # then fill in — generate secrets with: openssl rand -hex 32
# create the database, then:
npm run migrate                  # applies db/schema.sql (idempotent)
npm run start                    # listens on :PORT
npm run selftest                 # proves the EIP-712 voucher matches the contract
```

**Required env** (see `.env.example` for the full list): `DATABASE_URL`, `JWT_SECRET`,
`SESSION_SECRET`, `IP_SALT`, `RPC_URL`, `CHAIN_ID`, `LUV_TOKEN_ADDRESS`,
`AIRDROP_CONTRACT_ADDRESS`, `VOUCHER_SIGNER_PRIVATE_KEY`, `RELAYER_PRIVATE_KEY`,
`WALLET_ENCRYPTION_KEY`, plus OAuth client id/secret per provider you enable.

**Providers:** Google, Discord, GitHub are wired concretely. Apple and X (Twitter) are pluggable —
add the strategy dep + env vars and uncomment the block in `src/auth/strategies.js`.

---

## 6. API

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/health` | – | liveness |
| GET | `/auth/providers` | – | which providers are live |
| GET | `/auth/<provider>` | – | begin OAuth (`google`/`discord`/`github`) |
| GET | `/auth/<provider>/callback` | – | finish OAuth → provision + airdrop → set JWT cookie |
| GET | `/auth/me` | JWT | session identity + wallet address |
| POST | `/auth/logout` | – | clear session cookie |
| GET | `/airdrop/status` | JWT | has this identity claimed? wallet + tx |
| POST | `/airdrop/trigger` | JWT | idempotent re-run (acts only on the session identity) |

---

## 7. File map

```
auth/
  README.md                     this doc
  package.json                  deps + scripts (start, migrate, selftest)
  .env.example                  all config, placeholders only
  db/
    schema.sql                  identities / wallets / airdrop_claims (UNIQUE Sybil constraints)
  src/
    server.js                   express app: helmet, strict CORS, rate limits, routes, /health
    config.js                   env load + validate (fail-fast, no insecure fallbacks)
    db.js                       pg pool, parameterized queries, configurable SSL
    ethers.js                   clean-room ethers loader (vendored UMD, npm fallback)
    eip712.js                   domain + Claim types (byte-matches the contract)
    migrate.js                  apply schema.sql
    auth/
      strategies.js             passport Google/Discord/GitHub (+ Apple/X stubs)
      session.js                signed JWT sessions + requireAuth middleware
      identity.js               upsert identity, first-login provision + airdrop
    wallet/
      provision.js              AES-256-GCM embedded-wallet provisioning (custody tradeoff doc)
    airdrop/
      voucher.js                build/sign EIP-712 voucher + relay claim() (the gesture)
    routes/
      auth.js                   /auth/* (login, callback, /me, /logout, /providers)
      airdrop.js                /airdrop/status + /airdrop/trigger (both JWT-gated)
  test/
    voucher-selftest.mjs        proves verifyTypedData == signer + Solidity digest match
```

— *Share the ❤️. One real signup, one trillion LUV.*
