#!/usr/bin/env python3
"""
fetch_worlddebt.py — pull the world-debt inputs from keyless public sources.

Writes data/worlddebt.json. Two independent series, kept apart on purpose because they measure
different things (see ANALYSIS.md):

  * IMF DataMapper  GGXWDG_NGDP / WEOWORLD — general government gross debt, % of world GDP,
    including the WEO forecast years.
  * World Bank      NY.GDP.MKTP.CD / WLD  — world GDP in current USD.

Government debt in USD is the product of the two. That is NOT the $345T headline: that figure is
the IIF's, and it counts households, non-financial corporates, government AND the financial sector.
This script fetches what is publicly retrievable without a key and records the IIF figure as a
declared anchor rather than pretending to derive it.

    python worlddebt/fetch_worlddebt.py            # refresh data/worlddebt.json
    python worlddebt/fetch_worlddebt.py --print    # and print a summary
"""

import argparse
import json
import os
import subprocess
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "data", "worlddebt.json")

IMF_DEBT = "https://www.imf.org/external/datamapper/api/v1/GGXWDG_NGDP/WEOWORLD"
IMF_GDP = "https://www.imf.org/external/datamapper/api/v1/NGDPD/WEOWORLD"
WB_GDP = ("https://api.worldbank.org/v2/country/WLD/indicator/NY.GDP.MKTP.CD"
          "?format=json&per_page=200")

# The IIF Global Debt Monitor headline, as stated on the chart. Declared, not derived: the IIF
# series is not published under a keyless API. Anyone re-deriving it should replace this.
IIF_ANCHOR = {
    "date": "2026-08-09",
    "usd": 345e12,
    "source": "IIF Global Debt Monitor (headline aggregate, operator-stated)",
    "covers": ["household", "non-financial corporate", "government", "financial sector"],
    "note": "rounded to the trillion; not derived by this script",
}


def get(url, timeout=30):
    # The IMF DataMapper 403s a bare urllib User-Agent while answering curl fine, so send the
    # headers a normal client would. Nothing here is authenticated — these are public endpoints.
    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                      "(KHTML, like Gecko) Chrome/125.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
    })
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.load(r)
    except Exception:
        # The IMF endpoint answers curl and refuses urllib regardless of headers — it appears to
        # filter on the TLS client, not the request. Falling back to curl keeps the fetch keyless
        # and reproducible rather than dropping the series.
        out = subprocess.run(["curl", "-sS", "--max-time", str(timeout), url],
                             capture_output=True, text=True, check=True)
        return json.loads(out.stdout)


def imf_world(url, indicator):
    return {int(y): v for y, v in get(url)["values"][indicator]["WEOWORLD"].items()
            if v is not None}


def worldbank_world_gdp():
    rows = get(WB_GDP)[1]
    return {int(r["date"]): float(r["value"]) for r in rows if r.get("value") is not None}


def main(show=False):
    out = {"generated_from": "keyless public APIs", "sources": {
        "imf_government_debt_pct_gdp": IMF_DEBT,
        "imf_world_gdp_usd_bn": IMF_GDP,
        "worldbank_world_gdp_usd": WB_GDP,
    }, "iif_anchor": IIF_ANCHOR}

    errors = {}
    try:
        out["government_debt_pct_gdp"] = imf_world(IMF_DEBT, "GGXWDG_NGDP")
    except Exception as exc:
        errors["imf_debt"] = str(exc)
    try:
        # IMF reports GDP in billions of USD
        out["imf_world_gdp_usd"] = {y: v * 1e9 for y, v in imf_world(IMF_GDP, "NGDPD").items()}
    except Exception as exc:
        errors["imf_gdp"] = str(exc)
    try:
        out["worldbank_world_gdp_usd"] = worldbank_world_gdp()
    except Exception as exc:
        errors["worldbank"] = str(exc)

    # government debt in USD, where both halves exist
    debt = out.get("government_debt_pct_gdp", {})
    gdp = out.get("imf_world_gdp_usd", {})
    out["government_debt_usd"] = {y: debt[y] / 100.0 * gdp[y]
                                  for y in sorted(set(debt) & set(gdp))}
    if errors:
        out["errors"] = errors

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(out, f, indent=1, sort_keys=True)
    print(f"wrote {OUT}")

    if show:
        g = out["government_debt_usd"]
        print("\n  year   world GDP        govt debt %GDP    govt debt USD")
        for y in sorted(g):
            if y % 5 == 0 or y >= 2024:
                print(f"  {y}   ${gdp[y]/1e12:8.1f}T        {debt[y]:6.1f}%        ${g[y]/1e12:8.1f}T")
        print(f"\n  IIF headline anchor: ${IIF_ANCHOR['usd']/1e12:.0f}T on {IIF_ANCHOR['date']}"
              f"  ({'+'.join(IIF_ANCHOR['covers'])})")
    if errors:
        print("\nWARNING: some sources failed:", errors, file=sys.stderr)
    return out


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--print", dest="show", action="store_true")
    main(show=p.parse_args().show)
