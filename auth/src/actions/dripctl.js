'use strict';

/*
 * dripctl.js — operator CLI for the LUVdrip (run as the service user, env loaded):
 *
 *   node src/actions/dripctl.js status [<identity_key>]   # the ledger, or one participant's meter
 *   node src/actions/dripctl.js candidates [limit]        # who currently holds a redeemable tally
 *   node src/actions/dripctl.js sponsor all [limit]       # PROJECT PAYS THE GAS for everyone
 *   node src/actions/dripctl.js sponsor <identity_key>…   # …or for a selected set (activity rewards)
 *   node src/actions/dripctl.js reconcile                 # settle pending vouchers against the chain
 *   node src/actions/dripctl.js import-legacy [--dry]     # fold pre-drip 'accrued' rows into the ledger
 *
 * Add --force to a sponsor pass to ignore the SPONSOR_MAX_GWEI ceiling (deliberate, logged).
 *
 * On the VPS:  sudo -u luv -H bash -lc 'cd ~/DeltaVerse/shambaluv/auth &&
 *   set -a && . /home/luv/DeltaVerse/deploy/web2/luv.env && set +a && node src/actions/dripctl.js status'
 */

const db = require('../db');
const { config } = require('../config');
const drip = require('./drip');

const WEI = 10n ** 18n;
function luv(weiStr) {
  const v = BigInt(weiStr || 0);
  return (v / WEI).toLocaleString('en-US') + ' LUV';
}

async function status(identityKey) {
  if (identityKey) {
    const s = await drip.status(identityKey);
    if (!s.eligible) { console.log(`${identityKey}: no drip yet — it starts at their next sign-in`); return; }
    const pct = Number((BigInt(s.windowWei) * 10000n) / BigInt(s.capWei)) / 100;
    console.log(`${identityKey}`);
    console.log(`  this window   ${luv(s.windowWei)} of ${luv(s.capWei)} (${pct.toFixed(2)}%)${s.full ? ' — COMPLETE, next million awaits a login' : s.flowing ? ' — flowing' : ''}`);
    console.log(`  window ends   ${new Date(s.windowEndsAt * 1000).toISOString()}`);
    console.log(`  accumulated   ${luv(s.accrued)}${BigInt(s.heldWei) > 0n ? `  (+ ${luv(s.heldWei)} held in a live voucher)` : ''}`);
    console.log(`  redeemed      ${luv(s.redeemedWei)} over ${s.windows} window(s)`);
    return;
  }
  const t = await db.query(
    `SELECT COUNT(*)::int AS participants,
            COALESCE(SUM(banked_wei), 0)::text   AS banked,
            COALESCE(SUM(held_wei), 0)::text     AS held,
            COALESCE(SUM(redeemed_wei), 0)::text AS redeemed,
            COALESCE(SUM(windows), 0)::int       AS windows
       FROM drip_state`
  );
  const p = await db.query(
    `SELECT status, COUNT(*)::int AS n, COALESCE(SUM(amount_wei), 0)::text AS total
       FROM drip_redemptions GROUP BY status ORDER BY status`
  );
  const r = t.rows[0];
  console.log(`LUVdrip — ${config.dripDailyLuv} LUV a day, per login-armed 24h window (${drip.perSecond().toFixed(6)} LUV/s)`);
  console.log(`  participants  ${r.participants}   windows armed: ${r.windows}`);
  console.log(`  accumulated   ${luv(r.banked)}   held in vouchers: ${luv(r.held)}`);
  console.log(`  redeemed      ${luv(r.redeemed)}`);
  for (const row of p.rows) console.log(`  vouchers ${row.status.padEnd(8)} ${String(row.n).padStart(5)}  ${luv(row.total)}`);
}

async function candidates(limit) {
  const list = await drip.sponsorCandidates(limit ? Number(limit) : 50);
  if (!list.length) { console.log('nobody holds a redeemable tally right now'); return; }
  for (const c of list) console.log(`${c.identityKey}\t${luv(c.accrued)}`);
  console.log(`— ${list.length} participant(s) the project could redeem for`);
}

/**
 * Fold pre-drip presence rows ('accrued' welcome/return submissions from the lump-sum model)
 * into the drip ledger. Each such row was ONE DAY's drop, so each is imported as ONE DAY of
 * drip — 1,000,000 LUV — the corrected amount, NOT the 1e27 the row was written with.
 */
async function importLegacy(dry) {
  const r = await db.query(
    `SELECT identity_key, COUNT(*)::int AS drops
       FROM action_submissions
      WHERE action IN ('welcome','return') AND status = 'accrued'
      GROUP BY identity_key ORDER BY identity_key`
  );
  if (!r.rows.length) { console.log('no legacy accrued rows to import'); return; }
  let total = 0n;
  for (const row of r.rows) {
    const credit = drip.DAILY_WEI * BigInt(row.drops);
    total += credit;
    console.log(`${dry ? '[dry] ' : ''}${row.identity_key}\t${row.drops} drop(s) → ${luv(credit.toString())}`);
    if (dry) continue;
    await db.withTransaction(async (client) => {
      const up = await client.query(
        `UPDATE drip_state SET banked_wei = banked_wei + $2::numeric, updated_at = now()
          WHERE identity_key = $1 RETURNING identity_key`,
        [row.identity_key, credit.toString()]
      );
      if (!up.rows[0]) {
        // no drip row yet (they haven't signed in since the drip went live): open a completed
        // window so the credit lands and their next login arms a fresh million.
        await client.query(
          `INSERT INTO drip_state (identity_key, window_started_at, window_ends_at, window_wei, cap_wei, settled_at, banked_wei, windows)
           VALUES ($1, now() - make_interval(secs => 86400), now(), $2::numeric, $2::numeric, now(), $3::numeric, 0)
           ON CONFLICT (identity_key) DO UPDATE SET banked_wei = drip_state.banked_wei + $3::numeric`,
          [row.identity_key, drip.DAILY_WEI.toString(), credit.toString()]
        );
      }
      await client.query(
        `UPDATE action_submissions SET status='migrated', updated_at=now()
          WHERE identity_key=$1 AND action IN ('welcome','return') AND status='accrued'`,
        [row.identity_key]
      );
    });
  }
  console.log(`${dry ? '[dry] would import' : 'imported'} ${luv(total.toString())} across ${r.rows.length} participant(s)`);
}

async function main() {
  const argv = process.argv.slice(2).filter((a) => a !== '--force' && a !== '--dry');
  const force = process.argv.includes('--force');
  const dry = process.argv.includes('--dry');
  const [cmd, ...rest] = argv;

  if (cmd === 'status') {
    await status(rest[0]);
  } else if (cmd === 'candidates') {
    await candidates(rest[0]);
  } else if (cmd === 'sponsor') {
    if (!rest.length) { console.log('usage: dripctl.js sponsor all [limit] | sponsor <identity_key>…'); process.exit(1); }
    const all = rest[0] === 'all' || rest[0] === 'everyone';
    const keys = all ? null : rest;
    const limit = all && rest[1] ? Number(rest[1]) : undefined;
    console.log(all ? `sponsoring EVERYONE with a redeemable tally${limit ? ` (up to ${limit})` : ''} — the project pays the gas…`
      : `sponsoring ${keys.length} selected participant(s) — the project pays the gas…`);
    const out = await drip.sponsorRedeem(keys, { force, limit });
    console.log(out.error ? `not sent: ${out.error}${out.gwei ? ` (gas ${out.gwei} gwei > ceiling ${out.ceiling})` : ''}`
      : `sponsored ${out.sponsored}/${out.offered || 0}${out.txHash ? ` in ${out.txHash}` : ''}${out.note ? ` — ${out.note}` : ''}`);
  } else if (cmd === 'reconcile') {
    const out = await drip.reconcile();
    console.log(`checked ${out.checked} pending voucher(s): ${out.paid || 0} delivered, ${out.expired || 0} expired back to their tally`);
  } else if (cmd === 'import-legacy') {
    await importLegacy(dry);
  } else {
    console.log('usage: dripctl.js status [<identity_key>] | candidates [limit] | sponsor all [limit] | sponsor <identity_key>… [--force] | reconcile | import-legacy [--dry]');
  }
  process.exit(0);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err.message);
  process.exit(1);
});
