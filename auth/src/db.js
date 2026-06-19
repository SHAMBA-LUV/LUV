'use strict';

/*
 * db.js — PostgreSQL pool + thin helpers. PARAMETERIZED queries only.
 * DB SSL is configurable via env (we never hardcode rejectUnauthorized:false).
 */

const fs = require('fs');
const { Pool } = require('pg');
const { config } = require('./config');

function buildSsl() {
  if (!config.dbSsl) return false;
  const ssl = { rejectUnauthorized: config.dbSslRejectUnauthorized };
  if (config.dbSslCa) {
    // Accept either an inline PEM or a path to a CA file.
    if (config.dbSslCa.includes('BEGIN CERTIFICATE')) {
      ssl.ca = config.dbSslCa;
    } else if (fs.existsSync(config.dbSslCa)) {
      ssl.ca = fs.readFileSync(config.dbSslCa, 'utf8');
    }
  }
  return ssl;
}

const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: buildSsl(),
  max: parseInt(process.env.DB_POOL_MAX || '10', 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on('error', (err) => {
  // Don't crash the process on idle-client errors; log without PII.
  // eslint-disable-next-line no-console
  console.error('[db] idle pool error:', err.message);
});

/** Run a parameterized query. */
function query(text, params) {
  return pool.query(text, params);
}

/** Run fn inside a transaction with a dedicated client. */
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {
      /* ignore rollback failure */
    }
    throw err;
  } finally {
    client.release();
  }
}

async function close() {
  await pool.end();
}

module.exports = { pool, query, withTransaction, close };
