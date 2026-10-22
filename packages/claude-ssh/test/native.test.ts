import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { hostname, userInfo } from 'node:os';
import type { Context } from '@deepseek-ai/cordis';
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm';
import type { SubprocessSpawnSpec, SubprocessHandle } from '@deepseek-ai/dsh-subprocess';
import { SessionId } from '@deepseek-ai/dsh-session';
import { NativeClaudeAdapter } from '../src/native.js';
import { NATIVE_PROVIDER } from '../src/domain.js';
import { Store } from '../src/store.js';
import { Ssh } from '../src/ssh.js';
import { visibleGroups } from '../src/client/model-filter.js';
import { selectionFor } from '../src/selection.js';
import { collect, fixture } from './helpers.js';

async function nativeFixture(mode = 'success') {
  const f = await fixture(mode);
  const id = SessionId(randomUUID());
  const calls: SubprocessSpawnSpec[] = [];
  const header = { cwd: '/dsh/native/remote/project' };
  const runtime = { spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    calls.push(spec);
    // Exercise the real protocol against a separate execution directory. Never cd into
    // the native anchor on the host; the mounted runtime owns this translation.
    assert.equal(spec.cwd, header.cwd);
    const child = spawn(spec.argv[0], [...spec.argv.slice(1)], { cwd: f.path, stdio: ['pipe', 'pipe', 'pipe'] });
    const done = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      child.once('error', reject); child.once('close', (exitCode, signal) => resolve({ exitCode, signal }));
    });
    return { stdin: child.stdin, stdout: child.stdout, stderr: child.stderr, control: undefined, collected: {}, done,
      terminate: () => { child.kill('SIGKILL'); }, waitForExit: async () => { await done; return true; } };
  } };
  const agent = { session: { id, header }, ctx: { subprocess: runtime } };
  const ctx = { subprocess: runtime, agents: { get: (sessionId: string) => sessionId === id ? agent : undefined }, approval: { request: async () => 'allowed-once' }, userQuestions: {} } as unknown as Context;
  const adapter = new NativeClaudeAdapter(ctx, f.store, f.ssh);
  // The fixture process emulates the far machine; only the host's identity differs.
  adapter.localIdentity = { machine: 'dsh-application-host', user: 'app-user' };
  const options = (): GenerateOptions => ({ sessionId: id, provider: NATIVE_PROVIDER, model: 'sonnet', messages: [{ id: randomUUID(), role: 'user', content: [{ type: 'text', text: 'print cwd' }] } as any] });
  return { ...f, id, header, ctx, calls, adapter, options };
}
function finish(chunks: StreamChunk[]) { const last = chunks.at(-1); assert.equal(last?.type, 'finish'); return last?.type === 'finish' ? last.reason : undefined; }

test('原生远程工作区直接选 Claude，使用 DSH cwd 路由、持久续接，无需另存工作区', async () => {
  const f = await nativeFixture();
  try {
    await f.store.update(s => { s.workspaces = []; });
    assert.equal((await f.adapter.eligibility(f.id)).eligible, true);
    const first = await collect(f.adapter.stream(f.options()));
    assert.equal(finish(first)?.kind, 'stop');
    assert.equal(first.filter(c => c.type === 'text-delta').map(c => c.text).join(''), f.path);
    const saved = f.store.snapshot().nativeBindings[f.id];
    assert.equal(saved.cwd, f.header.cwd); assert.equal(saved.path, f.path); assert.equal(saved.initialized, true);
    assert.equal(f.store.snapshot().workspaces.length, 0);
    const next = { ...f.options(), model: 'haiku' };
    assert.equal(finish(await collect(f.adapter.stream(next)))?.kind, 'stop');
    assert.equal(f.store.snapshot().nativeBindings[f.id].claudeSessionId, saved.claudeSessionId);
    assert.equal(f.store.snapshot().nativeBindings[f.id].model, 'haiku');
    assert.ok(f.calls.some(c => c.argv[2].includes("'--resume'")));
    assert.ok(f.calls.every(c => Object.keys(c.env ?? {}).every(k => k === 'LC_ALL')));
  } finally { await f.dispose(); }
});

test('本机与伪装成远程的本机占位目录隐藏 Claude；绕过 UI 调用也不启动 Claude', async () => {
  const f = await nativeFixture();
  try {
    f.adapter.localIdentity = { machine: hostname(), user: userInfo().username };
    assert.equal((await f.adapter.eligibility(f.id)).eligible, false);
    assert.equal(finish(await collect(f.adapter.stream(f.options())))?.kind, 'error');
    assert.ok(f.calls.every(c => !c.argv[2].includes('--version') && !c.argv[2].includes('--session-id')));
    assert.equal(f.store.snapshot().nativeBindings[f.id], undefined);
  } finally { await f.dispose(); }
});

test('其他远程主机不展示或执行 Claude；无主机配置、无会话和 Claude 未登录均不可用', async () => {
  const f = await nativeFixture('logout');
  try {
    assert.equal((await f.adapter.eligibility(f.id)).eligible, false);
    assert.equal((await f.adapter.eligibility('unknown')).eligible, false);
    class OtherHost extends Ssh { override async run() { return 'different-machine\0different-user\0'; } }
    const other = new NativeClaudeAdapter(f.ctx, f.store, new OtherHost()); other.localIdentity = f.adapter.localIdentity;
    assert.equal((await other.eligibility(f.id)).eligible, false);
    assert.equal(finish(await collect(other.stream(f.options())))?.kind, 'error');
    await f.store.update(s => { s.hosts = []; });
    assert.equal((await f.adapter.eligibility(f.id)).eligible, false);
  } finally { await f.dispose(); }
});

test('已绑定原生会话不随 cwd、SSH 配置变化而迁移；重启将未完成任务标为中断', async () => {
  const f = await nativeFixture();
  try {
    assert.equal(finish(await collect(f.adapter.stream(f.options())))?.kind, 'stop');
    const cwd = f.header.cwd; f.header.cwd = '/dsh/other-project';
    assert.equal((await f.adapter.eligibility(f.id)).eligible, false);
    f.header.cwd = cwd;
    await f.store.update(s => { s.hosts[0].port = 2222; });
    assert.equal((await f.adapter.eligibility(f.id)).eligible, false);
    await f.store.update(s => { s.nativeBindings[f.id].state = 'running'; });
    const loaded = new Store(f.store.file); await loaded.load();
    assert.equal(loaded.snapshot().nativeBindings[f.id].state, 'interrupted');
  } finally { await f.dispose(); }
});

test('模型目录按会话过滤，不改变共享目录，也不影响其他模型', () => {
  const groups = ['deepseek', NATIVE_PROVIDER, 'claude-ssh-self', 'claude-ssh-other', 'codex'].map(id => ({ id, name: id, models: [{ id: 'm', name: 'M' }] }));
  assert.deepEqual(visibleGroups(groups, false).map(g => g.id), ['deepseek', 'codex']);
  assert.deepEqual(visibleGroups(groups, true).map(g => g.id), ['deepseek', NATIVE_PROVIDER, 'codex']);
  assert.deepEqual(visibleGroups(groups, false, 'self').map(g => g.id), ['deepseek', 'claude-ssh-self', 'codex']);
  assert.equal(groups.length, 5);
});

test('原生停止发送 interrupt，恢复只解除中断且不重发旧消息', async () => {
  const f = await nativeFixture('hang');
  try {
    const abort = new AbortController();
    const pending = collect(f.adapter.stream({ ...f.options(), signal: abort.signal }));
    const deadline = Date.now() + 5000;
    while (!f.store.snapshot().nativeBindings[f.id]?.initialized && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(f.store.snapshot().nativeBindings[f.id]?.initialized, true);
    abort.abort();
    assert.equal(finish(await pending)?.kind, 'aborted');
    assert.equal(f.store.snapshot().nativeBindings[f.id].state, 'cancelled');
    assert.equal(await readFile(join(f.root, 'interrupted'), 'utf8'), 'yes');
    const launches = () => f.calls.filter(c => c.argv[2].includes("'--input-format'")).length;
    const count = launches();
    await f.adapter.recover(f.id);
    assert.equal(f.store.snapshot().nativeBindings[f.id].state, 'ready');
    assert.equal(launches(), count);
  } finally { await f.dispose(); }
});

test('原生模型选择以会话最新事件为准，恢复时不被全局模型覆盖', () => {
  const agent = { session: { snapshotEvents: () => [{ type: 'model/selection', data: { provider: NATIVE_PROVIDER, model: 'opus' } }], requestHeader: () => ({ config: { provider: 'codex', model: 'old' } }) }, options: { provider: 'default', model: 'global' } };
  assert.deepEqual(selectionFor(agent), { provider: NATIVE_PROVIDER, model: 'opus' });
});
