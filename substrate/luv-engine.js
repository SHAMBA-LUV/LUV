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

  var VERSION = '1.9.0';
  var SEAM = '#4a1f30', ROSE = '#ff4d6d', GOLD = '#e3b25f', DIM = '#b98da0', CREAM = '#f6e7eb';

  // Where the organs are published. Each organ names its own file, so the inventory can
  // link every organ to itself — the copy running on this origin, and the source of record.
  // An organ that cannot be read cannot be verified, and the standard asks for no trust.
  var SRC = 'https://github.com/SHAMBA-LUV/LUV/blob/main/';

  // A colour per organ. Eleven rows of the same colour read as one wall of text; eleven
  // hues read as eleven things, and the eye finds the organ it came for. The pinned ones
  // are not decorative — the pulse wears the heart's rose, the frame its own gold, the
  // market the candle green, the rainbow its purple. The rest are spaced far enough apart
  // to stay distinguishable on the ink, including for the common colour deficiencies:
  // no judgement is ever carried by hue alone (presence is stated in words beside it).
  var HUE = {
    pulse: '#ff4d6d', heart: '#ff8fab', frame: '#e3b25f', drip: '#34d3eb', wei: '#b6f36a',
    market: '#0ecb81', rainbow: '#a06bff', share: '#58a6ff', engine: '#f7931a',
    story: '#ff5ec7', automindx: '#c0b3ff'
  };
  function hue(key) { return HUE[key] || CREAM; }

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
    { key: 'engine',  name: 'the engine',     file: 'substrate/luv-engine.js',  sym: 'DVLuvEngine',
      commitment: 'nothing is claimed that is not present',
      role: 'the inventory itself — names every organ and probes which of them this page loaded' },
    { key: 'story',   name: 'the story',     file: 'substrate/luv-story.js',   sym: 'DVLuvStory',
      commitment: 'a shared gesture arrives exactly where it was sent',
      role: 'the card you were sent is the card that opens, and the card you read is the one in the address bar' },
    { key: 'automindx', name: 'automindx',    file: 'substrate/luv-automindx.js', sym: 'DVLuvAutoMindX',
      commitment: 'an attending mind is an attending mind, whether neurons or weights',
      role: 'the cognition organ — keeper of the persona and the A2A capability card; a capability is '
          + 'claimed only if the organ implementing it is loaded (after mindX AutoMINDX)' }
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
      var col = hue(o.key);
      // the spine: a 3px rule in the organ's colour down the left of its row, plus the
      // name in the same colour. An absent organ keeps its identity and loses its weight.
      var r = el('div', 'padding:13px 16px 13px 13px;border-left:3px solid ' + col +
        ';opacity:' + (o.present ? '1' : '.62') + (i ? ';border-top:1px solid ' + SEAM : ''));
      var l1 = el('div', 'display:flex;flex-wrap:wrap;gap:9px;align-items:baseline');
      var chip = el('span', 'display:inline-block;width:8px;height:8px;border-radius:2px;background:' +
        col + ';margin-right:2px');
      chip.setAttribute('aria-hidden', 'true');
      l1.appendChild(chip);
      l1.appendChild(el('span', 'font-weight:700;color:' + col, o.name));
      // the organ's self-reference: the filename IS the link to the running file on this
      // origin, and `source ↗` is the published copy. Read either; they are the same bytes.
      var self = el('a', 'text-decoration:none;border-bottom:1px solid rgba(255,77,109,.32)');
      self.setAttribute('href', o.file);
      self.setAttribute('title', 'read ' + o.file + ' as this page loads it');
      self.appendChild(el('code', 'font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11px;color:' + DIM, o.file));
      l1.appendChild(self);
      var src = el('a', 'font-family:ui-monospace,Menlo,Consolas,monospace;font-size:10px;letter-spacing:.1em;' +
        'color:' + DIM + ';text-decoration:none;border-bottom:1px solid transparent', 'source ↗');
      src.setAttribute('href', SRC + o.file);
      src.setAttribute('target', '_blank');
      src.setAttribute('rel', 'noopener');
      src.setAttribute('title', 'the published source of ' + o.name);
      l1.appendChild(src);
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

  var ETH_MAINNET = '0x1';
  // Ethereum mainnet is present in every wallet, so a switch is enough — no addChain
  // fallback needed. Resolves false if the user declines; we then say so rather than
  // adding LUV to whatever network happened to be selected.
  function ensureEthereum(eth) {
    return eth.request({ method: 'eth_chainId' }).then(function (id) {
      if (String(id).toLowerCase() === ETH_MAINNET) return true;
      return eth.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: ETH_MAINNET }]
      }).then(function () { return true; }, function () { return false; });
    }, function () { return false; });
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
    return ensureEthereum(eth).then(function (onEth) {
      if (!onEth) { say('switch to Ethereum first'); return false; }
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
      });
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
  /// Release one heart from a host element. opts tunes the flight: {life, rise, drift, size,
  /// opacity}. The defaults are the hover emission this has always done; the ambient float below
  /// asks for a longer, taller, softer one.
  function emitHeart(host, opts) {
    opts = opts || {};
    var r;
    try { r = host.getBoundingClientRect(); } catch (e) { return; }
    // A host scrolled off the screen emits into nowhere — the hearts are position:fixed, so they
    // would be painted outside the viewport and thrown away. Skip the work entirely.
    var vh = global.innerHeight || 0, vw = global.innerWidth || 0;
    if (r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) return;
    var img = document.createElement('img');
    img.src = absolute(HEART);
    img.alt = '';
    img.setAttribute('aria-hidden', 'true');
    var size = opts.size || (12 + Math.floor(((r.width || 100) % 7)) + (heartSeed++ % 9));
    var x0 = r.left + r.width * (0.15 + ((heartSeed * 37) % 70) / 100);
    var y0 = r.top + r.height * (opts.from == null ? 0.55 : opts.from);
    var drift = (((heartSeed * 53) % 40) - 20) * (opts.drift || 1);
    var peak = opts.opacity == null ? 0.95 : opts.opacity;
    img.setAttribute('style',
      'position:fixed;left:' + x0 + 'px;top:' + y0 + 'px;width:' + size + 'px;height:' + size +
      'px;pointer-events:none;z-index:9999;opacity:' + peak + ';will-change:transform,opacity');
    document.body.appendChild(img);
    var t0 = null, LIFE = opts.life || 1100, RISE = opts.rise || 70;
    function step(t) {
      if (t0 === null) t0 = t;
      var k = (t - t0) / LIFE;
      if (k >= 1) { if (img.parentNode) img.parentNode.removeChild(img); return; }
      // a slow sideways sway on the way up, so a stream of hearts does not read as a column
      var sway = opts.sway ? Math.sin(k * Math.PI * 2) * opts.sway : 0;
      img.style.transform = 'translate(' + (drift * k + sway) + 'px,' + (-RISE * k) +
        'px) scale(' + (1 - 0.35 * k) + ')';
      img.style.opacity = String(peak * (1 - k));
      global.requestAnimationFrame(step);
    }
    global.requestAnimationFrame(step);
  }
  var heartSeed = 1;

  // ── hearts that float on their own, on the beat ────────────────────────────────────
  // [data-luv-float] releases a heart on the heartbeat rather than on a hover: the page beats at
  // exactly 1 Hz (substrate/luv-pulse.js), so the hearts leave on the same second for every
  // visitor, the way every other organ here is phase-shared. The attribute's value is how many
  // beats to wait between hearts — "2" is every other beat, for somewhere a heart a second would
  // be too much. One interval for the whole page, not one per host, and it stands down whenever
  // the tab is hidden. prefers-reduced-motion emits nothing at all.
  function wireFloat() {
    var reduced = false;
    try { reduced = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches; }
    catch (e) { /* older engines */ }
    if (reduced || !global.requestAnimationFrame) return;
    var hosts = document.querySelectorAll('[data-luv-float]');
    if (!hosts.length) return;
    var beat = 0;
    global.setInterval(function () {
      if (document.hidden) return;
      beat++;
      for (var i = 0; i < hosts.length; i++) {
        var every = Number(hosts[i].getAttribute('data-luv-float')) || 1;
        if (beat % every) continue;
        heartSeed++;
        emitHeart(hosts[i], { life: 2600, rise: 132, sway: 9, from: 0.72, opacity: 0.7 });
      }
    }, 1000);
  }
  function wireEmitters() {
    var reduced = false;
    try { reduced = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches; }
    catch (e) { /* older engines */ }
    if (reduced || !global.requestAnimationFrame) return;
    var hosts = document.querySelectorAll('[data-luv-emit]');
    for (var i = 0; i < hosts.length; i++) {
      (function (h) {
        var timer = 0;
        var start = function () {
          if (timer) return;
          heartSeed++; emitHeart(h);
          timer = global.setInterval(function () { heartSeed++; emitHeart(h); }, 190);
        };
        var stop = function () { if (timer) { global.clearInterval(timer); timer = 0; } };
        h.addEventListener('mouseenter', start);
        h.addEventListener('mouseleave', stop);
        // A hover is not the only way to touch a button. On a phone there IS no mouseenter,
        // so every heart on this page was invisible to anyone using one; a press now emits
        // for as long as the finger is down, and a keyboard focus emits too.
        h.addEventListener('pointerdown', start);
        h.addEventListener('pointerup', stop);
        h.addEventListener('pointercancel', stop);
        h.addEventListener('touchend', stop);
        h.addEventListener('focus', start);
        h.addEventListener('blur', stop);
      })(hosts[i]);
    }
  }

  // ── copy a URL to the clipboard ────────────────────────────────────────────────────
  // Wired to [data-luv-copy]; the attribute's value is the URL (relative is resolved
  // against this origin). Falls back to a hidden textarea + execCommand where the async
  // clipboard API is unavailable or refused. The label reports what happened.
  function wireCopy() {
    var els = document.querySelectorAll('[data-luv-copy]');
    for (var i = 0; i < els.length; i++) {
      (function (b) {
        var url = absolute(b.getAttribute('data-luv-copy') || '');
        b.addEventListener('click', function (e) {
          e.preventDefault();
          var prev = b.getAttribute('data-luv-label') || b.textContent;
          b.setAttribute('data-luv-label', prev);
          var done = function (ok) {
            b.textContent = ok ? '\u2705 link copied' : url;
            global.setTimeout(function () { b.textContent = prev; }, 2600);
          };
          if (global.navigator && global.navigator.clipboard && global.navigator.clipboard.writeText) {
            global.navigator.clipboard.writeText(url).then(function () { done(true); },
                                                          function () { done(false); });
            return;
          }
          try {
            var t = document.createElement('textarea');
            t.value = url; t.setAttribute('readonly', '');
            t.setAttribute('style', 'position:absolute;left:-9999px');
            document.body.appendChild(t); t.select();
            done(document.execCommand('copy'));
            document.body.removeChild(t);
          } catch (err) { done(false); }
        });
      })(els[i]);
    }
  }

  // ── the feeling of LUV: the pulse as expanding bands of frequency ──────────────────
  // The heart organ gives a single glow at 1 Hz. This widens it: every beat sheds a BAND
  // that expands outward and thins as it goes, and each band carries harmonics (the
  // fundamental and its 1/2 and 1/3 partials) so a pulse reads as a spectrum rather than
  // a ring. Phase is borrowed from --luv-pulse when luv-pulse.js is present, so the
  // feeling beats in the same phase as every other visitor's; absent it, it keeps its own
  // wall-clock 1 Hz. Canvas only — no fetch, no deps, nothing injected into the page CSS.
  // prefers-reduced-motion: one still band, structure without motion.
  var BAND_LIFE = 2600;          // ms for a band to cross the field and fade out
  var HARMONICS = [1, 0.5, 0.333333333333];   // fundamental + partials = the width

  // The pump runs red -> candle green, and it runs THROUGH BITCOIN ORANGE to get there.
  // Interpolating #ff2e4c straight to #0ecb81 in RGB passes through rgb(135,125,103) at the
  // half-beat — a dead khaki, the colour you always get crossing between complements in a linear
  // space. Routing the ramp through #f7931a keeps saturation up the whole way, and it borrows no
  // new colour: candle green and candle red are the frame's, the orange is the resting blend the
  // frame already leans on. Red at rest, orange on the rise, candle green at the top of the beat.
  var CORE_RED = [255, 46, 76], CORE_MID = [247, 147, 26], CORE_GREEN = [14, 203, 129];
  function mixRgb(a, b, t) {
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  }
  /// The beat's colour at envelope v — the two-leg ramp, red -> orange -> candle green.
  function pump(v) {
    v = v < 0 ? 0 : v > 1 ? 1 : v;
    return v < 0.5 ? mixRgb(CORE_RED, CORE_MID, v * 2) : mixRgb(CORE_MID, CORE_GREEN, (v - 0.5) * 2);
  }
  function rgba(c, a) {
    return 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + a.toFixed(3) + ')';
  }
  /// The heart, as the classic parametric curve — x = 16sin³t, y = 13cos t − 5cos 2t − 2cos 3t −
  /// cos 4t. Sampled rather than approximated with beziers: it is one closed loop, it needs no
  /// control points to tune, and 72 segments is already smoother than the pixels under it.
  function heartPath(ctx, cx, cy, s) {
    var k = s / 16, i, t, x, y;
    ctx.beginPath();
    for (i = 0; i <= 72; i++) {
      t = i / 72 * Math.PI * 2;
      x = 16 * Math.pow(Math.sin(t), 3);
      y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
      if (i === 0) ctx.moveTo(cx + x * k, cy + y * k); else ctx.lineTo(cx + x * k, cy + y * k);
    }
    ctx.closePath();
  }
  function Feel(mount) {
    this.mount = mount; this.canvas = null; this.ctx = null;
    this.raf = 0; this.bands = []; this.lastBeat = -1; this.dpr = 1;
    this.reduced = false;
    try { this.reduced = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches; }
    catch (e) { /* older engines */ }
  }
  Feel.prototype.phase = function () {
    var v = NaN;
    try { v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--luv-pulse')); }
    catch (e) { /* no style engine */ }
    if (v >= 0 && v <= 1) return v;
    var ms = Date.now() % 1000;
    return 0.5 - 0.5 * Math.cos(ms / 1000 * 2 * Math.PI);
  };
  Feel.prototype.fit = function () {
    var r = this.mount.getBoundingClientRect();
    this.dpr = Math.min(global.devicePixelRatio || 1, 2);
    this.w = Math.max(120, Math.floor(r.width));
    this.h = Math.max(60, Math.floor(r.height || 132));
    this.canvas.width = this.w * this.dpr;
    this.canvas.height = this.h * this.dpr;
    this.canvas.style.width = '100%';
    this.canvas.style.height = this.h + 'px';
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  };
  Feel.prototype.start = function () {
    if (this.canvas) return this;
    this.canvas = document.createElement('canvas');
    this.canvas.setAttribute('aria-hidden', 'true');
    this.canvas.setAttribute('style', 'display:block;width:100%;border-radius:14px');
    this.mount.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    var self = this;
    this.fit();
    this._onResize = function () { self.fit(); if (self.reduced) self.draw(0.5); };
    global.addEventListener('resize', this._onResize);
    if (this.reduced) { this.bands.push({ t0: Date.now() - BAND_LIFE * 0.45 }); this.draw(0.5); return this; }
    var tick = function () { self.raf = global.requestAnimationFrame(tick); self.draw(self.phase()); };
    this.raf = global.requestAnimationFrame(tick);
    return this;
  };
  Feel.prototype.draw = function (v) {
    var ctx = this.ctx, w = this.w, h = this.h, now = Date.now();
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);

    // a beat is the falling edge of the envelope — one band per heartbeat
    var beat = Math.floor(now / 1000);
    if (!this.reduced && beat !== this.lastBeat) { this.lastBeat = beat; this.bands.push({ t0: now }); }
    while (this.bands.length > 6) this.bands.shift();

    var cx = w / 2, cy = h / 2, maxR = Math.sqrt(cx * cx + cy * cy);

    // ── the core: a HEART, pumping red to candle green ──
    // It was a round glow, which read as a globe sitting in the middle of the bands. A heart is
    // what this page is about, so the core is drawn as one — and it pumps through the market's own
    // two colours rather than staying one hue: red at rest, candle green at the top of the beat,
    // the same #0ecb81 the candles and the frame use. The colour IS the envelope, so the eye reads
    // the beat twice over, in size and in hue.
    var beatRgb = pump(v);
    var glowR = 30 + 34 * v;
    var glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowR);
    glow.addColorStop(0, rgba(beatRgb, 0.30 + 0.34 * v));
    glow.addColorStop(1, rgba(beatRgb, 0));
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(cx, cy, glowR, 0, Math.PI * 2); ctx.fill();

    // the heart itself, swelling on the beat
    var hs = 17 + 9 * v;
    heartPath(ctx, cx, cy, hs);
    ctx.fillStyle = rgba(beatRgb, 0.72 + 0.24 * v);
    ctx.fill();
    ctx.lineWidth = 1.1;
    ctx.strokeStyle = rgba(mixRgb(beatRgb, [246, 231, 235], 0.45), 0.5 + 0.4 * v);
    ctx.stroke();

    // the bands — each beat expands outward, widening and thinning as it travels
    for (var i = 0; i < this.bands.length; i++) {
      var age = (now - this.bands[i].t0) / BAND_LIFE;
      if (age >= 1) continue;
      var ease = 1 - Math.pow(1 - age, 2);              // fast out, slow settle
      for (var k = 0; k < HARMONICS.length; k++) {
        var r = maxR * ease * HARMONICS[k];
        if (r < 2) continue;
        var alpha = (1 - age) * (0.40 - k * 0.09) * (0.55 + 0.45 * v);
        if (alpha <= 0) continue;
        ctx.beginPath();
        ctx.ellipse(cx, cy, r * 1.9, r, 0, 0, Math.PI * 2);   // wide bands, not circles
        ctx.lineWidth = 1 + 5 * age * (1 - k * 0.25);          // widens as it travels
        ctx.strokeStyle = (k === 0)
          ? 'rgba(255,0,110,' + alpha.toFixed(3) + ')'
          : (k === 1 ? 'rgba(179,59,214,' + alpha.toFixed(3) + ')'
                     : 'rgba(131,56,236,' + alpha.toFixed(3) + ')');
        ctx.stroke();
      }
    }
  };
  Feel.prototype.stop = function () {
    if (this.raf) global.cancelAnimationFrame(this.raf);
    if (this._onResize) global.removeEventListener('resize', this._onResize);
  };
  function wireFeel() {
    var mounts = document.querySelectorAll('[data-luvfeel]');
    for (var i = 0; i < mounts.length; i++) {
      try { new Feel(mounts[i]).start(); } catch (e) {
        try { (global.console && global.console.warn)('[luv-engine] feel failed:', e); } catch (_) {}
      }
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
    try { wireCopy(); } catch (e) { /* copy is a courtesy too */ }
    try { wireFeel(); } catch (e) { /* feeling is never a requirement */ }
    try { wireFloat(); } catch (e) { /* floating hearts are the softest courtesy of all */ }
  }
  // PUBLISH BEFORE BOOTING. The registry probes for the symbol each organ publishes —
  // including its own — so if boot() ran first (any load where readyState is already past
  // 'loading': defer, async, or an injected tag) the engine would render itself as "not on
  // this page" and under-report by one. The inventory must be able to count itself.
  global.DVLuvEngine = {
    version: VERSION, organs: organs, status: status, present: present, count: count,
    render: render, token: TOKEN, watchAsset: watchAsset, ensureEthereum: ensureEthereum, Feel: Feel,
    lineage: function () { return LINEAGE.map(function (l) { return l; }); },
    emit: emitHeart
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(typeof window !== 'undefined' ? window : this);
