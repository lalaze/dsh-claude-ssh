import { build } from 'esbuild';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const result = await build({ absWorkingDir: root, entryPoints: ['test/ui/fast.fixture.tsx'], bundle: true, write: false, platform: 'browser', format: 'iife' });
const html = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>GPT Fast · 界面预览</title></head><body><script>' + result.outputFiles[0].text.replaceAll('</script', '<\\/script') + '</script></body></html>';
const preferences = new Map();
const server = createServer(async (request, response) => {
  if (request.url.startsWith('/api/magpie-fast')) {
    const url = new URL(request.url, 'http://fixture.invalid');
    let body = Object.fromEntries(url.searchParams);
    if (request.method === 'POST') {
      let text = ''; for await (const part of request) text += part;
      body = JSON.parse(text); preferences.set(body.sessionId, body.enabled);
    }
    response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify({ enabled: preferences.get(body.sessionId) ?? false, supported: body.provider === 'remote-magpie', reason: '需要已有的 OpenAI Chat/Responses API 提供商（支持远端 Magpie）' })); return;
  }
  if (request.url === '/favicon.ico') { response.writeHead(204); response.end(); return; }
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); response.end(html);
});
server.listen(Number(process.env.DSH_FAST_PREVIEW_PORT || 4184), '0.0.0.0', () => console.log(`http://100.96.195.115:${server.address().port}/`));
