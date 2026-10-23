import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Config, isGpt, readSources, sourceAddress, supportedSource } from '../src/config.js';
import { materializeModels } from '../src/models.js';
import { Preferences, acquirePreferences, validSessionId } from '../src/preferences.js';
import { MODEL, source } from './fixtures.js';

test('默认关闭；复用已有提供商，不修改源配置或模型身份', () => {
  const src = source(); const before = structuredClone(src);
  const copies = readSources([{ value: { providers: { [src.id]: src.profile, unknown: {} } } }]);
  assert.equal(Config({}).defaultEnabled, false); assert.deepEqual(copies, [src]);
  const selected = supportedSource(copies, src.id, MODEL); assert.ok(selected);
  selected.profile.models![0].name = 'detached'; assert.deepEqual(src, before);
  const { models, caps } = materializeModels(src);
  assert.equal(models[0].provider, src.id); assert.equal(models[0].id, MODEL); assert.equal(models[0].name, 'GPT test');
  assert.equal(models[0].thinkingLevelMap?.xhigh, 'xhigh'); assert.equal(models[0].thinkingLevelMap?.minimal, null);
  assert.equal(caps.get(MODEL), 16384);
});
test('只支持当前提供商已经配置的 GPT Chat/Responses 模型', () => {
  for (const id of ['gpt-5.4', MODEL, 'openai/GPT-6-sol']) assert.equal(isGpt(id), true);
  for (const id of ['group/coding', 'claude/opus', 'm/notgpt-foo']) assert.equal(isGpt(id), false);
  const src = source(); assert.equal(supportedSource([src], 'other', MODEL), undefined);
  assert.equal(supportedSource([src], src.id, 'codex/gpt-missing'), undefined);
  assert.equal(supportedSource([src], src.id, 'claude/opus'), undefined);
  src.profile.api = 'anthropic-messages'; assert.equal(supportedSource([src], src.id, MODEL), undefined);
});
test('源地址保持完整；拒绝非 API 地址', () => {
  const src = source(); src.profile.baseURL = 'https://remote.example.invalid:3425/proxy/v1/';
  assert.equal(sourceAddress(src), src.profile.baseURL);
  for (const address of ['bad', 'file:///tmp/foo', 'https://user:pass@example.invalid/v1', 'https://x.invalid?key=secret']) {
    src.profile.baseURL = address; assert.throws(() => sourceAddress(src));
  }
});
test('会话偏好原子保存、重启恢复、并发不丢失，文件权限为 0600', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpt-fast-state-'));
  try {
    const path = join(dir, 'preferences.json'); const prefs = new Preferences(path); await prefs.load();
    assert.equal(prefs.get('session-a', false), false);
    await Promise.all([prefs.set('session-a', true), prefs.set('session-b', false)]);
    const restored = new Preferences(path); await restored.load();
    assert.equal(restored.get('session-a', false), true); assert.equal(restored.get('session-b', true), false);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.doesNotMatch(await readFile(path, 'utf8'), /provider|model|prompt|key|content/);
    for (const id of ['', '../escape', 'a/b', 'x'.repeat(257), null]) assert.equal(validSessionId(id), false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('写失败不假装已开启，且后续写入可恢复；损坏文件不覆盖', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpt-fast-broken-'));
  try {
    const blocked = join(dir, 'blocked'); await writeFile(blocked, 'file');
    const prefs = new Preferences(join(blocked, 'preferences.json'));
    await assert.rejects(prefs.set('session-a', true)); assert.equal(prefs.get('session-a', false), false);
    await rm(blocked); await prefs.set('session-a', true); assert.equal(prefs.get('session-a', false), true);
    const path = join(dir, 'bad.json'); await writeFile(path, '{bad'); await assert.rejects(new Preferences(path).load());
    assert.equal(await readFile(path, 'utf8'), '{bad');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('插件重载共享同一条写队列', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpt-fast-reload-'));
  try {
    const path = join(dir, 'state.json'); const first = acquirePreferences(path); const second = acquirePreferences(path);
    const a = await first.ready; const b = await second.ready; assert.equal(a, b);
    const writing = a.set('session-a', true); first.release(); await writing;
    assert.equal(b.get('session-a', false), true); second.release(); await b.idle();
  } finally { await rm(dir, { recursive: true, force: true }); }
});
