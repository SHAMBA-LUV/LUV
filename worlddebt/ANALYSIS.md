# World debt — what the number is, and what it is not

The rainbow chart's overlay measures Bitcoin's market cap against **total world debt**. That phrase
hides a choice, and the choice is worth a page, because the same words name figures that differ by
nearly a factor of three.

## Three different "world debts"

| measure | what it counts | latest | source |
|---|---|---|---|
| **Government debt** | general government gross debt, all countries | **$120.4T** (2026) | IMF, derived here |
| Government + private non-financial | adds households and non-financial corporates | ~$250T | IMF Global Debt Database |
| **IIF headline** | adds the financial sector | **$345T** | IIF Global Debt Monitor |

The chart uses the **$345T** figure, because that is what "total world debt" means in the headlines
it is being read against. It is the largest of the three, and it is the one that double-counts most
freely: a bank's borrowing and the loan it funds both appear.

## What this folder derives, and what it declares

`fetch_worlddebt.py` pulls two keyless public series:

* **IMF DataMapper** `GGXWDG_NGDP` / `WEOWORLD` — general government gross debt as % of world GDP,
  including WEO forecast years out to 2031.
* **World Bank** `NY.GDP.MKTP.CD` / `WLD` and **IMF** `NGDPD` — world GDP in current USD.

Their product is government debt in USD, and that part is genuinely derived — you can re-run it and
get the same numbers:

```
  year   world GDP    govt debt %GDP   govt debt USD
  2010     $67.1T          74.1%          $49.7T
  2015     $75.9T          77.8%          $59.1T
  2020     $86.2T          97.4%          $84.0T
  2024    $111.6T          92.0%         $102.7T
  2026    $126.3T          95.3%         $120.4T
  2030    $151.4T         101.2%         $153.2T   (IMF forecast)
```

The **$345T is declared, not derived**. The IIF does not publish its series under a keyless API, so
it is recorded in `data/worlddebt.json` as an anchor with its date, its coverage and a note saying
exactly that. Anyone who can re-derive it should replace the anchor rather than trust it.

That distinction is the whole point of keeping this in a folder: the chart draws one line, and a
reader deserves to know which parts of it are arithmetic and which part is a citation.

## Two things the derived series shows

**Government debt is growing faster than the economy carrying it.** In 2010 it was 74.1% of world
GDP; by 2026 it is 95.3%, and the IMF's own forecast crosses 100% in 2029. The debt line on the
chart is not rising because debt grows — it is rising because debt grows *faster than output*.

**The growth rate the chart uses is measured, not assumed.** The overlay compounds forward at
**3.15%/yr**, the 2010→2026 CAGR of the IIF headline ($210T → $345T). Against the derived
government series over the same window the rate is higher — about 5.7%/yr — so 3.15% is the
*conservative* choice of the two. Using the faster rate would push Bitcoin's crossing later, not
earlier.

## The anchor is dated, not annual

`worldDebtAt()` in `substrate/luv-rainbow.js` anchors $345T to **2026-08-09** and compounds
continuously from that instant, so "now" is this moment rather than the start of some year. At
3.15%/yr the aggregate grows roughly **$339,000 per second** — about $10.9T a year — which is
enough drift that an anchor pinned to a calendar year reads visibly wrong within months.

## Diagnostics

`diagnostics.py` checks the chart's model against the fetched data and against itself:

* the declared IIF anchor sits in a sane ratio to derived government debt
* the compounding is continuous and monotone, and matches the stated CAGR
* the historical anchor table in the organ does not contradict the derived series' *shape*
* the Bitcoin/debt crossing year is recomputed from scratch

```
python worlddebt/diagnostics.py
```

## Honest limits

* The IIF headline is a rounded press figure. Treating it as precise to the trillion is already
  generous; the chart labels it "approximate" for that reason.
* Compounding any aggregate for a century is not a forecast. The overlay exists to give Bitcoin's
  trajectory something real-sized to be measured against — not to predict either line.
* Debt and market cap are not the same kind of quantity. One is an obligation stock, the other a
  price times a supply. Drawing them on one axis compares *magnitudes*, and nothing more.
