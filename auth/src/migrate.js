'use strict';

/*
 * migrate.js — apply db/schema.sql to the configured DATABASE_URL. Idempotent (CREATE TABLE IF
 * NOT EXISTS). Run: `npm run migrate`.
 */

const fs = require('fs');
const path = require('path');
const db = require('./db');

async function migrate() {
  const schemaPath = path.resolve(__dirname, '../db/schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');
  await db.query(sql);
  // eslint-disable-next-line no-console
  console.log('[migrate] schema applied');
  await db.close();
}

migrate().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[migrate] failed:', err.message);
  process.exit(1);
});
