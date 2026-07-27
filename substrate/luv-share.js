/*!
 * SHAMBA LUV — share substrate (new substrate; existing DeltaVerse substrates untouched).
 *
 * Makes every aspect of luv.pythai.net one tap to share: native Web Share where the
 * platform offers it, share-intent links (X · Telegram · WhatsApp) everywhere, and a
 * copy-link fallback. Shares carry the page's own OG card (each page ships landing-grade
 * meta). Stage 3 wires the reward: sharing earns LUV through the tasks rail.
 *
 * Prototype lane (.js, UMD, zero-dep). Self-boots into every #luvshare mount.
 *   new DVLuvShare.Rail('#luvshare', { text: '…' }).render();
 */
(function (global) {
  'use strict';

  var DEFAULT_TEXT = 'LUV is priceless — and now the market measures it. ' +
    'HOLD LUV to earn LUV: LUV grows when you hold LUV. ' +
    'SHAMBA LUV, live on Uniswap ❤ thanks a million millions https://luv.pythai.net';

  function Rail(mount, opts) {
    this.root = typeof mount === 'string' ? document.querySelector(mount) : mount;
    opts = opts || {};
    this.url = opts.url || (global.location && location.href) || 'https://luv.pythai.net/';
    this.text = opts.text || (this.root && this.root.dataset.text) || DEFAULT_TEXT;
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
    lead.innerHTML = 'share the LUV <span class="beat">❤</span>';
    row.appendChild(lead);

    if (global.navigator && navigator.share) {
      row.appendChild(this._btn('⤴ share', 'share via your device', function () {
        navigator.share({ title: document.title, text: self.text, url: self.url }).catch(function () {});
      }));
    }
    row.appendChild(this._btn('𝕏 post', 'post on X', null,
      'https://twitter.com/intent/tweet?text=' + t + '&url=' + u));
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

    var note = document.createElement('div'); note.className = 'shr-note';
    note.textContent = 'phase 3 — sharing is caring: attention is capital, gestures are currency — shares will EARN LUV';
    this.root.appendChild(row); this.root.appendChild(note);
    return this;
  };

  var DVLuvShare = { Rail: Rail, DEFAULT_TEXT: DEFAULT_TEXT, version: '1.0.0' };
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
