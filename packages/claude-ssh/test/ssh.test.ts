import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { classify, quote, Ssh, sshArgs, sshEnvironment } from '../src/ssh.js';
import { fixture, shellTransport } from './helpers.js';
import { spawn } from 'node:child_process';
test('真实 zsh → sh 目录列表：空目录、中文、空格、引号和隐藏目录', async () => {
  const f = await fixture();
  try {
    const empty = await f.ssh.directory(f.host, f.path); assert.deepEqual(empty.names, []);
    for (const n of ["带 ' 引号", '中文 文件', '.hidden']) await mkdir(join(f.path, n));
    const d = await f.ssh.directory(f.host, f.path);
    assert.deepEqual(d.names, ['.hidden', "带 ' 引号", '中文 文件'].sort());
    assert.equal(d.path, await f.ssh.run(f.host, `cd ${quote(f.path)} && pwd -P`).then(s => s.trim()));
    assert.equal((await f.ssh.probe(f.host)).loggedIn, true);
  } finally { await f.dispose(); }
});
test('目录不存在立即停止，绝不回退 HOME 或执行后续命令', async () => {
  const f = await fixture();
  try { await assert.rejects(f.ssh.directory(f.host, join(f.path, 'missing')), { code: 'REMOTE_DIRECTORY' }); } finally { await f.dispose(); }
});
test('远端 Claude 缺失、未登录、认证、密钥与网络错误独立分类', async () => {
  const f = await fixture('logout');
  try {
    await assert.rejects(f.ssh.probe(f.host), { code: 'CLAUDE_LOGIN' });
    await assert.rejects(f.ssh.probe({ ...f.host, claudePath: '/absolutely/missing/claude' }), { code: 'CLAUDE_MISSING' });
    assert.equal(classify(255, 'Permission denied (publickey)').code, 'SSH_AUTH');
    assert.equal(classify(255, 'Host key verification failed').code, 'SSH_HOST_KEY');
    assert.equal(classify(255, 'Connection refused').code, 'SSH_CONNECTION');
    assert.ok(sshArgs(f.host, 'true').includes('StrictHostKeyChecking=yes'));
    assert.ok(sshArgs(f.host, 'true').includes('BatchMode=yes'));
  } finally { await f.dispose(); }
});
test('SSH spawn 错误与超时/非零退出不会被当成功', async () => {
  const f = await fixture();
  try {
    const ssh = new Ssh(() => spawn('/bin/sh', ['-c', 'echo "Permission denied (publickey)" >&2; exit 255'], { stdio: ['pipe', 'pipe', 'pipe'] }));
    await assert.rejects(ssh.directory(f.host, '/'), { code: 'SSH_AUTH' });
  } finally { await f.dispose(); }
});
test('不把本机 Claude 登录或配置环境传给 SSH，同时保留 SSH Agent', () => {
  const source = { CLAUDE_CODE_OAUTH_TOKEN: 'fixture-only', ANTHROPIC_API_KEY: 'fixture-only', CLAUDE_CONFIG_DIR: '/local-only', SSH_AUTH_SOCK: '/agent.sock', PATH: '/usr/bin' };
  const env = sshEnvironment(source);
  assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, undefined); assert.equal(env.ANTHROPIC_API_KEY, undefined); assert.equal(env.CLAUDE_CONFIG_DIR, undefined);
  assert.equal(env.SSH_AUTH_SOCK, '/agent.sock'); assert.equal(env.PATH, '/usr/bin');
  assert.equal(source.CLAUDE_CONFIG_DIR, '/local-only');
});
