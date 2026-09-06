// SHAMBA LUV — site.js  (CSP-safe: no inline JS anywhere; same-origin reads only)
"use strict";
(function () {
  // 1. the second hand — LUV's first organ beats at 60 bpm = exactly 1 Hz.
  //    phase = wall clock, so every visitor's hand is in the same place.
  const hand = document.querySelector(".dial .hand");
  const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (hand) {
    const set = () => { const s = Math.floor(Date.now() / 1000) % 60; hand.style.transform = `translate(-50%,-100%) rotate(${s * 6}deg)`; };
    set();
    if (!reduce) { const tick = () => { set(); setTimeout(tick, 1000 - (Date.now() % 1000)); }; setTimeout(tick, 1000 - (Date.now() % 1000)); }
  }

  // 2. the price line — read from market.json (luv.oracle, same origin). Display only; the pair is the source.
  const fmtUsd = (v) => v >= 1 ? "$" + v.toFixed(4) : "$" + v.toFixed(6);
  let prevOneT = null;
  const fmtBig = (n) => { if (n >= 1e12) return (n / 1e12).toFixed(2) + " T"; if (n >= 1e9) return (n / 1e9).toFixed(2) + " B"; return Math.round(n).toLocaleString(); };
  const pct = (x) => (x >= 0 ? "+" : "") + x.toFixed(1) + "%";
  function paintPrice(m) {
    const oneT = m.oneTrillionUsd != null ? m.oneTrillionUsd : m.priceUsd * 1e12;
    document.querySelectorAll("[data-luv-1t]").forEach((el) => {
      el.textContent = fmtUsd(oneT);
      if (prevOneT !== null && oneT !== prevOneT) { el.classList.remove("tick-up", "tick-dn"); void el.offsetWidth; el.classList.add(oneT > prevOneT ? "tick-up" : "tick-dn"); }
    });
    document.querySelectorAll("[data-luv-tick]").forEach((el) => { if (prevOneT !== null && oneT !== prevOneT) { el.textContent = oneT > prevOneT ? "▲" : "▼"; el.className = "d " + (oneT > prevOneT ? "up" : "dn"); } });
    prevOneT = oneT;
    // the two factors: the pair's own price (moves only on a LUV trade) × ETH/USD (moves all the time)
    document.querySelectorAll("[data-luv-mix]").forEach((el) => (el.textContent = (m.priceNative * 1e18).toFixed(4) + " wei per LUV × ETH $" + Number(m.ethUsd).toFixed(2)));
    document.querySelectorAll("[data-luv-mcap]").forEach((el) => (el.textContent = "$" + Math.round(m.marketCap).toLocaleString()));
    document.querySelectorAll("[data-luv-liq]").forEach((el) => (el.textContent = "$" + Math.round(m.liquidity.usd).toLocaleString()));
    document.querySelectorAll("[data-luv-x]").forEach((el) => (el.textContent = m.priceX.toFixed(2) + "x"));
    document.querySelectorAll("[data-luv-wei]").forEach((el) => (el.textContent = (m.priceNative * 1e18).toFixed(2) + " wei"));
    document.querySelectorAll("[data-luv-eth]").forEach((el) => (el.textContent = "$" + Math.round(m.ethUsd).toLocaleString()));
    document.querySelectorAll("[data-luv-h24]").forEach((el) => { const c = (m.priceChange && m.priceChange.h24) || 0; el.textContent = pct(c) + " 24h"; el.classList.toggle("up", c >= 0); el.classList.toggle("dn", c < 0); });
    document.querySelectorAll("[data-luv-block]").forEach((el) => (el.textContent = "block " + (m.chronos && m.chronos.block_number ? m.chronos.block_number.toLocaleString() : "…")));
    document.querySelectorAll("[data-luv-per-usd]").forEach((el) => (el.textContent = fmtBig(1 / m.priceUsd) + " LUV"));
    document.querySelectorAll("[data-luv-at]").forEach((el) => (el.textContent = new Date(m.t).toUTCString().replace(" GMT", " UTC")));
  }
  function loadPrice() {
    fetch("market.json", { cache: "no-store" }).then((r) => r.json()).then(paintPrice).catch(() => {
      document.querySelectorAll("[data-luv-1t]").forEach((el) => (el.textContent = "priced on Uniswap"));
    });
  }
  // the 15-second tick: the pair's reserves and the USDC/WETH reserves, read straight from Ethereum, laid over the
  // last market.json so the day's change and the market cap keep their fields. The chart page runs its own tick.
  var lastMarket = null, SEED_NATIVE = 1e-17, SEED_WETH = 0.051922968585348276;
  function readReserves() {
    var body = JSON.stringify([
      { jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: "0x57D2085Aa859a145cB107845AD03c0eAAFBD8a31", data: "0x0902f1ac" }, "latest"] },
      { jsonrpc: "2.0", id: 2, method: "eth_call", params: [{ to: "0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc", data: "0x0902f1ac" }, "latest"] },
      { jsonrpc: "2.0", id: 3, method: "eth_blockNumber", params: [] },
      { jsonrpc: "2.0", id: 4, method: "eth_call", params: [{ to: "0xA478c2975Ab1Ea89e8196811F51A7B7Ade33eB11", data: "0x0902f1ac" }, "latest"] },
      { jsonrpc: "2.0", id: 5, method: "eth_call", params: [{ to: "0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640", data: "0x3850c7bd" }, "latest"] }]);
    return fetch("https://ethereum-rpc.publicnode.com", { method: "POST", headers: { "content-type": "application/json" }, body: body }).then(function (r) { return r.json(); }).then(function (rs) {
      rs.sort(function (a, b) { return a.id - b.id; });
      var w = function (hex) { var h = hex.replace(/^0x/, ""), o = []; for (var i = 0; i + 64 <= h.length; i += 64) o.push(Number(BigInt("0x" + h.slice(i, i + 64)))); return o; };
      var a = w(rs[0].result), b = w(rs[1].result), luv = a[0] / 1e18, weth = a[1] / 1e18;
      // ETH/USD = the median of three on-chain markets: V2 USDC/WETH, V2 DAI/WETH, and the V3 USDC/WETH 0.05% pool (moves every block)
      var e1 = (b[0] / 1e6) / (b[1] / 1e18), c = w(rs[3].result), e2 = (c[0] / 1e18) / (c[1] / 1e18);
      var sq = Number(BigInt("0x" + rs[4].result.slice(2, 66))) / Math.pow(2, 96), e3 = 1e12 / (sq * sq);
      var es = [e1, e2, e3].filter(function (x) { return isFinite(x) && x > 0; }).sort(function (x, y) { return x - y; }), ethUsd = es[Math.floor(es.length / 2)];
      var nat = weth / luv, usd = nat * ethUsd;
      var m = lastMarket ? Object.assign({}, lastMarket) : { priceChange: { h24: 0 }, totalSupply: 111111111111111111, burned: 0 };
      m.t = Date.now(); m.priceUsd = usd; m.priceNative = nat; m.oneTrillionUsd = usd * 1e12; m.ethUsd = ethUsd; m.priceX = nat / SEED_NATIVE;
      m.liquidity = { usd: weth * ethUsd * 2, quote: weth, base: luv }; m.marketCap = usd * ((m.totalSupply || 111111111111111111) - (m.burned || 0));
      m.chronos = { block_number: parseInt(rs[2].result, 16) };
      paintPrice(m);
    }).catch(function () {});
  }
  if (document.querySelector("[data-luv-1t]")) {
    var poll = function () { fetch("market.json", { cache: "no-store" }).then(function (r) { return r.json(); }).then(function (m) { lastMarket = m; paintPrice(m); }).catch(function () {}); };
    poll(); setInterval(poll, 60000);
    if (!document.getElementById("luvchart")) { setTimeout(readReserves, 1500); setInterval(function () { if (!document.hidden) readReserves(); }, 15000); document.addEventListener("visibilitychange", function () { if (!document.hidden) readReserves(); }); }
  }
  document.addEventListener("luv:market", function (e) { if (e.detail) { lastMarket = e.detail; paintPrice(e.detail); } });

  // 3. copy the contract address (buttons carry the exact address; the code element is user-select:all as the no-JS fallback)
  document.querySelectorAll(".copybtn[data-copy]").forEach((b) => {
    const label = b.textContent;
    b.addEventListener("click", () => {
      const done = () => { b.textContent = "copied"; b.setAttribute("data-done", "1"); setTimeout(() => { b.textContent = label; b.removeAttribute("data-done"); }, 1800); };
      const text = b.dataset.copy;
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done).catch(() => fallback());
      else fallback();
      function fallback() { const ta = document.createElement("textarea"); ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0"; document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); done(); } catch (e) { b.textContent = "select and copy"; } document.body.removeChild(ta); }
    });
  });

  // 3b. add LUV to MetaMask — switch to Ethereum mainnet first, then wallet_watchAsset with the LUV mark.
  //     Other chains follow when the LUVbridge is live. No provider → MetaMask deep link (mobile) / install page.
  var LUV_ASSET = { type: "ERC20", options: { address: "0x2711111111683B8708cb9a48cBf36a51315F8254", symbol: "LUV", decimals: 18, image: "https://luv.pythai.net/gfx/logo.png" } };
  document.querySelectorAll(".addmm").forEach(function (b) {
    var label = b.textContent;
    var say = function (t, ok) { b.textContent = t; b.setAttribute("data-done", ok ? "1" : "0"); setTimeout(function () { b.textContent = label; b.removeAttribute("data-done"); }, 2600); };
    b.addEventListener("click", function (ev) {
      ev.preventDefault();
      var eth = window.ethereum;
      if (!eth) { var mobile = /Android|iPhone|iPad/i.test(navigator.userAgent); window.open(mobile ? "https://metamask.app.link/dapp/luv.pythai.net/" : "https://metamask.io/download/", "_blank", "noopener"); return; }
      var p = eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x1" }] }).catch(function (e) { if (e && e.code === 4001) throw e; });
      p.then(function () { return eth.request({ method: "wallet_watchAsset", params: LUV_ASSET }); })
       .then(function (r) { say(r ? "LUV added to MetaMask" : "not added", !!r); })
       .catch(function (e) { say(e && e.code === 4001 ? "cancelled" : "MetaMask said no", false); });
    });
  });

  // 4. nav — mark the page you are on
  const here = location.pathname.split("/").pop() || "index.html";
  document.querySelectorAll(".nav a.link").forEach((a) => { if (a.getAttribute("href") === here) a.setAttribute("aria-current", "page"); });

  // 5. depth meter — how deep the reader has gone (count of open details), for the small readout if present
  const meter = document.querySelector("[data-depth-meter]");
  if (meter) {
    const update = () => { const n = document.querySelectorAll("details[open]").length; meter.textContent = n === 0 ? "the face" : n < 4 ? "into the movement" : "at the jewels"; };
    document.addEventListener("toggle", update, true); update();
  }
})();
