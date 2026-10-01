/** Only the loopback canary. No third-party tracking server. */
const base = "http://127.0.0.1:3399";
const image = (path: string, extra = "") => `<img src="${base}/${path}.png" ${extra}>`;
export function imageFixtures() {
  return [
    {name:"REMOTE_BANNER",end:"END_REMOTE_BANNER",html:image('banner','alt="Synthetic banner" width="600" height="240"')+'<p>END_REMOTE_BANNER</p>',requests:1},
    {name:"REMOTE_IMAGE_ONLY",end:null,html:image('only'),requests:1},
    {name:"REMOTE_MULTIPLE",end:"END_REMOTE_MULTIPLE",html:image('one')+image('two')+image('three')+'<p>END_REMOTE_MULTIPLE</p>',requests:3},
    {name:"TRACKING_1X1",end:null,html:image('pixel','width="1" height="1"'),requests:1},
    {name:"TINY_REMOTE",end:null,html:image('tiny','width="3" height="3"'),requests:1},
    {name:"MIXED_TEXT_IMAGES",end:"END_MIXED",html:'<table width="600" style="max-width:100%;background-color:#eee"><tr><td style="padding:24px"><h1 style="font-family:Georgia;font-size:32px">Synthetic enterprise</h1><p>Text before</p>'+image('mixed','alt="Mixed banner"')+'<p>END_MIXED</p></td></tr></table>',requests:1},
    {name:"IMAGE_WITH_ALT",end:null,html:image('alt','alt="ECHFRONT synthetic banner"'),requests:1},
    {name:"MALICIOUS_IMAGE_URL",end:"END_IMAGE_SAFE",html:'<img src="javascript:window.__m1eActive=1"><img src="data:image/svg+xml,evil"><img src="//127.0.0.1:3399/relative.png"><img src="/m1e-canary-relative">'+image('safe','alt="Safe image" srcset="http://127.0.0.1:3399/srcset.png" onerror="window.__m1eActive=1"')+'<script>window.__m1eActive=1</script><iframe src="http://127.0.0.1:3399/frame"></iframe><p>END_IMAGE_SAFE</p>',requests:1},
    {name:"CSS_BACKGROUND_URL",end:"END_CSS_SAFE",html:'<style>@import "http://127.0.0.1:3399/import";</style><div style="background-image:url(http://127.0.0.1:3399/background.png)">END_CSS_SAFE</div>',requests:0},
  ];
}
