/*!
 * SHAMBA LUV — story substrate (DVLuvStory): the organ of the shared card.
 *
 * The fifth turn of the substrate lineage:
 *   DeltaVerse engine/sane-substrate.js  builds the world INSIDE
 *     -> substrate/luv-frame.js          draws the boundary AROUND
 *       -> substrate/luv-engine.js       names WHAT THE WORLD IS MADE OF
 *         -> substrate/luv-automindx.js  says WHAT AN ARRIVING MIND MAY DO HERE
 *           -> substrate/luv-story.js    makes sure AN ARRIVING PERSON LANDS WHERE SENT
 *
 * The commitment it implements: A SHARED GESTURE ARRIVES EXACTLY WHERE IT WAS SENT.
 * A card is only shareable if the link lands on that card and says so — otherwise the
 * sender's aim is approximate, and approximation is a display decision here, never a
 * storage one. So this organ does three things and nothing else:
 *
 *   1. ARRIVAL — a page opened at #card marks that card as the one you were sent,
 *      for four beats, so there is no hunting.
 *   2. PLACE — the card you are reading is the card in the address bar (replaceState,
 *      never a navigation), so copying the URL at any moment copies where you are.
 *   3. HIGHLIGHT — the current card's edge breathes on the shared 1 Hz beat, reading
 *      `--luv-pulse` from :root exactly as the frame does. It imports nothing.
 *
 * Read it:  DVLuvStory.cards()    → [{id, el, index}] in document order
 *           DVLuvStory.current()  → the card being read, or null
 *           DVLuvStory.count()    → {index, total} — where you are in the story
 *           DVLuvStory.highlight(id) → mark a card as arrived-at, programmatically
 * Mount it: any element with [data-luvcard] (or .luvcard[id]) is a card.
 *           <span data-luvstory-progress></span> renders "card 3 of 10 · #market".
 * Listen:   document.addEventListener('luv:story:card', e => e.detail.id)
 *
 * prefers-reduced-motion: the breath is dropped; arrival and place still hold, because
 * they are information, not decoration. Zero dependencies · CSP-safe (external file, no
 * fetch, no eval, no innerHTML) · reads only globals other organs already published.
 */
(function (global) {
  'use strict';

  var VERSION = '1.0.0';
  var ARRIVE_MS = 4000;   // four beats at the pulse organ's 1 Hz
  var FPS_MS = 33;        // ~30fps draw gate; the pulse is 1 Hz, this is plenty
  var ANCHOR_AT = 0.34;   // the reading line: a third down the viewport

  var cards = [], current = null, arrived = null, arriveUntil = 0;
  var raf = 0, last = 0, lastGlow = -1, reduced = false;

  function reducedMotion() {
    try { return !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches); }
    catch (e) { return false; }
  }

  function collect() {
    var out = [], seen = {};
    var nodes = document.querySelectorAll('[data-luvcard],.luvcard');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i], id = el.id;
      if (!id || seen[id]) continue;          // a card without an anchor cannot be sent
      seen[id] = 1;
      out.push({ id: id, el: el, index: out.length });
    }
    return out;
  }

  // the heart if it beats here, else our own 1 Hz — the same phase law the frame obeys
  function pulse() {
    var v = NaN;
    try { v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--luv-pulse')); }
    catch (e) { /* no style engine */ }
    if (v >= 0 && v <= 1) return v;
    var ms = Date.now() % 1000;
    return 0.5 - 0.5 * Math.cos(ms / 1000 * 2 * Math.PI);
  }

  function progressText() {
    if (!current) return cards.length ? 'card — of ' + cards.length : '';
    return 'card ' + (current.index + 1) + ' of ' + cards.length + ' · #' + current.id;
  }

  function paintProgress() {
    var mounts = document.querySelectorAll('[data-luvstory-progress]');
    for (var i = 0; i < mounts.length; i++) mounts[i].textContent = progressText();
  }

  function setCurrent(card) {
    if (current === card) return;
    if (current) current.el.classList.remove('is-current');
    current = card;
    if (current) current.el.classList.add('is-current');
    paintProgress();
    try {
      // the address bar follows the reading, but never as a navigation: replaceState
      // leaves the back button alone, so following a shared card and going back works.
      if (current && global.history && history.replaceState &&
          location.hash !== '#' + current.id) {
        history.replaceState(null, '', '#' + current.id);
      }
    } catch (e) { /* file:// or a strict engine — place is a courtesy, not a requirement */ }
    announce();
  }

  function announce() {
    try {
      var d = { id: current ? current.id : null, index: current ? current.index : -1, total: cards.length };
      var ev;
      if (typeof global.CustomEvent === 'function') ev = new global.CustomEvent('luv:story:card', { detail: d });
      else { ev = document.createEvent('CustomEvent'); ev.initCustomEvent('luv:story:card', false, false, d); }
      document.dispatchEvent(ev);
    } catch (e) { /* announcement is a courtesy */ }
  }

  function byId(id) {
    for (var i = 0; i < cards.length; i++) if (cards[i].id === id) return cards[i];
    return null;
  }

  // mark a card as the one you were sent — four beats, then it rejoins the others
  function highlight(id) {
    var card = typeof id === 'string' ? byId(id) : id;
    if (!card) return null;
    if (arrived && arrived !== card) arrived.el.classList.remove('is-arrived');
    arrived = card;
    arriveUntil = Date.now() + ARRIVE_MS;
    card.el.classList.add('is-arrived');
    if (reduced) {
      // no loop is running to clear it, so clear it on its own schedule
      global.setTimeout(function () {
        if (arrived === card) { card.el.classList.remove('is-arrived'); arrived = null; }
      }, ARRIVE_MS);
    }
    return card;
  }

  function spy() {
    if (!cards.length) return;
    var line = (global.innerHeight || 600) * ANCHOR_AT;
    var best = null, bestD = Infinity;
    for (var i = 0; i < cards.length; i++) {
      var r = cards[i].el.getBoundingClientRect();
      if (r.bottom < 0 || r.top > (global.innerHeight || 600)) continue;   // off screen
      var d = Math.abs(r.top - line);
      // a card straddling the reading line wins outright
      if (r.top <= line && r.bottom >= line) { best = cards[i]; break; }
      if (d < bestD) { bestD = d; best = cards[i]; }
    }
    if (best) setCurrent(best);
  }

  function tick(t) {
    raf = global.requestAnimationFrame(tick);
    if (t - last < FPS_MS) return;
    last = t;
    if (arrived && Date.now() > arriveUntil) { arrived.el.classList.remove('is-arrived'); arrived = null; }
    if (!current) return;
    // one custom property, written only when it actually moves — the card's own edge
    // breathes with the site's heart, and CSS decides what breathing looks like.
    var v = Math.round(pulse() * 100) / 100;
    if (v === lastGlow) return;
    lastGlow = v;
    try { current.el.style.setProperty('--luv-story-glow', String(v)); } catch (e) { /* ignore */ }
  }

  function boot() {
    if (global.__luvStoryBooted) return;
    global.__luvStoryBooted = true;
    reduced = reducedMotion();
    cards = collect();
    if (!cards.length) return;

    var onScroll = function () { spy(); };
    global.addEventListener('scroll', onScroll, { passive: true });
    global.addEventListener('resize', onScroll);
    global.addEventListener('hashchange', function () {
      var id = (location.hash || '').replace(/^#/, '');
      if (id) highlight(id);
    });

    // ARRIVAL IS READ FIRST, before anything can rewrite the hash. spy() replaces the
    // hash the moment it picks a card, so spying before reading would erase the very
    // thing we were sent — the aim would survive the link and die on arrival.
    var hash = (location.hash || '').replace(/^#/, '');
    var landed = hash ? byId(hash) : null;
    if (landed) {
      highlight(landed);
      setCurrent(landed);
    } else {
      spy();
    }
    paintProgress();

    if (!reduced) raf = global.requestAnimationFrame(tick);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  global.DVLuvStory = {
    version: VERSION,
    cards: function () {
      return cards.map(function (c) { return { id: c.id, index: c.index, el: c.el }; });
    },
    current: function () { return current ? { id: current.id, index: current.index, el: current.el } : null; },
    count: function () { return { index: current ? current.index + 1 : 0, total: cards.length }; },
    highlight: highlight,
    refresh: function () { cards = collect(); spy(); paintProgress(); return cards.length; }
  };
})(typeof window !== 'undefined' ? window : this);
