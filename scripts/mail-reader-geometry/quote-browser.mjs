/** Real local /mail UI; only the documented Codex CUA tab adapter. Never sends. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
export function quoteInner(body,end){
 const marker=Array.from(body.querySelectorAll('p,td,span,div,pre')).find(e=>e.textContent===end)??Array.from(body.querySelectorAll('pre')).find(e=>end&&e.textContent.includes(end));
 const range=body.ownerDocument.createRange();if(marker)range.selectNodeContents(marker);const r=marker?range.getBoundingClientRect():null;
 const style=selector=>{const e=body.querySelector(selector);if(!e)return null;const s=getComputedStyle(e);return {padding:s.padding,font:s.fontFamily,fontSize:s.fontSize,bg:s.backgroundColor};};
 return {text:body.textContent,marker:r?{top:r.top,bottom:r.bottom,left:r.left,right:r.right}:null,height:body.parentElement.clientHeight,scrollHeight:body.parentElement.scrollHeight,scrollTop:body.parentElement.scrollTop,tableCount:body.querySelectorAll('table').length,td:style('td'),h1:style('h1'),images:Array.from(body.querySelectorAll('img')).map(i=>({src:i.getAttribute('src'),loaded:i.complete&&i.naturalWidth>0})),blocked:body.querySelectorAll('[data-mail-image-v1]').length,active:body.querySelectorAll('script,iframe,form,object,embed,svg,[onerror],[onclick],[srcset]').length,executed:body.hasAttribute('data-m1b-executed')||body.hasAttribute('data-m1d-executed')};
}
export function quoteOuter({marker}){
 const rect=e=>{const r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,height:r.height};};
 const frame=document.querySelector('.mail-compose-quoted iframe'),scroller=document.querySelector('.mail-compose-body-scroll');const f=rect(frame),s=rect(scroller);
 const m=marker?{top:f.top+marker.top,bottom:f.top+marker.bottom,left:f.left+marker.left,right:f.left+marker.right}:null;
 const buttons=Array.from(document.querySelectorAll('button')).filter(e=>['Send','Attachments','Discard draft'].includes(e.getAttribute('aria-label')??e.textContent.trim())).filter(e=>e.getBoundingClientRect().width>0).map(e=>{const r=rect(e);return {label:e.getAttribute('aria-label')??e.textContent.trim(),rect:r,hit:e.contains(document.elementFromPoint((r.left+r.right)/2,(r.top+r.bottom)/2))};});
 return {frame:f,sandbox:frame.getAttribute('sandbox'),scroller:s,clientHeight:scroller.clientHeight,scrollHeight:scroller.scrollHeight,scrollTop:scroller.scrollTop,marker:m,markerVisible:!!m&&m.top>=s.top-1&&m.bottom<=s.bottom+1,document:{w:document.documentElement.clientWidth,sw:document.documentElement.scrollWidth,h:document.documentElement.clientHeight,sh:document.documentElement.scrollHeight},buttons,editable:document.querySelector('[contenteditable=true]')?.textContent,quoteEditable:!!document.querySelector('.mail-compose-quoted [contenteditable=true]')};
}
export async function runQuotes({tab,viewport,fixtures,runtime,evidenceDir,size}){
 if(new URL(await tab.url()).origin!=='http://127.0.0.1:3299')throw new Error('Local Mail only');
 await mkdir(evidenceDir,{recursive:true});await viewport.set(size);await tab.screenshot({fullPage:false});const records=[];
 const canary=async()=>{try{return await readFile(runtime+'/m1e-canary.jsonl','utf8');}catch(e){if(e.code==='ENOENT')return '';throw e;}};
 for(const fixture of fixtures){
  const back=tab.playwright.getByRole('button',{name:size.width===390?'Back to Mail':'Back to message list',exact:true});if(await back.isVisible()){await back.click();await tab.getAXState({emit:false});}
  const prior=await canary();
  await tab.playwright.getByRole('button',{name:new RegExp(`Synthetic Sender .* ${fixture.prefix??'M1B'} ${fixture.name}(?: |$)`)}).click();
  await tab.playwright.getByRole('heading',{name:`${fixture.prefix??'M1B'} ${fixture.name}`,exact:true}).waitFor({state:'visible',timeoutMs:15000});
  if(size.width===390&&fixture.mode!=='Reply'){await tab.playwright.getByRole('button',{name:'Actions',exact:true}).click();await tab.getAXState({emit:false});}
  await tab.playwright.getByRole('button',{name:fixture.mode,exact:true}).click();
  await tab.playwright.getByRole('button',{name:'Show quoted content',exact:true}).waitFor({state:'visible',timeoutMs:15000});
  if(fixture.expanded){await tab.playwright.getByRole('button',{name:'Expand compose',exact:true}).click();await tab.getAXState({emit:false});}
  if(fixture.mode==='Forward'){await tab.playwright.getByRole('textbox',{name:'To',exact:true}).fill('forward@example.invalid');await tab.playwright.getByRole('textbox',{name:'To',exact:true}).press('Enter');}
  const editor=tab.playwright.locator('[contenteditable="true"]');const initial=await editor.textContent();await editor.fill(`M1F synthetic ${fixture.mode} ${fixture.name}`);
  await tab.playwright.getByRole('button',{name:'Show quoted content',exact:true}).click();await tab.getAXState({emit:false});
  const body=tab.playwright.frameLocator('.mail-compose-quoted iframe').locator('body');let inner;
  for(let n=0;n<8;n++){await tab.screenshot({fullPage:false});inner=await body.evaluate(quoteInner,fixture.end);if(inner.images.filter(i=>i.loaded).length===(fixture.loaded??0))break;}
  const top=await tab.playwright.evaluate(quoteOuter,{marker:inner.marker});
  await writeFile(`${evidenceDir}/${fixture.name}-top.png`,await tab.screenshot({fullPage:false}));
  const point=[(top.scroller.left+top.scroller.right)/2,(top.scroller.top+top.scroller.bottom)/2];
  await tab.scroll(point,'down',1500);await tab.scroll(point,'down',1500);
  const maximum=await tab.playwright.evaluate(quoteOuter,{marker:inner.marker});
  let bottom=maximum;
  // A short viewport can fit either the end of a quote or the signature below
  // it at absolute maximum. Prove reachability with small normal wheel gestures,
  // not scrollIntoView or an assumption that the marker is the final DOM node.
  for(let n=0;n<4&&bottom.marker&&bottom.marker.top<bottom.scroller.top;n++){
    await tab.scroll(point,'up',0.05);
    bottom=await tab.playwright.evaluate(quoteOuter,{marker:inner.marker});
  }
  await writeFile(`${evidenceDir}/${fixture.name}-bottom.png`,await tab.screenshot({fullPage:false}));
  const checks=[];const check=(name,pass)=>checks.push({name,pass:!!pass});
  check('clean separate editable area',!initial.trim()&&!bottom.quoteEditable&&bottom.editable===`M1F synthetic ${fixture.mode} ${fixture.name}`);
  check('original quote metadata',inner.text.includes(fixture.mode==='Forward'?'Forwarded message':'wrote:')&&inner.text.includes('sender@example.invalid'));
  check('expected final content retained',!fixture.end||!!inner.marker);
  check('final marker wheel-reachable',!fixture.end||bottom.markerVisible);
  check('bounded outer compose scroll',bottom.clientHeight>0&&bottom.scroller.bottom<=size.height&&(!fixture.long||bottom.scrollHeight>bottom.clientHeight));
  check('no inner vertical scroll',inner.scrollHeight<=inner.height+1&&inner.scrollTop===0);
  check('document bounded',bottom.document.sw<=bottom.document.w+1&&bottom.document.sh<=bottom.document.h+1);
  check('send action uncovered',bottom.buttons.some(b=>b.label==='Send'&&b.hit));
  check('quote sandbox script disabled',bottom.sandbox==='allow-same-origin');
  check('no active content execution',inner.active===0&&!inner.executed);
  check('CID preview remains authorized',inner.images.length===(fixture.loaded??0)&&inner.images.every(i=>i.loaded&&i.src.startsWith(`http://127.0.0.1:3299/api/mail/messages/${fixture.id}/inline-resources/`)));
  check('zero automatic remote requests',await canary()===prior);
  if(fixture.name==='ENTERPRISE_TABLE')check('table typography and padding',inner.tableCount===2&&inner.td.padding==='24px'&&inner.h1.font==='Georgia, serif');
  if(fixture.name==='APPLE_STYLE_NO_IMAGES')check('Apple text hierarchy retained',inner.h1.fontSize==='48px');
  records.push({fixture,size,inner,top,maximum,bottom,checks});await writeFile(evidenceDir+'/results.json',JSON.stringify(records,null,2));
  await tab.playwright.getByRole('button',{name:size.width===390?'Back to Mail':'Close',exact:true}).click();
  await tab.playwright.locator('[contenteditable="true"]').waitFor({state:'hidden',timeoutMs:15000});await tab.getAXState({emit:false});
 }
 const summary={cases:records.length,passed:records.flatMap(r=>r.checks).filter(c=>c.pass).length,failures:records.flatMap(r=>r.checks.filter(c=>!c.pass).map(c=>({fixture:r.fixture.name,...c})))};await writeFile(evidenceDir+'/summary.json',JSON.stringify(summary,null,2));return summary;
}
