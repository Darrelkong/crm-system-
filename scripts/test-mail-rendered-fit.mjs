/** Loopback-only real renderer tests. No D1, credentials, transport or application routes. */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createServer } from 'node:http';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {MailIsolatedHtmlDocument} from './src/components/mail/mail-isolated-html-document';
import {sanitizeInboundBodyHtml} from './src/lib/mail/inbound-body-html-sanitizer';
const root=createRoot(document.getElementById('message'));
window.show=(html,key)=>root.render(<MailIsolatedHtmlDocument key={key} html={sanitizeInboundBodyHtml(html)}/>);
` }, bundle: true, write: false, platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' } });
const server = createServer((req, res) => {
  if (req.url === '/test.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0].contents); return; }
  res.setHeader('Content-Type', 'text/html');
  res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}main{margin:16px;width:calc(100% - 32px);height:calc(100dvh - 80px);overflow-y:auto}footer{height:32px}</style><main id="scroll"><div id="message"></div><footer>END FOOTER</footer></main><script src="/test.js"></script>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [], external = [], checks = [];
page.on('pageerror', e => errors.push(e.message));
await page.route('**/*', route => {
  if (new URL(route.request().url()).origin !== origin) { external.push(new URL(route.request().url()).origin); return route.abort(); }
  return route.continue();
});
const check = (ok, label) => { checks.push({ label, pass: !!ok }); assert.ok(ok, label); };
let identity = 0;
async function show(html) {
  await page.evaluate(({ html, key }) => window.show(html, key), { html, key: ++identity });
  await page.waitForFunction(() => document.querySelector('iframe')?.contentDocument?.body?.textContent?.includes('END'));
  await page.waitForTimeout(100);
}
async function geometry() {
  return page.locator('iframe').evaluate(f => {
    const d = f.contentDocument, h = f.parentElement.parentElement;
    return { available: h.clientWidth, natural: f.clientWidth, scale: f.getBoundingClientRect().width / f.clientWidth,
      horizontal: h.scrollWidth - h.clientWidth, outer: document.documentElement.scrollWidth,
      innerVertical: d.documentElement.scrollHeight - f.clientHeight,
      table: d.querySelector('table')?.getBoundingClientRect().width };
  });
}
const flexible = '<table style="width:600px;max-width:100%"><tr><td style="padding:16px">Flexible<p>END</p></td></tr></table>';
try {
  await page.goto(origin); await page.waitForFunction(() => typeof window.show === 'function');
  for (const [label, html] of [
    ['flexible', flexible],
    ['nested padded flexible', '<table style="width:600px;max-width:100%"><tr><td style="padding:16px"><table style="width:100%;max-width:100%"><tr><td style="padding:12px">Nested END</td></tr></table></td></tr></table>'],
    ['responsive flexible', '<style>.layout{width:600px;max-width:100%}.mobile{display:none}@media(max-width:600px){.mobile{display:block}.desktop{display:none}}</style><table class="layout"><tr><td><p class="mobile">MOBILE END</p><p class="desktop">DESKTOP END</p></td></tr></table>'],
  ]) {
    await show(html); const g = await geometry();
    check(g.available === 358 && g.natural === 358 && g.scale === 1 && g.horizontal === 0, label + ' natural mobile fit');
    check(await page.getByRole('button', { name: 'Original width', exact: true }).count() === 0, label + ' no toggle');
    // Controlled engine artifact, not a claim to emulate physical Safari.
    await page.locator('iframe').evaluate(f => { Object.defineProperty(f.contentDocument.body, 'scrollWidth', { configurable: true, get: () => 600 }); window.dispatchEvent(new Event('resize')); });
    await page.waitForTimeout(150);
    check((await geometry()).scale === 1 && await page.getByRole('button', { name: 'Original width', exact: true }).count() === 0, label + ' inflated intrinsic scrollWidth ignored');
  }
  await show('<table style="width:800px"><tr><td>Fixed END</td></tr></table>');
  let g = await geometry(); check(g.natural === 800 && g.scale === 358 / 800, 'genuine fixed width fits');
  await page.getByRole('button', { name: 'Original width', exact: true }).click(); await page.waitForTimeout(100);
  g = await geometry(); check(g.scale === 1 && g.horizontal === 442 && g.outer === 390, 'original width contained');
  await show(flexible); check((await geometry()).scale === 1 && await page.getByRole('button', { name: 'Fit to screen', exact: true }).count() === 0, 'new identity resets original mode');
  await show('<table style="width:800px"><tr><td>Fixed END</td></tr></table>'); check((await geometry()).scale < 1, 'return to wide identity defaults to fit');
  for (const tag of ['pre', 'p style="white-space:nowrap"']) {
    await show('<' + tag + '>' + 'LONG'.repeat(200) + ' END</' + tag.split(' ')[0] + '>');
    g = await geometry(); check(g.natural > 4000 && g.scale < 1 && g.outer === 390, tag + ' overflowing text range retained');
  }
  for (const height of [844, 600]) {
    await page.setViewportSize({ width: 390, height });
    await show('<table style="width:600px;max-width:100%"><tr><td>' + '<p>Long flexible paragraph</p>'.repeat(500) + '<p id="end">END</p></td></tr></table>');
    await page.locator('#scroll').evaluate(s => { s.scrollTop = s.scrollHeight; });
    g = await geometry();
    const bottom = await page.locator('#scroll').evaluate(s => { const f = s.querySelector('iframe'), e = [...f.contentDocument.querySelectorAll('p')].find(p => p.textContent === 'END'), r = e.getBoundingClientRect(), fr = f.getBoundingClientRect(), sr = s.getBoundingClientRect(); return fr.top + r.bottom <= sr.bottom && fr.top + r.top >= sr.top && s.querySelector('footer').getBoundingClientRect().bottom <= sr.bottom; });
    check(g.scale === 1 && g.innerVertical <= 1 && bottom, 'long flexible true bottom/footer ' + height);
  }
  await page.setViewportSize({ width: 1280, height: 900 }); await show(flexible);
  g = await geometry(); check(g.scale === 1 && g.table === 600, 'desktop flexible not shrunk');
  check(errors.length === 0 && external.length === 0, 'no browser errors or external requests');
} finally {
  console.log(JSON.stringify({ checks, errors, external }));
  await browser.close(); await new Promise(resolve => server.close(resolve));
}
