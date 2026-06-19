-- ShambaLuv self-hosted auth + airdrop backend — Postgres schema.
-- One social identity = one wallet = one claim, enforced by UNIQUE constraints.

CREATE TABLE IF NOT EXISTS identities (
    id              BIGSERIAL PRIMARY KEY,
    provider        TEXT        NOT NULL,            -- 'google' | 'discord' | 'github' | ...
    provider_user_id TEXT       NOT NULL,            -- the provider's stable user id
    -- Stable identity key = '<provider>:<providerUserId>'. The Sybil unit.
    identity_key    TEXT        NOT NULL UNIQUE,
    email           TEXT,                            -- may be null (not all providers share it)
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (provider, provider_user_id)
);

-- One embedded wallet per identity. Private key encrypted at rest (AES-256-GCM).
CREATE TABLE IF NOT EXISTS wallets (
    id              BIGSERIAL PRIMARY KEY,
    identity_key    TEXT        NOT NULL UNIQUE
                        REFERENCES identities (identity_key) ON DELETE CASCADE,
    address         TEXT        NOT NULL UNIQUE,      -- the 0x EVM address
    enc_ciphertext  TEXT        NOT NULL,             -- base64 AES-256-GCM ciphertext of the priv key
    enc_iv          TEXT        NOT NULL,             -- base64 12-byte GCM nonce
    enc_tag         TEXT        NOT NULL,             -- base64 16-byte GCM auth tag
    enc_alg         TEXT        NOT NULL DEFAULT 'AES-256-GCM',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One airdrop claim per identity. nonce is globally unique (matches on-chain usedNonce[]).
CREATE TABLE IF NOT EXISTS airdrop_claims (
    id              BIGSERIAL PRIMARY KEY,
    identity_key    TEXT        NOT NULL UNIQUE
                        REFERENCES identities (identity_key) ON DELETE CASCADE,
    wallet_address  TEXT        NOT NULL,
    nonce           NUMERIC(78, 0) UNIQUE,            -- uint256 nonce; NULL for the wallet-to-wallet
                                                      -- gesture (multiple NULLs ok), set only on the
                                                      -- optional on-chain voucher path
    amount          NUMERIC(78, 0) NOT NULL,          -- base units (wei)
    deadline        BIGINT,                           -- unix seconds the voucher expires
    tx_hash         TEXT,                             -- relayed claim() tx
    -- status: 'pending' -> 'submitted' -> 'confirmed' | 'failed' | 'already_claimed' | 'cap_reached'
    status          TEXT        NOT NULL DEFAULT 'pending',
    error           TEXT,                             -- short non-PII error note on failure
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_airdrop_claims_status ON airdrop_claims (status);
CREATE INDEX IF NOT EXISTS idx_wallets_address ON wallets (address);
