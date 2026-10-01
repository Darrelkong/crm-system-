/** Runs only through the existing Codex browser adapter and authenticated local /mail. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { measureFidelity, measureIsolated } from './fidelity-browser.mjs';
export function cidState(body) {
 return {text:body.textContent,descriptors:body.querySelectorAll('[data-mail-cid-v1]').length,unavailable:Array.from(body.querySelectorAll('[data-mail-cid-v1]')).filter(e=>e.textContent.includes('Inline image unavailable')).length,images:Array.from(body.querySelectorAll('img')).map(i=>({src:i.getAttribute('src'),width:i.naturalWidth,height:i.naturalHeight,complete:i.complete,referrer:i.referrerPolicy})),active:body.querySelectorAll('script,iframe,form,object,embed,svg,[onerror],[onload],[srcset]').length,csp:body.ownerDocument.querySelector('meta[http-equiv]')?.getAttribute('content')};
}
export async function runCidBrowser({tab,viewport,fixtures,runtime,evidenceDir,sizes=[{width:1280,height:900},{width:390,height:844}]}) {
 if(new URL(await tab.url()).origin!=='http://127.0.0.1:3299')throw new Error('Local Mail only');
 await mkdir(evidenceDir,{recursive:true});const records=[];
 const canary=async()=>{try{return await readFile(runtime+'/m1e-canary.jsonl','utf8');}catch(e){if(e.code==='ENOENT')return '';throw e;}};
 for(const size of sizes){await viewport.set(size);await tab.screenshot({fullPage:false});
  for(const fixture of fixtures){
   const back=tab.playwright.getByRole('button',{name:size.width===390?'Back to Mail':'Back to message list',exact:true});if(await back.isVisible()){await back.click();await tab.screenshot({fullPage:false});}
   const prior=await canary();
   await tab.playwright.getByRole('button',{name:new RegExp(`Synthetic Sender .* M1EC ${fixture.name}(?: |$)`)}).click();
   await tab.playwright.getByRole('heading',{name:`M1EC ${fixture.name}`,exact:true}).waitFor({state:'visible'});
   await tab.playwright.locator('.mail-message-body iframe').waitFor({state:'visible'});
   const body=tab.playwright.frameLocator('.mail-message-body iframe').locator('body');
   let state;
   for(let i=0;i<8;i++){await tab.screenshot({fullPage:false});state=await body.evaluate(cidState);if(state.images.filter(i=>i.complete&&i.width>0).length===fixture.loaded&&state.unavailable===fixture.unavailable)break;}
   const inner=await body.evaluate(measureIsolated,fixture.end);
   await writeFile(`${evidenceDir}/${size.width}-${fixture.name}-top.png`,await tab.screenshot({fullPage:false}));
   await tab.scroll(size.width===390?[195,420]:[800,450],'down',1500);
   await writeFile(`${evidenceDir}/${size.width}-${fixture.name}-bottom.png`,await tab.screenshot({fullPage:false}));
   const bottom=await measureFidelity(tab,fixture,inner);
   const checks=[];const check=(name,pass)=>checks.push({name,pass:!!pass});
   check('expected authorized images loaded',state.images.length===fixture.loaded&&state.images.every(i=>i.complete&&i.width>0));
   check('missing/ambiguous/denied remains visible',state.unavailable===fixture.unavailable);
   check('only current message private endpoints',state.images.every(i=>i.src.startsWith(`http://127.0.0.1:3299/api/mail/messages/${fixture.id}/inline-resources/`)));
   check('no remote sender request',await canary()===prior);
   check('no active content',state.active===0);
   check('script-disabled sandbox',bottom.frame.sandbox==='allow-same-origin');
   check('no empty body',!bottom.emptyState);
   check('no document overflow',bottom.document.scrollWidth<=bottom.document.clientWidth+1&&bottom.document.scrollHeight<=bottom.document.clientHeight+1);
   check('no iframe vertical trap',inner.documentScrollHeight<=inner.documentHeight+1&&inner.documentScrollTop===0);
   check('final marker reachable',!fixture.end||bottom.marker.fullyVisible);
   check('footer actions reachable',bottom.actions.every(a=>a.fullyVisible&&a.hitMatches));
   check('private image no referrer',state.images.every(i=>i.referrer==='no-referrer'));
   if(fixture.name==='CID_MULTIPLE')check('repeated CID uses same resource',new Set(state.images.map(i=>i.src)).size===2);
   records.push({name:fixture.name,size,state,bottom,checks});await writeFile(evidenceDir+'/results.json',JSON.stringify(records,null,2));
  }
 }
 const summary={cases:records.length,passed:records.flatMap(r=>r.checks).filter(c=>c.pass).length,failures:records.flatMap(r=>r.checks.filter(c=>!c.pass).map(c=>({fixture:r.name,width:r.size.width,...c})))};await writeFile(evidenceDir+'/summary.json',JSON.stringify(summary,null,2));return summary;
}
