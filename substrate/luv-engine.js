/*!
 * SHAMBA LUV — engine substrate (DVLuvEngine): the engine's inventory of itself.
 *
 * A NEW substrate extrapolated from the frame substrate (substrate/luv-frame.js), which
 * was itself drawn from the DeltaVerse sane substrate (engine/sane-substrate.js). Where
 * sane builds the world inside and frame draws the boundary around, THIS one looks
 * inward at the engine and names what the engine is made of. It is the derivation rule
 * made machine-readable: an organ enters the LUV engine only as the implementation of a
 * stated emotonomic commitment (form follows field), so every entry below carries the
 * commitment it implements. If a commitment has no organ, the engine has a gap; if an
 * organ has no commitment, it does not belong.
 *
 * It is a REGISTRY, not a renderer of value: it reports which organs a page has actually
 * loaded, by probing for the globals they publish — no fetch, no assumptions. A page that
 * loads one organ reports one; the engine paper, which loads several, reports several.
 * Detection is live at call time, so an organ loaded later is seen the moment it lands.
 *
 * Read it:   DVLuvEngine.organs()   → the registry
 *            DVLuvEngine.status()   → [{key, present, ...}] probed now
 *            DVLuvEngine.present(k) → boolean
 * Mount it:  <div data-luvengine></div>          the full inventory
 *            <div data-luvengine="present"></div> only what this page loaded
 *
 * Zero dependencies · CSP-safe (external file, no fetch, no eval, no innerHTML) ·
 * reads --luv-pulse from :root when luv-pulse.js is present, imports nothing.
 * prefers-reduced-motion: renders once, static. Self-boots on DOMContentLoaded.
 */
(function (global) {
  'use strict';

  var VERSION = '1.1.0';
  var SEAM = '#4a1f30', ROSE = '#ff4d6d', GOLD = '#e3b25f', DIM = '#b98da0', CREAM = '#f6e7eb';

  // The organs, in the order the engine grew them. `global` is the window symbol the
  // organ publishes — presence of that symbol IS the proof the organ is loaded.
  var ORGANS = [
    { key: 'pulse',   name: 'the pulse',      file: 'substrate/luv-pulse.js',   sym: 'DVLuvPulse',
      commitment: 'a shared rhythm owned by no one',
      role: 'chronos-locked 1 Hz frequency output — 60 bpm, phase-identical for every visitor' },
    { key: 'heart',   name: 'the heart',      file: 'substrate/heart.js',       sym: 'LUVHeart',
      commitment: 'consent over default',
      role: 'the visual organ — favicon and page retime, created only on consent' },
    { key: 'frame',   name: 'the frame',      file: 'substrate/luv-frame.js',   sym: 'DVLuvFrame',
      commitment: 'a boundary that contains, never intercepts',
      role: 'the octagon world-edge worn as the page frame; breathes with the pulse' },
    { key: 'drip',    name: 'the drip',       file: 'substrate/luv-drip.js',    sym: 'DVLuvDrip',
      commitment: 'precision without approximation',
      role: 'meters LUV continuously; settles once, as one integer of luv' },
    { key: 'wei',     name: 'the wei',        file: 'substrate/luv-wei.js',     sym: 'DVLuvWei',
      commitment: 'rounding is a display decision, never a storage decision',
      role: 'the atom — 1 luv = 0.000000000000000001 LUV, full-width arithmetic' },
    { key: 'market',  name: 'the market',     file: 'substrate/luv-market.js',  sym: 'DVLuvMarket',
      commitment: 'the pair creates the price; aggregators are never the source',
      role: 'reserves-first price, read from the pool and block-anchored' },
    { key: 'rainbow', name: 'the rainbow',    file: 'substrate/luv-rainbow.js', sym: 'DVLuvRainbow',
      commitment: 'a published fit anyone can redraw',
      role: 'the in-house rainbow drawn live from the fit — zero calls, zero deps' },
    { key: 'share',   name: 'the share',      file: 'substrate/luv-share.js',   sym: 'DVLuvShare',
      commitment: 'sharing is the marketing',
      role: 'the gesture outward — share intents, no trackers' },
    { key: 'automindx', name: 'automindx',    file: 'substrate/luv-automindx.js', sym: 'DVLuvAutoMindX',
      commitment: 'an attending mind is an attending mind, whether neurons or weights',
      role: 'the cognition organ — the agentic reader of the field (mindX automindx). NOT YET BUILT: '
          + 'listed because a commitment without an organ is a gap the engine should show, not hide' }
  ];

  // Lineage — the engine substrate is an evolution, and says so:
  //   DeltaVerse engine/sane-substrate.js   builds the world INSIDE  (point -> line -> stage)
  //     -> substrate/luv-frame.js           draws the boundary AROUND (the octagon world-edge)
  //       -> substrate/luv-engine.js        looks INWARD and names what the engine is made of
  // Frame answered "where does the world end?". Engine answers "what is the world made of, and
  // which commitment does each part discharge?" — the same octagon discipline turned on itself.
  var LINEAGE = [
    { file: 'engine/sane-substrate.js', where: 'DeltaVerse', role: 'builds the world inside' },
    { file: 'substrate/luv-frame.js',   where: 'SHAMBA LUV', role: 'draws the boundary around' },
    { file: 'substrate/luv-engine.js',  where: 'SHAMBA LUV', role: 'names what the engine is made of' }
  ];

  function probe(sym) {
    try { return typeof global[sym] !== 'undefined' && global[sym] !== null; }
    catch (e) { return false; }
  }

  function organs() { return ORGANS.map(function (o) { return o; }); }
  function present(key) {
    for (var i = 0; i < ORGANS.length; i++) if (ORGANS[i].key === key) return probe(ORGANS[i].sym);
    return false;
  }
  function status() {
    return ORGANS.map(function (o) {
      return { key: o.key, name: o.name, file: o.file, sym: o.sym, role: o.role,
               commitment: o.commitment, present: probe(o.sym) };
    });
  }
  function count() {
    var n = 0, s = status();
    for (var i = 0; i < s.length; i++) if (s[i].present) n++;
    return { present: n, total: s.length };
  }

  function el(tag, css, text) {
    var n = document.createElement(tag);
    if (css) n.setAttribute('style', css);
    if (text != null) n.appendChild(document.createTextNode(text));
    return n;
  }

  // ── the inventory, rendered ────────────────────────────────────────────────────────
  function render(mount) {
    var onlyPresent = (mount.getAttribute('data-luvengine') || '').toLowerCase() === 'present';
    var rows = status().filter(function (o) { return onlyPresent ? o.present : true; });
    var reduced = false;
    try { reduced = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches; }
    catch (e) { /* older engines */ }

    var box = el('div', 'border:1px solid ' + SEAM + ';border-radius:14px;overflow:hidden;margin:18px 0');
    var head = el('div', 'display:flex;flex-wrap:wrap;gap:10px;align-items:baseline;padding:13px 16px;' +
      'border-bottom:1px solid ' + SEAM + ';background:rgba(0,0,0,.2)');
    var t = el('span', 'font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11px;' +
      'letter-spacing:.22em;text-transform:uppercase;color:' + GOLD + ';font-weight:700', 'the engine — its organs');
    head.appendChild(t);
    head.appendChild(el('span', 'flex:1'));
    var c = count();
    var dot = el('span', 'display:inline-block;width:7px;height:7px;border-radius:50%;background:' + ROSE +
      ';margin-right:7px;vertical-align:middle' + (reduced ? '' : ';transition:opacity .3s ease'));
    dot.className = 'luvengine-dot';
    var tally = el('span', 'font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11px;color:' + DIM);
    tally.appendChild(dot);
    tally.appendChild(document.createTextNode(c.present + ' of ' + c.total + ' loaded on this page'));
    head.appendChild(tally);
    box.appendChild(head);

    rows.forEach(function (o, i) {
      var r = el('div', 'padding:13px 16px' + (i ? ';border-top:1px solid ' + SEAM : ''));
      var l1 = el('div', 'display:flex;flex-wrap:wrap;gap:9px;align-items:baseline');
      l1.appendChild(el('span', 'font-weight:700;color:' + (o.present ? CREAM : DIM), o.name));
      l1.appendChild(el('code', 'font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11px;color:' + DIM, o.file));
      l1.appendChild(el('span', 'flex:1'));
      l1.appendChild(el('span', 'font-family:ui-monospace,Menlo,Consolas,monospace;font-size:10px;' +
        'letter-spacing:.12em;text-transform:uppercase;color:' + (o.present ? '#7ee2a0' : DIM),
        o.present ? '● loaded' : '○ not on this page'));
      r.appendChild(l1);
      r.appendChild(el('div', 'font-size:13px;color:' + DIM + ';margin-top:4px', o.role));
      var cm = el('div', 'font-size:12px;color:' + DIM + ';margin-top:3px;font-style:italic');
      cm.appendChild(document.createTextNode('implements: ' + o.commitment));
      r.appendChild(cm);
      box.appendChild(r);
    });

    var foot = el('div', 'padding:11px 16px;border-top:1px solid ' + SEAM + ';background:rgba(0,0,0,.2);' +
      'font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11px;color:' + DIM);
    foot.appendChild(document.createTextNode(
      'DVLuvEngine v' + VERSION + ' — an organ enters the engine only as the implementation of a stated commitment.'));
    box.appendChild(foot);
    // swap only now — everything above could have thrown, and the page-rendered
    // fallback inside the mount is better than an empty div
    while (mount.firstChild) mount.removeChild(mount.firstChild);
    mount.appendChild(box);

    // the tally dot breathes with the pulse when the pulse organ is present
    if (!reduced && probe('DVLuvPulse')) {
      var tick = function () {
        var v = 0;
        try {
          v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--luv-pulse')) || 0;
        } catch (e) { /* no custom property support */ }
        dot.style.opacity = String(0.45 + 0.55 * v);
        global.requestAnimationFrame(tick);
      };
      if (global.requestAnimationFrame) global.requestAnimationFrame(tick);
    }
  }

  // ── add LUV to the wallet (EIP-747 wallet_watchAsset) ─────────────────────────────
  // The token is the same on every surface, so the parameters live here once. The icon
  // is served from this origin (gfx/heart-512.png, 512x512, 71 KB) — a square PNG is
  // what wallets want, and self-hosting it keeps the zero-dependency commitment.
  var TOKEN = {
    address: '0x2711111111683B8708cb9a48cBf36a51315F8254',
    symbol: 'LUV',
    decimals: 18,
    image: 'gfx/heart-512.png'
  };

  function absolute(path) {
    try { return new URL(path, global.location.href).href; } catch (e) { return path; }
  }

  function watchAsset(btn) {
    var eth = global.ethereum;
    var say = function (msg) {
      if (!btn) return;
      var prev = btn.getAttribute('data-label') || btn.textContent;
      btn.setAttribute('data-label', prev);
      btn.textContent = msg;
      global.setTimeout(function () { btn.textContent = prev; }, 3200);
    };
    if (!eth || typeof eth.request !== 'function') {
      say('no wallet detected ↗');
      return Promise.resolve(false);
    }
    return eth.request({
      method: 'wallet_watchAsset',
      params: {
        type: 'ERC20',
        options: {
          address: TOKEN.address, symbol: TOKEN.symbol,
          decimals: TOKEN.decimals, image: absolute(TOKEN.image)
        }
      }
    }).then(function (ok) {
      say(ok ? '❤ LUV added' : 'not added');
      return !!ok;
    }).catch(function () { say('not added'); return false; });
  }

  function wireWatchAsset() {
    var btns = document.querySelectorAll('[data-luv-watchasset]');
    for (var i = 0; i < btns.length; i++) {
      (function (b) {
        b.addEventListener('click', function (e) { e.preventDefault(); watchAsset(b); });
      })(btns[i]);
    }
  }

  // ── hearts, emitted on hover ──────────────────────────────────────────────────────
  // Wired to [data-luv-emit]. rAF only — no CSS keyframes, no injected stylesheet, so it
  // survives any style-src policy. Respects prefers-reduced-motion by simply not emitting.
  var HEART = 'gfx/heart.svg';
  function emitHeart(host) {
    var r;
    try { r = host.getBoundingClientRect(); } catch (e) { return; }
    var img = document.createElement('img');
    img.src = absolute(HEART);
    img.alt = '';
    img.setAttribute('aria-hidden', 'true');
    var size = 12 + Math.floor(((r.width || 100) % 7)) + (heartSeed++ % 9);
    var x0 = r.left + r.width * (0.15 + ((heartSeed * 37) % 70) / 100);
    var y0 = r.top + r.height * 0.55;
    var drift = (((heartSeed * 53) % 40) - 20);
    img.setAttribute('style',
      'position:fixed;left:' + x0 + 'px;top:' + y0 + 'px;width:' + size + 'px;height:' + size +
      'px;pointer-events:none;z-index:9999;opacity:.95;will-change:transform,opacity');
    document.body.appendChild(img);
    var t0 = null, LIFE = 1100;
    function step(t) {
      if (t0 === null) t0 = t;
      var k = (t - t0) / LIFE;
      if (k >= 1) { if (img.parentNode) img.parentNode.removeChild(img); return; }
      img.style.transform = 'translate(' + (drift * k) + 'px,' + (-70 * k) + 'px) scale(' + (1 - 0.35 * k) + ')';
      img.style.opacity = String(0.95 * (1 - k));
      global.requestAnimationFrame(step);
    }
    global.requestAnimationFrame(step);
  }
  var heartSeed = 1;
  function wireEmitters() {
    var reduced = false;
    try { reduced = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches; }
    catch (e) { /* older engines */ }
    if (reduced || !global.requestAnimationFrame) return;
    var hosts = document.querySelectorAll('[data-luv-emit]');
    for (var i = 0; i < hosts.length; i++) {
      (function (h) {
        var timer = 0;
        h.addEventListener('mouseenter', function () {
          if (timer) return;
          heartSeed++; emitHeart(h);
          timer = global.setInterval(function () { heartSeed++; emitHeart(h); }, 190);
        });
        h.addEventListener('mouseleave', function () {
          if (timer) { global.clearInterval(timer); timer = 0; }
        });
      })(hosts[i]);
    }
  }

  function boot() {
    if (global.__luvEngineBooted) return;
    global.__luvEngineBooted = true;
    var mounts = document.querySelectorAll('[data-luvengine]');
    for (var i = 0; i < mounts.length; i++) {
      try { render(mounts[i]); }
      catch (e) {
        // A silent catch here once hid a non-rendering mount for an entire session.
        // One bad mount still never breaks the page — but it never hides either.
        try { (global.console && global.console.warn)('[luv-engine] render failed:', e); } catch (_) {}
        // the mount still holds its server-rendered list — nothing to restore
      }
    }
    try { wireWatchAsset(); } catch (e) { /* a wallet-less page still renders */ }
    try { wireEmitters(); } catch (e) { /* motion is a courtesy, never a requirement */ }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  global.DVLuvEngine = {
    version: VERSION, organs: organs, status: status, present: present, count: count,
    render: render, token: TOKEN, watchAsset: watchAsset,
    lineage: function () { return LINEAGE.map(function (l) { return l; }); },
    emit: emitHeart
  };
})(typeof window !== 'undefined' ? window : this);
