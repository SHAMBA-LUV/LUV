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
    -- ERC-4337: the counterfactual LuvAccount for this identity (factory.getAddress(owner,
    -- salt)). The gesture is delivered HERE while the account has no code (0-fee window);
    -- `address` above stays the owner EOA (the signing key). NULL on pre-AA rows.
    smart_account   TEXT        UNIQUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotent upgrade for databases created before the ERC-4337 wallet rail.
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS smart_account TEXT UNIQUE;

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
    tx_hash         TEXT,                             -- relayed claim() tx, or the SHARED batch tx
    -- status:
    --   direct mode: 'pending' -> 'submitted' -> 'confirmed' | 'failed' | 'already_claimed' | 'cap_reached'
    --   batch  mode: 'queued' -> 'batching' -> 'submitted' -> 'confirmed'
    --               | back to 'queued' on send failure (attempts++) | 'failed' | 'cap_reached'
    status          TEXT        NOT NULL DEFAULT 'pending',
    attempts        INT         NOT NULL DEFAULT 0,   -- batch send retries (failed at BATCH_MAX_ATTEMPTS)
    error           TEXT,                             -- short non-PII error note on failure
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Proof-of-action submissions for the IncentiveDistributor tasks rail (earn LUV for
-- tweet/post/interaction). action_id is the on-chain dedup key (claimWithSignature);
-- amounts/limits always come from the on-chain registry — `amount` here is a display copy.
CREATE TABLE IF NOT EXISTS action_submissions (
    id              BIGSERIAL PRIMARY KEY,
    identity_key    TEXT        NOT NULL
                        REFERENCES identities (identity_key) ON DELETE CASCADE,
    action          TEXT        NOT NULL,             -- 'tweet' | 'post' | 'interaction' | ...
    action_id       TEXT        NOT NULL UNIQUE,      -- derived: luv:<action>:<sha256(identity+proof)>
    proof_url       TEXT        NOT NULL,
    platform        TEXT,                             -- detected from the proof URL host
    amount          NUMERIC(78, 0),                   -- registry reward at submission time (display)
    -- 'queued' -> 'approved' (operator or ACTIONS_AUTO_APPROVE) -> 'paid' | 'failed' | 'rejected'
    status          TEXT        NOT NULL DEFAULT 'queued',
    tx_hash         TEXT,
    error           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_action_submissions_status ON action_submissions (status);
CREATE INDEX IF NOT EXISTS idx_action_submissions_identity ON action_submissions (identity_key);

-- Idempotent upgrade for databases created before batch mode existed.
ALTER TABLE airdrop_claims ADD COLUMN IF NOT EXISTS attempts INT NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_airdrop_claims_status ON airdrop_claims (status);
CREATE INDEX IF NOT EXISTS idx_wallets_address ON wallets (address);
