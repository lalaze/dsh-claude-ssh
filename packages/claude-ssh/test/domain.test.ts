import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, route, providerFor, revision, validateHost } from '../src/domain.js';
import { fixture } from './helpers.js';
import { Store } from '../src/store.js';
import { stat } from 'node:fs/promises';
test('本地与未绑定会话不能启动；不匹配主机和变化绑定均拒绝', async () => {
  assert.throws(() => route(emptyState(), 'local', 'claude-ssh-x'), { code: 'WORKSPACE_REQUIRED' });
  const f = await fixture();
  try {
    assert.equal(route(f.store.snapshot(), f.binding.sessionId, providerFor(f.host.id)).binding.path, f.path);
    assert.throws(() => route(f.store.snapshot(), f.binding.sessionId, 'claude-ssh-other'), { code: 'HOST_MISMATCH' });
    const s = f.store.snapshot(); s.hosts[0].destination = 'elsewhere';
    assert.throws(() => route(s, f.binding.sessionId, providerFor(f.host.id)), { code: 'BINDING_CHANGED' });
    s.hosts[0] = f.host; s.workspaces[0].path = '/tmp/another';
    assert.throws(() => route(s, f.binding.sessionId, providerFor(f.host.id)), { code: 'BINDING_CHANGED' });
  } finally { await f.dispose(); }
});
test('持久化绑定、Claude ID、并发更新及重启中断恢复', async () => {
  const f = await fixture();
  try {
    await Promise.all(Array.from({ length: 8 }, (_, i) => f.store.update(s => { s.hosts.push({ id: 'h' + i, name: 'host', destination: 'test' }); })));
    await f.store.update(s => { s.bindings[f.binding.sessionId].state = 'running'; s.bindings[f.binding.sessionId].initialized = true; });
    const second = new Store(f.store.file); await second.load();
    assert.equal(second.snapshot().hosts.length, 9);
    const b = second.snapshot().bindings[f.binding.sessionId];
    assert.equal(b.path, f.path); assert.equal(b.claudeSessionId, f.binding.claudeSessionId); assert.equal(b.state, 'interrupted');
    assert.equal((await stat(f.store.file)).mode & 0o777, 0o600);
  } finally { await f.dispose(); }
});
test('SSH 目标拒绝选项和 shell 注入；标识稳定，显示名不影响绑定', () => {
  for (const destination of ['-oProxyCommand=evil', 'a;touch x', '$(whoami)', 'a b', 'a@b@c', 'ssh://host']) assert.throws(() => validateHost({ id: 'h', name: 'h', destination }));
  for (const destination of ['user@host', 'my-config-alias', '[::1]', 'me@[::1]']) assert.equal(validateHost({ id: 'h', name: 'h', destination }).destination, destination);
  assert.throws(() => validateHost({ id: 'h', name: 'h', destination: 'h', port: 1.5 }));
  assert.equal(revision({ id: 'h', name: 'a', destination: 'h' }), revision({ id: 'h', name: 'b', destination: 'h' }));
});
