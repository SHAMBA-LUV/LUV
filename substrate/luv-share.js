/*!
 * SHAMBA LUV — share substrate (new substrate; existing DeltaVerse substrates untouched).
 *
 * Makes every aspect of luv.pythai.net one tap to share: native Web Share where the
 * platform offers it, share-intent links (X · Telegram · WhatsApp) everywhere, and a
 * copy-link fallback. Shares carry the page's own OG card (each page ships landing-grade
 * meta).
 *
 * THE EARN SEAM (v1.2.0). Sharing is the marketing, and the IncentiveDistributor pays for it.
 * A mount that says data-earn="tweet" grows a second step under the buttons: post to X, paste
 * the link back, claim the LUV. It talks to three same-origin endpoints and nothing else —
 * GET /airdrop/actions (public registry), GET /airdrop/actions/mine (this identity's stats),
 * POST /airdrop/actions/submit {action, proofUrl}.
 *
 * THE AMOUNT IS NEVER OURS. This file displays the registry's own numbers and no others: the
 * reward, the daily limit and the cooldown all come from GET /airdrop/actions, which reads the
 * contract when it is live. If the chain and this page ever disagree, the chain is right and
 * this page is stale — it says so in the terms line rather than pretending otherwise.
 *
 * SHARING NEVER REQUIRES EARNING. The share buttons work signed out, always; the earn strip is
 * additive, and its absence costs the share nothing. That ordering is the point — the gesture
 * comes first and the reward follows it.
 *
 * Prototype lane (.js, UMD, zero-dep). Self-boots into every #luvshare mount.
 *   new DVLuvShare.Rail('#luvshare', { text: '…', earn: 'tweet' }).render();
 */
(function (global) {
  'use strict';

  var DEFAULT_TEXT = 'LUV is priceless — and now the market measures it. ' +
    'HOLD LUV to earn LUV: LUV grows when you hold LUV. ' +
    'SHAMBA LUV, live on Uniswap ❤ thanks a million millions https://luv.pythai.net';

  // The tasks rail, as the backend exposes it. Same-origin only: the page CSP is
  // connect-src 'self', and a share rail has no business reaching anywhere else.
  var API = {
    me:       '/auth/me',
    registry: '/airdrop/actions',
    mine:     '/airdrop/actions/mine',
    submit:   '/airdrop/actions/submit'
  };

  // Every error the submit endpoint can hand back, said in words a person can act on.
  // An unrecognised code is shown verbatim rather than swallowed — a silent failure on a
  // claim is worse than an ugly one.
  var SAYS = {
    login_required_today: 'earning starts with a fresh sign-in each day — sign in again, then claim.',
    already_submitted:    'that link is already in — one claim per post.',
    bad_proof_url:        'that does not look like a post link. Paste the URL of the post itself.',
    unknown_action:       'the rail is not paying for that right now.',
    inactive_action:      'the rail is not paying for that right now.',
    not_submittable:      'that one is automatic — there is nothing to submit.',
    invalid_request:      'the claim was malformed. Paste the post URL and try again.'
  };

  /// wei -> whole LUV, grouped. BigInt where the engine has it (exact), Number where it does
  /// not (this is a label, and approximation is a display decision).
  function luv(weiStr) {
    try {
      if (typeof BigInt === 'function') {
        return (BigInt(weiStr) / (10n ** 18n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      }
    } catch (e) { /* fall through */ }
    return Math.round(Number(weiStr) / 1e18).toLocaleString('en-US');
  }
  /// seconds -> the shortest honest unit
  function every(sec) {
    sec = Number(sec) || 0;
    if (!sec) return null;
    if (sec % 86400 === 0) return (sec / 86400) + 'd';
    if (sec % 3600 === 0) return (sec / 3600) + 'h';
    if (sec % 60 === 0) return (sec / 60) + 'm';
    return sec + 's';
  }
  function getJson(url) {
    return fetch(url, { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); });
  }

  // A rail shares ONE thing. By default that is the page it sits on, but a mount may name
  // its own target — so a card can share itself (its own anchor) and the swap button can
  // share the swap. data-url · data-text · data-label · data-note="off" · data-earn="tweet".
  function Rail(mount, opts) {
    this.root = typeof mount === 'string' ? document.querySelector(mount) : mount;
    opts = opts || {};
    var d = (this.root && this.root.dataset) || {};
    this.url = opts.url || d.url || (global.location && location.href) || 'https://luv.pythai.net/';
    this.text = opts.text || d.text || DEFAULT_TEXT;
    this.label = opts.label || d.label || null;
    this.note = opts.note === false ? false : d.note !== 'off';
    this.earn = opts.earn || d.earn || null;
    // THE ADVERTISING CEILING (data-earn-max, in whole LUV).
    // The registry is the final word on what the rail PAYS — this file never argues with it. But
    // a page can decline to ADVERTISE a figure it is not ready to stand behind, which is a
    // different thing. When the registry's reward is above this ceiling the terms line drops the
    // numbers and says only that the registry sets them; at or below it, the figures print.
    // So a contract still carrying its constructor seed does not get quoted as an offer, and the
    // moment the owner retunes it down to the published scale the figures appear here on their
    // own, with nothing to edit and nothing to remember.
    this.earnMax = Number(opts.earnMax || d.earnMax || 0) || 0;
  }

  Rail.prototype._btn = function (label, title, onClick, href) {
    var el = document.createElement(href ? 'a' : 'button');
    el.className = 'shr-btn'; el.textContent = label; el.title = title;
    if (href) { el.href = href; el.target = '_blank'; el.rel = 'noopener'; }
    else { el.type = 'button'; el.addEventListener('click', onClick); }
    return el;
  };

  Rail.prototype.render = function () {
    if (!this.root || this.root.dataset.booted) return this;
    this.root.dataset.booted = '1';
    var u = encodeURIComponent(this.url), t = encodeURIComponent(this.text), self = this;
    var row = document.createElement('div'); row.className = 'shr-row';
    var lead = document.createElement('span'); lead.className = 'shr-lead';
    if (this.label) {
      lead.appendChild(document.createTextNode(this.label + ' '));
      var h = document.createElement('span'); h.className = 'beat'; h.textContent = '❤';
      lead.appendChild(h);
    } else {
      lead.innerHTML = 'share the LUV <span class="beat">❤</span>';
    }
    row.appendChild(lead);

    if (global.navigator && navigator.share) {
      row.appendChild(this._btn('⤴ share', 'share via your device', function () {
        navigator.share({ title: document.title, text: self.text, url: self.url }).catch(function () {});
      }));
    }
    // If the caller's text already ends in the link, appending &url= posts it twice. The
    // DEFAULT_TEXT does carry one; a page that hands in its own usually does not.
    var xHref = 'https://twitter.com/intent/tweet?text=' + t +
                (this.text.indexOf(this.url) < 0 ? '&url=' + u : '');
    var xBtn = this._btn('𝕏 post', 'post on X', null, xHref);
    xBtn.setAttribute('data-luv-emit', '');   // luv-engine.js sheds hearts on hover, if present
    // Posting is the first half of earning, so it arms the second half: the claim box opens
    // and takes the cursor, ready for the link the user is about to come back with.
    xBtn.addEventListener('click', function () { if (self._arm) self._arm(); });
    row.appendChild(xBtn);
    row.appendChild(this._btn('✈ telegram', 'share on Telegram', null,
      'https://t.me/share/url?url=' + u + '&text=' + t));
    row.appendChild(this._btn('💬 whatsapp', 'share on WhatsApp', null,
      'https://wa.me/?text=' + t + '%20' + u));
    var copy = this._btn('⧉ copy link', 'copy the link', function () {
      (navigator.clipboard ? navigator.clipboard.writeText(self.url) : Promise.reject())
        .then(function () { copy.textContent = '✓ copied'; setTimeout(function () { copy.textContent = '⧉ copy link'; }, 1600); })
        .catch(function () { global.prompt && prompt('copy the link:', self.url); });
    });
    row.appendChild(copy);

    this.root.appendChild(row);
    if (this.note) {
      var note = document.createElement('div'); note.className = 'shr-note';
      note.textContent = 'phase 3 is live — sharing is caring: posting about LUV on X earns LUV. The rate, the cooldown and the daily limit are whatever the on-chain action registry says they are — it is the final word, and it is retuned as LUV appreciates.';
      this.root.appendChild(note);
    }
    if (this.earn) this._earnStrip();
    return this;
  };

  // ── the earn strip: post, paste, claim ────────────────────────────────────────────────
  // Three states, and it never blocks the share buttons above it:
  //   signed out  — the published terms, and the doorway
  //   signed in   — the terms, what is left of today, and the claim box
  //   submitted   — what the rail said back, in words
  Rail.prototype._earnStrip = function () {
    var self = this, action = this.earn;
    self.figures = true;                            // until the registry says otherwise
    if (!global.fetch) return;                      // no fetch, no rail; the share still works

    var box = document.createElement('div');
    box.className = 'shr-earn';
    var terms = document.createElement('div'); terms.className = 'shr-terms';
    terms.textContent = 'checking what the rail pays…';
    var body = document.createElement('div'); body.className = 'shr-claim';
    // Two lines, deliberately. The clock ticks once a second; the claim result must outlive it.
    // Sharing one element meant "that link is already in" was wiped before it could be read.
    var clock = document.createElement('div'); clock.className = 'shr-clock';
    var msg = document.createElement('div'); msg.className = 'shr-msg';
    box.appendChild(terms); box.appendChild(body); box.appendChild(clock); box.appendChild(msg);
    this.root.appendChild(box);

    function say(text, kind) {
      msg.textContent = text || '';
      msg.className = 'shr-msg' + (kind ? ' ' + kind : '');
    }
    function tickSay(text) { clock.textContent = text || ''; }

    // 1. the published terms — public, no session needed
    getJson(API.registry).then(function (reg) {
      var a = null, list = (reg && reg.actions) || [];
      for (var i = 0; i < list.length; i++) if (list[i].name === action) a = list[i];
      if (!a || !a.active) { box.parentNode && box.parentNode.removeChild(box); return null; }
      // above the ceiling the figures are withheld — see earnMax
      var whole = Number(a.reward) / 1e18;
      self.figures = !(self.earnMax > 0 && whole > self.earnMax);
      if (!self.figures) {
        terms.textContent = '❤ the rail pays LUV for posts about LUV. The rate, the daily limit '
          + 'and the cooldown are whatever the on-chain registry says — it is the final word, '
          + 'and it is retuned as LUV appreciates.';
        return a;
      }
      var bits = [luv(a.reward) + ' LUV a post'];
      if (a.dailyLimit) bits.push(a.dailyLimit + ' a day');
      var c = every(a.cooldown); if (c) bits.push(c + ' between');
      terms.textContent = '❤ ' + bits.join(' · ') + ' — ' + (reg.live
        ? 'read from the on-chain registry, which is the final word.'
        : 'the published terms; the on-chain registry is the final word once live.');
      return a;
    }).then(function (a) {
      if (!a) return;
      // 2. is anyone home?
      return getJson(API.me).then(function () { return a; }, function () {
        var p = document.createElement('div');
        p.appendChild(document.createTextNode('Posting is free and needs nobody. To be paid for it, '));
        var link = document.createElement('a'); link.href = '/'; link.textContent = 'sign in at the doorway';
        p.appendChild(link);
        p.appendChild(document.createTextNode(' and come back — the claim box opens here.'));
        body.appendChild(p);
        return null;
      });
    }).then(function (a) {
      if (!a) return;
      // 3. the claim box
      var label = document.createElement('label');
      label.className = 'shr-lbl';
      label.setAttribute('for', 'shr-proof-' + action);
      label.textContent = 'posted it? paste the link to your post:';
      var input = document.createElement('input');
      input.type = 'url'; input.id = 'shr-proof-' + action;
      input.className = 'shr-in'; input.placeholder = 'https://x.com/you/status/…';
      input.autocomplete = 'off'; input.spellcheck = false;
      var go = document.createElement('button');
      go.type = 'button'; go.className = 'shr-btn shr-go'; go.textContent = '❤ claim the LUV';

      var line = document.createElement('div'); line.className = 'shr-inrow';
      line.appendChild(input); line.appendChild(go);
      body.appendChild(label); body.appendChild(line);

      self._arm = function () {
        box.className = 'shr-earn armed';
        try { input.focus({ preventScroll: true }); } catch (e) { input.focus(); }
      };

      // What is left of today, and when the next one unlocks — from the contract's own per-user
      // stats, counted down live. The cooldown is the whole shape of the offer (a tweet every
      // eight hours, three a day), so it is a running clock rather than a number that was true
      // when the page loaded.
      getJson(API.mine).then(function (m) {
        var st = (m && m.stats && m.stats[action]) || null;
        if (!st) return;
        var left = a.dailyLimit ? Math.max(0, a.dailyLimit - (Number(st.countToday) || 0)) : null;
        // "2 of 10 left today" quotes the daily limit as plainly as the terms line would, so it
        // is withheld on the same rule. The clock stays either way: without it a user walks into
        // an invisible wall, and a countdown quotes no rate.
        var head = (left !== null && self.figures) ? left + ' of ' + a.dailyLimit + ' left today' : '';
        var nextAt = (st.lastAt && a.cooldown)
          ? (Number(st.lastAt) + Number(a.cooldown)) * 1000 : 0;

        function hhmmss(ms) {
          var t = Math.max(0, Math.ceil(ms / 1000));
          var h = Math.floor(t / 3600), mn = Math.floor((t % 3600) / 60), sc = t % 60;
          return (h ? h + ':' + ('0' + mn).slice(-2) : mn) + ':' + ('0' + sc).slice(-2);
        }
        function tick() {
          var rem = nextAt - Date.now();
          if (rem <= 0) {
            if (self._clock) { clearInterval(self._clock); self._clock = 0; }
            tickSay(head ? head + ' · ready — post and claim' : 'ready — post and claim');
            return;
          }
          tickSay((head ? head + ' · ' : '') + 'next in ' + hhmmss(rem));
        }
        if (nextAt > Date.now()) {
          tick();
          // one interval, cleared the moment it reaches zero; a hidden tab need not tick
          self._clock = setInterval(function () {
            if (!document.hidden) tick(); else if (nextAt - Date.now() <= 0) tick();
          }, 1000);
        } else if (head) {
          tickSay(head);
        }
      }, function () { /* stats are a courtesy; the claim works without them */ });

      function submit() {
        var proofUrl = (input.value || '').trim();
        if (!/^https?:\/\//i.test(proofUrl)) { say(SAYS.bad_proof_url, 'bad'); input.focus(); return; }
        go.disabled = true; say('claiming…');
        fetch(API.submit, {
          method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: action, proofUrl: proofUrl })
        }).then(function (r) {
          return r.json().then(function (d) { return { ok: r.ok, status: r.status, d: d }; },
                               function () { return { ok: false, status: r.status, d: {} }; });
        }).then(function (res) {
          go.disabled = false;
          if (res.status === 401) { say(SAYS.login_required_today, 'bad'); return; }
          if (res.status === 429) { say('easy — that is faster than the rail accepts. Try again shortly.', 'bad'); return; }
          if (!res.ok || (res.d && res.d.error)) {
            var code = (res.d && res.d.error) || 'unknown';
            say(SAYS[code] || ('the rail said: ' + code), 'bad');
            return;
          }
          var sub = res.d && res.d.submission;
          input.value = '';
          // the clock the strip was showing is now wrong — that claim started a new cooldown
          if (self._clock) { clearInterval(self._clock); self._clock = 0; }
          tickSay('');
          say(sub && sub.status === 'approved'
            ? '✓ claimed — approved. The payout worker relays it on-chain; the LUV lands in your account.'
            : '✓ claimed — queued for review. Approved claims are relayed on-chain automatically.', 'ok');
        }, function () {
          go.disabled = false;
          say('could not reach the rail. Your post still counts — claim it again in a moment.', 'bad');
        });
      }
      go.addEventListener('click', submit);
      input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    }).catch(function () {
      // the rail is unreachable — say nothing rather than promise something
      if (box.parentNode) box.parentNode.removeChild(box);
    });
  };

  var DVLuvShare = { Rail: Rail, DEFAULT_TEXT: DEFAULT_TEXT, API: API, luv: luv, version: '1.3.0' };
  if (typeof module !== 'undefined' && module.exports) module.exports = DVLuvShare;
  global.DVLuvShare = DVLuvShare;

  if (global.document) {
    var boot = function () {
      var els = document.querySelectorAll('#luvshare,[data-luvshare]');
      for (var i = 0; i < els.length; i++) new Rail(els[i]).render();
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
  }
})(typeof window !== 'undefined' ? window : this);
