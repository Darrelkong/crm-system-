/** Existing Codex browser adapter, actual authenticated /mail; no browser installation. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { measureFidelity, measureIsolated } from './fidelity-browser.mjs';
export function imageState(body) {
  return { text:body.textContent, images:Array.from(body.querySelectorAll('img')).map(i=>({src:i.getAttribute('src'),referrer:i.referrerPolicy,width:i.naturalWidth,height:i.naturalHeight,complete:i.complete,rectHeight:i.getBoundingClientRect().height})),
    placeholders:body.querySelectorAll('[data-mail-image-v1]').length,
    active:body.querySelectorAll('script,iframe,form,object,embed,[srcset],[onerror],[onload]').length,
    sentinel:body.hasAttribute('data-m1e-active'),csp:body.ownerDocument.querySelector('meta[http-equiv]')?.getAttribute('content') };
}
export async function runImagePrivacy({tab,viewport,fixtures,runtime,evidenceDir,sizes=[{width:1280,height:900},{width:390,height:844}]}) {
  if(new URL(await tab.url()).origin!=='http://127.0.0.1:3299')throw new Error('Local fixture only');
  const requests=async()=>{try{return (await readFile(runtime+'/m1e-canary.jsonl','utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);}catch(e){if(e.code==='ENOENT')return [];throw e;}};
  await mkdir(evidenceDir,{recursive:true});const records=[];
  for(const size of sizes) {
    await viewport.set(size);await tab.screenshot({fullPage:false});
    for(const fixture of fixtures) {
      const back=tab.playwright.getByRole('button',{name:size.width===390?'Back to Mail':'Back to message list',exact:true});
      if(await back.isVisible()){await back.click();await tab.screenshot({fullPage:false});}
      const before=await requests();
      await tab.playwright.getByRole('button',{name:new RegExp(`Synthetic Sender .* M1B ${fixture.name}(?: |$)`)}).click();
      await tab.playwright.getByRole('heading',{name:`M1B ${fixture.name}`,exact:true}).waitFor({state:'visible'});
      await tab.playwright.locator('.mail-message-body iframe').waitFor({state:'visible'});
      await tab.screenshot({fullPage:false});
      const blocked=await tab.playwright.frameLocator('.mail-message-body iframe').locator('body').evaluate(imageState);
      const pre=(await requests()).slice(before.length),checks=[];
      const check=(name,pass)=>checks.push({name,pass:!!pass});
      check('zero requests before opt-in',pre.length===0);
      check('no initial img src',blocked.images.length===0);
      check('active content absent',blocked.active===0&&!blocked.sentinel);
      check('initial CSP denies images',blocked.csp.includes("img-src 'none'"));
      check('image-only is readable blocked state',fixture.requests===0||blocked.text.includes('blocked'));
      await writeFile(`${evidenceDir}/${size.width}-${fixture.name}-blocked.png`,await tab.screenshot({fullPage:false}));
      let loaded=blocked;
      if(fixture.requests) {
        await tab.playwright.getByRole('button',{name:'Load remote images',exact:true}).click();
        await tab.screenshot({fullPage:false});
        loaded=await tab.playwright.frameLocator('.mail-message-body iframe').locator('body').evaluate(imageState);
        check('expected images loaded',loaded.images.length===fixture.requests&&loaded.images.every(i=>i.complete&&i.width>0));
        check('no-referrer on every image',loaded.images.every(i=>i.referrer==='no-referrer'));
        check('only descriptor URLs activated',loaded.images.every(i=>fixture.urls.includes(i.src)));
      }
      const inner=await tab.playwright.frameLocator('.mail-message-body iframe').locator('body').evaluate(measureIsolated,fixture.end);
      await tab.scroll(size.width===390?[195,420]:[800,450],'down',1500);
      await tab.screenshot({fullPage:false});
      const bottom=await measureFidelity(tab,fixture,inner);
      check('no document horizontal overflow',bottom.document.scrollWidth<=bottom.document.clientWidth+1);
      check('no document vertical overflow',bottom.document.scrollHeight<=bottom.document.clientHeight+1);
      check('no competing iframe vertical range',inner.documentScrollHeight<=inner.documentHeight+1&&inner.documentScrollTop===0);
      check('final marker reachable',!fixture.end||bottom.marker.fullyVisible);
      check('footer actions reachable',bottom.actions.every(a=>a.fullyVisible&&a.hitMatches));
      check('sandbox preserved',bottom.frame.sandbox==='allow-same-origin');
      const after=await requests(),newRequests=after.slice(before.length);
      check('exact opt-in request count',newRequests.length===fixture.requests);
      check('no unexpected resource request',newRequests.every(r=>fixture.urls.includes('http://127.0.0.1:3399'+r.path)));
      check('no referrer sent',newRequests.every(r=>r.referer===null));
      await writeFile(`${evidenceDir}/${size.width}-${fixture.name}-loaded-bottom.png`,await tab.screenshot({fullPage:false}));
      records.push({name:fixture.name,size,blocked,loaded,pre,newRequests,bottom,checks});
      await writeFile(evidenceDir+'/results.json',JSON.stringify(records,null,2));
    }
  }
  const summary={cases:records.length,passed:records.flatMap(r=>r.checks).filter(c=>c.pass).length,failures:records.flatMap(r=>r.checks.filter(c=>!c.pass).map(c=>({fixture:r.name,width:r.size.width,...c})))};
  await writeFile(evidenceDir+'/summary.json',JSON.stringify(summary,null,2));return summary;
}
