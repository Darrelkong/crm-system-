/** Synthetic only. Newly materialized v6 fixtures; never rewrite historical rows. */
export function m1hFixtures() {
 return [
  {name:'M1H_IMAGE_WIDE',end:'END_M1H_IMAGE',html:'<table width="800"><tr><td><img src="http://127.0.0.1:3399/banner.png" width="800" height="1200" alt="Synthetic banner"><p>END_M1H_IMAGE</p></td></tr></table>'},
  {name:'M1H_FIXED_LONG',end:'END_M1H_FIXED',html:'<table width="800" style="width:800px"><tr><td style="padding:24px"><h1 style="font-size:40px">Synthetic fixed newsletter</h1>'+Array.from({length:300},(_,i)=>`<p>Readable synthetic newsletter paragraph ${i}.</p>`).join('')+'<p>END_M1H_FIXED</p></td></tr></table>'},
  {name:'M1H_FLEXIBLE',end:'END_M1H_FLEX',html:'<table style="width:600px;max-width:100%"><tr><td style="padding:16px">Flexible synthetic message<p>END_M1H_FLEX</p></td></tr></table>'},
  {name:'M1H_RESPONSIVE',end:'END_M1H_RESPONSIVE',html:'<style>.mobile{display:none}.desktop{display:block}.layout td{padding:24px;background-color:#ddeeff;font-family:Georgia;font-size:20px}@media only screen and (max-width:600px){.mobile{display:block!important}.desktop{display:none!important}.layout td{padding:12px}}</style><table class="layout" style="width:800px"><tr><td><div class="desktop">DESKTOP_ONLY</div><div class="mobile">MOBILE_ONLY</div><p>END_M1H_RESPONSIVE</p></td></tr></table>'},
  {name:'M1H_HOSTILE',end:'END_M1H_HOSTILE',html:'<style>@import "http://127.0.0.1:3399/forbidden.css";.attack{position:fixed;inset:0;z-index:999999;pointer-events:auto;background:url(http://127.0.0.1:3399/css.png);color:red}@font-face{font-family:Bad;src:url(http://127.0.0.1:3399/font)}</style><div class="attack" onclick="document.body.dataset.executed=1">SAFE_HOSTILE_TEXT</div><script>document.body.dataset.executed=1</script><iframe src="http://127.0.0.1:3399/frame"></iframe><svg onload="alert(1)"></svg><form><input></form><img src="http://127.0.0.1:3399/pixel.png" width="1" height="1"><p>END_M1H_HOSTILE</p>'},
 ];
}
