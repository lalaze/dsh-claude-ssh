import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, rm, access, readFile } from 'node:fs/promises';
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
const evaluate = source => browser('eval', '-b', Buffer.from(`(() => eval(${JSON.stringify(source)}))()`).toString('base64')).result;
const click = (selector, frame = false, area = 'center') => {
  const point = evaluate(`(() => {
    const frame = document.getElementById('settings-frame');
    const doc = ${frame ? 'frame.contentDocument' : 'document'};
    const target = doc.querySelector(${JSON.stringify(selector)});
    target.scrollIntoView({ block: 'nearest' });
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
  const codexClientPath = process.env.DSH_TEST_CODEX_CLIENT;
  let codexSource = '';
  if (codexClientPath) {
    const installed = await readFile(codexClientPath, 'utf8');
    if (!installed.includes('function CodexSettingsPage(') || !installed.includes('exports.apply = apply;')) throw new Error('Unsupported Codex UI test bundle');
    codexSource = installed.replace('exports.apply = apply;', 'exports.__TestSettingsPage = CodexSettingsPage; exports.apply = apply;');
  }
  const result = await build({ absWorkingDir: root, entryPoints: ['test/ui/select.fixture.tsx'], bundle: true, write: false, platform: 'browser', format: 'iife', define: { __CODEX_CLIENT_SOURCE__: JSON.stringify(codexSource) } });
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
  click('#open-modal');
  click('#modal-picker [role=combobox]');
  evaluate(`const popup=document.querySelector('.dsh-ssh-select-panel');
    if (!popup?.closest('dialog')) throw new Error('Modal popup escaped its dialog and is inert behind the native modal layer');
    const rect=popup.getBoundingClientRect(), trigger=document.querySelector('#modal-picker [role=combobox]').getBoundingClientRect();
    if (Math.abs(rect.left-trigger.left)>1 || Math.abs(rect.top-trigger.bottom-6)>4) throw new Error('Transformed modal changed popup viewport coordinates');
    if (!popup.contains(document.elementFromPoint(rect.left+12, rect.top+12))) throw new Error('Modal popup cannot receive pointer input');`);
  browser('wait', '--fn', 'document.activeElement?.getAttribute("role")==="searchbox"');
  click('[role=option]:nth-child(2)');
  evaluate(`if (document.getElementById('modal-picker-value').textContent !== 'beta-ssh') throw new Error('Modal mouse selection failed');`);
  click('#modal-picker [role=combobox]');
  browser('wait', '--fn', 'document.activeElement?.getAttribute("role")==="searchbox"');
  browser('keyboard', 'type', 'gamma'); browser('press', 'Enter');
  evaluate(`if (document.getElementById('modal-picker-value').textContent !== 'gamma-ssh') throw new Error('Modal search/Enter failed');`);
  click('#close-modal');
  if (codexClientPath) {
    click('[data-dcu-settings-trigger]');
    browser('wait', '--fn', 'Boolean(document.querySelector("#codex-picker [role=combobox]"))');
    click('#codex-picker [role=combobox]');
    evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    evaluate(`if (!document.querySelector('.dsh-ssh-select-panel') || document.activeElement?.getAttribute('role') !== 'searchbox') throw new Error('Actual Codex settings redirected search focus and closed the popup after clicking');`);
    click('.dsh-ssh-select-footer');
    evaluate(`if (!document.querySelector('.dsh-ssh-select-panel')) throw new Error('Popup footer click activated the wrapping label');`);
    click('[role=option]:nth-child(2)');
    evaluate(`if (document.getElementById('codex-picker-value').textContent !== 'beta-ssh') throw new Error('Codex settings mouse selection failed');
      if (document.querySelector('.dsh-ssh-select-panel')) throw new Error('Selection reopened the popup through label activation');`);
    click('#codex-picker [role=combobox]');
    browser('wait', '--fn', 'document.activeElement?.getAttribute("role")==="searchbox"');
    browser('keyboard', 'type', 'no-such-connection');
    click('.dsh-ssh-select-empty');
    evaluate(`if (!document.querySelector('.dsh-ssh-select-panel')) throw new Error('Popup empty-state click activated the wrapping label');`);
    click('[role=searchbox]');
    browser('fill', '[role=searchbox]', 'gamma'); browser('press', 'Enter');
    evaluate(`if (document.getElementById('codex-picker-value').textContent !== 'gamma-ssh') throw new Error('Codex settings search/Enter failed');`);
    click('#codex-picker [role=combobox]'); browser('press', 'Escape');
    evaluate(`if (!document.querySelector('[data-dcu-settings-page]')) throw new Error('Escape closed settings instead of the popup');
      if (document.querySelector('.dsh-ssh-select-panel')) throw new Error('Escape did not close the Codex popup');`);
    console.log('PASS: installed Codex UI settings component mouse open/select, search, Enter, Escape, focus containment and no label reactivation');
  }
  const openModels = () => {
    click('#native-models [aria-label="选择模型"]');
    if (!evaluate(`Boolean(document.querySelector('#native-models [role=searchbox]'))`)) click('#native-models [role=menuitem]');
  };
  openModels();
  browser('wait', '--fn', 'Array.from(document.querySelectorAll("#native-models [role=menuitemradio]")).filter(e=>e.textContent.includes("Claude")).length===3');
  evaluate(`if (document.querySelector('#native-models [role=menu]').textContent.includes('Legacy Claude')) throw new Error('Cross-host legacy model leaked');`);
  browser('fill', '#native-models [role=searchbox]', 'opus'); browser('press', 'Enter');
  browser('wait', '--fn', 'document.getElementById("native-selection").textContent.includes("opus")');
  click('#local-project');
  openModels();
  evaluate(`if (document.querySelector('#native-models [role=menu]').textContent.includes('Claude')) throw new Error('Claude leaked into local project');`);
  click('#native-models [role=menuitemradio]');
  click('#native-models [aria-label="选择模型"]');
  click('#native-models [role=menuitem]:nth-child(2)');
  click('#native-models [role=menuitemradio]:nth-child(2)');
  evaluate(`if (!document.getElementById('native-selection').textContent.includes('high')) throw new Error('Other provider reasoning selection broke');`);
  evaluate(`const button=document.querySelector('#native-models .dsh-cm-trigger'), style=getComputedStyle(button), rect=button.getBoundingClientRect();
    if (rect.height!==28 || rect.width>360 || style.borderTopWidth!=='0px' || style.backgroundColor!=='rgba(0, 0, 0, 0)') throw new Error('Native compact borderless trigger changed');
    if (button.textContent.includes('Responses') || button.textContent.includes('Magpie ·')) throw new Error('Provider label duplicated in trigger');
    if (document.querySelectorAll('#native-models .dsh-cm-trigger').length!==1 || document.querySelector('#native-models [role=combobox]')) throw new Error('Separate large selectors returned');
    const left=document.getElementById('permission-trigger').getBoundingClientRect();
    if (Math.abs((left.top+left.bottom)/2-(rect.top+rect.bottom)/2)>1) throw new Error('Model entry wrapped to a second toolbar row');`);
  // The existing entrance opens the same two settings, rather than separate input controls.
  click('#native-models [aria-label="选择模型"]');
  evaluate(`const rows=[...document.querySelectorAll('#native-models [role=menuitem]')];
    if(rows.length!==2 || !rows[0].textContent.startsWith('模型') || !rows[1].textContent.startsWith('推理等级')) throw new Error('Two-level native menu changed');`);
  browser('press', 'Escape');
  // A remote probe is deliberately slower than the local one: its late result must not
  // make the shared model catalog visible in the next project's menu.
  evaluate('window.nativeDelay = 1500');
  click('#remote-project'); openModels(); browser('press', 'Escape'); browser('press', 'Escape'); click('#local-project');
  openModels();
  evaluate('new Promise(resolve => setTimeout(resolve, 1600))');
  evaluate(`if (document.querySelector('#native-models [role=menu]').textContent.includes('Claude')) throw new Error('Stale remote eligibility leaked across sessions');`);
  browser('press', 'Escape'); browser('press', 'Escape');
  browser('set', 'viewport', '390', '720');
  evaluate(`const button=document.querySelector('#native-models .dsh-cm-trigger'), rect=button.getBoundingClientRect(), label=button.querySelector('.dsh-cm-name');
    if (rect.right>innerWidth || rect.height!==28 || getComputedStyle(label).textOverflow!=='ellipsis') throw new Error('Compact model label overflows on narrow screens');`);
  if (process.env.DSH_TEST_UI_SCREENSHOT) {
    browser('set', 'viewport', '960', '600');
    evaluate(`document.querySelectorAll('main > :not(#native-models),#native-models > button,#native-selection').forEach(e=>e.style.display='none'); document.getElementById('native-models').style.marginTop='140px'; document.activeElement.blur(); window.scrollTo(0,0)`);
    browser('screenshot', process.env.DSH_TEST_UI_SCREENSHOT);
    click('#native-models [aria-label="选择模型"]');
    browser('screenshot', process.env.DSH_TEST_UI_SCREENSHOT.replace(/\.png$/, '-menu.png'));
  }
  console.log('PASS: target-only Claude models, native selection, other-provider reasoning, no cross-host models or stale eligibility after project switch');
  console.log('PASS: same-document, separate-document and modal mouse open/select, viewport placement, focus, search, Enter, Escape, outside click');
} catch (error) {
  try { console.error('Browser errors:', JSON.stringify(browser('errors'))); } catch {}
  try { console.error('Picker state:', JSON.stringify(evaluate(`({ active: document.activeElement?.outerHTML, search: document.querySelector('.dsh-ssh-select-search input')?.value, selected: document.getElementById('codex-picker-value')?.textContent })`))); } catch {}
  throw error;
} finally {
  try { browser('close'); } catch {}
  await rm(temp, { recursive: true, force: true });
}
