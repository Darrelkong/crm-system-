// Loopback-only real React customer list + real server page/API/SQL fixture.
// No CRM session, Cloudflare, migrations or remote resources. Open printed URL.
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { relationshipFixture } from './fixtures/customer-relationship.mjs';
// Deliberately remove only the state-reset fix to prove the browser catches
// stale rows even when the server relationship parameter is correctly passed.
const negativeControl=process.env.RELATIONSHIP_NEGATIVE_CONTROL==='without-key';
const fixture=await relationshipFixture({pageTransform:source=>negativeControl
  ? source.replace('key={listFilter.relationship ?? "all"}', '') : source});
const bundle=await build({entryPoints:['scripts/fixtures/customer-relationship-browser.tsx'],bundle:true,write:false,platform:'browser',format:'esm',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"'},plugins:[{
  name:'local-navigation',setup(b) {
    const mocks={
      'next/link':`import React from 'react';export const useLinkStatus=()=>({pending:false});export default function Link({href,children,prefetch,replace,scroll,...props}){return <a {...props} href={href} onClick={e=>{props.onClick?.(e);if(!e.defaultPrevented){e.preventDefault();window.__relationshipNavigate(href);}}}>{children}</a>;}`,
      '@/lib/customers/list-rows':`export function formatProjectNameForList(){return {display:"—"};}`,
    };
    b.onResolve({filter:/.*/},a=>a.path in mocks?{path:a.path,namespace:'fixture'}:undefined);
    b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:mocks[a.path],loader:'tsx',resolveDir:process.cwd()}));
  },
}]});
const server=createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,'http://127.0.0.1');
    if(req.method==='POST'&&url.pathname==='/result') {
      let body='';for await(const chunk of req)body+=chunk;
      const result=JSON.parse(body);console.log(JSON.stringify(result,null,2));
      process.exitCode=result.ok?0:1;res.end('recorded');server.close(()=>fixture.close());return;
    }
    if(req.method!=='GET'){res.writeHead(405);res.end();return;}
    if(url.pathname==='/test.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].contents);return;}
    if(url.pathname==='/locales/en.json'){res.setHeader('Content-Type','application/json');res.end(await readFile('public/locales/en.json'));return;}
    if(url.pathname==='/fixture/page'||url.pathname==='/api/customers') {
      res.setHeader('Content-Type','application/json');
      const role=url.searchParams.get('actor')==='admin'?'admin':'staff';
      url.searchParams.delete('actor');
      const data=url.pathname==='/fixture/page'?await fixture.page(Object.fromEntries(url.searchParams),role):await fixture.api(url.searchParams.toString(),role);
      res.end(JSON.stringify(data));return;
    }
    if(url.pathname!=='/'&&url.pathname!=='/customers'){res.writeHead(404);res.end();return;}
    res.setHeader('Content-Type','text/html');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; connect-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'none'");
    res.end('<!doctype html><title>R1 customer relationship regression</title><h1>R1 local relationship regression</h1><pre id="result">Running</pre><div id="mount"></div><script type="module" src="/test.js"></script>');
  } catch(error){console.error(error);res.writeHead(500);res.end('Local fixture failed');}
});
server.listen(Number(process.env.PORT||3211),'127.0.0.1',()=>console.log(`Open http://127.0.0.1:${server.address().port}`));
