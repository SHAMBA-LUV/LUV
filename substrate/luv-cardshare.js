// SPDX-License-Identifier: Apache-2.0
// luv-cardshare.js — the corner gesture. A share control in the top-right of any card that
// declares [data-cardshare]: native share where the platform offers it, share-intent links
// everywhere (X · Telegram · WhatsApp · Reddit · Facebook · LinkedIn · email), and a
// copy-link fallback. Intents only — no SDKs, no trackers, no third-party script. Shares
// carry the page's own OG card; the link is the share.
//   <div class="card" id="buy-eth" data-cardshare data-cardshare-text="…">
// Prototype lane (.js, UMD, zero-dep). Self-boots on DOM ready.
(function (global) {
  'use strict';

  var VERSION = '1.0.0';

  function enc(s) { return encodeURIComponent(s); }

  function intents(text, url) {
    return [
      ['𝕏',        'X',        'https://twitter.com/intent/tweet?text=' + enc(text + ' ' + url)],
      ['✈',        'Telegram', 'https://t.me/share/url?url=' + enc(url) + '&text=' + enc(text)],
      ['🟢',       'WhatsApp', 'https://wa.me/?text=' + enc(text + ' ' + url)],
      ['👽',       'Reddit',   'https://www.reddit.com/submit?url=' + enc(url) + '&title=' + enc(text)],
      ['📘',       'Facebook', 'https://www.facebook.com/sharer/sharer.php?u=' + enc(url)],
      ['💼',       'LinkedIn', 'https://www.linkedin.com/sharing/share-offsite/?url=' + enc(url)],
      ['✉',        'email',    'mailto:?subject=' + enc(text) + '&body=' + enc(text + '\n\n' + url)]
    ];
  }

  function el(tag, css, text) {
    var n = document.createElement(tag);
    if (css) n.style.cssText = css;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function mount(card) {
    if (card.getAttribute('data-cardshare-mounted')) return;
    card.setAttribute('data-cardshare-mounted', '1');
    if (getComputedStyle(card).position === 'static') card.style.position = 'relative';

    var text = card.getAttribute('data-cardshare-text') ||
      (document.querySelector('meta[property="og:description"]') || {}).content ||
      document.title;
    var url = card.id
      ? location.origin + location.pathname + '#' + card.id
      : location.origin + location.pathname;

    var btn = el('button',
      'position:absolute;top:10px;right:10px;z-index:5;cursor:pointer;font:700 13px/1 ui-monospace,Menlo,Consolas,monospace;' +
      'color:#ffd166;background:rgba(0,0,0,.35);border:1px solid rgba(255,209,102,.45);border-radius:999px;' +
      'padding:6px 11px;transition:border-color .15s,color .15s,box-shadow .15s', '⤴ share');
    btn.setAttribute('type', 'button');
    btn.setAttribute('aria-label', 'share this card');
    btn.setAttribute('title', 'share this card — the link is the share');
    btn.onmouseenter = function () { btn.style.borderColor = '#0ecb81'; btn.style.color = '#0ecb81';
      btn.style.boxShadow = '0 0 12px rgba(14,203,129,.4)'; };
    btn.onmouseleave = function () { btn.style.borderColor = 'rgba(255,209,102,.45)'; btn.style.color = '#ffd166';
      btn.style.boxShadow = 'none'; };

    var pop = null;
    function closePop() { if (pop) { pop.remove(); pop = null; } }

    function openPop() {
      closePop();
      pop = el('div',
        'position:absolute;top:44px;right:10px;z-index:6;display:flex;flex-direction:column;gap:2px;' +
        'background:#171126;border:1px solid rgba(255,209,102,.45);border-radius:12px;padding:8px;' +
        'box-shadow:0 12px 34px rgba(0,0,0,.6);min-width:170px');
      intents(text, url).forEach(function (it) {
        var a = el('a',
          'display:flex;gap:9px;align-items:center;padding:7px 10px;border-radius:8px;text-decoration:none;' +
          'font:600 13px/1.2 system-ui,-apple-system,sans-serif;color:#f4f0f8');
        a.href = it[2];
        a.target = '_blank';
        a.rel = 'noopener';
        a.appendChild(el('span', 'width:18px;text-align:center', it[0]));
        a.appendChild(el('span', '', it[1]));
        a.onmouseenter = function () { a.style.background = 'rgba(14,203,129,.14)'; };
        a.onmouseleave = function () { a.style.background = 'none'; };
        pop.appendChild(a);
      });
      var copy = el('button',
        'display:flex;gap:9px;align-items:center;padding:7px 10px;border-radius:8px;border:0;cursor:pointer;' +
        'font:600 13px/1.2 system-ui,-apple-system,sans-serif;color:#f4f0f8;background:none;text-align:left');
      copy.setAttribute('type', 'button');
      copy.appendChild(el('span', 'width:18px;text-align:center', '🔗'));
      var copyLabel = el('span', '', 'copy link');
      copy.appendChild(copyLabel);
      copy.onmouseenter = function () { copy.style.background = 'rgba(14,203,129,.14)'; };
      copy.onmouseleave = function () { copy.style.background = 'none'; };
      copy.onclick = function () {
        (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject())
          .then(function () { copyLabel.textContent = 'copied ✓'; setTimeout(closePop, 900); })
          .catch(function () { copyLabel.textContent = url; });
      };
      pop.appendChild(copy);
      card.appendChild(pop);
      setTimeout(function () {
        document.addEventListener('click', function onDoc(e) {
          if (pop && !pop.contains(e.target) && e.target !== btn) { closePop(); document.removeEventListener('click', onDoc); }
        });
      }, 0);
    }

    btn.onclick = function () {
      // native first — one sheet, every app the platform knows; intents as the fallback
      if (navigator.share) {
        navigator.share({ title: document.title, text: text, url: url }).catch(function () { /* declined */ });
      } else if (pop) { closePop(); } else { openPop(); }
    };

    card.appendChild(btn);
  }

  function boot() {
    var cards = document.querySelectorAll('[data-cardshare]');
    for (var i = 0; i < cards.length; i++) mount(cards[i]);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  global.DVLuvCardShare = { VERSION: VERSION, boot: boot };
})(typeof window !== 'undefined' ? window : this);
