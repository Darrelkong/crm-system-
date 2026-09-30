// Local browser regression: real SI2 analysis/cards/card/workflow composition.
// Open the printed loopback URL. Only HTTP responses are fixtures; no D1/AI/auth.
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const root = process.cwd();
const bundle = await build({
  entryPoints: [path.join(root, process.env.CONFIRM_REFRESH_TEST === '1' ? 'scripts/fixtures/knowledge-candidate-confirm-refresh.tsx' : 'scripts/fixtures/knowledge-candidate-lifecycle.tsx')],
  bundle: true, write: false, platform: 'browser', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"development"' },
  plugins: [{ name: 'observe-real-draft-lifecycle', setup(b) {
    // Observation only: keep all production callbacks, effects and state setters.
    b.onLoad({ filter: /knowledge-smart-ingest-analysis-section\.tsx$/ }, async ({ path: file }) => ({
      contents: (await readFile(file, 'utf8')).replace(
        '  const pollRef =', '  window.__candidateLifecycle.observe(candidateDrafts);\n  const pollRef ='),
      loader: 'tsx',
    }));
    b.onLoad({ filter: /knowledge-segment-candidate-card\.tsx$/ }, async ({ path: file }) => ({
      contents: (await readFile(file, 'utf8')).replace(
        '    onDraftStateChange?.(', '    window.__candidateLifecycle.notifications++;\n    onDraftStateChange?.('),
      loader: 'tsx',
    }));
  } }],
});
const server = createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/result') {
    let body = ''; for await (const chunk of req) body += chunk;
    const result = JSON.parse(body); console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.ok ? 0 : 1; res.end('recorded'); server.close(); return;
  }
  if (req.url === '/test.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0].contents); return; }
  res.setHeader('Content-Type', 'text/html');
  res.end('<!doctype html><title>SI2 candidate lifecycle regression</title><h1>SI2 candidate lifecycle regression</h1><pre id="result">Running</pre><div id="mount"></div><script src="/test.js"></script>');
});
server.listen(Number(process.env.PORT || 3198), '127.0.0.1', () => console.log(`Open http://127.0.0.1:${server.address().port}`));
