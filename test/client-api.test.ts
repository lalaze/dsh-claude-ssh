import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { emptyState, type StateView } from '../src/domain.js';
import { loadSshAliases, aliasPlaceholder } from '../src/client/ssh-aliases.js';
import { PLUGIN_VERSION } from '../src/version.js';

const currentState = (): StateView => ({ ...emptyState(), routeErrors: {}, plugin: { version: PLUGIN_VERSION, capabilities: ['sshAliases'], sshConfigPath: '/home/test/.ssh/config' } });

test('旧后端拒绝 sshAliases 的真实错误模式：先报版本不匹配，不误报无 SSH 别名', async () => {
  const actions: unknown[] = [];
  await assert.rejects(loadSshAliases(async body => {
    actions.push(body);
    if (body === undefined) return { ...emptyState(), routeErrors: {} };
    throw new Error('未知操作'); // 0.1.0 的真实 API 响应。
  }), /后端.*旧版.*完全退出.*desktop/);
  assert.deepEqual(actions, [undefined]);
  assert.equal(aliasPlaceholder(false, undefined, '后端旧版'), '读取失败，请查看下方提示');
  assert.notEqual(aliasPlaceholder(false, undefined, '后端旧版'), aliasPlaceholder(false, { aliases: [], warnings: [] }));
});

test('当前后端成功读取与刷新；返回真实配置路径，保留已有手动草稿由组件负责', async () => {
  let reads = 0;
  const request = async (body?: unknown) => body === undefined ? currentState() : { aliases: [++reads === 1 ? 'first' : 'second'], warnings: [], configPath: '/home/test/.ssh/config' };
  assert.deepEqual((await loadSshAliases(request)).aliases, ['first']);
  assert.deepEqual((await loadSshAliases(request)).aliases, ['second']);
  assert.match(aliasPlaceholder(false, { aliases: [], warnings: [] }), /未发现/);
  assert.match(aliasPlaceholder(true, undefined), /正在读取/);
});

test('前后端版本不一致或能力缺失时不向后端发送不支持的操作', async () => {
  for (const plugin of [{ version: '0.1.0', capabilities: ['sshAliases'] }, { version: PLUGIN_VERSION, capabilities: [] }]) {
    await assert.rejects(loadSshAliases(async body => {
      assert.equal(body, undefined);
      return { ...currentState(), plugin };
    }), /版本|不支持/);
  }
});

test('错误接口的未知操作明确指向后端更新，普通读取错误保留原始提示', async () => {
  const cases: Array<[string, RegExp]> = [['未知操作', /后端.*完全退出/], ['权限不足', /权限不足/]];
  for (const [error, expected] of cases) {
    await assert.rejects(loadSshAliases(async body => { if (body === undefined) return currentState(); throw new Error(error); }), expected);
  }
});

test('前后端共用版本必须与安装包版本一致', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(PLUGIN_VERSION, pkg.version);
});
