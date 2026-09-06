/*!
 * SHAMBA LUV — luvchart.js: the price chart, TradingView-style, zero dependencies.
 * Data (same origin, CSP connect-src 'self'): market.json (the live measurement),
 * market-history.json (minute samples [t, priceUsd, priceNative], 48 h),
 * market-trades.json (every swap on the pair since the seed). Trades and samples are
 * fused into one tape; candles are built from the tape at the chosen interval.
 * Units re-express ONE price: 1T LUV/USDC · WEI/LUV · luvwei/wei · luvwei/USDC · LUV/ETH.
 * Indicators read the canonical USD close, never the unit (momentum belongs to the asset).
 * Canvas, DPR-aware, wheel zoom, drag pan, crosshair with axis tags, persisted choices.
 */
(function () {
  "use strict";
  var root = document.getElementById("luvchart"); if (!root) return;
  var SEED_NATIVE = 1e-17, SEED_WETH = 0.051922968585348276;
  // the chain path — the pair is the source; mirrors are enrichment (CSP on the live vhost allows publicnode)
  var RPC = "https://ethereum-rpc.publicnode.com", PAIR = "0x57D2085Aa859a145cB107845AD03c0eAAFBD8a31", LUV = "0x2711111111683B8708cb9a48cBf36a51315F8254";
  var USDC_WETH = "0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc", DEAD = "0x000000000000000000000000000000000000dEaD", PAIR_BLOCK = 25620950;
  var SWAP_TOPIC = "0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822";
  var BLOCKSCOUT = "https://eth.blockscout.com/api/v2/addresses/" + PAIR + "/logs";
  var SUPPLY = 111111111111111111;
  function rpc(calls) { return fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(calls.map(function (c, i) { return { jsonrpc: "2.0", id: i + 1, method: c[0], params: c[1] }; })) }).then(function (r) { return r.json(); }).then(function (rs) { return rs.sort(function (a, b) { return a.id - b.id; }).map(function (r) { if (r.error) throw new Error(r.error.message); return r.result; }); }); }
  function words(hex) { var h = hex.replace(/^0x/, ""), o = []; for (var i = 0; i + 64 <= h.length; i += 64) o.push(BigInt("0x" + h.slice(i, i + 64))); return o; }
  function toNum(bi, dec) { return Number(bi) / Math.pow(10, dec); }
  var source = { mirror: false, chain: false, block: null }, buyFactor = 1.003;   // buy quote ÷ mid for 1T, refreshed from the reserves
  // reserves NOW, straight from the pair: price, ETH/USD from the USDC/WETH pair, burned + supply from the token
  function readPair() {
    var sel = "0x0902f1ac", bal = "0x70a08231" + DEAD.slice(2).toLowerCase().padStart(64, "0");
    return rpc([["eth_call", [{ to: PAIR, data: sel }, "latest"]], ["eth_call", [{ to: USDC_WETH, data: sel }, "latest"]], ["eth_call", [{ to: LUV, data: bal }, "latest"]], ["eth_blockNumber", []], ["eth_call", [{ to: "0xA478c2975Ab1Ea89e8196811F51A7B7Ade33eB11", data: sel }, "latest"]], ["eth_call", [{ to: "0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640", data: "0x3850c7bd" }, "latest"]]]).then(function (r) {
      var a = words(r[0]), b = words(r[1]), burned = toNum(words(r[2])[0], 18), block = parseInt(r[3], 16), c = words(r[4]);
      var luv = toNum(a[0], 18), weth = toNum(a[1], 18);
      // ETH/USD = median of V2 USDC/WETH, V2 DAI/WETH and the V3 USDC/WETH 0.05% pool (moves every block)
      var e1 = toNum(b[0], 6) / toNum(b[1], 18), e2 = toNum(c[0], 18) / toNum(c[1], 18), sq = Number(BigInt("0x" + r[5].slice(2, 66))) / Math.pow(2, 96), e3 = 1e12 / (sq * sq);
      var es = [e1, e2, e3].filter(function (x) { return isFinite(x) && x > 0; }).sort(function (x, y) { return x - y; }), med = es[Math.floor(es.length / 2)], ethUsd = (isFinite(e3) && e3 > 0 && Math.abs(e3 / med - 1) < 0.02) ? e3 : med; // the V3 pool leads (it moves every block); the V2 pairs bound it
      var nat = weth / luv, usd = nat * ethUsd;
      var T = 1e12, buyEth = (weth * T * 1000) / ((luv - T) * 997), sellEth = (weth * T * 997) / (luv * 1000 + T * 997);
      var quotes = { amountLuv: T, buy1T: { eth: buyEth, usd: buyEth * ethUsd }, sell1T: { eth: sellEth, usd: sellEth * ethUsd }, mid1T: { eth: nat * T, usd: usd * T }, poolFeeBps: 30 };
      buyFactor = buyEth / (nat * T);
      return { t: Date.now(), pair: PAIR, source: "reserves", quotes: quotes, priceUsd: usd, priceNative: nat, oneTrillionUsd: usd * 1e12, ethUsd: ethUsd, liquidity: { usd: weth * ethUsd * 2, base: luv, quote: weth }, reserves: { luv: luv, weth: weth }, totalSupply: SUPPLY, burned: burned, marketCap: usd * (SUPPLY - burned), fdv: usd * SUPPLY, priceX: nat / SEED_NATIVE, liqX: weth / SEED_WETH, priceChange: { h24: 0 }, txns: { h24: { buys: 0, sells: 0 } }, chronos: { block_number: block, observed_ms: Date.now() }, pairCreatedAt: 1785116795000 };
    });
  }
  // the pair's own Swap events from the Blockscout log index (CORS open, paginated 50 at a time)
  function readSwaps(ethUsd) {
    var out = [];
    function page(params) {
      var url = BLOCKSCOUT + (params ? "?" + Object.keys(params).map(function (k) { return k + "=" + encodeURIComponent(params[k]); }).join("&") : "");
      return fetch(url).then(function (r) { return r.json(); }).then(function (d) {
        (d.items || []).forEach(function (l) {
          if (!l.topics || l.topics[0] !== SWAP_TOPIC) return;
          var w = words(l.data); if (w.length < 4) return;
          var a0in = toNum(w[0], 18), a1in = toNum(w[1], 18), a0out = toNum(w[2], 18), a1out = toNum(w[3], 18);
          var buy = a0out > 0, luv = buy ? a0out : a0in, weth = buy ? a1in : a1out; if (!(luv > 0 && weth > 0)) return;
          var t = Date.parse(l.block_timestamp), to = (l.topics[2] || "").slice(-40);
          out.push([t, Number(l.block_number), buy ? "b" : "s", luv, weth, weth * ethUsd, weth / luv, "0x" + to, l.transaction_hash, Number(l.index)]);
        });
        if (d.next_page_params && out.length < 5000) return page(d.next_page_params);
      });
    }
    return page(null).then(function () { out.sort(function (x, y) { return x[0] - y[0]; }); return out; });
  }
  // ETH/USD through time — the pair prices LUV in ETH, so LUV's dollar price moves whenever ETH moves,
  // trade or no trade. Hourly closes from Binance (paged), DeFiLlama as the fallback, the live USDC/WETH
  // pair reserves as the newest point. ethAt(t) carries the last known value forward.
  var ethSeries = [];
  function readEth(fromMs) {
    var out = [], fineFrom = Date.now() - 48 * 3600e3;
    function pageFine(start) {
      return fetch("https://api.binance.com/api/v3/klines?symbol=ETHUSDT&interval=1m&limit=1000&startTime=" + start).then(function (r) { return r.json(); }).then(function (rows) {
        if (!Array.isArray(rows) || !rows.length) return;
        rows.forEach(function (k) { out.push([Number(k[0]) + 59e3, Number(k[4])]); });
        if (rows.length === 1000 && out.length < 40000) return pageFine(Number(rows[rows.length - 1][0]) + 1);
      });
    }
    function page(start) {
      return fetch("https://api.binance.com/api/v3/klines?symbol=ETHUSDT&interval=1h&limit=1000&startTime=" + start + "&endTime=" + fineFrom).then(function (r) { return r.json(); }).then(function (rows) {
        if (!Array.isArray(rows) || !rows.length) return;
        rows.forEach(function (k) { var t0 = Number(k[0]), o = Number(k[1]), h = Number(k[2]), l = Number(k[3]), c = Number(k[4]); out.push([t0 + 1, o]); if (c >= o) { out.push([t0 + 1200e3, l]); out.push([t0 + 2400e3, h]); } else { out.push([t0 + 1200e3, h]); out.push([t0 + 2400e3, l]); } out.push([t0 + 3599e3, c]); });
        if (rows.length === 1000 && out.length < 20000) return page(Number(rows[rows.length - 1][0]) + 1);
      });
    }
    return page(fromMs).then(function () { return pageFine(fineFrom); }).then(function () { if (!out.length) throw new Error("no binance"); return out; }).catch(function () {
      return fetch("https://coins.llama.fi/chart/coingecko:ethereum?start=" + Math.floor(fromMs / 1000) + "&span=500&period=2h").then(function (r) { return r.json(); }).then(function (d) { var c = d.coins && d.coins["coingecko:ethereum"]; return c ? c.prices.map(function (x) { return [x.timestamp * 1000, x.price]; }) : []; }).catch(function () { return []; });
    });
  }
  function ethAt(t) { var a = ethSeries; if (!a.length) return null; if (t <= a[0][0]) return a[0][1]; var lo = 0, hi = a.length - 1; while (lo < hi) { var m = (lo + hi + 1) >> 1; if (a[m][0] <= t) lo = m; else hi = m - 1; } return a[lo][1]; }
  function announce(m, pts) {
    try { document.dispatchEvent(new CustomEvent("luv:market", { detail: m })); } catch (e) {}
    var dial = document.querySelector("[data-emotonomic]"); if (dial && dial.__emoto) { try { dial.__emoto.compute(m, pts); dial.__emoto.render(); } catch (e) {} }
    var el = document.getElementById("luvsrc"); if (el) el.textContent = (source.mirror ? "history: luv.oracle's same-origin mirror of the pair" : "history: the pair's own Swap log, read from the Blockscout index") + (source.chain ? " · live price: the pair's reserves, read from Ethereum at block " + (source.block ? source.block.toLocaleString() : "…") : " · live price: the mirror") + " · ETH/USD through time: hourly closes (Binance, DeFiLlama fallback) so LUV's dollar price moves with ETH between trades · every number traces to the pair " + PAIR.slice(0, 6) + "…" + PAIR.slice(-4);
  }
  var C = { bg: "#150d22", grid: "rgba(247,242,249,.07)", ink: "#f7f2f9", muted: "#9b8bb0", gold: "#e3b25f", gold2: "#f5d689",
            up: "#0ecb81", dn: "#ff4d6d", pink: "#ff006e", purple: "#8338ec", cross: "rgba(247,242,249,.45)", tag: "#f7f2f9" };
  var MONO = "12px ui-monospace,SF Mono,Menlo,Consolas,monospace";
  var RIBBON = [{ p: 8, col: "#ffb3c1" }, { p: 13, col: "#ff4d6d" }, { p: 21, col: "#ff006e" }, { p: 34, col: "#b23bd6" }, { p: 55, col: "#8338ec" }];
  var FIBS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

  // ── units: one price, five expressions ──
  function sci(v, d) { return Number(v).toExponential(d); }
  function grp(n, d) { var s = Number(n).toFixed(d), p = s.split("."); return p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (p[1] ? "." + p[1] : ""); }
  var UNITS = {
    t1usdc:   { label: "1T LUV / USDC · buy", hint: "the Uniswap buy quote for one trillion LUV, in USDC (pool fee and the trade's own impact included, the way the router quotes it)", val: function (s) { return s.usd * 1e12 * buyFactor; }, fmt: function (v) { return "$" + (v >= 1 ? v.toFixed(4) : v.toFixed(6)); }, axis: function (v, d) { return "$" + v.toFixed(d); } },
    weiluv:   { label: "WEI / LUV", hint: "wei per ONE LUV", val: function (s) { return s.nat * 1e18; }, fmt: function (v) { return grp(v, 4) + " wei"; }, axis: function (v, d) { return v.toFixed(d); } },
    lwwei:    { label: "luvwei / wei", hint: "wei per ONE luvwei (10⁻¹⁸ LUV) — numerically ETH per LUV", val: function (s) { return s.nat; }, fmt: function (v) { return sci(v, 6) + " wei"; }, axis: function (v, d) { return sci(v, Math.min(d, 4)); } },
    lwusdc:   { label: "luvwei / USDC", hint: "USDC per ONE luvwei — the price at the bottom of the lattice", val: function (s) { return s.usd / 1e18; }, fmt: function (v) { return sci(v, 6) + " USDC"; }, axis: function (v, d) { return sci(v, Math.min(d, 4)); } },
    luveth:   { label: "LUV / ETH", hint: "LUV per ONE ETH, in trillions — the inverse measure", val: function (s) { return s.nat > 0 ? 1 / s.nat : NaN; }, fmt: function (v) { return grp(v / 1e12, 4) + "T LUV"; }, axis: function (v, d) { return (v / 1e12).toFixed(d) + "T"; } }
  };
  var UNIT_ORDER = ["t1usdc", "weiluv", "lwwei", "lwusdc", "luveth"];
  var RANGES = [["24H", 86400e3, 300e3], ["7D", 7 * 86400e3, 3600e3], ["30D", 30 * 86400e3, 4 * 3600e3], ["ALL", Infinity, 86400e3]];
  var INTERVALS = [["1m", 60e3], ["5m", 300e3], ["15m", 900e3], ["1h", 3600e3], ["4h", 14400e3], ["1D", 86400e3]];
  var INDICATORS = [["ribbon", "EMA ribbon"], ["bb", "Bollinger"], ["fib", "Fib"], ["vol", "Volume"], ["rsi", "RSI"], ["macd", "MACD"], ["pressure", "Pressure"], ["reflect", "Reflections"], ["x", "× from launch"]];

  // ── state ──
  var S = { log: false, unit: "t1usdc", range: 7 * 86400e3, interval: 3600e3, ind: { ribbon: false, bb: false, fib: false, vol: true, rsi: false, macd: false, pressure: false, reflect: false, x: false }, type: "candles" };
  try { var saved = JSON.parse(localStorage.getItem("luvchart-v4") || "null"); if (saved) { if (UNITS[saved.unit]) S.unit = saved.unit; if (saved.interval) S.interval = saved.interval; if (saved.ind) for (var k in saved.ind) if (k in S.ind) S.ind[k] = !!saved.ind[k]; if (saved.type) S.type = saved.type; S.log = !!saved.log; if (saved.range) S.range = saved.range === "inf" ? Infinity : saved.range; } } catch (e) {}
  function save() { try { localStorage.setItem("luvchart-v4", JSON.stringify({ unit: S.unit, interval: S.interval, ind: S.ind, type: S.type, log: S.log, range: S.range === Infinity ? "inf" : S.range })); } catch (e) {} }

  var market = null, tape = [], bars = [], view = { start: 0, count: 120 }, hover = null, dragging = null, firstLoad = true, liveAt = 0;
  // keep the reader's zoom/pan across refreshes: a view pinned to the right edge stays pinned, any other view stays put
  function keepView(prevLen) { var atEdge = view.start + view.count >= prevLen - 1; if (atEdge) view.start = Math.max(0, bars.length - view.count); else view.start = Math.min(view.start, Math.max(0, bars.length - view.count)); }

  // ── data: fuse trades + minute samples into one tape ──
  function load() {
    var m0 = null, hist = null, tr = null;
    var mirrors = Promise.all([
      fetch("market.json", { cache: "no-cache" }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
      fetch("market-history.json", { cache: "no-cache" }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
      fetch("market-trades.json", { cache: "no-cache" }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
    ]).then(function (rs) { m0 = rs[0]; hist = rs[1]; tr = rs[2]; source.mirror = !!(hist && hist.points && hist.points.length); });
    var live = readPair().then(function (m) { source.chain = true; source.block = m.chronos.block_number; return m; }).catch(function () { return null; });
    var eth = readEth(1785116795000).then(function (e) { ethSeries = e.sort(function (a, b) { return a[0] - b[0]; }); }).catch(function () {});
    return Promise.all([mirrors, live, eth]).then(function (r) {
      var liveM = r[1];
      if (m0) market = m0; else if (liveM) market = liveM;
      if (liveM && market !== liveM) { market.quotes = liveM.quotes; market.priceUsd = liveM.priceUsd; market.priceNative = liveM.priceNative; market.oneTrillionUsd = liveM.oneTrillionUsd; market.reserves = liveM.reserves; market.liquidity = liveM.liquidity; market.ethUsd = liveM.ethUsd; market.marketCap = liveM.marketCap; market.priceX = liveM.priceX; market.liqX = liveM.liqX; market.chronos = liveM.chronos; market.t = liveM.t; market.burned = liveM.burned; }
      if (!market) throw new Error("no source");
      var ethUsd = Number(market.ethUsd) || 0;
      if (ethUsd > 0) ethSeries.push([Date.now(), ethUsd]);
      var trades = tr && tr.trades ? Promise.resolve(tr.trades) : readSwaps(ethUsd).catch(function () { return []; });
      return trades.then(function (rows) {
        var t = [];
        rows.forEach(function (r) { var nat = Number(r[6]), luv = Number(r[3]), weth = Number(r[4]), e = ethAt(r[0]) || ethUsd, usd = weth * e; var pu = e > 0 ? nat * e : (luv > 0 && usd > 0 ? usd / luv : NaN); if (nat > 0 && pu > 0) t.push({ t: r[0], usd: pu, nat: nat, vol: usd, buy: r[2] === "b", trade: true, maker: r[7] }); });
        if (hist && hist.points) hist.points.forEach(function (p) { if (p[1] > 0 && p[2] > 0) { var e = ethAt(p[0]); t.push({ t: p[0], usd: e ? Number(p[2]) * e : Number(p[1]), nat: Number(p[2]), vol: 0, buy: null, trade: false }); } });
        if (liveM) { t.push({ t: liveM.t, usd: liveM.priceUsd, nat: liveM.priceNative, vol: 0, buy: null, trade: false, live: true }); liveAt = liveM.t; }
        t.sort(function (a, b) { return a.t - b.t; });
        // ETH ticks: at every ETH/USD sample, LUV's dollar price = the last pair price × ETH then — the pair moves with ETH
        if (ethSeries.length && t.length) { var k = 0, lastNat = null, ticks = []; ethSeries.forEach(function (e) { while (k < t.length && t[k].t <= e[0]) { lastNat = t[k].nat; k++; } var near = (k > 0 && e[0] - t[k - 1].t < 30e3) || (k < t.length && t[k].t - e[0] < 30e3); if (lastNat && !near && e[0] > t[0].t) ticks.push({ t: e[0], usd: lastNat * e[1], nat: lastNat, vol: 0, buy: null, trade: false, ethTick: true }); }); t = t.concat(ticks).sort(function (a, b) { return a.t - b.t; }); }
        tape = t;
        // 24H change + txns from the tape when the mirror did not supply them
        if (!m0 && t.length) { var cut = Date.now() - 86400e3, first = null, buys = 0, sells = 0; t.forEach(function (x) { if (x.t >= cut) { if (first === null) first = x.usd; if (x.trade) { if (x.buy) buys++; else sells++; } } }); if (first === null) first = t[0].usd; market.priceChange = { h24: first > 0 ? (market.priceUsd / first - 1) * 100 : 0 }; market.txns = { h24: { buys: buys, sells: sells } }; }
        // no minute samples (the chain path): open wide enough to see the whole tape, not the silence since the last trade
        var prevLen = bars.length; build(); if (firstLoad) { fitView(); firstLoad = false; } else keepView(prevLen); draw(); paintLine();
        announce(market, t.filter(function (x) { return x.t >= Date.now() - 86400e3; }).map(function (x) { return [x.t, x.usd, x.nat]; }));
      });
    }).catch(function () { root.innerHTML = '<p style="padding:24px;color:#9b8bb0">The pair could not be read right now. The price is live on <a href="https://app.uniswap.org/explore/tokens/ethereum/0x2711111111683B8708cb9a48cBf36a51315F8254">Uniswap</a>.</p>'; });
  }

  function build() {
    var I = S.interval, U = UNITS[S.unit], by = {};
    tape.forEach(function (s) {
      var v = U.val(s); if (!isFinite(v) || v <= 0) return;
      var k = Math.floor(s.t / I) * I, b = by[k];
      if (!b) b = by[k] = { t: k, o: v, h: v, l: v, c: v, cu: s.usd, cn: s.nat, vol: 0, bvol: 0, svol: 0, n: 0, buys: 0, sells: 0, makers: {} };
      b.h = Math.max(b.h, v); b.l = Math.min(b.l, v); b.c = v; b.cu = s.usd; b.cn = s.nat; b.eth = s.nat > 0 ? s.usd / s.nat : null;
      if (s.trade) { b.vol += s.vol; b.n++; if (s.buy) { b.bvol += s.vol; b.buys++; } else { b.svol += s.vol; b.sells++; } b.makers[s.maker] = 1; }
    });
    var keys = Object.keys(by).map(Number).sort(function (a, b) { return a - b; });
    var out = [], prev = null, MAX = 4000;
    // fill the silence between samples with flat bars so time stays uniform (a hang between trades is level by design)
    keys.forEach(function (k) {
      var b = by[k];
      if (prev && k - prev.t > I) {
        var gaps = Math.min((k - prev.t) / I - 1, MAX);
        for (var g = 1; g <= gaps; g++) out.push({ t: prev.t + g * I, o: prev.c, h: prev.c, l: prev.c, c: prev.c, cu: prev.cu, cn: prev.cn, eth: prev.eth, vol: 0, bvol: 0, svol: 0, n: 0, buys: 0, sells: 0, flat: true, makers: {} });
      }
      out.push(b); prev = b;
    });
    if (out.length > MAX) out = out.slice(-MAX);
    out.forEach(function (b, i) { b.up = b.c >= b.o; b.i = i; });
    bars = out;
    // indicators on the canonical USD close (momentum is a property of the asset, not the unit)
    var cu = bars.map(function (b) { return b.cu; }), cv = bars.map(function (b) { return b.c; });
    S.rsi = rsiSeries(cu, 14); S.macd = macdSeries(cu);
    S.ribbon = RIBBON.map(function (r) { return emaSeries(cv, r.p); });
    S.bb = bollinger(cv, 20, 2);
  }
  function fitView() { var n; if (S.range === Infinity) n = bars.length; else { var cut = Date.now() - S.range, i0 = 0; while (i0 < bars.length && bars[i0].t < cut) i0++; n = bars.length - i0; } n = Math.max(20, Math.min(bars.length, n || bars.length)); view.count = n; view.start = Math.max(0, bars.length - n); }

  // ── indicator math ──
  function emaSeries(v, p) { var k = 2 / (p + 1), o = [], prev; v.forEach(function (x, i) { prev = i ? x * k + prev * (1 - k) : x; o.push(prev); }); return o; }
  function rsiSeries(v, p) { var o = new Array(v.length).fill(null), g = 0, l = 0; for (var i = 1; i < v.length; i++) { var d = v[i] - v[i - 1], up = d > 0 ? d : 0, dn = d < 0 ? -d : 0; if (i <= p) { g += up; l += dn; if (i === p) { g /= p; l /= p; o[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); } } else { g = (g * (p - 1) + up) / p; l = (l * (p - 1) + dn) / p; o[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); } } return o; }
  function macdSeries(v) { var e12 = emaSeries(v, 12), e26 = emaSeries(v, 26); var m = v.map(function (_, i) { return i >= 25 ? e12[i] - e26[i] : null; }); var valid = m.filter(function (x) { return x !== null; }); var sv = emaSeries(valid, 9); var sig = new Array(v.length).fill(null); for (var i = 0, j = 0; i < v.length; i++) if (m[i] !== null) { sig[i] = j >= 8 ? sv[j] : null; j++; } return { macd: m, signal: sig, hist: m.map(function (x, i) { return x !== null && sig[i] !== null ? x - sig[i] : null; }) }; }
  function bollinger(v, p, k) { var mid = [], up = [], lo = []; for (var i = 0; i < v.length; i++) { if (i < p - 1) { mid.push(null); up.push(null); lo.push(null); continue; } var s = 0; for (var j = i - p + 1; j <= i; j++) s += v[j]; var m = s / p, q = 0; for (j = i - p + 1; j <= i; j++) q += (v[j] - m) * (v[j] - m); var sd = Math.sqrt(q / p); mid.push(m); up.push(m + k * sd); lo.push(m - k * sd); } return { mid: mid, up: up, lo: lo }; }

  // ── canvas + layout ──
  var cv = document.createElement("canvas"); cv.style.cssText = "width:100%;display:block;cursor:crosshair;touch-action:none"; root.innerHTML = ""; root.appendChild(cv);
  var ctx = cv.getContext("2d"), DPR = 1, W = 0, H = 0;
  var PAD = { l: 8, r: 84, top: 8, axis: 26 };
  function plotWidth() { return Math.max(100, (root.clientWidth || 900) - PAD.l - PAD.r); }
  function panes() { var p = [{ id: "main", h: 340 }]; if (S.ind.vol) p.push({ id: "vol", h: 70 }); if (S.ind.reflect) p.push({ id: "reflect", h: 70 }); if (S.ind.rsi) p.push({ id: "rsi", h: 80 }); if (S.ind.macd) p.push({ id: "macd", h: 90 }); if (S.ind.pressure) p.push({ id: "pressure", h: 70 }); return p; }
  function layout() { DPR = window.devicePixelRatio || 1; W = root.clientWidth || 900; var ps = panes(), h = PAD.top + PAD.axis; ps.forEach(function (p) { h += p.h; }); H = h; cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR); cv.style.height = H + "px"; ctx.setTransform(DPR, 0, 0, DPR, 0, 0); }

  function niceTicks(lo, hi, n) { var span = hi - lo; if (!(span > 0)) return [lo]; var raw = span / n, mag = Math.pow(10, Math.floor(Math.log10(raw))), norm = raw / mag, step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag; var out = []; for (var v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(v); return out; }
  function logTicks(lo, hi) { var out = [], e0 = Math.floor(Math.log10(lo)), e1 = Math.ceil(Math.log10(hi)); for (var e = e0; e <= e1; e++) [1, 2, 5].forEach(function (m) { var v = m * Math.pow(10, e); if (v >= lo && v <= hi) out.push(v); }); if (out.length > 8) out = out.filter(function (v) { return /^1/.test(v.toExponential(0)); }); return out; }
  function decFor(span, base, cap) { if (!(span > 0)) return base; var d = Math.ceil(-Math.log10(span / 5)) + 1; return Math.min(Math.max(d, base), cap); }
  function tlabel(t, I) { var d = new Date(t), hh = ("0" + d.getUTCHours()).slice(-2) + ":" + ("0" + d.getUTCMinutes()).slice(-2), md = (d.getUTCMonth() + 1) + "/" + d.getUTCDate(); return I >= 86400e3 ? md : (d.getUTCHours() === 0 && d.getUTCMinutes() === 0 ? md : hh); }
  function full(t) { return new Date(t).toISOString().slice(0, 16).replace("T", " ") + " UTC"; }

  // ── draw ──
  function draw() {
    layout(); ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
    var U = UNITS[S.unit], vis = bars.slice(view.start, view.start + view.count), n = vis.length;
    if (n < 2) { ctx.fillStyle = C.muted; ctx.font = MONO; ctx.fillText("collecting samples — the line grows from here ❤", 20, 40); return; }
    var pw = plotWidth(), bw = pw / view.count, X = function (i) { return PAD.l + (i - view.start + 0.5) * bw; };
    var ps = panes(), y0 = PAD.top, geo = {};
    ps.forEach(function (p) { geo[p.id] = { top: y0, h: p.h, bot: y0 + p.h }; y0 += p.h; });
    // ── main pane ──
    var g = geo.main, lo = Infinity, hi = -Infinity;
    vis.forEach(function (b) { lo = Math.min(lo, b.l); hi = Math.max(hi, b.h); });
    if (S.ind.bb) vis.forEach(function (b) { var u = S.bb.up[b.i], l = S.bb.lo[b.i]; if (u != null) { hi = Math.max(hi, u); lo = Math.min(lo, l); } });
    var pad = (hi - lo) * 0.12 || hi * 0.05 || 1e-30; lo -= pad; hi += pad;
    var useLog = S.log && lo > 0, L = useLog ? Math.log10 : function (v) { return v; }, Lhi = L(hi), Llo = L(lo);
    var Y = function (v) { return g.top + 12 + (Lhi - L(v)) / (Lhi - Llo) * (g.h - 24); };
    var Yinv = function (y) { var t = Lhi - (y - g.top - 12) / (g.h - 24) * (Lhi - Llo); return useLog ? Math.pow(10, t) : t; };
    var dec = decFor(hi - lo, S.unit === "t1usdc" ? 4 : 2, 8);
    ctx.font = MONO; ctx.textBaseline = "middle";
    var lastY0 = bars.length ? Y(bars[bars.length - 1].c) : -99; (useLog ? logTicks(lo, hi) : niceTicks(lo, hi, 5)).forEach(function (t) { var y = Y(t); if (Math.abs(y - lastY0) < 11) { ctx.strokeStyle = C.grid; ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(PAD.l + pw, y); ctx.stroke(); return; } ctx.strokeStyle = C.grid; ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(PAD.l + pw, y); ctx.stroke(); ctx.fillStyle = C.muted; ctx.textAlign = "left"; ctx.fillText(U.axis(t, dec), PAD.l + pw + 6, y); });
    // fib
    if (S.ind.fib) { var fl = Infinity, fh = -Infinity; vis.forEach(function (b) { fl = Math.min(fl, b.l); fh = Math.max(fh, b.h); }); FIBS.forEach(function (f) { var y = Y(fl + (fh - fl) * f); ctx.strokeStyle = "rgba(227,178,95," + (f === 0 || f === 1 ? .45 : .28) + ")"; ctx.setLineDash(f === 0 || f === 1 ? [] : [3, 4]); ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(PAD.l + pw, y); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = "rgba(227,178,95,.7)"; ctx.font = "10px ui-monospace,Menlo,monospace"; ctx.textAlign = "left"; ctx.fillText("fib " + f, PAD.l + 4, y - 7); ctx.font = MONO; }); }
    // bollinger
    if (S.ind.bb) { var band = function (arr, col, width) { ctx.strokeStyle = col; ctx.lineWidth = width; ctx.beginPath(); var on = false; vis.forEach(function (b) { var v = arr[b.i]; if (v == null) { on = false; return; } var x = X(b.i), y = Y(v); if (!on) { ctx.moveTo(x, y); on = true; } else ctx.lineTo(x, y); }); ctx.stroke(); ctx.lineWidth = 1; };
      ctx.fillStyle = "rgba(131,56,236,.10)"; ctx.beginPath(); var started = false; vis.forEach(function (b) { var v = S.bb.up[b.i]; if (v == null) return; var x = X(b.i), y = Y(v); if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y); }); for (var i = vis.length - 1; i >= 0; i--) { var v = S.bb.lo[vis[i].i]; if (v == null) continue; ctx.lineTo(X(vis[i].i), Y(v)); } ctx.closePath(); ctx.fill();
      band(S.bb.up, "rgba(131,56,236,.8)", 1); band(S.bb.lo, "rgba(131,56,236,.8)", 1); band(S.bb.mid, "rgba(245,214,137,.8)", 1); }
    // ribbon
    if (S.ind.ribbon) RIBBON.forEach(function (r, ri) { ctx.strokeStyle = r.col; ctx.globalAlpha = .55; ctx.lineWidth = 1.2; ctx.beginPath(); vis.forEach(function (b, j) { var x = X(b.i), y = Y(S.ribbon[ri][b.i]); if (j) ctx.lineTo(x, y); else ctx.moveTo(x, y); }); ctx.stroke(); ctx.globalAlpha = 1; ctx.lineWidth = 1; });
    // candles / line
    if (S.type === "compare") {
      var b0 = vis[0], series = [["LUV / USDC", C.gold, function (b) { return b.cu / b0.cu - 1; }], ["ETH / USDC", "#3fa9ff", function (b) { return b.eth && b0.eth ? b.eth / b0.eth - 1 : null; }], ["LUV / ETH", C.pink, function (b) { return b.cn / b0.cn - 1; }]];
      var clo = 0, chi = 0; series.forEach(function (sr) { vis.forEach(function (b) { var v = sr[2](b); if (v != null) { clo = Math.min(clo, v); chi = Math.max(chi, v); } }); }); var cpad = (chi - clo) * 0.1 || 0.01; clo -= cpad; chi += cpad;
      var Yc = function (v) { return g.top + 12 + (chi - v) / (chi - clo) * (g.h - 24); };
      ctx.fillStyle = C.bg; ctx.fillRect(PAD.l, g.top, pw + PAD.r, g.h);
      niceTicks(clo * 100, chi * 100, 5).forEach(function (t) { var y = Yc(t / 100); ctx.strokeStyle = C.grid; ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(PAD.l + pw, y); ctx.stroke(); ctx.fillStyle = C.muted; ctx.textAlign = "left"; ctx.fillText((t >= 0 ? "+" : "") + t.toFixed(1) + "%", PAD.l + pw + 6, y); });
      ctx.strokeStyle = "rgba(247,242,249,.25)"; ctx.beginPath(); ctx.moveTo(PAD.l, Yc(0)); ctx.lineTo(PAD.l + pw, Yc(0)); ctx.stroke();
      series.forEach(function (sr, si) { ctx.strokeStyle = sr[1]; ctx.lineWidth = si === 0 ? 2.2 : 1.6; ctx.beginPath(); var on = false; vis.forEach(function (b) { var v = sr[2](b); if (v == null) { on = false; return; } var x = X(b.i), y = Yc(v); if (!on) { ctx.moveTo(x, y); on = true; } else ctx.lineTo(x, y); }); ctx.stroke(); ctx.lineWidth = 1; var lastB = vis[vis.length - 1], lv = sr[2](lastB); if (lv != null) tag(PAD.l + pw + 2, Yc(lv), (lv >= 0 ? "+" : "") + (lv * 100).toFixed(1) + "%", sr[1], "#0a0d14"); ctx.fillStyle = sr[1]; ctx.textAlign = "left"; ctx.fillText("— " + sr[0], PAD.l + 8 + si * 130, g.top + 30); });
      label(g, "compare, indexed to the start of the view · " + intervalLabel());
      var lb = vis[vis.length - 1], dUsd = lb.cu / b0.cu - 1, dEth = lb.eth && b0.eth ? lb.eth / b0.eth - 1 : null, dNat = lb.cn / b0.cn - 1;
      ctx.fillStyle = C.ink; ctx.textAlign = "right"; ctx.fillText("LUV in USDC " + (dUsd >= 0 ? "+" : "") + (dUsd * 100).toFixed(2) + "% = LUV/ETH " + (dNat >= 0 ? "+" : "") + (dNat * 100).toFixed(2) + "% × ETH " + (dEth == null ? "…" : (dEth >= 0 ? "+" : "") + (dEth * 100).toFixed(2) + "%"), PAD.l + pw - 6, g.top + 14);
    } else if (S.type === "line") { ctx.strokeStyle = C.gold; ctx.lineWidth = 2; ctx.beginPath(); vis.forEach(function (b, j) { var x = X(b.i), y = Y(b.c); if (j) ctx.lineTo(x, y); else ctx.moveTo(x, y); }); ctx.stroke(); ctx.lineWidth = 1; }
    else if (S.type === "candles") { var bodyW = Math.max(1, Math.min(bw * 0.7, 14)); vis.forEach(function (b) { var x = X(b.i), col = b.flat ? C.muted : (b.up ? C.up : C.dn); ctx.strokeStyle = col; ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(x, Y(b.h)); ctx.lineTo(x, Y(b.l)); ctx.stroke(); var yo = Y(b.o), yc = Y(b.c), top = Math.min(yo, yc), hh = Math.max(1, Math.abs(yo - yc)); if (b.flat) { ctx.globalAlpha = .5; ctx.fillRect(x - bodyW / 2, top - 0.5, bodyW, 1); ctx.globalAlpha = 1; } else ctx.fillRect(x - bodyW / 2, top, bodyW, hh); }); }
    // last price line + tag
    var last = bars[bars.length - 1]; if (last) { var ly = Y(last.c); if (ly > g.top && ly < g.bot) { ctx.strokeStyle = last.up ? C.up : C.dn; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(PAD.l, ly); ctx.lineTo(PAD.l + pw, ly); ctx.stroke(); ctx.setLineDash([]); tag(PAD.l + pw + 2, ly, U.axis(last.c, dec), last.up ? C.up : C.dn, "#0a0d14"); } }
    // × from seed, on the right of the last close
    if (S.type !== "compare" && S.ind.x && last) { var xm = last.cn / SEED_NATIVE; ctx.fillStyle = C.gold2; ctx.textAlign = "right"; ctx.font = "700 " + MONO; ctx.fillText(xm.toFixed(2) + "× UP from launch", PAD.l + pw - 6, g.top + 14); ctx.font = MONO; }
    // pane label
    if (S.type !== "compare") label(g, U.label + " · " + intervalLabel() + (useLog ? " · log" : "") + (S.ind.ribbon ? " · EMA 8·13·21·34·55" : "") + (S.ind.bb ? " · BB 20,2" : ""));
    // ── sub panes ──
    if (geo.vol) { var gv = geo.vol, vmax = 0; vis.forEach(function (b) { vmax = Math.max(vmax, b.vol); }); label(gv, "volume, USD · buys green, sells red"); vis.forEach(function (b) { if (!b.vol) return; var x = X(b.i), h = (b.vol / vmax) * (gv.h - 22); ctx.fillStyle = b.bvol >= b.svol ? C.up : C.dn; ctx.globalAlpha = .8; ctx.fillRect(x - Math.max(1, bw * .6) / 2, gv.bot - 4 - h, Math.max(1, bw * .6), h); ctx.globalAlpha = 1; }); sep(gv); axisRight(gv, ["$" + vmax.toFixed(2), "$0"]); }
    if (geo.reflect) { var gr = geo.reflect, cum = 0, series = vis.map(function (b) { cum += b.vol * 0.03; return cum; }), rmax = cum || 1; label(gr, "reflections paid to holders in view, USD (3% of every trade) · cumulative " + "$" + cum.toFixed(2)); ctx.strokeStyle = C.pink; ctx.lineWidth = 1.5; ctx.beginPath(); vis.forEach(function (b, j) { var x = X(b.i), y = gr.bot - 4 - series[j] / rmax * (gr.h - 22); if (j) ctx.lineTo(x, y); else ctx.moveTo(x, y); }); ctx.stroke(); ctx.lineWidth = 1; sep(gr); axisRight(gr, ["$" + rmax.toFixed(2), "$0"]); }
    if (geo.rsi) { var gs = geo.rsi, Ys = function (v) { return gs.top + 14 + (100 - v) / 100 * (gs.h - 22); }; label(gs, "RSI 14"); [30, 70].forEach(function (l) { ctx.strokeStyle = "rgba(247,242,249,.15)"; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(PAD.l, Ys(l)); ctx.lineTo(PAD.l + pw, Ys(l)); ctx.stroke(); ctx.setLineDash([]); }); ctx.fillStyle = "rgba(131,56,236,.10)"; ctx.fillRect(PAD.l, Ys(70), pw, Ys(30) - Ys(70)); ctx.strokeStyle = C.pink; ctx.lineWidth = 1.5; ctx.beginPath(); var on = false; vis.forEach(function (b) { var v = S.rsi[b.i]; if (v == null) { on = false; return; } var x = X(b.i), y = Ys(v); if (!on) { ctx.moveTo(x, y); on = true; } else ctx.lineTo(x, y); }); ctx.stroke(); ctx.lineWidth = 1; sep(gs); axisRight(gs, ["70", "30"], [Ys(70), Ys(30)]); var lr = S.rsi[last.i]; if (lr != null) tag(PAD.l + pw + 2, Ys(lr), lr.toFixed(1), C.pink, "#fff"); }
    if (geo.macd) { var gm = geo.macd, mm = 0; vis.forEach(function (b) { var a = S.macd.macd[b.i], s2 = S.macd.signal[b.i], h2 = S.macd.hist[b.i]; if (a != null) mm = Math.max(mm, Math.abs(a)); if (s2 != null) mm = Math.max(mm, Math.abs(s2)); if (h2 != null) mm = Math.max(mm, Math.abs(h2)); }); mm = mm || 1; var Ym = function (v) { return gm.top + 12 + (mm - v) / (2 * mm) * (gm.h - 20); }; label(gm, "MACD 12·26·9 (on the USD close)"); ctx.strokeStyle = C.grid; ctx.beginPath(); ctx.moveTo(PAD.l, Ym(0)); ctx.lineTo(PAD.l + pw, Ym(0)); ctx.stroke(); vis.forEach(function (b) { var h2 = S.macd.hist[b.i]; if (h2 == null) return; var x = X(b.i); ctx.fillStyle = h2 >= 0 ? C.up : C.dn; ctx.globalAlpha = .7; ctx.fillRect(x - Math.max(1, bw * .5) / 2, Math.min(Ym(0), Ym(h2)), Math.max(1, bw * .5), Math.abs(Ym(h2) - Ym(0))); ctx.globalAlpha = 1; }); [[S.macd.macd, C.gold], [S.macd.signal, C.pink]].forEach(function (pair) { ctx.strokeStyle = pair[1]; ctx.lineWidth = 1.4; ctx.beginPath(); var on2 = false; vis.forEach(function (b) { var v = pair[0][b.i]; if (v == null) { on2 = false; return; } var x = X(b.i), y = Ym(v); if (!on2) { ctx.moveTo(x, y); on2 = true; } else ctx.lineTo(x, y); }); ctx.stroke(); ctx.lineWidth = 1; }); sep(gm); }
    if (geo.pressure) { var gp = geo.pressure, Yp = function (v) { return gp.top + 12 + (1 - v) / 2 * (gp.h - 20); }; label(gp, "emotonomic pressure · (buys − sells) ÷ volume per bar, +1 all entries, −1 all exits"); ctx.strokeStyle = C.grid; ctx.beginPath(); ctx.moveTo(PAD.l, Yp(0)); ctx.lineTo(PAD.l + pw, Yp(0)); ctx.stroke(); vis.forEach(function (b) { if (!b.vol) return; var p = (b.bvol - b.svol) / b.vol, x = X(b.i); ctx.fillStyle = p >= 0 ? C.up : C.dn; ctx.globalAlpha = .8; ctx.fillRect(x - Math.max(1, bw * .6) / 2, Math.min(Yp(0), Yp(p)), Math.max(1, bw * .6), Math.abs(Yp(p) - Yp(0))); ctx.globalAlpha = 1; }); sep(gp); axisRight(gp, ["+1", "−1"], [Yp(1) + 4, Yp(-1) - 4]); }
    // ── time axis ──
    var ax = H - PAD.axis; ctx.strokeStyle = C.grid; ctx.beginPath(); ctx.moveTo(PAD.l, ax); ctx.lineTo(PAD.l + pw, ax); ctx.stroke(); ctx.fillStyle = C.muted; ctx.textAlign = "center"; ctx.textBaseline = "top";
    var STEPS = [60e3, 300e3, 900e3, 1800e3, 3600e3, 7200e3, 14400e3, 21600e3, 43200e3, 86400e3, 2 * 86400e3, 7 * 86400e3, 14 * 86400e3, 30 * 86400e3], msPerPx = S.interval / bw, step = STEPS[STEPS.length - 1];
    for (var si = 0; si < STEPS.length; si++) if (STEPS[si] / msPerPx >= 90) { step = STEPS[si]; break; }
    var t0 = Math.ceil(vis[0].t / step) * step, lastX = -Infinity;
    for (var tt = t0; tt <= vis[n - 1].t; tt += step) { var bi = Math.round((tt - vis[0].t) / S.interval) + vis[0].i; var lx = X(bi), d = new Date(tt), lb = step >= 86400e3 || (d.getUTCHours() === 0 && d.getUTCMinutes() === 0) ? (d.getUTCMonth() + 1) + "/" + d.getUTCDate() : ("0" + d.getUTCHours()).slice(-2) + ":" + ("0" + d.getUTCMinutes()).slice(-2); var lw = ctx.measureText(lb).width; if (lx - lw / 2 < PAD.l || lx + lw / 2 > PAD.l + pw || lx - lastX < lw + 12) continue; ctx.strokeStyle = C.grid; ctx.beginPath(); ctx.moveTo(lx, ax); ctx.lineTo(lx, ax + 4); ctx.stroke(); ctx.fillText(lb, lx, ax + 7); lastX = lx; }
    ctx.textBaseline = "middle";
    // ── crosshair ──
    if (hover) { var hb = bars[hover.i]; if (hb) { var hx = X(hb.i); ctx.strokeStyle = C.cross; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(hx, PAD.top); ctx.lineTo(hx, ax); ctx.stroke(); if (hover.y >= g.top && hover.y <= g.bot) { ctx.beginPath(); ctx.moveTo(PAD.l, hover.y); ctx.lineTo(PAD.l + pw, hover.y); ctx.stroke(); var pv = Yinv(hover.y); tag(PAD.l + pw + 2, hover.y, U.axis(pv, dec), C.tag, "#0a0d14"); } ctx.setLineDash([]); ctx.textAlign = "center"; ctx.textBaseline = "top"; var tl = full(hb.t), tw = ctx.measureText(tl).width + 10; ctx.fillStyle = C.tag; ctx.fillRect(Math.min(Math.max(hx - tw / 2, PAD.l), PAD.l + pw - tw), ax + 3, tw, 18); ctx.fillStyle = "#0a0d14"; ctx.fillText(tl, Math.min(Math.max(hx, PAD.l + tw / 2), PAD.l + pw - tw / 2), ax + 6); ctx.textBaseline = "middle";
      legend(hb, U); } } else legend(last, U);
  }
  function intervalLabel() { for (var i = 0; i < INTERVALS.length; i++) if (INTERVALS[i][1] === S.interval) return INTERVALS[i][0]; return ""; }
  function label(g, text) { ctx.fillStyle = C.muted; ctx.font = "11px ui-monospace,Menlo,monospace"; ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillText(text, PAD.l + 4, g.top + 10); ctx.font = MONO; }
  function sep(g) { ctx.strokeStyle = "rgba(247,242,249,.12)"; ctx.beginPath(); ctx.moveTo(PAD.l, g.top); ctx.lineTo(W - 4, g.top); ctx.stroke(); }
  function axisRight(g, labels, ys) { ctx.fillStyle = C.muted; ctx.textAlign = "left"; ctx.font = "10px ui-monospace,Menlo,monospace"; labels.forEach(function (l, i) { ctx.fillText(l, PAD.l + plotWidth() + 6, ys ? ys[i] : (i === 0 ? g.top + 18 : g.bot - 8)); }); ctx.font = MONO; }
  function tag(x, y, text, bg, fg) { ctx.font = "700 11px ui-monospace,Menlo,monospace"; var w = Math.min(ctx.measureText(text).width + 8, PAD.r - 4); ctx.fillStyle = bg; ctx.fillRect(x, y - 9, w, 18); ctx.fillStyle = fg; ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillText(text, x + 4, y); ctx.font = MONO; }
  function legend(b, U) {
    var el = document.getElementById("luvlegend"); if (!el || !b) return;
    var chg = b.o ? (b.c / b.o - 1) * 100 : 0, mk = Object.keys(b.makers || {}).length;
    el.innerHTML = "";
    var v0 = bars[view.start], vN = bars[Math.min(bars.length - 1, view.start + view.count - 1)], rU = v0 && vN ? vN.cu / v0.cu - 1 : 0, rE = v0 && vN && v0.eth && vN.eth ? vN.eth / v0.eth - 1 : null, rN = v0 && vN ? vN.cn / v0.cn - 1 : 0;
    var rangeName = S.range === Infinity ? "all" : (RANGES.filter(function (r) { return r[1] === S.range; })[0] || ["view"])[0];
    var parts = [["O", U.fmt(b.o)], ["H", U.fmt(b.h)], ["L", U.fmt(b.l)], ["C", U.fmt(b.c)], ["Δ", (chg >= 0 ? "+" : "") + chg.toFixed(2) + "%"], ["ETH", b.eth ? "$" + b.eth.toFixed(2) : "…"], ["vol", "$" + b.vol.toFixed(2)], ["trades", b.n + (b.n ? " (" + b.buys + "b/" + b.sells + "s)" : "")], ["makers", String(mk)], ["×", (b.cn / SEED_NATIVE).toFixed(2)], ["t", full(b.t)], ["live", liveAt ? "block " + (source.block ? source.block.toLocaleString() : "…") + ", " + Math.max(0, Math.round((Date.now() - liveAt) / 1000)) + "s ago" : "…"], ["buy 1T", market && market.quotes ? "$" + market.quotes.buy1T.usd.toFixed(6) : "…"], ["sell 1T", market && market.quotes ? "$" + market.quotes.sell1T.usd.toFixed(6) : "…"],
      [rangeName + " LUV/USDC", (rU >= 0 ? "+" : "") + (rU * 100).toFixed(2) + "%"], [rangeName + " ETH", rE == null ? "…" : (rE >= 0 ? "+" : "") + (rE * 100).toFixed(2) + "%"], [rangeName + " LUV/ETH", (rN >= 0 ? "+" : "") + (rN * 100).toFixed(2) + "%"]];
    parts.forEach(function (p) { var s = document.createElement("span"); s.innerHTML = "<i>" + p[0] + "</i> " + p[1]; if (p[0] === "Δ" || p[0] === "C") s.style.color = chg >= 0 ? C.up : C.dn; el.appendChild(s); });
  }
  function paintLine() { var el = document.getElementById("luvconv"); if (!el || !market) return; var pn = Number(market.priceNative), pu = Number(market.priceUsd); if (!(pn > 0)) return; el.textContent = "⚖ 1T LUV = $" + Number(market.oneTrillionUsd).toFixed(4) + " USDC · 1 LUV = " + grp(pn * 1e18, 4) + " wei = " + sci(pn, 4) + " ETH · 1 luvwei = " + sci(pn, 4) + " wei = " + sci(pu / 1e18, 4) + " USDC · 1 ETH = " + grp(1 / pn / 1e12, 4) + "T LUV · price " + (pn / SEED_NATIVE).toFixed(2) + "× and liquidity " + (market.liquidity && market.liquidity.quote ? (Number(market.liquidity.quote) / SEED_WETH).toFixed(2) : "…") + "× UP from launch"; }

  // ── interaction ──
  function barAt(px) { var bw = plotWidth() / view.count; return Math.max(0, Math.min(bars.length - 1, view.start + Math.floor((px - PAD.l) / bw))); }
  function pos(ev) { var r = cv.getBoundingClientRect(); var p = ev.touches ? ev.touches[0] : ev; return { x: p.clientX - r.left, y: p.clientY - r.top }; }
  cv.addEventListener("mousemove", function (ev) { var p = pos(ev); if (dragging) { var bw = plotWidth() / view.count, dx = Math.round((dragging.x - p.x) / bw); if (dx) { view.start = Math.max(0, Math.min(bars.length - view.count, dragging.start + dx)); } hover = { i: barAt(p.x), y: p.y }; draw(); return; } hover = { i: barAt(p.x), y: p.y }; draw(); });
  cv.addEventListener("mouseleave", function () { hover = null; dragging = null; draw(); });
  cv.addEventListener("mousedown", function (ev) { var p = pos(ev); dragging = { x: p.x, start: view.start }; });
  window.addEventListener("mouseup", function () { dragging = null; });
  cv.addEventListener("wheel", function (ev) { ev.preventDefault(); var p = pos(ev), anchor = barAt(p.x), f = ev.deltaY > 0 ? 1.15 : 1 / 1.15, nc = Math.max(20, Math.min(bars.length, Math.round(view.count * f))); var frac = (anchor - view.start) / view.count; view.count = nc; view.start = Math.max(0, Math.min(bars.length - nc, Math.round(anchor - frac * nc))); draw(); }, { passive: false });
  cv.addEventListener("touchstart", function (ev) { var p = pos(ev); dragging = { x: p.x, start: view.start }; hover = { i: barAt(p.x), y: p.y }; draw(); }, { passive: true });
  cv.addEventListener("touchmove", function (ev) { var p = pos(ev); if (dragging) { var bw = plotWidth() / view.count, dx = Math.round((dragging.x - p.x) / bw); view.start = Math.max(0, Math.min(bars.length - view.count, dragging.start + dx)); } hover = { i: barAt(p.x), y: p.y }; draw(); }, { passive: true });
  cv.addEventListener("touchend", function () { dragging = null; });
  window.addEventListener("resize", function () { draw(); });

  // ── controls ──
  function chips(id, items, isOn, onClick) { var box = document.getElementById(id); if (!box) return; box.innerHTML = ""; items.forEach(function (it) { var b = document.createElement("button"); b.type = "button"; b.textContent = it.label; b.title = it.hint || ""; b.setAttribute("aria-pressed", String(isOn(it))); b.addEventListener("click", function () { onClick(it); save(); paintControls(); }); box.appendChild(b); }); }
  function paintControls() {
    chips("luv-units", UNIT_ORDER.map(function (k) { return { key: k, label: UNITS[k].label, hint: UNITS[k].hint }; }), function (it) { return it.key === S.unit; }, function (it) { S.unit = it.key; build(); draw(); });
    chips("luv-ranges", RANGES.map(function (r) { return { key: r[1], label: r[0], iv: r[2] }; }), function (it) { return it.key === S.range; }, function (it) { S.range = it.key; if (!S.userInterval) S.interval = it.iv; build(); fitView(); draw(); });
    chips("luv-intervals", INTERVALS.map(function (iv) { return { key: iv[1], label: iv[0] }; }), function (it) { return it.key === S.interval; }, function (it) { S.interval = it.key; S.userInterval = true; build(); fitView(); draw(); });
    chips("luv-type", [{ key: "candles", label: "candles" }, { key: "line", label: "line" }, { key: "compare", label: "vs ETH", hint: "LUV in USDC, ETH in USDC and LUV/ETH, each indexed to the start of the view — which of them moved" }], function (it) { return it.key === S.type; }, function (it) { S.type = it.key; draw(); });
    chips("luv-scale", [{ key: "log", label: "log", hint: "logarithmic price axis — a 10× move reads as one decade" }], function () { return S.log; }, function () { S.log = !S.log; draw(); });
    chips("luv-indicators", INDICATORS.map(function (i) { return { key: i[0], label: i[1] }; }), function (it) { return !!S.ind[it.key]; }, function (it) { S.ind[it.key] = !S.ind[it.key]; draw(); });
    var fit = document.getElementById("luv-fit"); if (fit) fit.onclick = function () { fitView(); draw(); };
  }
  function tickLive() {
    if (document.hidden || !tape.length) return;
    return readPair().then(function (m) {
      if (!market) market = m;
      else { ["quotes", "priceUsd", "priceNative", "oneTrillionUsd", "reserves", "liquidity", "ethUsd", "marketCap", "priceX", "liqX", "chronos", "t", "burned"].forEach(function (k) { market[k] = m[k]; }); }
      source.chain = true; source.block = m.chronos.block_number; liveAt = m.t;
      if (m.ethUsd > 0) ethSeries.push([m.t, m.ethUsd]);
      tape = tape.filter(function (x) { return !x.live; });
      tape.push({ t: m.t, usd: m.priceUsd, nat: m.priceNative, vol: 0, buy: null, trade: false, live: true });
      var prevLen = bars.length; build(); keepView(prevLen); draw(); paintLine();
      announce(market, tape.filter(function (x) { return x.t >= Date.now() - 86400e3; }).map(function (x) { return [x.t, x.usd, x.nat]; }));
    }).catch(function () {});
  }
  paintControls(); load();
  setInterval(function () { if (!document.hidden) load(); }, 60000);
  setInterval(tickLive, 15000);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) load(); });
})();
