# luv.pythai.net — the second site

Shiny on the outside, an engineered timepiece on the inside. Four pages, one proof page, and the machine files.

| page | job |
|---|---|
| `index.html` | sells SHAMBA LUV: the dial, the Uniswap button, the price line, six jewels that open to depth |
| `faq.html` | every answer ends at a GitHub document or an Ethereum transaction; the full repo directory; the open list |
| `chart.html` | the price, drawn from luv.oracle's minute series, and the arithmetic behind it |
| `roadmap.html` | five phases; the ledger of everything shipped with its transaction; what is next |
| `liqlock.html` + `liqlock.js` | the liquidity-lock proof page, carried over verbatim |

Shared: `site.css`, `site.js` (the 1 Hz second hand, the price line from `market.json`, nav state, depth meter), `chart.js` (zero-dep SVG chart).
Machine: `luv.live.json`, `llms.txt`/`llm.txt`, `robots.txt`, `sitemap.xml`, `404.html`. `market*.json` are runtime files written by the collector on the VPS and are git-ignored here (local snapshots are kept for review).

Constraints honoured: the live CSP (`script-src 'self'`, no inline JS, `connect-src 'self' + publicnode`), no external fonts or CDNs, reduced-motion respected, every asset versioned (`?v=N`, bump on change).

Review locally: `python3 -m http.server 8792` in this directory.

## Campaign compatibility (incentivedistributor2, sharing is caring)
- `app.html` = the first site's dashboard carried over verbatim (sign-in, LUVdrip, earn panel) with `luv.app.js` and its substrates; `consent.html`/`authorize.html` (+ `.js`) are the OAuth entry flow the backend redirects to. **At go-live set `FRONTEND_SUCCESS_URL=https://luv.pythai.net/app.html`** in luv.env (it is `/` today) so sign-in lands on the dashboard, not the landing.
- `/#ledger` (linked from the incentivedistributor2 docs and dapp config) resolves on the landing; `/#share` is the share rail (𝕏 intent, Telegram, copy link, sign in to earn).
- `luvbus.html`, `lock.html`, `contractaudit.html` (operator consoles) are carried over unchanged.
- Old URLs: every first-site page has a meta-refresh stub pointing at its successor (papers go to their canonical GitHub markdown); `_deploy/redirects.conf` holds the matching Apache 301 map, include it from the vhost for proper SEO redirects.

## The chart's data sources
Mirrors first (`market.json`, `market-history.json`, `market-trades.json`, written by the collector on the VPS). Always in addition: the pair's reserves and the USDC/WETH reserves read live from Ethereum (publicnode) for the newest point. When the mirrors are unreachable (a `file://` open, or the collector down): the pair's Swap log from Blockscout's index. ETH/USD through time comes from Binance hourly klines (DeFiLlama fallback) so LUV's dollar price moves with ETH between LUV trades. **The live vhost CSP must allow those hosts: see `_deploy/csp.txt`.**

## SEO
Every indexable page carries: title, description, canonical, keywords, robots (max-image-preview:large), theme-color, full Open Graph (type, site_name, locale, url, title, description, image 1200×630 with type/size/alt) and Twitter card tags, `rel=me` to @shambaluv, and JSON-LD (`Organization` + `WebSite` on the landing, `FAQPage` with all 26 questions on the FAQ, `Dataset` for the price series on the chart, `BreadcrumbList` everywhere). `sitemap.xml` carries lastmod + image entries; `app.html` and redirect stubs are `noindex`. liqlock.html wears the DeltaVerse `$` favicon (`gfx/dollar.ico`).
