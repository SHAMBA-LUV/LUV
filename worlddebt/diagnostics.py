#!/usr/bin/env python3
"""
diagnostics.py — check the chart's world-debt model against the fetched data and against itself.

The overlay in substrate/luv-rainbow.js is a declared anchor plus a compounding rate. Neither is
self-evident, so this re-derives both from data/worlddebt.json and from the organ's own source,
and fails loudly when they disagree.

    python worlddebt/fetch_worlddebt.py     # refresh the data first
    python worlddebt/diagnostics.py
"""

import datetime as dt
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data", "worlddebt.json")
ORGAN = os.path.join(HERE, "..", "substrate", "luv-rainbow.js")
YEAR_S = 365.2425 * 86400

checks, failures = [], []


def check(name, ok, detail=""):
    checks.append((name, ok, detail))
    if not ok:
        failures.append(name)
    print(f"  {'PASS' if ok else 'FAIL'}  {name}" + (f"   {detail}" if detail else ""))


def organ_constants():
    """Read the anchor and rate out of the renderer, so the docs cannot drift from the code."""
    src = open(ORGAN).read()
    anchor_ms = re.search(r"DEBT_ANCHOR_MS = Date\.UTC\((\d+),\s*(\d+),\s*(\d+)\)", src)
    anchor_usd = re.search(r"DEBT_ANCHOR_USD = ([\d.e+]+)", src)
    cagr = re.search(r"DEBT_CAGR = Math\.pow\((\d+) / (\d+), 1 / (\d+)\) - 1", src)
    table = re.search(r"var WORLD_DEBT = (\[\[.*?\]\]);", src, re.S)
    y, m, d = (int(g) for g in anchor_ms.groups())
    a, b, n = (int(g) for g in cagr.groups())
    return {
        "anchor_date": dt.date(y, m + 1, d),           # JS months are 0-based
        "anchor_usd": float(anchor_usd.group(1)),
        "cagr": (a / b) ** (1 / n) - 1,
        "table": json.loads(table.group(1).replace("], [", "],[")),
    }


def debt_at(o, when):
    """The organ's own function, re-implemented — if these diverge the test is worthless."""
    anchor = dt.datetime.combine(o["anchor_date"], dt.time()).replace(tzinfo=dt.timezone.utc)
    secs = (when - anchor).total_seconds()
    if secs >= 0:
        return o["anchor_usd"] * (1 + o["cagr"]) ** (secs / YEAR_S)
    y = when.year + (when.timetuple().tm_yday - 1) / 365.2425
    tbl = o["table"]
    if y <= tbl[0][0]:
        return tbl[0][1] * 1e12
    for i in range(len(tbl) - 1):
        (ya, va), (yb, vb) = tbl[i], tbl[i + 1]
        if ya <= y <= yb:
            return (va + (vb - va) * (y - ya) / (yb - ya)) * 1e12
    return o["anchor_usd"]


def main():
    if not os.path.exists(DATA):
        print("no data/worlddebt.json — run worlddebt/fetch_worlddebt.py first", file=sys.stderr)
        return 2
    data = json.load(open(DATA))
    gov = {int(k): v for k, v in data.get("government_debt_usd", {}).items()}
    o = organ_constants()
    now = dt.datetime.now(dt.timezone.utc)

    print(f"\nworld-debt diagnostics   {now.isoformat(timespec='seconds')}\n")
    print(f"  anchor      ${o['anchor_usd']/1e12:.0f}T on {o['anchor_date']}")
    print(f"  rate        {o['cagr']*100:.2f}%/yr compounded continuously")
    print(f"  now         ${debt_at(o, now)/1e12:.2f}T")
    print(f"  growth      ${(debt_at(o, now + dt.timedelta(seconds=1)) - debt_at(o, now))/1e3:,.0f}k per second\n")

    # 1. the declared headline must be a sane multiple of derived government debt
    if gov:
        latest_year = max(y for y in gov if y <= o["anchor_date"].year)
        ratio = o["anchor_usd"] / gov[latest_year]
        check("headline is 2-4x derived government debt", 2.0 <= ratio <= 4.0,
              f"{ratio:.2f}x  (govt ${gov[latest_year]/1e12:.1f}T in {latest_year})")
    else:
        check("derived government debt available", False, "no government_debt_usd in the data")

    # 2. compounding must be monotone and continuous
    pts = [debt_at(o, now + dt.timedelta(days=k)) for k in (0, 1, 30, 365, 3650)]
    check("debt is monotone forward", all(a < b for a, b in zip(pts, pts[1:])))
    one_year = debt_at(o, now + dt.timedelta(seconds=YEAR_S)) / debt_at(o, now)
    check("one year of growth equals the stated CAGR", abs(one_year - (1 + o["cagr"])) < 1e-9,
          f"{(one_year-1)*100:.4f}% vs {o['cagr']*100:.4f}%")

    # 3. the anchor must agree with the historical table it continues
    tail = o["table"][-1]
    drift = abs(debt_at(o, dt.datetime(tail[0], 1, 1, tzinfo=dt.timezone.utc)) - tail[1] * 1e12)
    check("anchor continues the historical table", drift / (tail[1] * 1e12) < 0.05,
          f"{drift/1e12:.1f}T apart at {tail[0]}")

    # 4. the derived series must rise faster than GDP — the reason the line climbs at all
    if gov and 2010 in gov:
        latest_year = max(gov)
        gdp = {int(k): v for k, v in data.get("imf_world_gdp_usd", {}).items()}
        r0, r1 = gov[2010] / gdp[2010], gov[latest_year] / gdp[latest_year]
        check("government debt outgrows world GDP", r1 > r0,
              f"{r0*100:.1f}% of GDP in 2010 -> {r1*100:.1f}% in {latest_year}")

    # 5. recompute the Bitcoin crossing from scratch
    S, I = 5.380917, -15.403007
    genesis = dt.datetime(2009, 1, 3, tzinfo=dt.timezone.utc)
    cross = None
    for year in range(2026, 2141):
        when = dt.datetime(year, 1, 1, tzinfo=dt.timezone.utc)
        days = (when - genesis).total_seconds() / 86400
        btc_cap = 10 ** (S * (days and __import__("math").log10(days)) + I) * 21e6
        if btc_cap >= debt_at(o, when):
            cross = year
            break
    check("Bitcoin market cap overtakes world debt within the drawn window",
          cross is not None and cross <= 2140, f"crossing {cross}")

    print(f"\n  {len(checks)-len(failures)}/{len(checks)} checks passed")
    if failures:
        print("  failing: " + ", ".join(failures))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
