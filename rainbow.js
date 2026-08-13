'use strict';
/*
 * rainbow.js — gated delivery of the in-house Bitcoin rainbow chart.
 * The chart SVG is served by GET /auth/rainbow ONLY to a live session (wallet signature
 * or social login). Unauthenticated visitors see the gate; the prose stays public.
 * CSP-safe: external file, same-origin fetches only, no eval, no inline handlers.
 * Every .chartbox gets +/− zoom. Static charts widen inside their scrolling box;
 * the substrate rainbow ([data-luvrainbow]) instead steps a PRICE-SCALE LADDER —
 * the ceiling walks $10k → $100k → $1M → $10M → $100M → $1B → $2B → $10B → $100B
 * → $1T → $2T → $10T → $100T, re-rendered by DVLuvRainbow at every step.
 */
(function () {
  var MIN = 1, MAX = 4, STEP = 1.25;
  function makeRow(box) {
    var row = document.createElement('div');
    row.className = 'zoomrow';
    var minus = document.createElement('button');
    minus.type = 'button'; minus.textContent = '−'; minus.setAttribute('aria-label', 'zoom out');
    var lvl = document.createElement('span');
    lvl.className = 'zoomlvl';
    var plus = document.createElement('button');
    plus.type = 'button'; plus.textContent = '+'; plus.setAttribute('aria-label', 'zoom in');
    row.appendChild(minus); row.appendChild(lvl); row.appendChild(plus);
    box.parentNode.insertBefore(row, box);
    return { minus: minus, lvl: lvl, plus: plus };
  }
  // width zoom — the static SVGs can't re-render, so they widen
  function addWidthZoom(box) {
    var c = makeRow(box), z = 1;
    function apply() {
      var svg = box.querySelector('svg');
      if (svg) svg.style.width = (z * 100) + '%';
      c.lvl.textContent = Math.round(z * 100) + '%';
      c.minus.disabled = z <= MIN; c.plus.disabled = z >= MAX;
    }
    c.minus.addEventListener('click', function () { z = Math.max(MIN, z / STEP); apply(); });
    c.plus.addEventListener('click', function () { z = Math.min(MAX, z * STEP); apply(); });
    apply();
    box._applyZoom = apply; // re-apply after late SVG injection (the gated chart)
  }
  // scale-ladder zoom — the substrate rainbow re-renders at an explicit price ceiling
  function addScaleZoom(box, mount) {
    var RB = window.DVLuvRainbow;
    if (!RB) { addWidthZoom(box); return; }
    var c = makeRow(box);
    // $100M — the whole 2010–2040 fit fits under it. A mount drawing a shorter window says so with
    // data-zoomstart, because a ceiling chosen for 2140 leaves a near view as a stripe at the floor.
    var idx = mount.dataset.zoomstart ? Number(mount.dataset.zoomstart) : 4;
    if (!(idx >= 0 && idx < RB.SCALES.length)) idx = 4;
    function apply() {
      var o = mount._rainbowOpts || {};
      o.yMax = RB.SCALES[idx];
      RB.render(mount, o);
      c.lvl.textContent = RB.SCALE_LABELS[idx];
      // + zooms IN (lower ceiling), − zooms OUT (higher ceiling)
      c.plus.disabled = idx <= 0; c.minus.disabled = idx >= RB.SCALES.length - 1;
    }
    c.plus.addEventListener('click', function () { if (idx > 0) { idx--; apply(); } });
    c.minus.addEventListener('click', function () { if (idx < RB.SCALES.length - 1) { idx++; apply(); } });
    apply();
  }

  // ── the live price: every fifteen minutes, from the free tier ────────────────
  // The rainbow's you-are-here dot was pinned to a dated figure, which is fine for a fit
  // drawn in decades and wrong for a page someone opens today. market.json carries btcUsd,
  // refreshed server-side at most every 15 minutes from DeFiLlama's keyless tier — the
  // browser cannot fetch that itself (CSP: connect-src 'self'), so it arrives same-origin.
  // We re-render on the same 15-minute cadence, and again whenever a hidden tab comes back,
  // so a window left open overnight is never quietly stale.
  var PRICE_TTL_MS = 15 * 60 * 1000;
  var lastPriceAt = 0;
  var lastRead = null;      // the last good reading, so a chart mounted later is never blank-dated

  function fmtUsd(v) {
    return '$' + Math.round(v).toLocaleString('en-US');
  }

  function paintCaption(mount, price, atMs, stale) {
    var box = mount.parentNode;
    if (!box || !box.parentNode) return;
    var cap = box.nextElementSibling;
    if (!cap || cap.className !== 'livecap') {
      cap = document.createElement('div');
      cap.className = 'livecap';
      box.parentNode.insertBefore(cap, box.nextSibling);
    }
    var when = new Date(atMs).toISOString().slice(11, 16);
    cap.textContent = '● BTC ' + fmtUsd(price) + ' — the dot, live. Read ' + when
      + ' UTC from the free tier' + (stale ? ' (last good price — refetch failed)' : '')
      + ', refreshed every 15 minutes.';
  }

  function applyPrice(price, atMs, stale) {
    var RB = window.DVLuvRainbow;
    var mounts = document.querySelectorAll('[data-luvrainbow]');
    for (var i = 0; i < mounts.length; i++) {
      var m = mounts[i];
      // keep the attributes in step, so a zoom or debt toggle re-renders at the live price
      m.dataset.price = String(price);
      m.dataset.date = new Date(atMs).toISOString().slice(0, 10);
      if (RB) {
        var o = m._rainbowOpts || {};
        o.price = price;
        o.dateMs = atMs;
        RB.render(m, o);
      }
      paintCaption(m, price, atMs, stale);
    }
    // The arc is the other renderer of the same history, and it carries its own embedded series:
    // it takes the reading through setLive, which redraws every arc mount the organ has drawn into.
    // Without this the page's first chart sat at its last embedded close while the two below it
    // moved — the same picture disagreeing with itself.
    var RC = window.DVLuvRainbowChart;
    if (RC && RC.setLive) RC.setLive(price, atMs);
    var arcs = document.querySelectorAll('[data-luvrainbowchart],[data-rainbow-chart]');
    for (i = 0; i < arcs.length; i++) paintCaption(arcs[i], price, atMs, stale);
  }

  function refreshPrice(force) {
    if (!force && Date.now() - lastPriceAt < PRICE_TTL_MS) return;
    fetch('/market.json', { cache: 'no-store' }).then(function (r) {
      return r.ok ? r.json() : null;
    }).then(function (d) {
      if (!d || !(d.btcUsd > 0)) return;         // no price is better than a wrong dot
      lastPriceAt = Date.now();
      lastRead = { price: d.btcUsd, atMs: d.btcUsdAt || Date.now(),
                   stale: /(stale)/.test(d.btcUsdSource || '') };
      applyPrice(lastRead.price, lastRead.atMs, lastRead.stale);
    }).catch(function () { /* offline: the dated dot stands, and says its date */ });
  }

  // world-debt overlay toggle — only for the substrate rainbow, which carries the market-cap
  // reading the comparison needs. Re-renders through the organ from the mount's own options, so
  // the toggle can never disagree with what is drawn.
  function addDebtToggle(box, mount) {
    var RB = window.DVLuvRainbow;
    if (!RB) return;
    var row = box.previousSibling;
    if (!row || row.className !== 'zoomrow') return;
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'debtbtn';
    b.textContent = 'world debt';
    b.title = 'overlay total world debt on the market-cap scale (IIF aggregates, carried forward at 3.15%/yr)';
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', function () {
      var o = mount._rainbowOpts || {};
      o.debt = !o.debt;
      b.setAttribute('aria-pressed', o.debt ? 'true' : 'false');
      RB.render(mount, o);
    });
    row.insertBefore(b, row.firstChild);
  }

  function addZoom(box) {
    if (box.dataset.zoomed) return; box.dataset.zoomed = '1';
    var mount = box.querySelector('[data-luvrainbow]');
    if (mount) { addScaleZoom(box, mount); addDebtToggle(box, mount); } else addWidthZoom(box);
  }

  /// A box that gained a live rainbow AFTER boot — the gated one — needs its controls rebuilt:
  /// it was given the width zoom a static SVG wants, and now wants the scale ladder instead.
  function rewire(box) {
    var row = box.previousElementSibling;
    if (row && row.className === 'zoomrow') row.parentNode.removeChild(row);
    delete box.dataset.zoomed;
    box._applyZoom = null;
    addZoom(box);
  }

  /// Paint the last good reading onto whatever is on the page now, then top it up if it is old.
  /// A chart mounted between refreshes would otherwise wait up to fifteen minutes for its price.
  function republish() {
    if (lastRead) applyPrice(lastRead.price, lastRead.atMs, lastRead.stale);
    refreshPrice(false);
  }

  function boot() {
    var boxes = document.querySelectorAll('.chartbox');
    for (var i = 0; i < boxes.length; i++) addZoom(boxes[i]);
    // the dot goes live, and stays live
    refreshPrice(true);
    setInterval(function () { refreshPrice(true); }, PRICE_TTL_MS);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) refreshPrice(false); // a tab that comes back gets a fresh read
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  window.__rainbowZoomBoot = boot;
  window.__rainbowRewire = rewire;
  window.__rainbowRefresh = republish;
})();
(async function () {
  var gate = document.getElementById('gate');
  var box = document.getElementById('chartbox');
  var gated = document.querySelectorAll('.gated');
  if (!gate || !box) return;
  function unlock() {
    box.hidden = false;
    gate.hidden = true;
    for (var i = 0; i < gated.length; i++) gated[i].hidden = false;
  }

  try {
    var me = await fetch('/auth/me', { credentials: 'same-origin' });
    if (!me.ok) return; // no session — the gate stays

    // THE NEAR VIEW, DRAWN LIVE RATHER THAN DELIVERED FROZEN.
    // /auth/rainbow serves a static SVG generated when the page was last published, so the one
    // chart behind the handshake was the one chart still quoting the price of the day it was made.
    // A session now unlocks a chart the substrate draws in the browser, on the same fifteen-minute
    // reading as everything else here. The gate is unchanged — /auth/me still decides who sees it,
    // and the near window with its band prices is still what a session buys. The frozen SVG stays
    // as the fallback for a browser where the substrate did not load.
    var RB = window.DVLuvRainbow;
    if (RB) {
      var mount = document.createElement('div');
      mount.setAttribute('data-luvrainbow', '');
      mount.dataset.rainbowBooted = '1';   // this file renders it; the organ's self-boot must not
      mount.dataset.zoomstart = '3';       // $10M — the near window's ribbon, top to bottom
      mount._rainbowOpts = { from: 2010, to: 2030, height: 620 };
      box.textContent = '';
      box.appendChild(mount);
      unlock();
      if (window.__rainbowRewire) window.__rainbowRewire(box);
      else RB.render(mount, mount._rainbowOpts);
      if (window.__rainbowRefresh) window.__rainbowRefresh();
      return;
    }

    var r = await fetch('/auth/rainbow', { credentials: 'same-origin' });
    if (!r.ok) return;
    var svg = await r.text();
    // defense in depth: only inject if the payload is the expected SVG document
    if (svg.indexOf('<svg') !== 0) return;
    box.innerHTML = svg;
    unlock();
    if (box._applyZoom) box._applyZoom();
  } catch (_) {
    /* network error — the gate stays; the prose is already visible */
  }
})();
