import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverSshAliases } from '../src/ssh-config.js';
import { hostFromAlias } from '../src/client/host-draft.js';
import { sshArgs } from '../src/ssh.js';

async function configFixture() {
  const home = await mkdtemp(join(tmpdir(), 'dsh-ssh-config-'));
  await mkdir(join(home, '.ssh', 'conf.d'), { recursive: true });
  const systemConfig = join(home, 'system', 'ssh_config');
  await mkdir(join(home, 'system'));
  return { home, systemConfig, dispose: () => rm(home, { recursive: true, force: true }) };
}

test('SSH 别名：递归 Include、glob、双引号、等号、去重，排除通配和否定规则', async () => {
  const f = await configFixture();
  try {
    await writeFile(join(f.home, '.ssh', 'config'), `# Host ignored\nHost alpha beta !excluded *.prod ???\n  HostName private.example\n  IdentityFile /secret/key\nInclude "conf.d/*.conf"\nhOsT="quoted" # comment\nHost alpha\n`);
    await writeFile(join(f.home, '.ssh', 'conf.d', '1.conf'), 'Host included\nInclude nested.conf\n');
    // Relative Include paths remain relative to ~/.ssh, not to conf.d.
    await writeFile(join(f.home, '.ssh', 'nested.conf'), 'Host nested\n');
    await writeFile(join(f.home, '.ssh', 'conf.d', '2.conf'), 'Host second\n');
    await writeFile(join(f.home, '.ssh', 'conf.d', '.hidden.conf'), 'Host hidden\n');
    await writeFile(f.systemConfig, 'Host system-host\nInclude extra.conf\n');
    await writeFile(join(f.home, 'system', 'extra.conf'), 'Host system-include\n');
    assert.deepEqual(await discoverSshAliases(f), { aliases: ['alpha', 'beta', 'included', 'nested', 'quoted', 'second', 'system-host', 'system-include'], warnings: [] });
  } finally { await f.dispose(); }
});

test('Include 支持空格/中文路径、HOME、环境变量、%d 与 %%；不读取 key 或执行 Match', async () => {
  const f = await configFixture();
  try {
    const marker = join(f.home, 'must-not-exist');
    const secret = 'PRIVATE_TEST_CONTENT_MUST_NOT_BE_RETURNED';
    await writeFile(join(f.home, '.ssh', 'config'), `Include "~/中文 空格.conf" "\${CONFIG_ROOT}/env.conf" "%d/percent%%.conf"\nIdentityFile "${f.home}/key"\nMatch exec "touch ${marker}"\n  Include conditional.conf\n`);
    await writeFile(join(f.home, '中文 空格.conf'), 'Host unicode-path\n');
    await writeFile(join(f.home, 'env.conf'), 'Host environment\n');
    await writeFile(join(f.home, 'percent%.conf'), 'Host percent\n');
    await writeFile(join(f.home, 'key'), `Host ${secret}\n`);
    await writeFile(join(f.home, '.ssh', 'conditional.conf'), 'Host conditional-candidate\n');
    const result = await discoverSshAliases({ ...f, env: { CONFIG_ROOT: f.home } });
    assert.deepEqual(result, { aliases: ['conditional-candidate', 'environment', 'percent', 'unicode-path'], warnings: [] });
    assert.ok(!JSON.stringify(result).includes(secret));
    await assert.rejects(access(marker), { code: 'ENOENT' });
  } finally { await f.dispose(); }
});

test('Include 循环和符号链接去重；缺失配置返回空列表，错误和动态 Include 明确提示', async () => {
  const f = await configFixture();
  try {
    assert.deepEqual(await discoverSshAliases(f), { aliases: [], warnings: [] });
    await symlink('config', join(f.home, '.ssh', 'cycle'));
    await writeFile(join(f.home, '.ssh', 'config'), 'Host kept\nInclude cycle missing %h.conf ${UNDEFINED}/file ~other/file\nHost "broken\n');
    const result = await discoverSshAliases({ ...f, env: {} });
    assert.deepEqual(result.aliases, ['kept']);
    assert.ok(result.warnings.some(w => w.includes('动态令牌')));
    assert.ok(result.warnings.some(w => w.includes('无法解析')));
    // Never return sensitive contents or arbitrary filesystem exception details.
    await writeFile(join(f.home, '.ssh', 'config'), 'Host still-kept\nInclude huge.conf directory\n');
    await writeFile(join(f.home, '.ssh', 'huge.conf'), 'x'.repeat(256 * 1024 + 1));
    await mkdir(join(f.home, '.ssh', 'directory'));
    const bounded = await discoverSshAliases(f);
    assert.deepEqual(bounded.aliases, ['still-kept']); assert.ok(bounded.warnings.length);
  } finally { await f.dispose(); }
});

test('Include 的单字符与字符范围 glob 按顺序读取，深层 Include 有界', async () => {
  const f = await configFixture();
  try {
    await writeFile(join(f.home, '.ssh', 'config'), 'Include conf.d/[ab]?.conf chain0\n');
    await writeFile(join(f.home, '.ssh', 'conf.d', 'a1.conf'), 'Host a1\n');
    await writeFile(join(f.home, '.ssh', 'conf.d', 'b2.conf'), 'Host b2\n');
    await writeFile(join(f.home, '.ssh', 'conf.d', 'c3.conf'), 'Host c3\n');
    for (let i = 0; i < 20; i++) await writeFile(join(f.home, '.ssh', `chain${i}`), `Include chain${i + 1}\n`);
    const result = await discoverSshAliases(f);
    assert.deepEqual(result.aliases, ['a1', 'b2']); assert.ok(result.warnings.some(w => w.includes('层级')));
  } finally { await f.dispose(); }
});

test('选择别名填充新主机；切换继承新 config 端口，编辑保留稳定 ID，SSH 使用原别名', () => {
  const first = hostFromAlias({ id: '', name: '', destination: '' }, 'my-box');
  assert.deepEqual(first, { id: 'ssh-my-box', name: 'my-box', destination: 'my-box', port: undefined });
  const edited = hostFromAlias({ ...first, port: 2222, claudePath: '/opt/claude' }, 'other-box');
  assert.equal(edited.id, first.id); assert.equal(edited.name, first.name);
  assert.equal(edited.port, undefined); assert.equal(edited.claudePath, '/opt/claude');
  assert.equal(hostFromAlias({ ...first, port: 2222 }, 'my-box').port, 2222);
  const args = sshArgs(edited, 'true');
  assert.equal(args.at(-2), 'other-box'); assert.ok(!args.includes('-p'));
});
