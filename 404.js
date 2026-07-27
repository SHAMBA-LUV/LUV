// 404 → doorway auto-redirect (self-hosted: the CSP blocks inline scripts).
// The meta refresh in 404.html is the no-JS fallback at 10s.
(function () {
  var n = 8;
  var el = document.getElementById('count');
  var t = setInterval(function () {
    n -= 1;
    if (el) el.textContent = String(n);
    if (n <= 0) { clearInterval(t); window.location.replace('/'); }
  }, 1000);
})();
