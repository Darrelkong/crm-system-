import { measureReader, assertGeometry } from './geometry.mjs';
import { mkdir, writeFile } from 'node:fs/promises';

export function measureIsolated(body, end) {
  const rect=e=>{const r=e.getBoundingClientRect(); return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,height:r.height};};
  const marker=Array.from(body.querySelectorAll('p,td,span')).find(e=>e.textContent===end);
  // Range captures visible text rather than the full width of its block box.
  const range=body.ownerDocument.createRange(); if(marker) range.selectNodeContents(marker);
  const r=marker?range.getBoundingClientRect():null;
  let hash=2166136261; const text=body.textContent;
  for(let i=0;i<text.length;i++) hash=Math.imul(hash^text.charCodeAt(i),16777619);
  const styles=selector=>{const e=body.querySelector(selector); if(!e)return null;const s=getComputedStyle(e);return {rect:rect(e),width:s.width,maxWidth:s.maxWidth,padding:s.padding,margin:s.margin,border:s.border,background:s.backgroundColor,color:s.color,font:s.fontFamily,fontSize:s.fontSize,position:s.position};};
  return {marker:r?{top:r.top,bottom:r.bottom,left:r.left,right:r.right}:null,textFingerprint:`${text.length}:${hash>>>0}`,textLength:text.length,height:body.scrollHeight,documentHeight:body.parentElement.clientHeight,documentScrollHeight:body.parentElement.scrollHeight,documentScrollTop:body.parentElement.scrollTop,
    executed:body.hasAttribute('data-m1b-executed')||body.hasAttribute('data-m1d-executed'),dangerousElementCount:body.querySelectorAll('script,iframe,form,input,object,embed,svg,img,[onclick],[onerror]').length,remoteResourceCount:body.querySelectorAll('[src],[srcset],link,style,object,embed').length,unsafeLinkCount:Array.from(body.querySelectorAll('a')).filter(a=>! /^(https?:\/\/|mailto:|tel:)/i.test(a.getAttribute('href')??'')).length,
    table:styles('table'),td:styles('td'),h1:styles('h1'),div:styles('div'),body:styles(':scope'),csp:body.ownerDocument.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content')};
}
export async function measureFidelity(tab, fixture, cachedInner) {
  const outer=await tab.playwright.evaluate(measureReader,{end:fixture.end});
  if(outer.emptyState) return outer;
  const inner=cachedInner ?? await tab.playwright.frameLocator('.mail-message-body iframe').locator('body').evaluate(measureIsolated,fixture.end);
  const frame=await tab.playwright.evaluate(()=>{const el=document.querySelector('.mail-message-body iframe');const r=el.getBoundingClientRect();return {top:r.top,left:r.left,height:r.height,width:r.width,sandbox:el.getAttribute('sandbox'),scrolling:el.getAttribute('scrolling')};});
  const scroll=outer.chain.find(n=>n.classes.includes('flex-1 overflow-y-auto'));
  const r=inner.marker;
  const global=r?{top:r.top+frame.top,bottom:r.bottom+frame.top,left:r.left+frame.left,right:r.right+frame.left}:null;
  const clip={top:scroll.rect.top,bottom:scroll.rect.bottom,left:scroll.rect.left,right:scroll.rect.right};
  const visible=global&&global.top>=clip.top-1&&global.bottom<=clip.bottom+1&&global.left>=clip.left-1&&global.right<=clip.right+1;
  return {...outer,isolated:inner,frame,markerExists:!!r,marker:{rect:global,fullyVisible:!!visible,visible:!!visible},textFingerprint:inner.textFingerprint,bodyTextLength:inner.textLength,dangerousElementCount:inner.dangerousElementCount,remoteResourceCount:inner.remoteResourceCount,unsafeLinkCount:inner.unsafeLinkCount,executed:inner.executed};
}
export async function runFidelity({tab,viewport,fixtures,evidenceDir}) {
  const url=new URL(await tab.url());
  if(url.origin!=='http://127.0.0.1:3299'||url.pathname!=='/mail')throw new Error('Only local M1 Mail allowed');
  await mkdir(evidenceDir,{recursive:true});
  const records=[];
  for(const size of [{width:1280,height:900},{width:390,height:844}]) {
    await viewport.set(size);await tab.screenshot({fullPage:false});
    for(const fixture of fixtures) {
      const back=tab.playwright.getByRole('button',{name:size.width===390?'Back to Mail':'Back to message list',exact:true});
      if(await back.isVisible()){await back.click();await tab.screenshot({fullPage:false});}
      const start=Date.now();
      await tab.playwright.getByRole('button',{name:new RegExp(`Synthetic Sender .* M1B ${fixture.name}(?: |$)`)}).click();
      await tab.playwright.getByRole('heading',{name:`M1B ${fixture.name}`,exact:true}).waitFor({state:'visible'});
      await tab.playwright.locator('.mail-message-body').waitFor({state:'visible'});
      if(fixture.end) await tab.playwright.locator('.mail-message-body iframe').waitFor({state:'visible'});
      // The browser adapter activates/centers a frame for frame-scoped reads.
      // Read static inner layout once BEFORE user scrolling; all reachability
      // probes afterward inspect outer DOM only, without moving any container.
      const inner=fixture.end?await tab.playwright.frameLocator('.mail-message-body iframe').locator('body').evaluate(measureIsolated,fixture.end):undefined;
      await tab.scroll(size.width===390?[195,420]:[800,450],'up',1500);
      const capture=async stage=>{await writeFile(`${evidenceDir}/${size.width}-${fixture.name}-${stage}.png`,await tab.screenshot({fullPage:false}));return measureFidelity(tab,fixture,inner);};
      const top=await capture('top'),openMs=Date.now()-start;
      await tab.scroll(size.width===390?[195,420]:[800,450],'down',1500);
      const middle=await capture('middle');
      await tab.scroll(size.width===390?[195,420]:[800,450],'down',1500);
      const firstBottom=await capture('bottom');
      await tab.screenshot({fullPage:false});const bottom=await measureFidelity(tab,fixture,inner);
      const record={fixture,top,middle,firstBottom,bottom,openMs};
      const checks=[];const check=(name,pass)=>checks.push({name,pass:!!pass});
      if(fixture.id.startsWith('m1b-')) checks.push(...assertGeometry(record,'fixed').checks);
      else {
        check('complete expected body',top.textFingerprint===fixture.textFingerprint&&bottom.textFingerprint===fixture.textFingerprint);
        check('final marker reachable',bottom.marker.fullyVisible);
        check('no document overflow',bottom.document.scrollWidth<=bottom.document.clientWidth+1&&bottom.document.scrollHeight<=bottom.document.clientHeight+1);
        check('footer actions reachable',bottom.actions.every(a=>a.fullyVisible&&a.hitMatches));
      }
      if(bottom.isolated){
        check('script-disabled sandbox',bottom.frame.sandbox==='allow-same-origin');
        check('no inner vertical scroll range',bottom.isolated.documentScrollHeight<=bottom.isolated.documentHeight+1&&bottom.isolated.documentScrollTop===0);
        check('height stable',Math.abs(firstBottom.frame.height-bottom.frame.height)<=1);
        check('network denied',bottom.isolated.csp.includes("default-src 'none'")&&bottom.remoteResourceCount===0);
        check('active content absent',bottom.dangerousElementCount===0&&bottom.unsafeLinkCount===0&&!bottom.executed);
      }
      if(fixture.name==='ENTERPRISE_TABLE') {
        check('600px design or responsive max-width',parseFloat(top.isolated.table.width)<=600&&parseFloat(top.isolated.table.width)>300);
        check('sender padding retained',top.isolated.td.padding==='24px');
        check('sender background retained',top.isolated.td.background==='rgb(22, 50, 79)');
        check('sender typography isolated',top.isolated.h1.font==='Georgia, serif'&&top.isolated.h1.fontSize==='32px');
      }
      if(fixture.name==='APPLE_STYLE_NO_IMAGES')check('sender hierarchy preserved',top.isolated.h1.fontSize==='48px'&&top.isolated.div.padding==='24px');
      const assets=await (await tab.capabilities.get('pageAssets')).list();
      record.requests=assets.assets.filter(a=>a.sources.some(s=>s.kind==='resource')).map(a=>({url:a.url,kind:a.kind}));
      check('no canary network resource observed',!record.requests.some(r=>r.url.includes('m1d-network-canary')));
      record.assertions={checks,passed:checks.filter(c=>c.pass).length,failed:checks.filter(c=>!c.pass).length};
      records.push(record);await writeFile(`${evidenceDir}/geometry.json`,JSON.stringify(records,null,2));
    }
  }
  await writeFile(`${evidenceDir}/console.json`,JSON.stringify(await tab.dev.logs({levels:['error','warn'],limit:100}),null,2));
  const summary={cases:records.length,passed:records.reduce((n,r)=>n+r.assertions.passed,0),failed:records.reduce((n,r)=>n+r.assertions.failed,0),failures:records.flatMap(r=>r.assertions.checks.filter(c=>!c.pass).map(c=>({fixture:r.fixture.name,width:r.top.viewport.width,...c})))};
  await writeFile(`${evidenceDir}/summary.json`,JSON.stringify(summary,null,2));return summary;
}
