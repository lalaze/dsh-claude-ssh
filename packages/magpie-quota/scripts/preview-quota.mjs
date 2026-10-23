import { build } from 'esbuild';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

export async function startPreview(port = 4185) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const result = await build({ absWorkingDir: root, entryPoints: ['test/ui/quota.fixture.tsx'], bundle: true, write: false, platform: 'browser', format: 'iife', target: 'es2022' });
  const html = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Magpie 额度 · 界面预览</title></head><body><script>' + result.outputFiles[0].text.replaceAll('</script', '<\\/script') + '</script></body></html>';
  const server = createServer((request, response) => {
    if (request.url === '/favicon.ico') { response.writeHead(204); response.end(); return; }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); response.end(html);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '0.0.0.0', resolve); });
  return server;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = await startPreview(Number(process.env.DSH_QUOTA_PREVIEW_PORT || 4185));
  console.log(`http://100.96.195.115:${server.address().port}/`);
}
