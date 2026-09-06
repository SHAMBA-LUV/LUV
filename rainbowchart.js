/*!
 * SHAMBA LUV — rainbowchart.js: the page organ for rainbowchart.html.
 *
 * Fills the readout, the equation, the band table and the honesty numbers from
 * DVLuvRainbowChart, so nothing on the page is a hand-typed figure that can drift away from the
 * substrate that draws the chart. External file (never inline) so the page stays CSP-safe, and
 * every insertion is textContent — no innerHTML anywhere.
 */
(function () {
  'use strict';

  var R = window.DVLuvRainbowChart;
  if (!R) return;

  var LAST_I = R.SERIES.length - 1;
  var lastX = R.SERIES_LAST_X;
  var lastUsd = Math.pow(10, R.SERIES[LAST_I]);
  var fitUsd = R.fit(lastX);
  var ratio = lastUsd / fitUsd;
  var band = R.bandOf(lastUsd, lastX);

  function usd(p) {
    if (p >= 1e6) return '$' + (p / 1e6).toFixed(2) + 'M';
    if (p >= 1e3) return '$' + Math.round(p).toLocaleString('en-US');
    if (p >= 1) return '$' + p.toFixed(2);
    return '$' + p.toFixed(4);
  }
  function set(id, text) { var n = document.getElementById(id); if (n) n.textContent = text; }
  function cell(k, v, note, colour) {
    var d = document.createElement('div'); d.className = 'cell';
    var a = document.createElement('div'); a.className = 'k'; a.textContent = k; d.appendChild(a);
    var b = document.createElement('div'); b.className = 'v'; b.textContent = v;
    if (colour) b.style.color = colour;
    d.appendChild(b);
    if (note) { var c = document.createElement('div'); c.className = 'n'; c.textContent = note; d.appendChild(c); }
    return d;
  }

  // ── the readout ──
  var ro = document.getElementById('readout');
  if (ro) {
    var bandName = band < 0 ? 'below the scale' : band > 8 ? 'above the scale' : R.BANDS[band].name;
    var bandCol = band < 0 || band > 8 ? '#b98da0' : R.BANDS[band].col;
    ro.appendChild(cell('BTC close', usd(lastUsd), R.FIT.to, '#f6e7eb'));
    ro.appendChild(cell('the fit says', usd(fitUsd), 'regression value that day'));
    ro.appendChild(cell('price ÷ fit', ratio.toFixed(3) + '×', ratio < 1 ? 'under the curve' : 'over the curve'));
    ro.appendChild(cell('band', bandName, band < 0 || band > 8 ? 'outside the painted range' : 'band ' + band + ' of 8', bandCol));
    // Market cap on the day: price times the supply the emission schedule had actually minted by
    // then — NOT the terminal-supply rescale the axis and the band table use.
    ro.appendChild(cell('market cap',
      R.usdLabel(R.marketcapAt(lastUsd, R.msOf(lastX))),
      Math.round(R.supplyAt(R.msOf(lastX))).toLocaleString('en-US') + ' BTC mined by then'));
  }

  set('standing', band < 0
    ? 'At ' + ratio.toFixed(3) + '× the fit, the last close sits BELOW the bottom band — off the bottom of the '
      + 'scale entirely. The chart has no colour for that, which is itself worth noticing: the ladder was '
      + 'built with far more room above the curve than below it.'
    : band > 8
      ? 'The last close sits ABOVE the top band — off the top of the scale.'
      : 'The last close sits inside band ' + band + ', "' + R.BANDS[band].name + '".');

  // ── the equation ──
  var f = R.FIT;
  set('eq',
    'ln(price)  =  a · ln(b + x)  +  c\n\n' +
    '  a = ' + f.a + '\n' +
    '  b = ' + f.b + '\n' +
    '  c = ' + f.c + '\n\n' +
    '  x = 1 on ' + f.from + ', +1 per priced day');
  set('fitmeta',
    'Least-squares fit over ' + f.n.toLocaleString('en-US') + ' daily closes, ' + f.from + ' to ' + f.to +
    ' · R² = ' + f.r2.toFixed(4) + '. Fitted on the day index rather than on calendar days, which is what the ' +
    'reference implementation does; across this range the two differ by a single missing day (2010-08-17).');

  // ── the band table ──
  var rows = document.getElementById('bandrows');
  if (rows) {
    for (var i = 8; i >= 0; i--) {
      var loOff = (i - R.BAND_OFFSET) * R.BAND_WIDTH - R.BAND_WIDTH;
      var hiOff = (i - R.BAND_OFFSET) * R.BAND_WIDTH;
      var tr = document.createElement('tr');

      var td0 = document.createElement('td');
      var sw = document.createElement('span');
      sw.className = 'sw'; sw.style.background = R.BANDS[i].col;
      td0.appendChild(sw);
      td0.appendChild(document.createTextNode(String(i)));
      tr.appendChild(td0);

      var td1 = document.createElement('td');
      td1.textContent = R.BANDS[i].name;
      if (i === band) { td1.style.color = R.BANDS[i].col; td1.style.fontWeight = '700'; }
      tr.appendChild(td1);

      var td2 = document.createElement('td'); td2.className = 'num';
      td2.textContent = Math.exp(loOff).toFixed(2) + '–' + Math.exp(hiOff).toFixed(2) + '×';
      tr.appendChild(td2);

      var td3 = document.createElement('td'); td3.className = 'num';
      td3.textContent = usd(fitUsd * Math.exp(loOff)) + '–' + usd(fitUsd * Math.exp(hiOff));
      tr.appendChild(td3);

      // Market cap at the terminal supply — the same rescale the chart's right axis draws, so the
      // column and the axis can never tell different stories.
      var td4 = document.createElement('td'); td4.className = 'num';
      td4.textContent = R.usdLabel(fitUsd * Math.exp(loOff) * R.TERMINAL_SUPPLY) + '–' +
                        R.usdLabel(fitUsd * Math.exp(hiOff) * R.TERMINAL_SUPPLY);
      tr.appendChild(td4);

      rows.appendChild(tr);
    }
  }

  // ── the forward window ──
  // The fit does not stop at the edge of the record, so the page lets you walk it out. The
  // magnitudes are worth seeing: the curve crosses $1M/coin around 2035, $100M around 2075 and
  // $1B around 2113, and the market-cap axis follows it into the quadrillions. That is not a
  // forecast — it is the arithmetic confessing that a log-time regression describes one era and
  // not the next eleven, which is easier to believe once you have watched it happen.
  var WINDOWS = [
    { to: 0,    label: '+9 months', note: 'the reference window' },
    { to: 2040, label: '2040',      note: '' },
    { to: 2060, label: '2060',      note: '' },
    { to: 2100, label: '2100',      note: '' },
    { to: 2140, label: '2140',      note: 'end of emission — all 32 halvings' }
  ];
  var winrow = document.getElementById('winrow');
  var mount = document.querySelector('[data-luvrainbowchart]');
  if (winrow && mount) {
    var lab = document.createElement('span');
    lab.className = 'lab'; lab.textContent = 'window';
    winrow.appendChild(lab);

    var buttons = [];
    WINDOWS.forEach(function (w, idx) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = w.label;
      if (w.note) b.title = w.note;
      b.setAttribute('aria-pressed', idx === 0 ? 'true' : 'false');
      b.addEventListener('click', function () {
        R.render(mount, { to: w.to || 0, height: 600 });
        buttons.forEach(function (o, j) { o.setAttribute('aria-pressed', j === idx ? 'true' : 'false'); });
      });
      buttons.push(b);
      winrow.appendChild(b);
    });
  }

  // ── how much of history the painted range actually holds ──
  // Counted here from the embedded series rather than quoted, so the claim cannot go stale.
  var inside = 0;
  for (var k = 0; k < R.SERIES.length; k++) {
    var x = R.seriesX(k);
    var r = Math.log(Math.pow(10, R.SERIES[k])) - Math.log(R.fit(x));
    var lo = -R.BAND_OFFSET * R.BAND_WIDTH - R.BAND_WIDTH;   // bottom of band 0
    var hi = (8 - R.BAND_OFFSET) * R.BAND_WIDTH;             // top of band 8
    if (r > lo && r <= hi) inside++;
  }
  set('insidepct', (inside / R.SERIES.length * 100).toFixed(1) + '%');
})();
