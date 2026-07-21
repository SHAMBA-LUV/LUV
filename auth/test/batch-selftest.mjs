/*
 * batch-selftest.mjs — END-TO-END proof of the batched gesture path against a real chain
 * and a real Postgres.
 *
 *   anvil (fresh)  +  scratch DB  →  deploy ShambaLuv + LuvBatchGesture  →  enqueue N signups
 *   →  flushBatch()  →  ONE transaction  →  every signup holds the FULL 1 trillion LUV
 *   (0 fee: every hop is treasury EOA → signup EOA), rows 'confirmed', dedup + idempotency hold.
 *
 * Prereqs: `anvil` running on 127.0.0.1:8545 (fresh instance) and local Postgres accepting
 * connections (the script creates/drops its own scratch database).
 *
 * Run: node test/batch-selftest.mjs
 */

// ── env BEFORE any src require (config.js validates at load) ──
const SCRATCH_DB = 'luv_batch_selftest';
process.env.JWT_SECRET = 'selftest-jwt';
process.env.SESSION_SECRET = 'selftest-session';
process.env.IP_SALT = 'selftest-salt';
process.env.WALLET_ENCRYPTION_KEY = '00'.repeat(32);
process.env.DATABASE_URL = process.env.DATABASE_URL || `postgres://localhost/${SCRATCH_DB}`;
process.env.RPC_URL = process.env.RPC_URL || 'http://127.0.0.1:8545';
process.env.CHAIN_ID = process.env.CHAIN_ID || '31337';
process.env.GESTURE_MODE = 'batch';
process.env.BATCH_MAX_SIZE = '50';
// anvil defaults: key0 = deployer/treasury, key1 = operator (fires batches, pays gas)
const TREASURY_PK = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const OPERATOR_PK = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
process.env.RELAYER_PRIVATE_KEY = OPERATOR_PK;
process.env.VOUCHER_SIGNER_PRIVATE_KEY = OPERATOR_PK;
process.env.LUV_TOKEN_ADDRESS = '0x0000000000000000000000000000000000000001'; // patched after deploy
process.env.AIRDROP_CONTRACT_ADDRESS = '0x0000000000000000000000000000000000000001';
process.env.BATCH_GESTURE_ADDRESS = '0x0000000000000000000000000000000000000001';

import { createRequire } from 'module';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const ethers = require('../src/ethers.js');

let failures = 0;
function assert(cond, msg) {
  if (!cond) { failures += 1; console.error('FAIL:', msg); }
  else console.log('ok  -', msg);
}

function art(name) {
  // forge {abi, bytecode:{object}} shape from shambaluv/artifacts (vendor-luv-artifacts.mjs)
  const a = JSON.parse(readFileSync(join(HERE, '..', '..', 'artifacts', `${name}.json`), 'utf8'));
  return { abi: a.abi, bytecode: a.bytecode.object || a.bytecode };
}

// scratch DB (drop + recreate so reruns are clean)
execSync(`dropdb --if-exists ${SCRATCH_DB} && createdb ${SCRATCH_DB}`, { stdio: 'pipe', shell: '/bin/bash' });

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL, Number(process.env.CHAIN_ID));
// NonceManager: serialize nonces (instamine-safe), same as the production deploy scripts.
const treasury = new ethers.NonceManager(new ethers.Wallet(TREASURY_PK, provider));
const operator = new ethers.NonceManager(new ethers.Wallet(OPERATOR_PK, provider));
treasury.address = new ethers.Wallet(TREASURY_PK).address;
operator.address = new ethers.Wallet(OPERATOR_PK).address;

const GESTURE = 10n ** 30n; // 1 trillion LUV in base units

async function main() {
  // ── deploy: token (treasury = deployer EOA holds supply) + batcher ──
  const luvArt = art('ShambaLuv');
  const luv = await (await new ethers.ContractFactory(luvArt.abi, luvArt.bytecode, treasury)
    .deploy(operator.address, operator.address, ethers.ZeroAddress, ethers.ZeroAddress)).waitForDeployment();
  const luvAddr = await luv.getAddress();

  const batchArt = art('LuvBatchGesture');
  const batch = await (await new ethers.ContractFactory(batchArt.abi, batchArt.bytecode, treasury)
    .deploy(luvAddr, treasury.address, operator.address)).waitForDeployment();
  const batchAddr = await batch.getAddress();

  await (await luv.approve(batchAddr, ethers.MaxUint256)).wait();

  process.env.LUV_TOKEN_ADDRESS = luvAddr;
  process.env.BATCH_GESTURE_ADDRESS = batchAddr;

  // load backend AFTER env is final
  const db = require('../src/db.js');
  const { config } = require('../src/config.js');
  config.luvTokenAddress = luvAddr;
  config.batchGestureAddress = batchAddr;
  const { enqueueGesture, flushBatch, queueDepth } = require('../src/airdrop/batch.js');

  // migrate schema
  const schema = readFileSync(join(HERE, '..', 'db', 'schema.sql'), 'utf8');
  await db.query(schema);

  // ── enqueue N signups (fresh EOAs, like provisioned wallets) ──
  const N = 12;
  const signups = [];
  for (let i = 0; i < N; i++) {
    const w = ethers.Wallet.createRandom();
    signups.push({ identityKey: `google:selftest-${i}`, address: w.address });
  }
  // identities rows (FK)
  for (const s of signups) {
    await db.query(
      "INSERT INTO identities (provider, provider_user_id, identity_key) VALUES ('google', $1, $2)",
      [s.identityKey.split(':')[1], s.identityKey]
    );
  }

  for (const s of signups) {
    const r = await enqueueGesture(s.identityKey, s.address);
    if (s === signups[0]) assert(r.status === 'queued', `enqueue → status 'queued' (got '${r.status}')`);
  }
  assert((await queueDepth()) === N, `queue depth = ${N}`);

  // idempotency: re-enqueue the first identity
  const again = await enqueueGesture(signups[0].identityKey, signups[0].address);
  assert(again.alreadyClaimed === true, 're-enqueue same identity → alreadyClaimed');
  assert((await queueDepth()) === N, 'queue depth unchanged after duplicate enqueue');

  // ── flush: ONE transaction delivers all N ──
  const { sent, txHash } = await flushBatch();
  assert(sent === N, `flushBatch delivered ${sent}/${N} in one tx`);
  assert(!!txHash, `batch tx hash recorded (${txHash})`);

  // every signup holds the FULL trillion (0 fee, wallet-to-wallet through the batcher)
  let whole = true;
  for (const s of signups) {
    const bal = await luv.balanceOf(s.address);
    if (bal !== GESTURE) { whole = false; console.error(`   ${s.address} got ${bal}`); }
  }
  assert(whole, 'every signup holds the FULL 1 trillion LUV (no fee skimmed)');

  // rows all confirmed, sharing the batch tx
  const rows = await db.query("SELECT status, tx_hash FROM airdrop_claims");
  assert(rows.rows.every((r) => r.status === 'confirmed'), "all claim rows 'confirmed'");
  assert(rows.rows.every((r) => r.tx_hash === txHash), 'all rows share the ONE batch tx hash');

  // on-chain dedup mirror
  assert(await batch.delivered(signups[0].address), 'on-chain delivered[] mirror set');

  // empty flush is a no-op
  const empty = await flushBatch();
  assert(empty.sent === 0, 'empty queue flush is a no-op');

  await db.close();
  execSync(`dropdb --if-exists ${SCRATCH_DB}`, { stdio: 'pipe' });

  if (failures) { console.error(`\n${failures} FAILURE(S)`); process.exit(1); }
  console.log('\n❤️ batch-selftest: ALL GREEN — the batched gesture delivers the full trillion to every signup in one transaction.');
}

main().catch((err) => { console.error(err); process.exit(1); });
