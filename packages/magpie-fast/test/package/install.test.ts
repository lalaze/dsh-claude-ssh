import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { chatReply, MODEL, request, responsesReply, source } from '../fixtures.js';

const run = promisify(execFile);
const packageDir = fileURLToPath(new URL('../../', import.meta.url));
const developmentRequire = createRequire(new URL('../../package.json', import.meta.url));

test('安装包在严格脚本策略下离线安装；复用宿主 GPT 实现，不安装完整 pi-ai SDK', { timeout: 60000 }, async () => {
  const manifest = JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf8'));
  const workspace = JSON.parse(await readFile(resolve(packageDir, '../../package.json'), 'utf8'));
  const archive = process.env.DSH_FAST_TEST_ARCHIVE ?? resolve(packageDir, '../../dist', `${manifest.name}-${manifest.version}.tgz`);
  const { stdout: packedManifest } = await run('tar', ['-xOf', archive, 'package/package.json']);
  const packed = JSON.parse(packedManifest);
  assert.deepEqual(packed.dependencies ?? {}, {}, '安装包不能额外安装完整 pi-ai 及 Google SDK');

  const profile = await mkdtemp(join(tmpdir(), 'dsh-fast-package-'));
  try {
    await writeFile(join(profile, 'package.json'), JSON.stringify({ name: 'fast-package-test', version: '1.0.0', private: true, packageManager: workspace.packageManager }));
    await writeFile(join(profile, 'pnpm-workspace.yaml'), 'packages:\n  - .\nstrictDepBuilds: true\nallowBuilds: {}\n');
    const { stdout, stderr } = await run('pnpm', [
      'add', '--offline', '--store-dir', join(profile, 'store'), archive,
    ], { cwd: profile, env: { ...process.env, CI: 'true' } });
    assert.doesNotMatch(stdout + stderr, /IGNORED_BUILDS|Ignored build scripts/);
    const lock = await readFile(join(profile, 'pnpm-lock.yaml'), 'utf8');
    assert.doesNotMatch(lock, /@earendil-works\/pi-ai|@google\/genai|protobufjs/);

    const installed = join(profile, 'node_modules', manifest.name);
    const isolatedRequire = createRequire(join(installed, 'package.json'));
    assert.throws(() => isolatedRequire.resolve('@earendil-works/pi-ai'), { code: 'MODULE_NOT_FOUND' });

    // DSH supplies its own peer modules. Only the host adapter can resolve its pi-ai.
    for (const peer of Object.keys(packed.peerDependencies)) {
      const target = dirname(developmentRequire.resolve(`${peer}/package.json`));
      const link = join(profile, 'node_modules', peer);
      await mkdir(dirname(link), { recursive: true });
      await symlink(target, link, 'junction');
    }
    const fixtures = await Promise.all((['openai-completions', 'openai-responses'] as const).map(async protocol => ({
      protocol, source: source(protocol), request: request(),
      reply: await (protocol === 'openai-completions' ? chatReply() : responsesReply()).text(),
    })));
    // Use plain Node without tsx so the installed archive must work independently of source hooks.
    await run(process.execPath, ['--input-type=module', '--eval', `
      import assert from 'node:assert/strict';
      import { Context } from '@deepseek-ai/cordis';
      import { FastPool } from 'dsh-magpie-fast';
      for (const fixture of ${JSON.stringify(fixtures)}) {
        const ctx = new Context();
        const calls = [];
        const fetch = async (input, init) => {
          calls.push(await new Request(input, init).json());
          return new Response(fixture.reply, { headers: { 'Content-Type': 'text/event-stream' } });
        };
        const pool = new FastPool({ context: ctx, resolveKey: async () => 'package-test-key', fetch });
        try {
          const chunks = [];
          for await (const chunk of pool.stream(fixture.source, fixture.request)) chunks.push(chunk);
          assert.equal(calls.length, 1, JSON.stringify(chunks));
          assert.equal(calls[0].model, ${JSON.stringify(MODEL)});
          assert.equal(calls[0].service_tier, 'priority');
          assert.equal(fixture.protocol === 'openai-completions' ? calls[0].reasoning_effort : calls[0].reasoning.effort, 'high');
          assert.ok(chunks.some(chunk => chunk.type === 'text-delta' && chunk.text === 'hello'));
          assert.ok(chunks.some(chunk => chunk.type === 'finish' && chunk.reason.kind === 'stop' && chunk.replayState));
        } finally { pool.close(); await ctx.fiber.dispose(); }
      }
    `], { cwd: profile });
  } finally { await rm(profile, { recursive: true, force: true }); }
});
