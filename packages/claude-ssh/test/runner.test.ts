import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { SessionId } from '@deepseek-ai/dsh-session';
import type { Context } from '@deepseek-ai/cordis';
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm';
import { ClaudeSshAdapter, promptOf } from '../src/adapter.js';
import { Manager } from '../src/manager.js';
import { runTurn, launchScript } from '../src/runner.js';
import { providerFor } from '../src/domain.js';
import { questions, questionAnswers, Translator } from '../src/protocol.js';
import { collect, fixture } from './helpers.js';

const options = (id: string, signal?: AbortSignal): GenerateOptions => ({ sessionId: SessionId(id), provider: 'claude-ssh-self', model: 'sonnet', signal, messages: [{ id: randomUUID(), role: 'user', content: [{ type: 'text', text: 'test only' }] } as any] });
const finish = (chunks: StreamChunk[]) => { const last = chunks.at(-1); assert.equal(last?.type, 'finish'); return last?.type === 'finish' ? last.reason : undefined; };
function context(approval = 'allowed-once') {
  const decisions: any[] = [];
  const ctx = { agents: { get: () => ({}) }, approval: { request: async (r: unknown) => { decisions.push(r); return approval; } }, userQuestions: { ask: async (r: any) => ({ answers: r.questions.map((q: any) => ({ id: q.id, selected: ['选择一'], custom: '' })) }) } } as unknown as Context;
  return { ctx, decisions };
}
test('stream-json 流式输出、工具结果无本地执行、会话续接', async () => {
  const f = await fixture();
  try {
    const a = new ClaudeSshAdapter(context().ctx, f.store, f.ssh);
    const chunks = await collect(a.stream(options(f.binding.sessionId)));
    assert.equal(finish(chunks)?.kind, 'stop');
    assert.equal(chunks.filter(c => c.type === 'text-delta').map(c => c.text).join(''), f.path);
    assert.ok(chunks.some(c => c.type === 'reasoning-delta' && c.text.includes('真实夹具结果')));
    assert.ok(chunks.every(c => c.type !== 'tool-call-delta'));
    const b = f.store.snapshot().bindings[f.binding.sessionId];
    assert.equal(b.state, 'completed'); assert.equal(b.initialized, true);
    assert.ok(launchScript({ binding: b, binary: f.binary, model: 'sonnet' }).includes("'--resume'"));
    assert.equal(finish(await collect(a.stream(options(f.binding.sessionId))))?.kind, 'stop');
    assert.equal(f.store.snapshot().bindings[f.binding.sessionId].claudeSessionId, f.binding.claudeSessionId);
  } finally { await f.dispose(); }
});
test('权限请求经 DSH 确认并通过 stdio 回传；拒绝不会自动放行', async () => {
  const f = await fixture('permission');
  try {
    for (const outcome of ['allowed-once', 'rejected', 'unavailable']) {
      const { ctx, decisions } = context(outcome);
      const a = new ClaudeSshAdapter(ctx, f.store, f.ssh);
      const chunks = await collect(a.stream(options(f.binding.sessionId)));
      assert.equal(finish(chunks)?.kind, 'stop'); assert.equal(decisions.length, 1);
      assert.ok(decisions[0].reason.includes(f.path));
      const text = chunks.filter(c => c.type === 'text-delta').map(c => c.text).join('');
      assert.ok(text.includes(outcome === 'allowed-once' ? 'allow' : 'deny'));
      assert.ok(text.includes('req-1'));
    }
  } finally { await f.dispose(); }
});
test('未知控制协议返回 error，不伪造成功或绕过确认', async () => {
  const f = await fixture('unknown');
  try {
    const { ctx, decisions } = context();
    const a = new ClaudeSshAdapter(ctx, f.store, f.ssh);
    const chunks = await collect(a.stream(options(f.binding.sessionId)));
    assert.equal(finish(chunks)?.kind, 'stop');
    assert.equal(decisions.length, 0);
    const text = chunks.filter(c => c.type === 'text-delta').map(c => c.text).join('');
    assert.match(text, /"subtype":"error"/); assert.match(text, /unknown-1/);
  } finally { await f.dispose(); }
});
test('取消发送 interrupt，明确显示取消，恢复前不重试', async () => {
  const f = await fixture('hang');
  try {
    const a = new ClaudeSshAdapter(context().ctx, f.store, f.ssh);
    const controller = new AbortController();
    const pending = collect(a.stream(options(f.binding.sessionId, controller.signal)));
    // Wait on the durable CLI init fact, not an arbitrary cancellation before launch.
    for (let i = 0; i < 200 && !f.store.snapshot().bindings[f.binding.sessionId].initialized; i++) await new Promise(r => setTimeout(r, 10));
    assert.equal(f.store.snapshot().bindings[f.binding.sessionId].initialized, true);
    controller.abort();
    assert.equal(finish(await pending)?.kind, 'aborted');
    assert.equal(await readFile(join(f.root, 'interrupted'), 'utf8'), 'yes');
    assert.equal(f.store.snapshot().bindings[f.binding.sessionId].state, 'cancelled');
    const blocked = finish(await collect(a.stream(options(f.binding.sessionId))));
    assert.equal(blocked?.kind, 'error'); if (blocked?.kind === 'error') assert.equal(blocked.failure.code, 'RECOVERY_REQUIRED');
    assert.equal(a.active.size, 0);
  } finally { await f.dispose(); }
});
test('SSH 断开不重发；明确恢复只解锁，不发送旧消息', async () => {
  const f = await fixture('disconnect');
  try {
    const { ctx } = context(); const a = new ClaudeSshAdapter(ctx, f.store, f.ssh);
    const r = finish(await collect(a.stream(options(f.binding.sessionId))));
    assert.equal(r?.kind, 'error'); if (r?.kind === 'error') assert.equal(r.failure.code, 'SSH_CONNECTION');
    assert.equal(f.store.snapshot().bindings[f.binding.sessionId].state, 'interrupted');
    const m = new Manager(ctx, f.store, f.ssh, a, () => {});
    await m.recover(f.binding.sessionId);
    const b = f.store.snapshot().bindings[f.binding.sessionId];
    assert.equal(b.state, 'ready'); assert.equal(b.claudeSessionId, f.binding.claudeSessionId); assert.equal(a.active.size, 0);
  } finally { await f.dispose(); }
});
test('未绑定、错主机、无目录、Claude 缺失与未登录都在执行前停止', async () => {
  const f = await fixture();
  try {
    let count = 0;
    const a = new ClaudeSshAdapter(context().ctx, f.store, { directory: async () => { count++; throw new Error('should not run'); } } as any);
    for (const o of [options('local-session'), { ...options(f.binding.sessionId), provider: 'claude-ssh-other' }]) assert.equal(finish(await collect(a.stream(o)))?.kind, 'error');
    assert.equal(count, 0);
    await f.store.update(s => { s.bindings[f.binding.sessionId].path = '/missing'; s.workspaces[0].path = '/missing'; });
    const actual = new ClaudeSshAdapter(context().ctx, f.store, f.ssh);
    const r = finish(await collect(actual.stream(options(f.binding.sessionId))));
    if (r?.kind === 'error') assert.equal(r.failure.code, 'REMOTE_DIRECTORY'); else assert.fail();
    assert.equal(f.store.snapshot().bindings[f.binding.sessionId].state, 'ready');
  } finally { await f.dispose(); }
});
test('多主机、多会话并发隔离目录和 session ID', async () => {
  const x = await fixture(); const y = await fixture();
  try {
    const a = new ClaudeSshAdapter(context().ctx, x.store, x.ssh);
    const yHost = { ...y.host, id: 'second' };
    const { revision } = await import('../src/domain.js');
    await x.store.update(s => {
      s.hosts.push(yHost);
      const w = y.store.snapshot().workspaces[0]; s.workspaces.push({ ...w, hostId: yHost.id, hostRevision: revision(yHost) });
      s.bindings[y.binding.sessionId] = { ...y.binding, hostId: yHost.id, hostRevision: revision(yHost) };
    });
    const [a1, a2] = await Promise.all([collect(a.stream(options(x.binding.sessionId))), collect(a.stream({ ...options(y.binding.sessionId), provider: providerFor('second') }))]);
    assert.equal(a1.filter(c => c.type === 'text-delta').map(c => c.text).join(''), x.path);
    assert.equal(a2.filter(c => c.type === 'text-delta').map(c => c.text).join(''), y.path);
    assert.notEqual(x.binding.claudeSessionId, y.binding.claudeSessionId); assert.equal(a.active.size, 0);
  } finally { await x.dispose(); await y.dispose(); }
});
test('AskUserQuestion 的选项和自定义答案使用真实协议字段', async () => {
  const input = { questions: [{ question: '选哪个？', options: [{ label: '选择一' }, { label: '选择二' }], multiSelect: false }] };
  const qs = questions(input, 'tool');
  assert.deepEqual(questionAnswers(qs, { answers: [{ id: qs[0].id, selected: ['选择一'] }] }), { '选哪个？': '选择一' });
  const a = new ClaudeSshAdapter(context().ctx, {} as any, {} as any);
  const result = await a.decide('s', 'host / user / path', { subtype: 'can_use_tool', tool_name: 'AskUserQuestion', tool_use_id: 'tool', input }, new AbortController().signal) as any;
  assert.equal(result.behavior, 'allow'); assert.equal(result.updatedInput.answers['选哪个？'], '选择一');
});
test('仅发送新用户文本，不转发本机 system/工具声明或重放历史', () => {
  const o = options('s');
  o.messages = [
    { role: 'user', content: [{ type: 'text', text: 'old' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'old answer' }] } as any,
    { role: 'user', content: [{ type: 'text', text: 'new' }] }
  ];
  o.system = 'local secret instructions';
  assert.equal(promptOf(o), 'new');
  o.messages = [{ role: 'user', content: [{ type: 'image', attachment: {} }] } as any];
  assert.throws(() => promptOf(o), { code: 'ATTACHMENT_UNSUPPORTED' });
});
test('中断后新指令不重发已提交消息；同一消息重复请求被拒绝', async () => {
  const f = await fixture();
  try {
    const a = new ClaudeSshAdapter(context().ctx, f.store, f.ssh);
    const o = options(f.binding.sessionId);
    assert.equal(finish(await collect(a.stream(o)))?.kind, 'stop');
    const repeated = finish(await collect(a.stream(o)));
    assert.equal(repeated?.kind, 'error'); if (repeated?.kind === 'error') assert.equal(repeated.failure.code, 'EMPTY_PROMPT');
    const fresh = options(f.binding.sessionId);
    fresh.messages = [...o.messages, ...fresh.messages];
    const sent = f.store.snapshot().bindings[f.binding.sessionId].sentMessageIds!;
    assert.equal(promptOf(fresh, sent), 'test only');
    assert.equal(finish(await collect(a.stream(fresh)))?.kind, 'stop');
    assert.equal(f.store.snapshot().bindings[f.binding.sessionId].sentMessageIds?.length, 2);
  } finally { await f.dispose(); }
});
