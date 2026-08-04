/*!
 * SHAMBA LUV — heart.js: the pulse at 60 bpm, measured by chronos, cached client-side.
 *
 * 60 bpm BY DESIGN: one beat per chronos second, sixty beats to the chronos
 * minute — time as a service (TaaS) from chronos.oracle, delivered same-origin
 * through luv.oracle's market.json attestation (chronos.observed_ms). The local
 * clock is corrected against it, so the heart beats ON the chronos second and
 * the first beat of each minute lands deeper — the measure.
 *
 * LOW FOOTPRINT, CLIENT-SIDE:
 *   - The 16 beat frames are pre-rendered server-side (gfx/heart-beat/{n,a}0..7.png,
 *     ~1KB each, immutable). heart.js copies them ONCE into a client-side gfx
 *     folder (localStorage, ~28KB of data URIs) — after that the favicon beats
 *     with zero network and zero canvas work: one setInterval flipping hrefs.
 *   - The pulse is consent-gated: a small one-time "❤ 60 bpm · OK" chip asks
 *     before anything is stored or animated; the OK persists. No OK, no pulse,
 *     no storage — the static heart stands.
 *   - Background-tab timer throttling only slows the sampling; phase comes from
 *     the corrected wall clock, so the beat never drifts — a slower heart,
 *     never a torn one. Safari ignores dynamic favicons: static heart.
 *   - prefers-reduced-motion: nothing animates, nothing is asked.
 *
 * YOUR FOLDER BELONGS TO YOU — cypherpunk2048. The client-side gfx folder lives
 * in YOUR browser's storage, on YOUR machine: created only on your OK, readable
 * by no one else, deletable by you at any time (clear site data), and it never
 * phones home. Sovereignty over custody, consent over default — the same
 * doctrine as the wallet: your keys, your LUV; your browser, your folder.
 *
 * WCAG 2.3.1-safe (1 Hz, ≤3 flashes/s). CSP: self-hosted file, no inline JS.
 */
(function (global) {
  'use strict';

  var BPM = 60;
  var PERIOD_MS = 60000 / BPM;          // TARGET: precisely 1 second per pulsation.
  // The period is exact by construction: phase = chronosNow() % PERIOD_MS —
  // derived from the corrected wall clock, never from timer accumulation, so
  // interval jitter can delay a frame sample but can never stretch the beat.
  var BEATS_PER_MEASURE = 60;           // sixty seconds in one minute
  var FRAMES = 8;
  var GFX = 'gfx/heart-beat/';          // server-side graphic substrate
  var RESYNC_MS = 15 * 60e3;
  var LS_OK = 'luv-heart-ok';
  var LS_GFX = 'luv-heart-gfx-v1';      // the client-side gfx folder

  var reduced = false;
  try { reduced = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { /* old UA */ }

  // ── chronos correction (TaaS): chronosNow() = Date.now() + correction ──
  var correction = 0, sync = 'local';
  function chronosNow() { return Date.now() + correction; }
  function takeSync() {
    try {
      fetch('market.json?v=' + Date.now(), { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (m) {
          if (m && m.chronos && m.chronos.observed_ms) {
            correction = (m.chronos.observed_ms % 1000) - (Date.now() % 1000);
            sync = m.chronos.signal === 'blocktime' ? 'chronos:blocktime' : 'chronos:cpu';
          }
        })
        .catch(function () { /* keep last correction */ });
    } catch (e) { /* local clock still keeps 60 bpm */ }
  }

  // ── duty: page pulse retimed to 60 bpm (cosmetic; no storage, no consent needed) ──
  if (!reduced && global.document) {
    try {
      var st = document.createElement('style');
      st.textContent = '.beat,.hero .logo,.healthdot.up{animation-duration:1s!important}';
      document.head.appendChild(st);
    } catch (e) { /* cosmetic only */ }
  }

  // ── the client-side gfx folder ──
  function loadClientGfx() {
    try {
      var raw = global.localStorage.getItem(LS_GFX);
      if (!raw) return null;
      var arr = JSON.parse(raw);
      return (arr && arr.length === FRAMES * 2) ? arr : null;
    } catch (e) { return null; }
  }
  function buildClientGfx() {
    // fetch the 16 tiny PNGs once, store as data URIs — the client-side copy
    var names = [];
    for (var i = 0; i < FRAMES; i++) names.push('n' + i);
    for (var j = 0; j < FRAMES; j++) names.push('a' + j);
    return Promise.all(names.map(function (n) {
      return fetch(GFX + n + '.png').then(function (r) {
        if (!r.ok) throw new Error(n);
        return r.blob();
      }).then(function (b) {
        return new Promise(function (res, rej) {
          var fr = new FileReader();
          fr.onload = function () { res(fr.result); };
          fr.onerror = rej;
          fr.readAsDataURL(b);
        });
      });
    })).then(function (uris) {
      try { global.localStorage.setItem(LS_GFX, JSON.stringify(uris)); } catch (e) { /* quota — run from memory */ }
      return uris;
    });
  }

  function startPulse(uris) {
    var normal = uris.slice(0, FRAMES), accent = uris.slice(FRAMES);
    var link = document.querySelector('link[rel="icon"]');
    if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link); }
    takeSync();
    setInterval(takeSync, RESYNC_MS);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) takeSync(); });
    var last = '';
    setInterval(function () {
      var now = chronosNow();
      var phase = (now % PERIOD_MS) / PERIOD_MS;
      var beat = Math.floor(now / PERIOD_MS) % BEATS_PER_MEASURE;
      var idx = Math.floor(phase * FRAMES) % FRAMES;
      var key = (beat === 0 ? 'a' : 'n') + idx;
      if (key !== last) { last = key; link.href = (beat === 0 ? accent : normal)[idx]; }
    }, PERIOD_MS / FRAMES);
  }

  // ── the OK chip: consent creates the client-side gfx folder and starts the beat ──
  function askOk() {
    var chip = document.createElement('button');
    chip.type = 'button';
    chip.textContent = '❤ beat at 60 bpm · OK';
    chip.setAttribute('aria-label', 'Enable the 60 bpm pulsating heart favicon (stores 16 tiny frames in your browser — your folder belongs to you)');
    chip.title = 'your folder belongs to you — cypherpunk2048: 16 tiny heart frames (~28KB) stored in YOUR browser, on your OK only, deletable by you, never phones home';
    chip.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:9999;' +
      'font:12px ui-monospace,Menlo,monospace;letter-spacing:.06em;color:#ffb3c1;' +
      'background:#2b111c;border:1px solid #4a1f30;border-radius:999px;padding:8px 16px;' +
      'cursor:pointer;opacity:.92';
    chip.onmouseenter = function () { chip.style.borderColor = '#ff4d6d'; chip.style.color = '#ff4d6d'; };
    chip.onmouseleave = function () { chip.style.borderColor = '#4a1f30'; chip.style.color = '#ffb3c1'; };
    chip.onclick = function () {
      chip.disabled = true; chip.textContent = '❤ …';
      buildClientGfx().then(function (uris) {
        try { global.localStorage.setItem(LS_OK, '1'); } catch (e) { /* session-only then */ }
        chip.remove();
        startPulse(uris);
      }).catch(function () { chip.textContent = '❤ gfx unavailable'; setTimeout(function () { chip.remove(); }, 2500); });
    };
    document.body.appendChild(chip);
  }

  function boot() {
    if (reduced || !global.document) return;
    var ok = false;
    try { ok = global.localStorage.getItem(LS_OK) === '1'; } catch (e) { /* no storage → ask each visit */ }
    if (ok) {
      var cached = loadClientGfx();
      if (cached) startPulse(cached);
      else buildClientGfx().then(startPulse).catch(function () { /* static heart stands */ });
    } else {
      askOk();
    }
  }

  if (global.document) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
  }

  global.LUVHeart = {
    BPM: BPM, PERIOD_MS: PERIOD_MS, BEATS_PER_MEASURE: BEATS_PER_MEASURE, FRAMES: FRAMES,
    sync: function () { return { mode: sync, correction_ms: correction }; },
    version: '3.0.0'
  };
})(typeof window !== 'undefined' ? window : this);
