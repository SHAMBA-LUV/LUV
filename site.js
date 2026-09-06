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
  const fmtUsd = (v) => v >= 1 ? "$" + v.toFixed(2) : "$" + v.toFixed(4);
  const fmtBig = (n) => { if (n >= 1e12) return (n / 1e12).toFixed(2) + " T"; if (n >= 1e9) return (n / 1e9).toFixed(2) + " B"; return Math.round(n).toLocaleString(); };
  const pct = (x) => (x >= 0 ? "+" : "") + x.toFixed(1) + "%";
  function paintPrice(m) {
    const oneT = m.oneTrillionUsd != null ? m.oneTrillionUsd : m.priceUsd * 1e12;
    document.querySelectorAll("[data-luv-1t]").forEach((el) => (el.textContent = fmtUsd(oneT)));
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
  if (document.querySelector("[data-luv-1t]")) { loadPrice(); setInterval(loadPrice, 60000); }
  document.addEventListener("luv:market", function (e) { if (e.detail) paintPrice(e.detail); });

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
