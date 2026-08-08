/**
 * internal/calculation.js — internal.calculation: LUV earned per identity in 24h.
 *
 * Computed when an identity is PROCESSED AT LOGIN (the consent click / wallet signature
 * that stamps identities.last_login_at), and written to internal_calculations as an
 * append-only record. It is a bookkeeping observation, not a payment instruction: nothing
 * here moves LUV, and nothing here is authoritative over the chain or the on-chain action
 * registry. It records what this backend believes was earned, so the belief itself is
 * auditable after the fact.
 *
 * Precision: amounts are NUMERIC(78,0) base units — 1 LUV = 10^18 luv. They are summed in
 * Postgres and returned as STRINGS. They are never put through a JS number: 1e18 exceeds
 * Number.MAX_SAFE_INTEGER by orders of magnitude, and rounding a balance is exactly the
 * thing the standard forbids.
 *
 * Failure is non-fatal by contract. A login must never fail because bookkeeping failed.
 */
'use strict';

const db = require('../db');

const WINDOW = '24 hours';
const KIND = 'internal.calculation';

// Rows that represent LUV genuinely earned in the window. 'rejected' and 'failed' are
// excluded — they were never earned. Everything else (queued/approved/accrued/paid) is
// counted as earned-but-not-necessarily-settled, and the breakdown says which is which.
const EARNED_STATUSES = ['queued', 'approved', 'accrued', 'paid', 'submitted', 'confirmed'];

/**
 * Sum LUV earned by one identity over the trailing 24 hours, with a breakdown.
 * @param {string} identityKey
 * @returns {Promise<{luv_base_units: string, entries: number, by_action: object, by_status: object, window: string}>}
 */
async function earned24h(identityKey) {
  const totalRes = await db.query(
    `SELECT COALESCE(SUM(amount), 0)::text AS total, COUNT(*)::int AS entries
       FROM action_submissions
      WHERE identity_key = $1
        AND created_at >= now() - interval '${WINDOW}'
        AND status = ANY($2::text[])`,
    [identityKey, EARNED_STATUSES]
  );

  const byActionRes = await db.query(
    `SELECT action, COALESCE(SUM(amount), 0)::text AS total, COUNT(*)::int AS n
       FROM action_submissions
      WHERE identity_key = $1
        AND created_at >= now() - interval '${WINDOW}'
        AND status = ANY($2::text[])
      GROUP BY action ORDER BY action`,
    [identityKey, EARNED_STATUSES]
  );

  const byStatusRes = await db.query(
    `SELECT status, COALESCE(SUM(amount), 0)::text AS total, COUNT(*)::int AS n
       FROM action_submissions
      WHERE identity_key = $1
        AND created_at >= now() - interval '${WINDOW}'
      GROUP BY status ORDER BY status`,
    [identityKey]
  );

  const by_action = {};
  for (const r of byActionRes.rows) by_action[r.action] = { luv_base_units: r.total, entries: r.n };
  const by_status = {};
  for (const r of byStatusRes.rows) by_status[r.status] = { luv_base_units: r.total, entries: r.n };

  return {
    window: WINDOW,
    luv_base_units: totalRes.rows[0].total,   // string; 1 LUV = 10^18
    entries: totalRes.rows[0].entries,
    by_action,
    by_status
  };
}

/**
 * Compute and RECORD the calculation for an identity. Called on login.
 * Never throws — a bookkeeping failure must not cost anyone their session.
 * @returns {Promise<object|null>} the calculation, or null if it could not be taken
 */
async function recordOnLogin(identityKey, trigger) {
  try {
    const calc = await earned24h(identityKey);
    await db.query(
      `INSERT INTO internal_calculations (identity_key, kind, trigger, window_label, luv_base_units, entries, detail)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [identityKey, KIND, trigger || 'login', calc.window,
       calc.luv_base_units, calc.entries,
       JSON.stringify({ by_action: calc.by_action, by_status: calc.by_status })]
    );
    return calc;
  } catch (e) {
    try { console.warn('[internal.calculation] not recorded:', e && e.message); } catch (_) {}
    return null;
  }
}

/** The most recent recorded calculation for an identity (read-only). */
async function latest(identityKey) {
  const r = await db.query(
    `SELECT identity_key, kind, trigger, window_label, luv_base_units::text, entries, detail, computed_at
       FROM internal_calculations
      WHERE identity_key = $1 AND kind = $2
      ORDER BY computed_at DESC LIMIT 1`,
    [identityKey, KIND]
  );
  return r.rows[0] || null;
}

module.exports = { earned24h, recordOnLogin, latest, KIND, WINDOW, EARNED_STATUSES };
