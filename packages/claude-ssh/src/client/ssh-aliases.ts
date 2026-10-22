import type { StateView } from '../domain.js';
import type { SshAliases } from '../ssh-config.js';
import { PLUGIN_VERSION } from '../version.js';

const mismatch = (version?: string): Error => new Error(`Claude SSH 后端${version ? `版本 ${version}` : '为旧版（未提供版本）'}，当前界面版本 ${PLUGIN_VERSION}。请完全退出 DSH 桌面端，使用 --profile desktop 安装同版本插件后重新打开；Web 端请重启对应 profile。`);

export async function loadSshAliases(request: (body?: unknown) => Promise<unknown>): Promise<SshAliases> {
  const state = await request() as StateView;
  if (!state.plugin) throw mismatch();
  if (!state.plugin.capabilities?.includes('sshAliases')) throw new Error('当前后端不支持 SSH 列表，请重新安装插件并完全退出、重启 DSH。');
  try {
    const result = await request({ action: 'sshAliases' }) as SshAliases;
    if (!result || !Array.isArray(result.aliases) || !result.aliases.every(a => typeof a === 'string') || !Array.isArray(result.warnings)) throw new Error('SSH 列表响应格式无效，请核对前后端插件版本。');
    if (state.plugin.version !== PLUGIN_VERSION) return { ...result, warnings: [...result.warnings, `界面 ${PLUGIN_VERSION} / 后端 ${state.plugin.version}：SSH 列表接口兼容，可以正常选择；建议重启完成插件更新。`] };
    return result;
  } catch (e) {
    if (e instanceof Error && e.message === '未知操作') throw mismatch(state.plugin.version);
    throw e;
  }
}

export function aliasPlaceholder(loading: boolean, aliases?: SshAliases, error?: string): string {
  if (loading) return '正在读取 SSH 配置…';
  if (error) return '读取失败，请查看下方提示';
  if (!aliases) return '尚未加载 SSH 列表';
  return aliases.aliases.length ? '请选择 SSH 别名（也可在下方手动填写）' : '未发现 SSH 别名，可在下方手动填写';
}
