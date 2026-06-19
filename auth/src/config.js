'use strict';

/*
 * config.js — load + validate environment. Secrets ONLY come from env (never hardcoded).
 * Fails fast at boot if a required secret is missing, so we never silently fall back to an
 * insecure default (a fix for the old backend which had a hardcoded IP_SALT fallback).
 */

require('dotenv').config();

function req(name) {
  const v = process.env[name];
  if (v === undefined || v === null || String(v).trim() === '') {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

function opt(name, fallback) {
  const v = process.env[name];
  return v === undefined || v === null || String(v).trim() === '' ? fallback : v;
}

function bool(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === null || String(v).trim() === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(v).trim());
}

// Parse a comma-separated CORS allowlist. STRICT: exact-origin match only, no substring,
// no "!origin" bypass. Empty => no cross-origin browser access allowed.
function parseOrigins(raw) {
  if (!raw) return [];
  return String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const config = {
  env: opt('NODE_ENV', 'development'),
  port: parseInt(opt('PORT', '8787'), 10),

  // Sessions / auth
  jwtSecret: req('JWT_SECRET'),
  sessionSecret: req('SESSION_SECRET'),
  jwtTtlSeconds: parseInt(opt('JWT_TTL_SECONDS', '86400'), 10),
  cookieSecure: bool('COOKIE_SECURE', process.env.NODE_ENV === 'production'),

  // Public base URL the OAuth providers redirect back to.
  publicBaseUrl: opt('PUBLIC_BASE_URL', 'http://localhost:8787'),
  // Where to send the browser after a successful login (the dapp/app frontend).
  frontendSuccessUrl: opt('FRONTEND_SUCCESS_URL', 'http://localhost:5173/welcome'),
  frontendFailureUrl: opt('FRONTEND_FAILURE_URL', 'http://localhost:5173/login?error=auth'),

  // CORS
  corsAllowlist: parseOrigins(opt('CORS_ALLOWLIST', '')),

  // Database
  databaseUrl: req('DATABASE_URL'),
  // DB SSL: configurable. Do NOT hardcode rejectUnauthorized:false.
  dbSsl: bool('DATABASE_SSL', false),
  dbSslRejectUnauthorized: bool('DATABASE_SSL_REJECT_UNAUTHORIZED', true),
  dbSslCa: opt('DATABASE_SSL_CA', ''), // optional PEM string or path handled in db.js

  // Privacy: salt for hashing client IPs before any rate-limit / abuse bookkeeping.
  // REQUIRED (no insecure fallback). Generate with: openssl rand -hex 32
  ipSalt: req('IP_SALT'),

  // Chain / contracts
  rpcUrl: req('RPC_URL'),
  chainId: parseInt(req('CHAIN_ID'), 10),
  luvTokenAddress: req('LUV_TOKEN_ADDRESS'),
  airdropContractAddress: req('AIRDROP_CONTRACT_ADDRESS'),

  // Keys (hex, 0x-prefixed). VOUCHER signer must equal the contract's `signer`.
  voucherSignerPrivateKey: req('VOUCHER_SIGNER_PRIVATE_KEY'),
  relayerPrivateKey: req('RELAYER_PRIVATE_KEY'),

  // Wallet-at-rest encryption master key (hex, 32 bytes). Generate: openssl rand -hex 32
  walletEncryptionKey: req('WALLET_ENCRYPTION_KEY'),

  // The gesture amount in base units (wei). Default 1 trillion LUV = 1e30.
  // 1_000_000_000_000 * 1e18 = 1e30.
  claimAmount: BigInt(opt('CLAIM_AMOUNT', '1000000000000000000000000000000')),

  // How long a signed voucher is valid for (seconds) before its deadline expires.
  voucherTtlSeconds: parseInt(opt('VOUCHER_TTL_SECONDS', '3600'), 10),

  // OAuth providers
  oauth: {
    google: {
      clientId: opt('GOOGLE_CLIENT_ID', ''),
      clientSecret: opt('GOOGLE_CLIENT_SECRET', ''),
    },
    discord: {
      clientId: opt('DISCORD_CLIENT_ID', ''),
      clientSecret: opt('DISCORD_CLIENT_SECRET', ''),
    },
    github: {
      clientId: opt('GITHUB_CLIENT_ID', ''),
      clientSecret: opt('GITHUB_CLIENT_SECRET', ''),
    },
    // Apple / X (Twitter) are pluggable — see src/auth/strategies.js TODO.
    apple: {
      clientId: opt('APPLE_CLIENT_ID', ''),
      teamId: opt('APPLE_TEAM_ID', ''),
      keyId: opt('APPLE_KEY_ID', ''),
      privateKey: opt('APPLE_PRIVATE_KEY', ''),
    },
    x: {
      clientId: opt('X_CLIENT_ID', ''),
      clientSecret: opt('X_CLIENT_SECRET', ''),
    },
  },
};

function enabledProviders() {
  const list = [];
  if (config.oauth.google.clientId && config.oauth.google.clientSecret) list.push('google');
  if (config.oauth.discord.clientId && config.oauth.discord.clientSecret) list.push('discord');
  if (config.oauth.github.clientId && config.oauth.github.clientSecret) list.push('github');
  return list;
}

module.exports = { config, enabledProviders };
