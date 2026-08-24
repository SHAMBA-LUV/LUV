// SPDX-License-Identifier: Apache-2.0
// liqlock.js — the public proof page for the SHAMBA LUV liquidity locker.
// READ-ONLY and self-contained: no wallet, no library, no build step. Selectors are
// hardcoded from the verified ABI; every number is an eth_call your browser makes.
// Contract source + tests: https://github.com/SHAMBA-LUV/liq-locker
"use strict";

const RPC = "https://ethereum-rpc.publicnode.com";
const LOCKER = "0x111111f70cb3469B5285862d7a4e7Cb53d04f502";
const PAIR = "0x57D2085Aa859a145cB107845AD03c0eAAFBD8a31";
const LUV = "0x2711111111683B8708cb9a48cBf36a51315F8254";
const TREASURY = "0x10f7Ee226B16bea7f365Dc1eDEF159Fc1957D169";
const EXPLORER = "https://etherscan.io";

// selectors, from the Etherscan-verified ABI (cast sig)
const SEL = {
  lock_count: "0x293f2067",           // lock_count()
  total_locked: "0x1f15f418",         // total_locked(address)
  lock_at: "0xe1377a5b",              // lock_at(uint256) → (token, beneficiary, amount, unlock_at, withdrawn)
  time_remaining: "0x5c036855",       // time_remaining(uint256) → (seconds_left, blocks_left)
  is_locked: "0x5f042807",            // is_locked(uint256)
  totalSupply: "0x18160ddd",
  balanceOf: "0x70a08231",
};

const TRAIL = [
  { label: "deploy — Create3d → the locker, at a deterministic every-chain address",
    hash: "0x113ba138d140f7ec0ca75c8697d69b7e8a931d508515ded6cee1523c5627f38d", block: 25822914 },
  { label: "approve — the pair permits the locker to pull LP",
    hash: "0xf2ab3e27efd82cee3cc57c17397119a57d2d6b8615304405f12d1451a963c422", block: 25827621 },
  { label: "lock #0 — 0.001 LP, the dust rehearsal, 90 days",
    hash: "0x30748af283c482f0bc8746e53f9f40ce1496ed4c6e64c46d5839a25f03670b72", block: 25827695 },
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
const pad = (v) => (typeof v === "bigint" ? v.toString(16) : v.toLowerCase().replace(/^0x/, "")).padStart(64, "0");

async function rpc(method, params) {
  const res = await fetch(RPC, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || "rpc error");
  return json.result;
}
const call = (to, data) => rpc("eth_call", [{ to, data }, "latest"]);
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

async function refresh() {
  try {
    const [count] = words(await call(LOCKER, SEL.lock_count));
    const [locked] = words(await call(LOCKER, SEL.total_locked + pad(PAIR)));
    const [supply] = words(await call(PAIR, SEL.totalSupply));
    const [treasuryLP] = words(await call(PAIR, SEL.balanceOf + pad(TREASURY)));
    const circulating = supply - 1000n; // MINIMUM_LIQUIDITY is burned at pair creation
    const pct = circulating > 0n ? Number(locked) / Number(circulating) * 100 : 0;

    $("s-locks").textContent = count.toString();
    $("s-locked").textContent = `${locked} LP wei  (≈ ${fmt18(locked)} LP)`;
    $("s-pct").textContent = `${(pct === 0 ? "0" : pct < 0.01 ? pct.toExponential(2) : pct.toFixed(4))} % of all circulating LUV/WETH liquidity`;
    $("s-treasury").textContent = `${treasuryLP} LP wei  (≈ ${fmt18(treasuryLP)} LP) still unlocked in the treasury`;
    $("s-read").textContent = `read live at ${new Date().toISOString()} — reload to re-ask the chain`;

    const box = $("locks");
    box.replaceChildren();
    if (count === 0n) { box.append(el("p", "muted", "no locks yet")); return; }
    for (let id = 0n; id < count; id++) {
      const w = words(await call(LOCKER, SEL.lock_at + pad(id)));
      const [token, beneficiary, amount, unlockAt, withdrawn] = [addr(w[0]), addr(w[1]), w[2], Number(w[3]), w[4] !== 0n];
      const [secsLeft, blocksLeft] = words(await call(LOCKER, SEL.time_remaining + pad(id)));
      const isLocked = words(await call(LOCKER, SEL.is_locked + pad(id)))[0] !== 0n;
      const leftDays = Number(secsLeft) / 86400;
      const row = el("div", "row");
      row.append(el("div", "sig", `lock #${id} — ${fmt18(amount)} LP (${amount} wei)`));
      const meta = el("div", isLocked ? "ok" : "muted");
      meta.append(
        `${withdrawn ? "withdrawn" : isLocked ? "🔒 LOCKED" : "matured, unclaimed"}  ·  `
        + `opens ${new Date(unlockAt * 1000).toISOString()}  ·  ${leftDays.toFixed(1)} days left`
        + (blocksLeft > 0n ? `  ·  block gate: ${blocksLeft} blocks` : "  ·  time gate only")
        + `  ·  beneficiary ${beneficiary.slice(0, 10)}…`);
      row.append(meta);
      box.append(row);
    }
  } catch (e) {
    $("s-read").textContent = `read failed: ${e.message} — the chain is the source; reload to try again`;
  }
}

function mountStatic() {
  $("c-locker").replaceChildren(link(`${EXPLORER}/address/${LOCKER}#code`, LOCKER));
  $("c-pair").replaceChildren(link(`${EXPLORER}/address/${PAIR}`, PAIR));
  $("c-luv").replaceChildren(link(`${EXPLORER}/token/${LUV}`, LUV));
  const trail = $("trail");
  for (const t of TRAIL) {
    const row = el("div", "row");
    row.append(el("div", "sig", t.label));
    const meta = el("div", "ok");
    meta.append(`block ${t.block} · `);
    meta.append(link(`${EXPLORER}/tx/${t.hash}`, t.hash.slice(0, 22) + "… ↗"));
    row.append(meta);
    trail.append(row);
  }
}

mountStatic();
refresh();
setInterval(refresh, 60_000);
