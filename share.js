/*!
 * SHAMBA LUV — share.js: the share + copy buttons for rainbow.html.
 *
 * Lifted verbatim out of an inline <script> in the page. The vhost serves
 * `Content-Security-Policy: script-src 'self'` with no 'unsafe-inline' and no nonce, so an
 * inline block never executes: the buttons rendered and did nothing when clicked. An external
 * same-origin file is the same code the CSP will actually run.
 */
/* Share and copy. navigator.share is used where the browser offers it (mobile,
   Safari) and falls back to the clipboard everywhere else; if the clipboard is
   unavailable too — insecure context, older browser — the URL is selected so the
   reader can copy it by hand rather than being told nothing happened. */
(function(){
  var url=(document.querySelector('link[rel=canonical]')||{}).href||location.href.split('#')[0];
  var title=document.title;
  var shr=document.getElementById('shrBtn'), cpy=document.getElementById('cpyBtn');

  function flash(btn,msg){
    var was=btn.textContent; btn.textContent=msg; btn.classList.add('done');
    setTimeout(function(){btn.textContent=was;btn.classList.remove('done');},1800);
  }
  async function toClipboard(text){
    try{ if(navigator.clipboard&&window.isSecureContext){ await navigator.clipboard.writeText(text); return true; } }catch(e){}
    try{ var ta=document.createElement('textarea'); ta.value=text;
      ta.style.cssText='position:fixed;top:0;left:0;opacity:0'; document.body.appendChild(ta);
      ta.focus(); ta.select(); var ok=document.execCommand('copy'); document.body.removeChild(ta); return ok; }catch(e){ return false; }
  }
  if(cpy) cpy.addEventListener('click',async function(){
    flash(cpy, (await toClipboard(url)) ? 'copied ✓' : url);
  });
  if(shr) shr.addEventListener('click',async function(){
    if(navigator.share){
      try{ await navigator.share({title:title,text:'The Bitcoin rainbow — an in-house fit, every number reproducible',url:url}); return; }
      catch(e){ if(e&&e.name==='AbortError') return; }   /* user dismissed the sheet: not an error */
    }
    flash(shr, (await toClipboard(url)) ? 'link copied ✓' : 'copy failed');
  });
})();
