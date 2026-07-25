# The LUVdrop signer vault

The airdrop delivers by having the backend sign an EIP-712 voucher; the on-chain
`ShambaLuvAirdrop.signer` must match the key that signs. This doc is how that key is created,
protected, and rotated.

## The key is DEDICATED and low-value by design

- It is **not** bankon.eth. It is a fresh EOA created only to sign vouchers.
- It **holds no funds** and **sends no transactions** — participants submit `claim()` and pay their
  own gas. So the signer can never be *drained*.
- Blast radius if it ever leaked: an attacker could forge vouchers to pull from the **1-quadrillion
  airdrop pool** (never the 111-quad supply, never contract ownership). The **offline owner
  (bankon.eth)** neutralises that instantly with `setSigner()` (rotate) and/or `setPaused()`.

## At-rest protection: bankon-vault

The private key lives only inside `secrets/luvdrop-signer.vault.json`, sealed with
**AES-256-GCM** (per-entry HKDF-SHA512 keys, master key derived from a passphrase via
PBKDF2-210k) — `engine/bankon-vault.js`. The file is gitignored and mode `0600`. Without the
passphrase the file is useless; a wrong passphrase fails closed (`wrong key — vault did not unlock`).

**Honest limit:** a signer that signs on every request must be *in memory* while the service runs —
the vault protects the key **at rest**, not against a live-process compromise. The real containment
is the low-value design above (no funds, instant offline revoke). For stronger separation, supply the
passphrase out-of-band (`LUV_SIGNER_VAULT_PASSPHRASE_FILE` on a tmpfs / systemd credential) so it is
never written to the same disk as the vault.

## Create it

```bash
cd shambaluv/auth
LUV_SIGNER_VAULT_PASSPHRASE="$(openssl rand -base64 32)" node scripts/create-luvdrop-signer.mjs
```

Prints the **signer address** (no key is ever printed) and writes the encrypted vault.

## Point the airdrop at it (owner = bankon.eth, run OFFLINE)

```bash
cast send 0xdf2C1836550c5711EF9c021cB0de86241dc1DEf3 "setSigner(address)" <SIGNER_ADDRESS> \
  --private-key 0x<bankon.eth key> --rpc-url https://ethereum-rpc.publicnode.com
cast call 0xdf2C1836550c5711EF9c021cB0de86241dc1DEf3 "signer()(address)" --rpc-url https://ethereum-rpc.publicnode.com
```

## Wire the backend (`luv.env`)

```
LUV_SIGNER_VAULT_FILE=/home/luv/DeltaVerse/shambaluv/auth/secrets/luvdrop-signer.vault.json
LUV_SIGNER_VAULT_PASSPHRASE=<the passphrase>          # or LUV_SIGNER_VAULT_PASSPHRASE_FILE
# leave VOUCHER_SIGNER_PRIVATE_KEY blank in production
```

At boot the backend unlocks the vault, holds the signer in memory, and signs vouchers. On a wrong
passphrase it refuses to start signing (fails closed).

## Rotate (if ever suspected)

Use the owner-ops helper `scripts/luvdrop-admin.mjs` (previews the exact `cast` command + raw
calldata; sign from bankon.eth offline):

1. `node scripts/luvdrop-admin.mjs pause` → freeze claims.
2. Create a new signer vault (above), then `node scripts/luvdrop-admin.mjs rotate-signer <newAddress>`;
   update `luv.env` (LUV_SIGNER_VAULT_FILE/PASSPHRASE) and restart the auth service.
3. `node scripts/luvdrop-admin.mjs unpause`. Old vouchers signed by the previous key are now invalid.

`node scripts/luvdrop-admin.mjs status` shows owner / signer / paused / claimed / pool balance at a glance.
