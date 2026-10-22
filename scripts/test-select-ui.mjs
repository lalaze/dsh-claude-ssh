import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const temp = await mkdtemp(join(tmpdir(), 'dsh-select-ui-'));
const session = `dsh-select-ui-${process.pid}`;
const browserArgs = ['--session', session, '--json'];
let executable = process.env.DSH_TEST_BROWSER_PATH;
if (!executable && process.platform === 'darwin') {
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  try { await access(chrome); executable = chrome; } catch {}
}
function browser(...args) {
  let raw;
  try { raw = execFileSync('agent-browser', [...browserArgs, ...args], { encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 35000 }); }
  catch (error) {
    if (error.code === 'ENOENT') throw new Error('Install agent-browser before running test:ui.');
    try { const result = JSON.parse(error.stdout); throw new Error(result.error); }
    catch (parsed) { if (parsed instanceof SyntaxError) throw error; throw parsed; }
  }
  const result = JSON.parse(raw);
  if (!result.success) throw new Error(result.error ?? 'Browser command failed');
  return result.data;
}
const evaluate = source => browser('eval', '-b', Buffer.from(source).toString('base64')).result;
const click = (selector, frame = false, area = 'center') => {
  const point = evaluate(`(() => {
    const frame = document.getElementById('settings-frame');
    const doc = ${frame ? 'frame.contentDocument' : 'document'};
    const target = doc.querySelector(${JSON.stringify(selector)});
    const rect = target.getBoundingClientRect();
    const x = Math.round(rect.left + ${area === 'left' ? '12' : area === 'right' ? 'rect.width - 12' : 'rect.width / 2'});
    const y = Math.round(rect.top + rect.height / 2);
    if (!target.contains(doc.elementFromPoint(x, y))) throw new Error('Mouse target is covered: ' + ${JSON.stringify(selector)});
    const origin = ${frame ? 'frame.getBoundingClientRect()' : '{ left: 0, top: 0 }'};
    return { x: Math.round(origin.left + x), y: Math.round(origin.top + y) };
  })()`);
  browser('mouse', 'move', String(point.x), String(point.y)); browser('mouse', 'down'); browser('mouse', 'up');
};
try {
  const result = await build({ absWorkingDir: root, entryPoints: ['test/ui/select.fixture.tsx'], bundle: true, write: false, platform: 'browser', format: 'iife' });
  const html = '<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:#181818;color:#eee;font:14px system-ui}label{display:grid;gap:8px}output{display:block;min-height:24px}</style></head><body><script>' + result.outputFiles[0].text.replaceAll('</script', '<\\/script') + '</script></body></html>';
  const file = join(temp, 'index.html'); await writeFile(file, html);
  browser(...(executable ? ['--executable-path', executable] : []), '--allow-file-access', 'open', pathToFileURL(file).href);
  browser('wait', '--fn', 'Boolean(document.getElementById("settings-frame")?.contentDocument?.querySelector("[role=combobox]"))');
  click('#main-picker [role=combobox]');
  evaluate(`if (!document.querySelector('.dsh-ssh-select-panel')) throw new Error('Main-document mouse click did not open menu');`);
  click('[role=option]:nth-child(2)');
  evaluate(`if (document.getElementById('main-picker-value').textContent !== 'beta-ssh') throw new Error('Main-document mouse selection failed');`);

  click('#frame-picker [role=combobox]', true);
  browser('wait', '--fn', 'document.getElementById("settings-frame").contentDocument.querySelector("[role=combobox]").getAttribute("aria-expanded")==="true"');
  evaluate(`const doc=document.getElementById('settings-frame').contentDocument;
    if (!doc.querySelector('.dsh-ssh-select-panel')) throw new Error('Menu mounted in wrong document: separate settings window appears unresponsive');
    if (document.querySelector('.dsh-ssh-select-panel')) throw new Error('Menu leaked into main window');
    const rect=doc.querySelector('.dsh-ssh-select-panel').getBoundingClientRect();
    if (rect.top<0 || rect.bottom>doc.defaultView.innerHeight || rect.right>doc.defaultView.innerWidth) throw new Error('Menu positioned using wrong window');`);
  click('[role=option]:nth-child(2)', true);
  evaluate(`const doc=document.getElementById('settings-frame').contentDocument;
    if (doc.getElementById('frame-picker-value').textContent !== 'beta-ssh') throw new Error('Separate-document mouse selection failed');
    if (doc.activeElement !== doc.querySelector('[role=combobox]')) throw new Error('Focus returned to wrong document');`);

  click('#frame-picker [role=combobox]', true);
  browser('wait', '--fn', 'document.getElementById("settings-frame").contentDocument.activeElement?.getAttribute("role")==="searchbox"');
  browser('keyboard', 'type', 'gamma'); browser('press', 'Enter');
  evaluate(`const doc=document.getElementById('settings-frame').contentDocument;
    if (doc.getElementById('frame-picker-value').textContent !== 'gamma-ssh') throw new Error('Separate-document search/Enter failed');`);
  click('#frame-picker [role=combobox]', true); browser('press', 'Escape');
  evaluate(`if (document.getElementById('settings-frame').contentDocument.querySelector('.dsh-ssh-select-panel')) throw new Error('Escape did not close separate-document menu');`);
  click('#frame-picker [role=combobox]', true); click('#frame-picker-outside', true);
  evaluate(`if (document.getElementById('settings-frame').contentDocument.querySelector('.dsh-ssh-select-panel')) throw new Error('Outside click did not close separate-document menu');`);
  for (const area of ['left', 'center', 'right']) {
    click('#frame-picker [role=combobox]', true, area);
    evaluate(`if (!document.getElementById('settings-frame').contentDocument.querySelector('.dsh-ssh-select-panel')) throw new Error('Trigger click region failed: ${area}');`);
    browser('press', 'Escape');
  }
  console.log('PASS: same-document and separate-document mouse open/select, viewport placement, focus, search, Enter, Escape, outside click');
} finally {
  try { browser('close'); } catch {}
  await rm(temp, { recursive: true, force: true });
}
