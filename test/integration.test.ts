import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Context } from '@deepseek-ai/cordis';
import { lstat } from 'node:fs/promises';
import { apply } from '../src/index.js';
import { Manager } from '../src/manager.js';
import { ClaudeSshAdapter } from '../src/adapter.js';
import { fixture } from './helpers.js';

test('远程会话初始模型在发布前持久化；不调用全局默认模型或创建本地目录', async () => {
  const f = await fixture();
  try {
    let published = false; let selected = false; let metadata: any;
    const ctx = {
      agents: { create: async (o: any) => {
        metadata = o.meta;
        const agent = { session: { append: (type: string) => { assert.equal(published, false); assert.equal(type, 'model/selection'); selected = true; } } };
        await o.setup({}, agent); assert.equal(selected, true); published = true;
        return { agent, dispose: async () => {} };
      } }, effect: () => {},
      sessionController: { rename: async () => {} }
    } as unknown as Context;
    const adapter = new ClaudeSshAdapter(ctx, f.store, f.ssh);
    const m = new Manager(ctx, f.store, f.ssh, adapter, () => {});
    const id = await m.createSession(f.binding.workspaceId, 'haiku');
    const b = f.store.snapshot().bindings[id];
    assert.equal(b.path, f.path); assert.equal(b.model, 'haiku');
    assert.ok(metadata.cwd.startsWith('/__dsh_claude_ssh_remote__/'));
    assert.notEqual(metadata.cwd, f.path);
    await assert.rejects(lstat(metadata.cwd), { code: 'ENOENT' });
  } finally { await f.dispose(); }
});

test('公开 waterfall 仅接管已绑定会话；普通本地会话完全委托原服务', async () => {
  const f = await fixture();
  try {
    const handlers = new Map<string, (...args: any[]) => any>(); let route: any;
    const ctx = {
      llm: { registerAdapter: () => () => {} }, effect: () => {},
      on: (name: string, fn: (...args: any[]) => any) => handlers.set(name, fn),
      connection: { fetch: { register: (r: unknown) => { route = r; } } }
    } as unknown as Context;
    await apply(ctx, { stateDir: f.root });
    assert.equal(route.path, '/api/claude-ssh');
    assert.deepEqual(route.methods, ['GET', 'POST']);
    let forwarded = 0;
    const next = async () => { forwarded++; return { local: true }; };
    const local = { session: { id: 'ordinary-local', header: { cwd: '/local-project' } } };
    assert.deepEqual(await handlers.get('agent/pre-step')!({ agent: local, messages: [] }, next), { local: true });
    assert.deepEqual(await handlers.get('system-prompt/assemble')!({}, { agent: local }, next), { local: true });
    const request = { provider: 'ordinary-local', model: 'local' };
    assert.deepEqual(await handlers.get('agent/request')!({ agent: local }, async () => request), request);
    const remote = { session: { id: f.binding.sessionId, header: {}, snapshotEvents: () => [] } };
    const prepared = await handlers.get('agent/pre-step')!({ agent: remote, messages: ['new'] }, next);
    assert.deepEqual(prepared, { kind: 'enter', messages: ['new'] });
    assert.deepEqual(await handlers.get('system-prompt/assemble')!({}, { agent: remote }, next), { sections: [], contexts: [], tools: [], variables: {} });
    assert.equal(forwarded, 2);
    await assert.rejects(handlers.get('agent/request')!({ agent: remote }, async () => request), { code: 'HOST_MISMATCH' });
    const cold = { session: { id: f.binding.sessionId, header: {}, snapshotEvents: () => [{ type: 'model/selection', data: { provider: 'claude-ssh-self', model: 'haiku' } }] } };
    assert.deepEqual(await handlers.get('agent/request')!({ agent: cold }, async () => request), { provider: 'claude-ssh-self', model: 'haiku' });
    const switched = { session: { ...cold.session, snapshotEvents: () => [{ type: 'model/selection', data: { provider: 'claude-ssh-other', model: 'haiku' } }] } };
    await assert.rejects(handlers.get('agent/request')!({ agent: switched }, async () => request), { code: 'HOST_MISMATCH' });
    const state = await (await route.fetch(new Request('http://example.test/api/claude-ssh'))).json();
    assert.equal(state.bindings[f.binding.sessionId].path, f.path);
  } finally { await f.dispose(); }
});
