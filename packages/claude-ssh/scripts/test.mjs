import { readdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const cssLoader = fileURLToPath(new URL('./test-css.mjs', import.meta.url));
// OpenSSH ControlPath and Unix sockets have short limits on macOS.
const testRoot = process.platform === 'win32' ? tmpdir() : '/tmp';

async function discover(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(entries.map(entry => entry.isDirectory() ? discover(join(dir, entry.name)) : entry.name.endsWith('.test.ts') ? [join(dir, entry.name)] : []));
  return files.flat().sort();
}
const discovered = await discover(resolve('src'));
const requested = process.argv.slice(2).map(file => resolve(file));
for (const file of requested) if (!discovered.includes(file)) throw new Error(`Unknown test file: ${file}`);
const files = requested.length ? requested : discovered;
let next = 0;
let failed = 0;
async function worker() {
  while (next < files.length) {
    const file = files[next++];
    const state = await mkdtemp(join(testRoot, 'omc-'));
    try {
      const result = await new Promise((done, reject) => {
        const child = spawn(process.execPath, ['--import', cssLoader, '--import', 'tsx', file], {
          env: { ...process.env, DSH_OMC_STATE_DIR: state }, stdio: ['ignore', 'pipe', 'pipe'],
        });
        let output = '';
        child.stdout.on('data', data => { output += data; });
        child.stderr.on('data', data => { output += data; });
        child.on('error', reject);
        child.on('close', code => done({ code, output }));
      });
      console.log(`${result.code === 0 ? 'PASS' : 'FAIL'} ${file.slice(process.cwd().length + 1)}`);
      if (result.code !== 0) { failed++; console.error(result.output); }
    } finally {
      // state is the exact directory returned by mkdtemp above, never an inferred path.
      if (state.startsWith(join(testRoot, 'omc-'))) await rm(state, { recursive: true, force: true });
    }
  }
}
await Promise.all(Array.from({ length: Math.min(4, files.length) }, worker));
console.log(`${files.length - failed}/${files.length} test files passed`);
if (failed) process.exitCode = 1;
