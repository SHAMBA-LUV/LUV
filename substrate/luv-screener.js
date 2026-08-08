/* luv-screener — the in-house screener: every element of the aggregator pair page,
 * reproduced from pool truth with zero third-party surface and zero warning chips.
 *
 * Data: same-origin market.json (reserves price, windows, liquidity, fdv/mcap)
 *     + market-trades.json (the swap log — the pair's own Swap events, decoded).
 * Mount: <div id="luvscreener"></div> on view.html. Refreshes every 60s.
 * CSP-safe: external file, no inline handlers, DOM built with createElement.
 */
(function () {
  'use strict';
  var MOUNT = document.getElementById('luvscreener');
  if (!MOUNT) return;

  var PAIR = '0x57D2085Aa859a145cB107845AD03c0eAAFBD8a31';
  var LUV = '0x2711111111683B8708cb9a48cBf36a51315F8254';
  var WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
  var USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
  var BUY_URL = 'https://app.uniswap.org/swap?chain=ethereum&inputCurrency=' + USDC + '&outputCurrency=' + LUV;
  var SELL_URL = 'https://app.uniswap.org/swap?chain=ethereum&inputCurrency=' + LUV + '&outputCurrency=' + USDC;
  var WINDOWS = [['m5', '5M'], ['h1', '1H'], ['h6', '6H'], ['h24', '24H']];
  var TRADE_ROWS = 40;

  var HOLDERS_MOUNT = document.getElementById('luvholders');
  var TOTAL_SUPPLY = 111111111111111111; // the repunit, whole LUV
  var LABELS = {
    '0x10f7ee226b16bea7f365dc1edef159fc1957d169': ['treasury — the LUV signer', 'gold'],
    '0x000000000000000000000000000000000000dead': ['🔥 dEaD — burned', 'rose'],
    '0x57d2085aa859a145cb107845ad03c0eaafbd8a31': ['LUV/WETH pair (the market)', null],
    '0xdf2c1836550c5711ef9c021cb0de86241dc1def3': ['ShambaLuvAirdrop (gesture pool)', null],
    '0x2711111111683b8708cb9a48cbf36a51315f8254': ['token contract (fees awaiting processFees)', null],
  };

  var state = { win: 'h24', market: null, trades: null, holders: null };

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function frag() { return document.createDocumentFragment(); }

  // sub-zero price form: 0.0(12)2078 — full precision belongs to the chain; this is display
  function priceParts(x) {
    if (!(x > 0)) return null;
    if (x >= 0.001) return { zeros: 0, digits: x.toPrecision(4) };
    var zeros = -Math.floor(Math.log10(x)) - 1;
    var digits = Math.round(x * Math.pow(10, zeros + 4)).toString();
    return { zeros: zeros, digits: digits };
  }
  function priceNode(x, prefix) {
    var s = el('span', 'scr-price');
    var p = priceParts(x);
    if (!p) { s.textContent = '—'; return s; }
    s.appendChild(document.createTextNode(prefix + (p.zeros ? '0.0' : '')));
    if (p.zeros) {
      s.appendChild(el('sub', 'scr-zeros', String(p.zeros)));
      s.appendChild(document.createTextNode(p.digits));
    } else s.appendChild(document.createTextNode(p.digits));
    return s;
  }
  function fmtUsd(x) {
    if (x == null || isNaN(x)) return '—';
    if (x >= 1e9) return '$' + (x / 1e9).toFixed(2) + 'B';
    if (x >= 1e6) return '$' + (x / 1e6).toFixed(2) + 'M';
    if (x >= 1e3) return '$' + (x / 1e3).toFixed(1) + 'K';
    if (x >= 1) return '$' + x.toFixed(2);
    if (x > 0) return '$' + x.toFixed(4);
    return '$0';
  }
  function fmtLuv(x) {
    if (x == null || isNaN(x)) return '—';
    if (x >= 1e15) return (x / 1e15).toFixed(2) + 'Q';
    if (x >= 1e12) return (x / 1e12).toFixed(2) + 'T';
    if (x >= 1e9) return (x / 1e9).toFixed(2) + 'B';
    if (x >= 1e6) return (x / 1e6).toFixed(2) + 'M';
    return Math.round(x).toLocaleString('en-US');
  }
  function fmtAge(ms) {
    if (!(ms > 0)) return '—';
    var s = Math.floor(ms / 1000);
    if (s < 60) return s + 's';
    if (s < 3600) return Math.floor(s / 60) + 'm';
    if (s < 86400) return Math.floor(s / 3600) + 'h ' + Math.floor((s % 86400 % 3600) / 60) + 'm';
    return Math.floor(s / 86400) + 'd ' + Math.floor((s % 86400) / 3600) + 'h';
  }
  function shortAddr(a) { return a ? a.slice(0, 6) + '…' + a.slice(-4) : '—'; }
  function pctNode(v) {
    var s = el('span', 'scr-pct');
    if (v == null || isNaN(v)) { s.textContent = '—'; return s; }
    s.textContent = (v > 0 ? '+' : '') + v.toFixed(2) + '%';
    s.classList.add(v > 0 ? 'up' : (v < 0 ? 'down' : 'flat'));
    return s;
  }
  function splitBar(a, b, aCls, bCls) {
    var bar = el('div', 'scr-bar');
    var total = (a || 0) + (b || 0);
    var left = el('span', 'scr-bar-a ' + aCls);
    var right = el('span', 'scr-bar-b ' + bCls);
    left.style.width = total > 0 ? (100 * a / total).toFixed(1) + '%' : '50%';
    right.style.width = total > 0 ? (100 * b / total).toFixed(1) + '%' : '50%';
    bar.appendChild(left); bar.appendChild(right);
    return bar;
  }
  function link(href, text, cls) {
    var a = el('a', cls || null, text);
    a.href = href; a.target = '_blank'; a.rel = 'noopener';
    return a;
  }

  function statCell(label, mainNode, subNodes) {
    var c = el('div', 'scr-stat');
    c.appendChild(el('div', 'scr-k', label));
    var m = el('div', 'scr-v'); m.appendChild(mainNode); c.appendChild(m);
    if (subNodes) { var s = el('div', 'scr-sub'); subNodes.forEach(function (n) { s.appendChild(n); }); c.appendChild(s); }
    return c;
  }

  function render() {
    var m = state.market;
    if (!m) return;
    var w = (m.windows && m.windows[state.win]) || null;
    var out = frag();

    // ── header: pair identity + price both ways ──
    var head = el('div', 'scr-head');
    var idbox = el('div', 'scr-id');
    var t1 = el('div', 'scr-pairname');
    t1.appendChild(el('b', null, 'LUV'));
    t1.appendChild(document.createTextNode(' / WETH'));
    idbox.appendChild(t1);
    var badges = el('div', 'scr-badges');
    ['Ethereum', 'Uniswap V2'].forEach(function (b) { badges.appendChild(el('span', 'scr-badge', b)); });
    if (m.pairCreatedAt) badges.appendChild(el('span', 'scr-badge dim', 'pair age ' + fmtAge(Date.now() - m.pairCreatedAt)));
    idbox.appendChild(badges);
    head.appendChild(idbox);

    var pricebox = el('div', 'scr-prices');
    var pu = el('div', 'scr-price-main'); pu.appendChild(priceNode(m.priceUsd, '$')); pu.appendChild(el('span', 'scr-price-lbl', ' USD'));
    var pn = el('div', 'scr-price-alt'); pn.appendChild(priceNode(m.priceNative, '')); pn.appendChild(el('span', 'scr-price-lbl', ' WETH'));
    var measure = el('div', 'scr-price-alt gold', '1T LUV = ' + fmtUsd(m.oneTrillionUsd));
    pricebox.appendChild(pu); pricebox.appendChild(pn); pricebox.appendChild(measure);
    head.appendChild(pricebox);
    out.appendChild(head);

    // ── window tabs with % change ──
    var tabs = el('div', 'scr-tabs');
    WINDOWS.forEach(function (pair) {
      var key = pair[0], label = pair[1];
      var b = el('button', 'scr-tab' + (state.win === key ? ' on' : ''));
      b.type = 'button';
      b.appendChild(el('span', 'scr-tab-l', label));
      b.appendChild(pctNode(m.priceChange ? m.priceChange[key] : null));
      b.addEventListener('click', function () { state.win = key; render(); });
      tabs.appendChild(b);
    });
    out.appendChild(tabs);

    // ── stats for the chosen window: txns / volume / makers, buy-sell split ──
    var grid = el('div', 'scr-grid');
    if (w) {
      grid.appendChild(statCell('txns', el('span', null, String(w.txns)), [
        el('span', 'scr-buy', 'buys ' + w.buys), el('span', 'scr-sell', 'sells ' + w.sells),
        splitBar(w.buys, w.sells, 'buy', 'sell'),
      ]));
      grid.appendChild(statCell('volume', el('span', null, fmtUsd(w.volUsd)), [
        el('span', 'scr-buy', 'buy ' + fmtUsd(w.buyVolUsd)), el('span', 'scr-sell', 'sell ' + fmtUsd(w.sellVolUsd)),
        splitBar(w.buyVolUsd, w.sellVolUsd, 'buy', 'sell'),
      ]));
      grid.appendChild(statCell('makers', el('span', null, String(w.makers)), [
        el('span', 'scr-buy', 'buyers ' + w.buyers), el('span', 'scr-sell', 'sellers ' + w.sellers),
        splitBar(w.buyers, w.sellers, 'buy', 'sell'),
      ]));
    } else {
      grid.appendChild(el('div', 'scr-stat dim', 'swap-log stats warming up…'));
    }
    out.appendChild(grid);

    // ── liquidity / fdv / mcap / pooled / since-seed ──
    var mrow = el('div', 'scr-metrics');
    [['liquidity', fmtUsd(m.liquidity && m.liquidity.usd)],
     ['fdv', fmtUsd(m.fdv)],
     ['mkt cap', fmtUsd(m.marketCap)],
     ['pooled LUV', m.reserves ? fmtLuv(m.reserves.luv) : '—'],
     ['pooled WETH', m.reserves ? m.reserves.weth.toFixed(4) : '—'],
     ['since seed', m.priceX ? m.priceX.toFixed(2) + '×' : '—'],
    ].forEach(function (kv) {
      var c = el('div', 'scr-metric');
      c.appendChild(el('div', 'scr-k', kv[0]));
      c.appendChild(el('div', 'scr-v', kv[1]));
      mrow.appendChild(c);
    });
    out.appendChild(mrow);

    // ── buy / sell ──
    var trade = el('div', 'scr-trade');
    trade.appendChild(link(BUY_URL, '▲ BUY LUV', 'scr-cta buy'));
    trade.appendChild(link(SELL_URL, '▼ SELL LUV', 'scr-cta sell'));
    trade.appendChild(el('span', 'scr-slip', 'set slippage ~10% — the 5% reflection fee rides inside every trade'));
    out.appendChild(trade);

    // ── the allegory — LUV is the WEI, and the WEI to LUV ──
    var alle = el('div', 'scr-allegory');
    var a1 = el('div', 'scr-allegory-line');
    a1.appendChild(el('b', null, 'LUV is the WEI, and the WEI to LUV'));
    a1.appendChild(document.createTextNode(' — the allegory reads both ways: '));
    a1.appendChild(el('b', 'scr-buy', 'LUV / ETH'));
    a1.appendChild(document.createTextNode(' prices the gesture in ether · '));
    a1.appendChild(el('b', 'scr-sell', 'ETH / LUV'));
    a1.appendChild(document.createTextNode(' prices ether in gestures. Seeded at exactly 10 WEI per LUV — the identity holds in both directions. '));
    var wl = el('a', null, '⚖️ the arithmetic paper');
    wl.href = 'wei.html';
    a1.appendChild(wl);
    alle.appendChild(a1);
    out.appendChild(alle);

    // ── pair info ──
    var info = el('div', 'scr-info');
    [['pair', PAIR], ['LUV', LUV], ['WETH', WETH]].forEach(function (kv) {
      var row = el('div', 'scr-inforow');
      row.appendChild(el('span', 'scr-k', kv[0]));
      row.appendChild(link('https://etherscan.io/address/' + kv[1], kv[1], 'scr-addr'));
      var copy = el('button', 'scr-copy', 'copy');
      copy.type = 'button';
      copy.addEventListener('click', function () {
        navigator.clipboard && navigator.clipboard.writeText(kv[1]).then(function () {
          copy.textContent = '✓'; setTimeout(function () { copy.textContent = 'copy'; }, 1200);
        });
      });
      row.appendChild(copy);
      info.appendChild(row);
    });
    var links = el('div', 'scr-links');
    links.appendChild(link('https://luv.pythai.net/', '🌐 website'));
    links.appendChild(link('https://etherscan.io/address/' + LUV + '#code', '✓ verified source'));
    links.appendChild(link('https://app.uniswap.org/tokens/ethereum/' + LUV, '🦄 Uniswap'));
    links.appendChild(link('https://github.com/SHAMBA-LUV/LUV', '📜 GitHub'));
    info.appendChild(links);
    out.appendChild(info);

    // ── the transaction log ──
    out.appendChild(el('div', 'scr-loghead', 'the transaction log — the pair’s own Swap events, decoded'));
    var twrap = el('div', 'scr-tablewrap');
    var table = el('table', 'scr-table');
    var thead = el('thead'); var hr = el('tr');
    ['age', 'type', 'usd', 'LUV', 'WETH', 'price usd', 'maker', 'txn'].forEach(function (h) { hr.appendChild(el('th', null, h)); });
    thead.appendChild(hr); table.appendChild(thead);
    var tbody = el('tbody');
    var trades = (state.trades && state.trades.trades) ? state.trades.trades.slice().reverse().slice(0, TRADE_ROWS) : [];
    if (!trades.length) {
      var tr0 = el('tr'); var td0 = el('td', 'dim', 'no swaps in the log yet');
      td0.colSpan = 8; tr0.appendChild(td0); tbody.appendChild(tr0);
    }
    trades.forEach(function (tr) {
      var ts = tr[0], side = tr[2], luv = tr[3], weth = tr[4], usd = tr[5], maker = tr[7], hash = tr[8];
      var row = el('tr', side === 'b' ? 'buyrow' : 'sellrow');
      row.appendChild(el('td', null, ts ? fmtAge(Date.now() - ts) : '—'));
      row.appendChild(el('td', side === 'b' ? 'scr-buy' : 'scr-sell', side === 'b' ? 'buy' : 'sell'));
      row.appendChild(el('td', null, fmtUsd(usd)));
      row.appendChild(el('td', null, fmtLuv(luv)));
      row.appendChild(el('td', null, weth.toFixed(6)));
      var tdP = el('td'); tdP.appendChild(priceNode(luv > 0 ? usd / luv : null, '$')); row.appendChild(tdP);
      var tdM = el('td'); tdM.appendChild(link('https://etherscan.io/address/' + maker, shortAddr(maker))); row.appendChild(tdM);
      var tdT = el('td'); tdT.appendChild(link('https://etherscan.io/tx/' + hash, shortAddr(hash) + ' ↗', 'scr-txlink')); row.appendChild(tdT);
      tbody.appendChild(row);
    });
    table.appendChild(tbody);
    twrap.appendChild(table);
    out.appendChild(twrap);
    var foot = el('div', 'scr-foot');
    foot.appendChild(el('span', null, 'pool truth: reserves + on-chain swap log, mirrored same-origin every minute'));
    var full = link('https://etherscan.io/address/' + PAIR, 'full history on Etherscan ↗');
    foot.appendChild(full);
    out.appendChild(foot);

    MOUNT.textContent = '';
    MOUNT.appendChild(out);
  }

  // ── the holders — live balanceOf, the same truth the Etherscan holders tab shows ──
  function renderHolders() {
    if (!HOLDERS_MOUNT || !state.holders) return;
    var h = state.holders;
    var out = frag();
    var twrap = el('div', 'scr-tablewrap');
    var table = el('table', 'scr-table');
    var thead = el('thead'); var hr = el('tr');
    ['holder', 'address', 'LUV', '% supply'].forEach(function (th) { hr.appendChild(el('th', null, th)); });
    thead.appendChild(hr); table.appendChild(thead);
    var tbody = el('tbody');
    (h.top || []).forEach(function (row) {
      var addr = row[0], bal = row[1];
      var meta = LABELS[addr.toLowerCase()] || ['recognized participant member', null];
      var tr = el('tr');
      tr.appendChild(el('td', meta[1] === 'gold' ? 'scr-gold' : (meta[1] === 'rose' ? 'scr-sell' : null), meta[0]));
      var tdA = el('td'); tdA.appendChild(link('https://etherscan.io/address/' + addr, shortAddr(addr))); tr.appendChild(tdA);
      tr.appendChild(el('td', 'scr-num', Math.round(bal).toLocaleString('en-US')));
      tr.appendChild(el('td', 'scr-num', (100 * bal / TOTAL_SUPPLY).toFixed(3) + '%'));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    twrap.appendChild(table);
    out.appendChild(twrap);
    var foot = el('div', 'scr-foot');
    foot.appendChild(el('span', null, h.count + ' holders ≥ 1 LUV · every balance is live balanceOf — reflections included, refreshed every minute'));
    foot.appendChild(link('https://etherscan.io/token/' + LUV + '#balances', 'cross-check the holders tab on Etherscan ↗'));
    out.appendChild(foot);
    HOLDERS_MOUNT.textContent = '';
    HOLDERS_MOUNT.appendChild(out);
  }

  // Reasonable for lingering clients: no-cache revalidates against the server ETag
  // (unchanged data = a 304), the vhost's 30s max-age absorbs same-window refetches,
  // and a hidden tab doesn't poll at all — it catches up the moment it's seen again.
  function refresh() {
    if (document.hidden) return;
    Promise.all([
      fetch('market.json', { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
      fetch('market-trades.json', { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
      // The holders list is published at the source (the Etherscan holders tab), so this only
      // fetches when a page actually mounts #luvholders — no request for data nothing renders.
      HOLDERS_MOUNT ? fetch('market-holders.json', { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }) : null,
    ]).then(function (res) {
      if (res[0]) state.market = res[0];
      if (res[1]) state.trades = res[1];
      if (res[2]) state.holders = res[2];
      render();
      renderHolders();
    });
  }
  refresh();
  setInterval(refresh, 60000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) refresh(); });

  window.DVLuvScreener = { version: '1.3.0', refresh: refresh };
})();
