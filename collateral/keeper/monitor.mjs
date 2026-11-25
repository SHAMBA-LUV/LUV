#!/usr/bin/env node
// collateral monitor — watches governance and system health; alerts to stdout and a webhook.
//
//   node monitor.mjs            loop every INTERVAL seconds
//   node monitor.mjs --once     one pass then exit (exit code 2 if any CRIT alert)
//
// Env:
//   RPC_URL      JSON-RPC endpoint (required)
//   VAULT        GoldVault address (required) — bXAU and spotter are read from it
//   TIMELOCK     GoldTimelock address (strongly recommended: the delay only protects users if
//                someone reads Schedule events)
//   GUARDIAN     GoldGuardian address
//   FLASH        GoldFlash address
//   PSM          GoldPsm address (fee, floor, treasury changes; mint gate closing on a depeg)
//   POOLS        comma-separated GoldStablePool addresses (pause, fee/A/receiver changes, imbalance)
//   IMBALANCE_WARN  WARN when a pool's smaller side falls below this share, in % (default 20) —
//                   in a pool of 1-oz claims, a lopsided pool is the market's depeg signal
//   WEBHOOK_URL  POST target for WARN and CRIT alerts (Slack/Discord-compatible JSON body)
//   FROM_BLOCK   first block to scan (default: latest − 1000)
//   INTERVAL     seconds between passes (default 60)
//   UTIL_WARN    ceiling utilisation that triggers a WARN, in % (default 90)
//
// Severity:
//   CRIT  shutdown fired, a new bXAU minter, vault ward changes, spotter swapped, oracle down,
//         books out of balance, any SCHEDULED call that changes authority or the oracle
//   WARN  any other scheduled governance call, bad debt appearing, ceiling nearly full
//   INFO  executed/cancelled governance calls, liquidations, parameter changes, flap
import { ethers, ABI, RAY, b32, fmt, env, isMain, getLogs, webhook, sleep, headBlock } from './lib.mjs';

const DANGEROUS = new Set([
  'fileSpotter', 'rely', 'deny', 'setAdmin', 'setDelay', 'transferOwnership', 'fileSrc', 'fileXau', 'cage',
  'setFeeReceiver', 'setPauser', 'setTreasury', 'setFloor',
]);

const decoders = [
  ['vault', new ethers.Interface(ABI.vault)],
  ['spotter', new ethers.Interface(ABI.spotter)],
  ['timelock', new ethers.Interface(ABI.timelock)],
  ['guardian', new ethers.Interface(ABI.guardian)],
  ['flash', new ethers.Interface(ABI.flash)],
  ['pool', new ethers.Interface(ABI.pool)],
  ['psm', new ethers.Interface(ABI.psm)],
];

function show(v) {
  if (typeof v === 'string' && /^0x[0-9a-fA-F]{64}$/.test(v)) return JSON.stringify(b32(v));
  if (typeof v === 'bigint') return v >= 10n ** 15n ? `${fmt(v)} (${v})` : v.toString();
  return String(v);
}

/** Human-readable form of a scheduled call: { text, fn }. */
export function describeCall(target, data, names) {
  for (const [label, iface] of decoders) {
    try {
      const tx = iface.parseTransaction({ data });
      if (!tx) continue;
      const who = names[target.toLowerCase()] ?? label;
      return { fn: tx.name, text: `${who}.${tx.name}(${tx.args.map(show).join(', ')})` };
    } catch {
      /* try next */
    }
  }
  return { fn: null, text: `${target} <unknown calldata ${data.slice(0, 10)}…>` };
}

export function createState(fromBlock) {
  return { from: fromBlock, health: new Map(), wired: null };
}

async function wire(cfg) {
  const p = cfg.provider;
  const vault = new ethers.Contract(cfg.vault, ABI.vault, p);
  const bxau = new ethers.Contract(await vault.bxau(), ABI.bxau, p);
  const spotter = new ethers.Contract(await vault.spotter(), ABI.spotter, p);
  const names = { [cfg.vault.toLowerCase()]: 'vault', [bxau.target.toLowerCase()]: 'bXAU', [spotter.target.toLowerCase()]: 'spotter' };
  const c = { vault, bxau, spotter, names };
  for (const k of ['timelock', 'guardian', 'flash', 'psm']) {
    if (cfg[k]) {
      c[k] = new ethers.Contract(cfg[k], ABI[k], p);
      names[cfg[k].toLowerCase()] = k;
    }
  }
  c.pools = [];
  for (const addr of cfg.pools ?? []) {
    const pool = new ethers.Contract(addr, ABI.pool, p);
    const label = `pool:${await pool.symbol()}`;
    const decs = [];
    for (const i of [0, 1]) decs.push(await new ethers.Contract(await pool.coins(i), ABI.erc20, p).decimals());
    c.pools.push({ pool, label, decs });
    names[addr.toLowerCase()] = label;
  }
  return c;
}

/** One pass: returns alerts [{ severity, title, detail, block?, tx? }]. */
export async function pollOnce(cfg, state) {
  const { provider } = cfg;
  const alerts = [];
  const push = (severity, title, detail, l) =>
    alerts.push({ severity, title, detail, block: l?.blockNumber, tx: l?.transactionHash });
  if (!state.wired) state.wired = await wire(cfg);
  const w = state.wired;
  const head = await headBlock(provider);

  // ── events ──
  if (state.from <= head) {
    const sources = [w.vault, w.bxau, w.spotter, w.timelock, w.guardian, w.flash, w.psm, ...w.pools.map((x) => x.pool)]
      .filter(Boolean);
    const byAddr = new Map(sources.map((c) => [c.target.toLowerCase(), c]));
    const logs = await getLogs(provider, { address: [...byAddr.keys()] }, state.from, head);
    for (const l of logs) {
      const c = byAddr.get(l.address.toLowerCase());
      let ev;
      try {
        ev = c.interface.parseLog(l);
      } catch {
        continue;
      }
      if (!ev) continue;
      const src = w.names[l.address.toLowerCase()];
      const a = ev.args;
      if (src.startsWith('pool:')) {
        const pa = {
          Paused: () => push(a.paused ? 'CRIT' : 'INFO', `${src} ${a.paused ? 'PAUSED (swaps/deposits; withdrawals still open)' : 'unpaused'}`, '', l),
          SetFee: () => push('WARN', `${src} fee changed`, `fee ${Number(a.fee) / 1e6} bps, staker share ${Number(a.stakerShare) / 1e8}%`, l),
          SetFeeReceiver: () => push('CRIT', `${src} fee receiver changed`, a.receiver, l),
          SetPauser: () => push('WARN', `${src} pauser changed`, a.pauser, l),
          RampA: () => push('WARN', `${src} A ramp`, `${Number(a.oldA) / 100} → ${Number(a.newA) / 100} by ${new Date(Number(a.futureTime) * 1000).toISOString()}`, l),
          StopRampA: () => push('INFO', `${src} A ramp stopped`, `A = ${Number(a.A) / 100}`, l),
          OwnershipTransferred: () => push('WARN', `${src} owner changed`, `${a.from} → ${a.to}`, l),
        }[ev.name];
        if (pa) pa();
        continue;
      }
      switch (`${src}.${ev.name}`) {
        case 'timelock.Schedule': {
          const d = describeCall(a.target, a.data, w.names);
          const when = new Date(Number(a.eta) * 1000).toISOString();
          push(DANGEROUS.has(d.fn) ? 'CRIT' : 'WARN', 'governance call SCHEDULED', `${d.text} — executable from ${when}`, l);
          break;
        }
        case 'timelock.Execute':
          push('INFO', 'governance call executed', describeCall(a.target, a.data, w.names).text, l);
          break;
        case 'timelock.Cancel':
          push('INFO', 'governance call cancelled', `id ${a.id}`, l);
          break;
        case 'timelock.SetAdmin':
          push('CRIT', 'timelock admin changed', a.admin, l);
          break;
        case 'timelock.SetDelay':
          push('WARN', 'timelock delay changed', `${a.delay} s`, l);
          break;
        case 'guardian.Fired':
          push('CRIT', 'EMERGENCY SHUTDOWN fired by guardian', `by ${a.by}`, l);
          break;
        case 'vault.Cage':
          push('CRIT', 'vault CAGED', 'shutdown started: skim → thaw → cash', l);
          break;
        case 'vault.Rely':
          push('CRIT', 'new vault ward', a.usr, l);
          break;
        case 'vault.Deny':
          push('WARN', 'vault ward removed', a.usr, l);
          break;
        case 'bXAU.Rely':
          push('CRIT', 'NEW bXAU MINTER', a.usr, l);
          break;
        case 'bXAU.Deny':
          push('WARN', 'bXAU minter removed', a.usr, l);
          break;
        case 'vault.FileSpotter':
          push('CRIT', 'vault oracle replaced', a.spotter, l);
          state.wired = null; // re-read spotter next pass
          break;
        case 'vault.File':
          push('INFO', 'risk parameter changed', `${b32(a.ilk)}.${b32(a.what)} = ${show(a.data)}`, l);
          break;
        case 'vault.FileGlobal':
          push('INFO', 'global parameter changed', `${b32(a.what)} = ${show(a.data)}`, l);
          break;
        case 'vault.Liquidate':
          push(
            a.badDebt > 0n ? 'WARN' : 'INFO',
            'liquidation',
            `${b32(a.ilk)} ${a.usr}: ${fmt(a.wad)} bXAU for ${a.gemOut} gem units` +
              (a.badDebt > 0n ? `, bad debt ${fmt(a.badDebt / RAY)} oz` : ''),
            l,
          );
          break;
        case 'vault.Flap':
          push('INFO', 'surplus minted', `${fmt(a.wad)} bXAU to ${a.to}`, l);
          break;
        case 'spotter.FileSrc':
          push('WARN', 'price source changed', `${b32(a.ilk)} feed ${a.feed} maxAge ${a.maxAge} par ${fmt(a.par)}`, l);
          break;
        case 'spotter.FileXau':
          push('WARN', 'XAU/USD feed changed', `${a.feed} maxAge ${a.maxAge}`, l);
          break;
        case 'spotter.OwnershipTransferred':
        case 'flash.OwnershipTransferred':
          push('WARN', `${src} owner changed`, `${a.from} → ${a.to}`, l);
          break;
        case 'psm.SetFees':
          push('WARN', 'PSM fees changed', `tin ${fmt(a.tin * 100n)}%, tout ${fmt(a.tout * 100n)}%`, l);
          break;
        case 'psm.SetFloor':
          push('WARN', 'PSM depeg floor changed', `${fmt(a.floor)} oz/token`, l);
          break;
        case 'psm.SetTreasury':
          push('CRIT', 'PSM treasury changed', a.treasury, l);
          break;
        case 'psm.OwnershipTransferred':
          push('WARN', 'psm owner changed', `${a.from} → ${a.to}`, l);
          break;
        case 'flash.SetMax':
          push('INFO', 'flash-mint ceiling changed', `${fmt(a.max)} bXAU`, l);
          break;
        default:
          break;
      }
    }
    state.from = head + 1;
  }

  // ── health (alert only on change of state) ──
  const health = [];
  const check = (key, bad, severity, title, detail) => health.push({ key, bad, severity, title, detail });
  const [live, debt, sin, surplus, supply] = await Promise.all([
    w.vault.live(), w.vault.debt(), w.vault.sin(), w.vault.surplus(), w.bxau.totalSupply(),
  ]);
  check('live', live !== 1n, 'CRIT', 'vault is not live', 'caged');
  check('books', debt + sin !== supply * RAY + surplus, 'CRIT', 'books out of balance',
    `debt+sin ${debt + sin} != supply·RAY+surplus ${supply * RAY + surplus}`);
  check('sin', sin > 0n, 'WARN', 'bad debt outstanding', `${fmt(sin / RAY)} oz (heal() against surplus ${fmt(surplus / RAY)})`);
  const n = Number(await w.vault.ilkCount());
  for (let k = 0; k < n; k++) {
    const ilk = await w.vault.ilkList(k);
    const name = b32(ilk);
    const [, ok] = await w.spotter.peek(ilk);
    const i = await w.vault.ilks(ilk);
    if (i.Art > 0n || i.line > 0n) {
      check(`oracle:${name}`, !ok, 'CRIT', `oracle down for ${name}`, 'draw/free/liquidate halted');
    }
    if (i.line > 0n) {
      const used = (i.Art * i.rate) / RAY;
      const pct = Number((used * 10000n) / i.line) / 100;
      check(`util:${name}`, pct >= Number(cfg.utilWarn ?? 90), 'WARN', `${name} ceiling ${pct}% used`,
        `${fmt(used)} / ${fmt(i.line)} oz`);
    }
  }
  if (w.psm) {
    check('psm:gate', !(await w.psm.pegHealthy()), 'WARN', 'PSM minting closed by the depeg guard',
      'the peg is below the PSM floor or its feed is stale; redemptions remain open');
  }
  for (const { pool, label, decs } of w.pools) {
    const [b0, b1, paused] = await Promise.all([pool.balances(0), pool.balances(1), pool.paused()]);
    const n0 = b0 * 10n ** BigInt(18 - Number(decs[0]));
    const n1 = b1 * 10n ** BigInt(18 - Number(decs[1]));
    const tot = n0 + n1;
    const minPct = tot === 0n ? 50 : Number(((n0 < n1 ? n0 : n1) * 10000n) / tot) / 100;
    check(`imbalance:${label}`, tot > 0n && minPct < Number(cfg.imbalanceWarn ?? 20), 'WARN',
      `${label} imbalanced: smaller side ${minPct}%`, `${fmt(n0)} / ${fmt(n1)} — possible depeg`);
    check(`paused:${label}`, paused, 'CRIT', `${label} is paused`, 'swaps and deposits stopped');
  }
  for (const h of health) {
    const prev = state.health.get(h.key) ?? false;
    if (h.bad !== prev) {
      if (h.bad) push(h.severity, h.title, h.detail);
      else push('INFO', `recovered: ${h.title}`, '');
      state.health.set(h.key, h.bad);
    }
  }
  return alerts;
}

async function main() {
  const once = process.argv.includes('--once');
  const provider = new ethers.JsonRpcProvider(env('RPC_URL'));
  const cfg = {
    provider,
    vault: env('VAULT'),
    timelock: process.env.TIMELOCK || null,
    guardian: process.env.GUARDIAN || null,
    flash: process.env.FLASH || null,
    utilWarn: Number(env('UTIL_WARN', '90')),
    psm: process.env.PSM || null,
    pools: (process.env.POOLS ?? '').split(',').map((x) => x.trim()).filter(Boolean),
    imbalanceWarn: Number(env('IMBALANCE_WARN', '20')),
  };
  if (!cfg.timelock) console.error('WARN: TIMELOCK not set — scheduled governance calls will not be seen');
  const head = await headBlock(provider);
  const state = createState(Number(env('FROM_BLOCK', String(Math.max(0, head - 1000)))));
  const url = process.env.WEBHOOK_URL;
  let crit = false;
  for (;;) {
    try {
      for (const a of await pollOnce(cfg, state)) {
        crit ||= a.severity === 'CRIT';
        console.log(`${a.severity.padEnd(4)} ${a.title}${a.detail ? ` — ${a.detail}` : ''}${a.tx ? ` (tx ${a.tx})` : ''}`);
        if (a.severity !== 'INFO') await webhook(url, { text: `[${a.severity}] ${a.title}: ${a.detail}`, ...a });
      }
    } catch (e) {
      console.error(`poll failed: ${e.shortMessage ?? e.message}`);
    }
    if (once) process.exit(crit ? 2 : 0);
    await sleep(Number(env('INTERVAL', '60')) * 1000);
  }
}

if (isMain(import.meta.url)) main().catch((e) => { console.error(e); process.exit(1); });
