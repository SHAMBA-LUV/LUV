'use strict';

/*
 * participants.js — export every participant that has logged in.
 *
 * Each social login provisions ONE wallet whose address is stored in the `wallets` table
 * (schema.sql), so this is the durable roster of everyone who joined. Read-only.
 *
 *   node src/participants.js            # human table
 *   node src/participants.js --json     # JSON array (pipe to a file)
 *   node src/participants.js --csv      # CSV (identity_key,provider,address,smart_account,claim_status,created_at)
 *   node src/participants.js --addresses  # just the 0x addresses, one per line (for airdrops/snapshots)
 *
 * Uses the same DATABASE_URL as the backend (loaded via config/db).
 */

const db = require('./db');

async function rows() {
  const r = await db.query(
    `SELECT i.identity_key, i.provider, w.address, w.smart_account,
            COALESCE(c.status, 'none') AS claim_status, c.tx_hash, i.created_at
       FROM identities i
       LEFT JOIN wallets w        ON w.identity_key = i.identity_key
       LEFT JOIN airdrop_claims c ON c.identity_key = i.identity_key
      ORDER BY i.created_at ASC`
  );
  return r.rows;
}

function csvCell(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

async function main() {
  const mode = (process.argv[2] || '').replace(/^--/, '');
  const list = await rows();

  if (mode === 'json') {
    process.stdout.write(JSON.stringify(list, null, 2) + '\n');
  } else if (mode === 'csv') {
    const cols = ['identity_key', 'provider', 'address', 'smart_account', 'claim_status', 'tx_hash', 'created_at'];
    process.stdout.write(cols.join(',') + '\n');
    for (const row of list) process.stdout.write(cols.map((c) => csvCell(row[c])).join(',') + '\n');
  } else if (mode === 'addresses') {
    // The wallet that actually receives LUV: smart account when present, else the owner EOA.
    for (const row of list) {
      const a = row.smart_account || row.address;
      if (a) process.stdout.write(a + '\n');
    }
  } else {
    // eslint-disable-next-line no-console
    console.log(`participants: ${list.length}\n`);
    for (const row of list) {
      const a = row.smart_account || row.address || '(no wallet)';
      // eslint-disable-next-line no-console
      console.log(`  ${(row.provider || '?').padEnd(9)} ${a}  claim=${row.claim_status}`);
    }
  }
  await db.pool?.end?.();
  process.exit(0);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('participants export failed:', e.message);
  process.exit(1);
});
