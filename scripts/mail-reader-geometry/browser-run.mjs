/** Browser adapter runner for the existing Codex in-app browser (no install).
 * Invoke from cua_repl with an authenticated LOCAL tab, viewport capability,
 * and the disposable fixture manifest. Uses only documented browser APIs.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { measureReader, assertGeometry } from './geometry.mjs';

export async function runReaderGeometry({ tab, viewport, fixtures, evidenceDir, mode='fixed' }) {
  const url = new URL(await tab.url());
  if(url.hostname!=='127.0.0.1'||url.port!=='3299'||url.protocol!=='http:'||url.pathname!=='/mail') throw new Error('M1B requires the local /mail fixture at 127.0.0.1:3299');
  if(!['baseline','fixed'].includes(mode)) throw new Error('Unknown assertion mode');
  const expectedNames=['LONG_HTML','TABLE_NEWSLETTER','IMAGE_ONLY_CURRENT_POLICY','QUOTED_LONG','SAFE_WIDE_CONTENT','MALICIOUS_HTML'];
  if(fixtures.length!==6||expectedNames.some(n=>!fixtures.some(f=>f.name===n&&f.id===`m1b-${n.toLowerCase()}`))) throw new Error('Wrong fixture manifest');
  await mkdir(evidenceDir,{recursive:true});
  const records=[];
  const measure=async fixture=>{
    const result=await tab.playwright.evaluate(measureReader,{end:fixture.end});
    return result;
  };
  try {
    for(const size of [{width:1280,height:900},{width:390,height:844}]) {
      await viewport.set(size);
      await tab.screenshot({fullPage:false});
      const label=size.width===390?'mobile':'desktop';
      for(const name of expectedNames) {
        const fixture=fixtures.find(f=>f.name===name);
        const back=tab.playwright.getByRole('button',{name:size.width===390?'Back to Mail':'Back to message list',exact:true});
        if(await back.isVisible()) { await back.click(); await tab.screenshot({fullPage:false}); }
        const row=tab.playwright.getByRole('button',{name:new RegExp(`Synthetic Sender .* M1B ${name}(?: |$)`)});
        await row.click();
        await tab.playwright.getByRole('heading',{name:`M1B ${name}`,exact:true}).waitFor({state:'visible'});
        await tab.playwright.locator('.mail-message-body').waitFor({state:'visible'});
        const capture=async stage=>{
          await writeFile(path.join(evidenceDir,`${label}-${name.toLowerCase()}-${stage}.png`),await tab.screenshot({fullPage:false}));
          return measure(fixture);
        };
        const top=await capture('top');
        const point=size.width===390?[195,420]:[800,450];
        await tab.scroll(point,'down',300);
        const middle=await capture('middle-attempt');
        await tab.scroll(point,'down',1000);
        const bottom=await capture('bottom-attempt');
        // A second large gesture proves the user-scrollable maximum is stable.
        await tab.scroll(point,'down',1000);
        await tab.screenshot({fullPage:false});
        const settled=await measure(fixture);
        const record={fixture,top,middle,bottom:settled,firstBottom:bottom};
        if(name==='MALICIOUS_HTML') {
          await tab.playwright.getByText('SAFE_CLICK_TARGET',{exact:true}).click();
          record.securityAfterClick=await measure(fixture);
        }
        record.assertions=assertGeometry(record,mode);
        records.push(record);
        await writeFile(path.join(evidenceDir,'geometry.json'),JSON.stringify(records,null,2));
      }
    }
    const logs=await tab.dev.logs({levels:['error','warn'],limit:30});
    await writeFile(path.join(evidenceDir,'console.json'),JSON.stringify(logs,null,2));
    const summary={ mode,cases:records.length,passed:records.reduce((n,r)=>n+r.assertions.passed,0),failed:records.reduce((n,r)=>n+r.assertions.failed,0),results:records.map(r=>({name:r.fixture.name,width:r.top.viewport.width,checks:r.assertions})) };
    await writeFile(path.join(evidenceDir,'summary.json'),JSON.stringify(summary,null,2));
    if(summary.failed) throw new Error(`M1B geometry assertions failed: ${summary.failed}; see summary.json`);
    return summary;
  } finally { await viewport.reset(); }
}
