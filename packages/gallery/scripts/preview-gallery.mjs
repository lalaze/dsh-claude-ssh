import { build } from 'esbuild';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { createGalleryHandler } from '../lib/server/bing.js';

export async function startPreview(port = 4183) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const result = await build({ absWorkingDir: root, entryPoints: ['test/ui/gallery.fixture.tsx'], bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022' });
  const script = result.outputFiles[0].text.replaceAll('</script', '<\\/script');
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DSH 图库 · 界面预览</title></head><body><script type="module">${script}</script></body></html>`;
  const handler = createGalleryHandler();
  const server = createServer(async (request, response) => {
    try {
      if (request.url === '/favicon.ico') { response.writeHead(204); response.end(); return; }
      if (request.url?.startsWith('/api/gallery/')) {
        const result = await handler(new Request(`http://preview.test${request.url}`, { method: request.method }));
        response.writeHead(result.status, Object.fromEntries(result.headers)); response.end(Buffer.from(await result.arrayBuffer())); return;
      }
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); response.end(html);
    } catch (error) { response.writeHead(500); response.end(String(error)); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '0.0.0.0', resolve); });
  return server;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.DSH_GALLERY_PREVIEW_PORT || 4183);
  const server = await startPreview(port); console.log(`图库预览：http://100.96.195.115:${server.address().port}/`);
}
