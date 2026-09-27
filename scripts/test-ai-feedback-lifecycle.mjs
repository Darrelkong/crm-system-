// Real React DOM/StrictMode regression runner. Open the printed loopback URL.
// Uses the already-installed esbuild; no CRM server, auth, D1 or AI calls.
import { build } from 'esbuild';
import { createServer } from 'node:http';
import path from 'node:path';
const root = process.cwd();
const bundle = await build({
  entryPoints: [path.join(root, 'scripts/fixtures/ai-feedback-lifecycle.tsx')],
  bundle: true, write: false, platform: 'browser', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"development"' },
  plugins: [{ name: 'test-translation', setup(b) {
    b.onResolve({ filter: /^@\/i18n\/provider$/ }, () => ({ path: 'translations', namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const useTranslation = () => ({t: key => key});' }));
  } }],
});
const server = createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/result') {
    let body = ''; for await (const chunk of req) body += chunk;
    const result = JSON.parse(body);
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.ok ? 0 : 1;
    res.end('recorded'); server.close(); return;
  }
  if (req.url === '/test.js') { res.setHeader('Content-Type','text/javascript'); res.end(bundle.outputFiles[0].contents); return; }
  res.setHeader('Content-Type','text/html');
  res.end('<!doctype html><title>AI feedback lifecycle tests</title><h1>AI feedback lifecycle tests</h1><pre id="result">Running</pre><div id="mount"></div><script src="/test.js"></script>');
});
server.listen(Number(process.env.PORT || 3198), '127.0.0.1', () => console.log(`Open http://127.0.0.1:${server.address().port}`));
