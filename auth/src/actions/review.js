'use strict';

/*
 * review.js — operator CLI for the tasks rail (run as the service user, env loaded):
 *
 *   node src/actions/review.js list                 # queued submissions
 *   node src/actions/review.js approve <id|all>     # approve → next payout sweep pays
 *   node src/actions/review.js reject <id> [note]
 *   node src/actions/review.js sweep                # run one payout sweep now
 *
 * On the VPS:  sudo -u luv -H bash -lc 'cd ~/DeltaVerse/shambaluv/auth &&
 *   set -a && . /home/luv/DeltaVerse/deploy/web2/luv.env && set +a && node src/actions/review.js list'
 */

const db = require('../db');
const { payoutSweep } = require('./index');

async function main() {
  const [cmd, arg, ...note] = process.argv.slice(2);
  if (cmd === 'list') {
    const r = await db.query(
      "SELECT id, identity_key, action, platform, proof_url, status, created_at FROM action_submissions WHERE status IN ('queued','failed') ORDER BY id"
    );
    if (!r.rows.length) { console.log('nothing awaiting review ❤'); }
    for (const s of r.rows) {
      console.log(`#${s.id} [${s.status}] ${s.action}/${s.platform} ${s.identity_key} ${s.proof_url}`);
    }
  } else if (cmd === 'approve') {
    const q = arg === 'all'
      ? await db.query("UPDATE action_submissions SET status='approved', error=NULL, updated_at=now() WHERE status IN ('queued','failed') RETURNING id")
      : await db.query("UPDATE action_submissions SET status='approved', error=NULL, updated_at=now() WHERE id=$1 AND status IN ('queued','failed') RETURNING id", [Number(arg)]);
    console.log(`approved: ${q.rows.map((r) => '#' + r.id).join(' ') || 'nothing'}`);
  } else if (cmd === 'reject') {
    const q = await db.query(
      "UPDATE action_submissions SET status='rejected', error=$2, updated_at=now() WHERE id=$1 RETURNING id",
      [Number(arg), note.join(' ') || 'rejected by operator']
    );
    console.log(q.rows.length ? `rejected #${arg}` : `no such submission #${arg}`);
  } else if (cmd === 'sweep') {
    await payoutSweep();
    console.log('sweep complete');
  } else {
    console.log('usage: review.js list | approve <id|all> | reject <id> [note] | sweep');
  }
  process.exit(0);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
