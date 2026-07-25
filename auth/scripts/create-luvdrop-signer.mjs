#!/usr/bin/env node
/*
 * create-luvdrop-signer.mjs — generate a DEDICATED LUVdrop voucher signer and SEAL its private
 * key in a bankon-vault (AES-256-GCM, HKDF-SHA512 per-entry keys, passphrase-derived master via
 * PBKDF2-210k — engine/bankon-vault.js, byte-compatible with services/bankon_vault).
 *
 * The plaintext private key is NEVER written to disk and NEVER printed — only the public address
 * is shown (for ShambaLuvAirdrop.setSigner). The encrypted vault file alone is useless without the
 * passphrase.
 *
 * WHY THIS IS SAFE ENOUGH: the signer holds NO funds and sends NO transactions — it only signs
 * off-chain EIP-712 vouchers. So even a full server compromise cannot *drain* it. The worst case is
 * an attacker forging airdrop-pool vouchers, which the OFFLINE owner (bankon.eth) neutralises
 * instantly with setSigner() (rotate) and/or setPaused() — a bounded blast radius (the 1-quad pool),
 * never the 111-quad supply or contract ownership.
 *
 *   LUV_SIGNER_VAULT_PASSPHRASE="$(openssl rand -base64 32)" node scripts/create-luvdrop-signer.mjs
 *
 * Writes secrets/luvdrop-signer.vault.json (gitignored, 0600). Refuses to overwrite an existing one.
 */
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import { existsSync, mkdirSync, writeFileSync, chmodSync } from 'fs';

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const AUTH = resolve(HERE, '..');
const ethers = require(join(AUTH, 'src', 'ethers.js'));
const DVBankonVault = require(resolve(AUTH, '..', '..', 'engine', 'bankon-vault.js'));

const AIRDROP = '0xdf2C1836550c5711EF9c021cB0de86241dc1DEf3';
const ENTRY_ID = 'luvdrop-signer';

const pass = process.env.LUV_SIGNER_VAULT_PASSPHRASE || '';
if (pass.trim().length < 16) {
  console.error('✗ set LUV_SIGNER_VAULT_PASSPHRASE to a strong passphrase (≥16 chars).');
  console.error('  e.g.  LUV_SIGNER_VAULT_PASSPHRASE="$(openssl rand -base64 32)" node scripts/create-luvdrop-signer.mjs');
  process.exit(1);
}

const OUT_DIR = join(AUTH, 'secrets');
const OUT = join(OUT_DIR, 'luvdrop-signer.vault.json');
if (existsSync(OUT)) {
  console.error('✗ ' + OUT + ' already exists — refusing to overwrite an existing signer vault.');
  console.error('  To rotate: move it aside, create a new one, then ShambaLuvAirdrop.setSigner(newAddr).');
  process.exit(1);
}

(async () => {
  // Fresh signing key — created here, sealed immediately, never persisted in plaintext.
  const wallet = ethers.Wallet.createRandom();
  const vault = await DVBankonVault.fromPassphrase(pass);
  await vault.put(ENTRY_ID, wallet.privateKey, {
    chain: 'evm', role: 'shambaluv-airdrop-voucher-signer', address: wallet.address,
  });
  const doc = vault.export(); // encrypted document — safe to store on disk

  mkdirSync(OUT_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(OUT, JSON.stringify(doc, null, 2), { mode: 0o600 });
  try { chmodSync(OUT, 0o600); } catch (e) { /* best effort */ }

  const addr = wallet.address;
  console.log('✓ LUVdrop signer created + sealed (bankon-vault · AES-256-GCM).');
  console.log('  signer address : ' + addr);
  console.log('  vault file     : ' + OUT + '  (encrypted · 0600 · gitignored)');
  console.log('  entry id       : ' + ENTRY_ID);
  console.log('');
  console.log('1) Point the airdrop at this signer — run from bankon.eth OFFLINE (hardware wallet):');
  console.log('   cast send ' + AIRDROP + ' "setSigner(address)" ' + addr + ' \\');
  console.log('     --private-key 0x<bankon.eth key> --rpc-url https://ethereum-rpc.publicnode.com');
  console.log('   verify: cast call ' + AIRDROP + ' "signer()(address)" --rpc-url https://ethereum-rpc.publicnode.com');
  console.log('');
  console.log('2) In luv.env (NEVER store the raw key):');
  console.log('   LUV_SIGNER_VAULT_FILE=' + OUT);
  console.log('   LUV_SIGNER_VAULT_PASSPHRASE=<the passphrase you just used>   # or LUV_SIGNER_VAULT_PASSPHRASE_FILE');
  console.log('   # and delete any VOUCHER_SIGNER_PRIVATE_KEY line');
})().catch((e) => { console.error('failed:', e && e.message ? e.message : e); process.exit(1); });
