// Loopback-only synthetic lifecycle test of the production revalidation effect,
// workspace provider and reader. No authentication shortcuts enter app builds.
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
const bundle = await build({entryPoints:['scripts/fixtures/mail-reader-continuity.tsx'],bundle:true,write:false,platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"'},plugins:[{name:'fixture-boundaries',setup(b){
  b.onLoad({filter:/mail-workspace-data-source-boundary\.tsx$/},async({path})=>({loader:'tsx',contents:(await readFile(path,'utf8')).replace('function MailProductionWorkspaceRevalidation()', 'export function MailProductionWorkspaceRevalidation()')}));
  b.onLoad({filter:/i18n\/provider\.tsx$/},()=>({loader:'tsx',contents:'export const useTranslation=()=>({t:(key)=>key,locale:"en"}); export const I18nProvider=({children})=>children;'}));
  b.onLoad({filter:/mail-session-provider\.tsx$/},()=>({loader:'tsx',contents:'export const useMailSession=()=>({effectiveMailAccessEnabled:true});'}));
}}]});
const server=createServer(async(req,res)=>{
 if(req.method==='POST'&&req.url==='/result'){let body='';for await(const chunk of req)body+=chunk;const result=JSON.parse(body);console.log(JSON.stringify(result,null,2));process.exitCode=result.ok?0:1;res.end('recorded');server.close();return;}
 if(req.url==='/test.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].contents);return;}
 res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Mail continuity lifecycle</title><pre id="result">Running</pre><style>#mount{height:600px;display:flex;flex-direction:column}#mount>div{display:flex;flex:1;min-height:0;flex-direction:column}article{display:flex;flex:1;min-height:0;flex-direction:column;overflow:hidden}.mail-message-scroll{overflow-y:auto;flex:1;min-height:0}.mail-reading-footer{flex-shrink:0}</style><div id="mount"></div><script src="/test.js"></script>');
});
server.listen(3301,'127.0.0.1',()=>console.log('Open http://127.0.0.1:3301'));
