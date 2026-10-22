import { build } from 'esbuild';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const result = await build({ absWorkingDir: root, entryPoints: ['test/ui/dashboard.fixture.tsx'], bundle: true, write: false, platform: 'browser', format: 'iife' });
const html = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DSH 使用量统计 · 界面预览</title><style>:root{color-scheme:light dark}body{margin:0;background:Canvas;color:CanvasText;font:14px system-ui}</style></head><body><script>' + result.outputFiles[0].text.replaceAll('</script', '<\\/script') + '</script></body></html>';
const port = Number(process.env.DSH_USAGE_PREVIEW_PORT || 4182);
const server = createServer((request, response) => {
  if (request.url === '/favicon.ico') { response.writeHead(204); response.end(); return; }
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); response.end(html);
});
server.listen(port, '0.0.0.0', () => console.log(`演示数据预览：http://100.96.195.115:${port}/#demo`));
