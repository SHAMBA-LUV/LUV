// SPDX-License-Identifier: Apache-2.0
// liqlock.js — the public page for the SHAMBA LUV liquidity locker.
// Self-contained: no library, no build step. Selectors are hardcoded from the verified ABI; every
// number is an eth_call your browser makes. Reading needs no wallet.
//
// v5 (2026-11-28): the page says what the chain says. A matured lock is shown as matured, never as
// "locked", and the beneficiary is treated as a client of the locker: its options (redeem · extend ·
// lock afresh) are listed for every visitor and simulated against Ethereum as the beneficiary would
// send them. A wallet is asked for only to sign, and the buttons arm only for the address the
// contract itself would accept.
// Contract source + tests: https://github.com/SHAMBA-LUV/liq-locker
"use strict";

const RPC = "https://ethereum-rpc.publicnode.com";
const LOCKER = "0x111111f70cb3469B5285862d7a4e7Cb53d04f502";
const PAIR = "0x57D2085Aa859a145cB107845AD03c0eAAFBD8a31";
const LUV = "0x2711111111683B8708cb9a48cBf36a51315F8254";
const TREASURY = "0x10f7Ee226B16bea7f365Dc1eDEF159Fc1957D169";
const EXPLORER = "https://etherscan.io";
const DAY = 86400;
const DEFAULT_DAYS = 90;            // DEFAULT_LOCK_DURATION
const MAX_DAYS = 73050;             // MAX_LOCK_DURATION (≈ 200 years)

// selectors, from the Etherscan-verified ABI (cast sig)
const SEL = {
  lock_count: "0x293f2067",           // lock_count()
  total_locked: "0x1f15f418",         // total_locked(address)
  lock_at: "0xe1377a5b",              // lock_at(uint256) → (token, beneficiary, amount, unlock_at, withdrawn)
  time_remaining: "0x5c036855",       // time_remaining(uint256) → (seconds_left, blocks_left)
  is_locked: "0x5f042807",            // is_locked(uint256)
  totalSupply: "0x18160ddd",
  balanceOf: "0x70a08231",
  allowance: "0xdd62ed3e",            // allowance(address,address)
  // writes — the beneficiary's options
  withdraw: "0x2e1a7d4d",             // withdraw(uint256)
  extend_default: "0xb6b4d7e5",       // extend_default(uint256)          +90 d on the CURRENT maturity
  extend_by: "0x670b98b6",            // extend_by(uint256,uint256)       +seconds on the CURRENT maturity
  lock_for: "0xa7864665",             // lock_for(address,uint256,uint256,address)
  approve: "0x095ea7b3",              // approve(address,uint256)
};
const ERRORS = {
  "0xb06bc0f2": "not_beneficiary — only the lock's beneficiary can do this",
  "0x65032c6a": "still_locked — the gates have not both passed",
  "0x09a15552": "already_withdrawn",
  "0x7d7fec23": "not_shortenable — a lock can only be made longer",
  "0x4eccc25f": "bad_unlock_time",
  "0xf8fc8df4": "duration_too_long — beyond the 200-year horizon",
  "0xf79efaa8": "timestamp_overflow",
  "0x73c4b506": "amount_zero",
  "0x9fc29c60": "zero_address",
};

const TRAIL = [
  { label: "deploy — Create3d → the locker, at a deterministic every-chain address",
    hash: "0x113ba138d140f7ec0ca75c8697d69b7e8a931d508515ded6cee1523c5627f38d", block: 25822914 },
  { label: "approve — the pair permits the locker to pull LP",
    hash: "0xf2ab3e27efd82cee3cc57c17397119a57d2d6b8615304405f12d1451a963c422", block: 25827621 },
  { label: "lock #0 — 0.001 LP, the dust rehearsal, 90 days",
    hash: "0x30748af283c482f0bc8746e53f9f40ce1496ed4c6e64c46d5839a25f03670b72", block: 25827695 },
  { label: "lock #1 — THE FULL POSITION: 16,419,484.36 LP, 100% of circulating liquidity, 90 days",
    hash: "0xc2c3c73d2bfa216807e900abb17eff4a98808b45768cf11f23e829e52a10390d", block: 25827873 },
  { label: "maturity — both locks matured 2026-11-22 (21:21 and 21:57 UTC), by plan: a live test of redemption and/or continuation",
    hash: null, block: null },
];

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const link = (href, text) => {
  const a = el("a", "lk", text);
  a.href = href; a.target = "_blank"; a.rel = "noopener";
  return a;
};
const pad = (v) => (typeof v === "bigint" ? v.toString(16) : String(v).toLowerCase().replace(/^0x/, "")).padStart(64, "0");
const short = (a) => a.slice(0, 6) + "…" + a.slice(-4);
const same = (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
const utc = (t) => new Date(t * 1000).toUTCString().replace(" GMT", " UTC");
const day = (t) => new Date(t * 1000).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });

async function rpc(method, params) {
  const res = await fetch(RPC, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = await res.json();
  if (json.error) { const e = new Error(json.error.message || "rpc error"); e.data = json.error.data; throw e; }
  return json.result;
}
const call = (to, data, from) => rpc("eth_call", [from ? { from, to, data } : { to, data }, "latest"]);
const words = (hex) => {
  const b = hex.replace(/^0x/, "");
  return Array.from({ length: b.length / 64 }, (_, i) => BigInt("0x" + (b.slice(i * 64, i * 64 + 64) || "0")));
};
const addr = (w) => "0x" + w.toString(16).padStart(40, "0");

// full-width integer → human units at 18 decimals; rounding is display-only
function fmt18(v, places = 6) {
  const neg = v < 0n; if (neg) v = -v;
  const whole = v / 10n ** 18n;
  const frac = (v % 10n ** 18n).toString().padStart(18, "0").slice(0, places);
  return `${neg ? "-" : ""}${whole}${places ? "." + frac : ""}`;
}
const lp = (v) => `${fmt18(v, v < 10n ** 18n ? 6 : 3)} LP`;

// simulate a write exactly as `from` would send it; never signs anything
async function simulate(from, data, to = LOCKER) {
  try { await call(to, data, from); return { ok: true, why: "would succeed" }; }
  catch (e) {
    const d = typeof e.data === "string" ? e.data : (e.data && e.data.data) || "";
    return { ok: false, why: ERRORS[String(d).slice(0, 10)] || e.message };
  }
}

/* ── state ──────────────────────────────────────────────────────────────────── */
let LOCKS = [], NOW = 0, ACCOUNT = null, ACCOUNT_LP = 0n, DESK_KEY = "";

async function readLocks() {
  const [count] = words(await call(LOCKER, SEL.lock_count));
  const out = [];
  for (let id = 0n; id < count; id++) {
    const w = words(await call(LOCKER, SEL.lock_at + pad(id)));
    const [secsLeft, blocksLeft] = words(await call(LOCKER, SEL.time_remaining + pad(id)));
    const isLocked = words(await call(LOCKER, SEL.is_locked + pad(id)))[0] !== 0n;
    out.push({ id, token: addr(w[0]), beneficiary: addr(w[1]), amount: w[2], unlockAt: Number(w[3]),
               withdrawn: w[4] !== 0n, isLocked, secsLeft, blocksLeft });
  }
  return out;
}

async function refresh() {
  try {
    const head = await rpc("eth_getBlockByNumber", ["latest", false]);
    NOW = Number(BigInt(head.timestamp));
    const block = Number(BigInt(head.number));
    LOCKS = await readLocks();
    const [inLocker] = words(await call(LOCKER, SEL.total_locked + pad(PAIR)));
    const [supply] = words(await call(PAIR, SEL.totalSupply));
    const [treasuryLP] = words(await call(PAIR, SEL.balanceOf + pad(TREASURY)));
    const circulating = supply - 1000n; // MINIMUM_LIQUIDITY is burned at pair creation

    const live = LOCKS.filter((l) => !l.withdrawn && same(l.token, PAIR));
    const under = live.filter((l) => l.isLocked).reduce((s, l) => s + l.amount, 0n);
    const matured = live.filter((l) => !l.isLocked).reduce((s, l) => s + l.amount, 0n);
    const pctOf = (v) => circulating > 0n ? Number(v) / Number(circulating) * 100 : 0;
    const pctTxt = (p) => p === 0 ? "0 %" : p < 0.01 ? `${p.toExponential(1)} %` : `${p.toFixed(2)} %`;

    // the headline is the chain's word, in every state
    const h1 = $("s-h1");
    if (matured > 0n) h1.innerHTML = "The lock has <em>matured</em>.<br>The liquidity is still in the locker.";
    else if (under > 0n) h1.innerHTML = "The liquidity is <em>locked</em>.<br>Check it yourself.";
    else if (LOCKS.length) h1.innerHTML = "The liquidity was <em>redeemed</em>.<br>Check it yourself.";
    $("s-locked").textContent = lp(under);
    $("s-matured").textContent = lp(matured);
    $("s-pct").textContent = pctTxt(pctOf(under));
    $("s-locks").textContent = String(LOCKS.length);
    $("s-treasury").textContent =
      `In the locker, exactly: ${inLocker} LP wei (${pctTxt(pctOf(inLocker))} of all withdrawable LP) — ` +
      `${under} under lock, ${matured} matured and claimable by the beneficiary. ` +
      `The treasury wallet holds ${fmt18(treasuryLP, 3)} LP outside the locker (${treasuryLP} wei).`;
    $("s-read").textContent = `read live from Ethereum at block ${block.toLocaleString("en-US")}, ${utc(NOW)} — refreshes every minute`;

    // the maturity notice — only while something has matured and is still in the locker
    const m = $("maturity");
    m.hidden = matured === 0n;
    if (matured > 0n) {
      const ml = live.filter((l) => !l.isLocked);
      $("m-what").innerHTML = "";
      $("m-what").append(
        el("b", null, `${ml.length === 1 ? "Lock" : "Locks"} ${ml.map((l) => "#" + l.id).join(" and ")} matured on ${day(Math.max(...ml.map((l) => l.unlockAt)))}`),
        ` and ${ml.length === 1 ? "has" : "have"} been neither withdrawn nor extended. ${lp(matured)} — ` +
        `${pctTxt(pctOf(matured))} of all withdrawable LP — is still in the locker, claimable by the beneficiary ` +
        `${short(ml[0].beneficiary)} alone.`);
    }

    renderLocks(LOCKS);
    const key = LOCKS.map((l) => `${l.id}:${l.withdrawn}:${l.isLocked}:${l.unlockAt}`).join("|") + "|" + ACCOUNT;
    if (key !== DESK_KEY) { DESK_KEY = key; await renderDesk(); } else resimulate();
  } catch (e) {
    $("s-read").textContent = `read failed: ${e.message} — the chain is the source; reload to try again`;
  }
}

function renderLocks(locks) {
  const box = $("locks");
  box.replaceChildren();
  if (!locks.length) { box.append(el("p", "fine", "no locks yet")); return; }
  for (const l of locks) {
    const head = el("div", "head");
    head.append(el("span", "dot"), el("span", "kicker", `LOCK #${l.id}`));
    head.append(el("span", l.withdrawn ? "net state-muted" : l.isLocked ? "net state-ok" : "net state-warn",
      l.withdrawn ? "redeemed (withdrawn)" : l.isLocked ? "🔒 LOCKED" : "⏳ MATURED — in the locker, claimable"));
    box.append(head);
    const grid = el("div", "grid");
    const cell = (label, value, cls) => {
      const c = el("div", "cell");
      c.append(el("span", "label", label), el("span", "value " + (cls || ""), value));
      return c;
    };
    const overdue = !l.isLocked && !l.withdrawn ? ((NOW - l.unlockAt) / DAY).toFixed(1) + " d ago" : null;
    grid.append(
      cell("Amount", lp(l.amount), "green"),
      cell(l.isLocked ? "Opens" : "Opened", day(l.unlockAt)),
      cell(l.isLocked ? "Days left" : "Matured", l.isLocked ? (Number(l.secsLeft) / DAY).toFixed(1) : overdue || "—", "big goldc"),
      cell("Gates", l.blocksLeft > 0n ? "time + block height" : "time"));
    box.append(grid);
    box.append(el("p", "fine", `Exactly ${l.amount} LP wei · beneficiary ${l.beneficiary} · unlock ${utc(l.unlockAt)}`));
  }
}

/* ── the beneficiary's desk ─────────────────────────────────────────────────── */
// Every option is rendered for every visitor and simulated `from` the beneficiary. The button arms
// only when the connected wallet is the address the contract would accept.
const SIMS = []; // [{ node, from, data(), to }]

function option(title, tag, desc, controls, sim) {
  const o = el("div", "opt");
  const t = el("div", "t", title); t.append(el("small", null, tag));
  o.append(t, el("div", "d", desc));
  const row = el("div", "row"); controls.forEach((c) => row.append(c));
  const s = el("span", "sim", "simulating…"); row.append(s);
  o.append(row);
  if (sim) SIMS.push(Object.assign({ node: s }, sim));
  return o;
}
function button(label, primary, armed, onClick) {
  const b = el("button", "act" + (primary ? " primary" : ""), label);
  b.type = "button"; b.disabled = !armed; b.addEventListener("click", () => onClick(b));
  return b;
}

async function renderDesk() {
  const box = $("opts");
  box.replaceChildren(); SIMS.length = 0;
  const live = LOCKS.filter((l) => !l.withdrawn);
  if (!live.length) box.append(el("p", "fine", "No open locks: every lock has been redeemed. Lock afresh below."));

  for (const l of live) {
    const mine = same(ACCOUNT, l.beneficiary);
    const h = el("div", "head"); h.append(el("span", "kicker", `LOCK #${l.id} · ${lp(l.amount)} · ${l.isLocked ? "locked to " + day(l.unlockAt) : "matured " + day(l.unlockAt)}`));
    box.append(h);

    // 1 · redeem
    box.append(option("Redeem", "withdraw(" + l.id + ")",
      l.isLocked ? `Opens ${utc(l.unlockAt)}. Until then nobody can redeem it — the beneficiary included.`
                 : `The LP returns to the beneficiary ${short(l.beneficiary)}, to the wei. The lock is closed for good; continuing afterwards means a new lock (below).`,
      [button("redeem", false, mine && !l.isLocked, (b) => send(b, SEL.withdraw + pad(l.id), `redeem lock #${l.id}`))],
      { from: l.beneficiary, data: () => SEL.withdraw + pad(l.id) }));

    // 2 · continue: +90 days on the current maturity
    const plus90 = l.unlockAt + DEFAULT_DAYS * DAY;
    const stillPast = plus90 <= NOW;
    box.append(option("Continue — extend 90 days", "extend_default(" + l.id + ")",
      `New maturity ${utc(plus90)}. Extensions add to the current maturity, not to today, so extending late never shortens a lock.` +
      (stillPast ? " That date is already past: the lock would stay matured — use a longer extension below." : ""),
      [button("extend +90 d", true, mine && !stillPast, (b) => send(b, SEL.extend_default + pad(l.id), `extend lock #${l.id} to ${day(plus90)}`))],
      { from: l.beneficiary, data: () => SEL.extend_default + pad(l.id) }));

    // 3 · continue: any length, from the current maturity
    const inp = el("input", "inp"); inp.type = "number"; inp.min = "1"; inp.max = String(MAX_DAYS); inp.step = "1";
    // default: ninety days from today, expressed as days past the current maturity
    inp.value = String(l.isLocked ? 365 : Math.ceil((NOW - l.unlockAt) / DAY) + DEFAULT_DAYS);
    const target = () => l.unlockAt + Math.max(0, Math.floor(Number(inp.value) || 0)) * DAY;
    const lbl = el("span", "fine", ""); lbl.style.margin = "0";
    const btn = button("extend", false, false, (b) => send(b, SEL.extend_by + pad(l.id) + pad(BigInt(Math.floor(Number(inp.value)) * DAY)), `extend lock #${l.id} to ${day(target())}`));
    const sync = () => {
      const t = target(), ok = t > NOW && Number(inp.value) >= 1;
      lbl.textContent = `days past the current maturity → ${ok ? utc(t) : "still in the past — the contract would accept it, this page will not send it"}`;
      btn.disabled = !(mine && ok);
    };
    inp.addEventListener("input", () => { sync(); resimulate(); });
    sync();
    box.append(option("Continue — extend by any length", "extend_by(" + l.id + ", days × 86400)",
      "Up to the 200-year horizon. The contract accepts an extension whose new date is still in the past (it can only refuse a shorter one); this page refuses to send one, so an extension always re-locks.",
      [inp, lbl, btn],
      { from: l.beneficiary, data: () => SEL.extend_by + pad(l.id) + pad(BigInt(Math.max(1, Math.floor(Number(inp.value) || 1)) * DAY)) }));
  }

  // 4 · lock afresh — open to any LP holder, the beneficiary included
  const holder = ACCOUNT || TREASURY;
  const [bal] = words(await call(PAIR, SEL.balanceOf + pad(holder)));
  ACCOUNT_LP = ACCOUNT ? bal : 0n;
  const dInp = el("input", "inp"); dInp.type = "number"; dInp.min = "1"; dInp.max = String(MAX_DAYS); dInp.value = String(DEFAULT_DAYS);
  const lockBtn = button("approve + lock", true, !!ACCOUNT && bal > 0n, (b) => lockAfresh(b, bal, Number(dInp.value)));
  const lh = el("div", "head"); lh.append(el("span", "kicker", "LOCK AFRESH")); box.append(lh);
  box.append(option("Lock", "approve(locker) → lock_for(pair, amount, days, self)",
    `Any LP holder can lock their own LP here, for 1 day to 200 years; the beneficiary is the one who locks. ` +
    `${ACCOUNT ? "Your wallet" : "The treasury wallet"} holds ${lp(bal)} outside the locker` +
    (bal === 0n ? " — redeem first, or add liquidity, to have something to lock." : " — all of it would be locked.") +
    " Two signatures: the approval, then the lock.",
    [dInp, el("span", "fine", "days"), lockBtn], null));
  box.lastChild.querySelector(".sim").textContent = bal > 0n ? "simulated at signing time" : "nothing to lock yet";

  resimulate();
}

let simTimer = null;
function resimulate() {
  clearTimeout(simTimer);
  simTimer = setTimeout(async () => {
    for (const s of SIMS) {
      const r = await simulate(s.from, s.data(), s.to);
      s.node.className = "sim " + (r.ok ? "ok" : "no");
      s.node.textContent = (r.ok ? "✓ simulated as the beneficiary: " : "✗ simulated as the beneficiary: ") + r.why;
    }
  }, 250);
}

/* ── signing — only ever on the visitor's click, in the visitor's wallet ─────── */
function log(node) { $("txlog").prepend(node); }

async function connect() {
  if (!window.ethereum) { $("who").textContent = "no wallet in this browser — the page stays read-only, which is all a reader needs"; return; }
  try {
    const [a] = await window.ethereum.request({ method: "eth_requestAccounts" });
    const chain = await window.ethereum.request({ method: "eth_chainId" });
    if (chain !== "0x1") await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x1" }] });
    ACCOUNT = a;
    const ben = LOCKS.some((l) => same(l.beneficiary, a));
    $("who").textContent = `connected ${a} — ${ben ? "the beneficiary: the options above are armed" : "not a beneficiary of any lock: you can see every option, and lock your own LP"}`;
    $("connect").textContent = "connected";
    DESK_KEY = ""; await refresh();
  } catch (e) { $("who").textContent = `not connected: ${e.message || e}`; }
}

async function send(btn, data, what, to = LOCKER) {
  btn.disabled = true;
  const line = el("div", null, `${what}: simulating as ${short(ACCOUNT)}…`); log(line);
  try {
    const sim = await simulate(ACCOUNT, data, to);
    if (!sim.ok) { line.textContent = `${what}: not sent — ${sim.why}`; btn.disabled = false; return false; }
    line.textContent = `${what}: waiting for your signature…`;
    const hash = await window.ethereum.request({ method: "eth_sendTransaction", params: [{ from: ACCOUNT, to, data }] });
    line.textContent = `${what}: sent · `; line.append(link(`${EXPLORER}/tx/${hash}`, hash.slice(0, 22) + "… ↗"), " · waiting for the block…");
    for (let i = 0; i < 90; i++) {
      await new Promise((r) => setTimeout(r, 4000));
      const rc = await rpc("eth_getTransactionReceipt", [hash]);
      if (rc) {
        const ok = rc.status === "0x1";
        line.lastChild.textContent = ok ? ` · ✓ mined in block ${Number(BigInt(rc.blockNumber))}` : " · ✗ reverted";
        DESK_KEY = ""; await refresh();
        return ok;
      }
    }
    line.lastChild.textContent = " · not mined yet — reload later; the chain will say";
  } catch (e) { line.textContent = `${what}: ${e.message || e}`; }
  btn.disabled = false;
  return false;
}

async function lockAfresh(btn, amount, days) {
  days = Math.floor(days);
  if (!(days >= 1 && days <= MAX_DAYS)) { log(el("div", null, `lock: choose 1 to ${MAX_DAYS} days`)); return; }
  const [allow] = words(await call(PAIR, SEL.allowance + pad(ACCOUNT) + pad(LOCKER)));
  if (allow < amount) {
    const ok = await send(btn, SEL.approve + pad(LOCKER) + pad(amount), `approve the locker for ${lp(amount)}`, PAIR);
    if (!ok) return;
  }
  await send(btn, SEL.lock_for + pad(PAIR) + pad(amount) + pad(BigInt(days * DAY)) + pad(ACCOUNT), `lock ${lp(amount)} for ${days} days`);
}

function mountStatic() {
  $("c-locker").replaceChildren(link(`${EXPLORER}/address/${LOCKER}#code`, LOCKER));
  $("c-pair").replaceChildren(link(`${EXPLORER}/address/${PAIR}`, PAIR));
  $("c-luv").replaceChildren(link(`${EXPLORER}/token/${LUV}`, LUV));
  const trail = $("trail");
  for (const t of TRAIL) {
    const row = el("div", "trailrow");
    row.append(el("span", "what", t.label));
    const who = el("span", "who");
    if (t.hash) { who.append(`block ${t.block} · `); who.append(link(`${EXPLORER}/tx/${t.hash}`, t.hash.slice(0, 22) + "… ↗")); }
    else who.append("no transaction — maturity is the clock, not a signature");
    row.append(who);
    trail.append(row);
  }
  $("connect").addEventListener("click", connect);
}

mountStatic();
refresh();
setInterval(refresh, 60_000);
