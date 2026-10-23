import Schema from '@deepseek-ai/schemastery';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { record } from './normalize.js';

export const NAME = 'dsh-magpie-quota';
export const Config = Schema.object({
  providers: Schema.array(String).default([]).description('读取这些 DSH 提供商的额度；留空时自动选择名称含 Magpie 的提供商'),
  baseURL: Schema.string().description('可选的独立 Magpie 网关地址，支持以 /v1 结尾'),
  apiKeyEnv: Schema.string().description('独立网关使用的 DSH 凭据名或环境变量名'),
  discoverLocal: Schema.boolean().default(true).description('未找到 Magpie 提供商时尝试本机 Magpie'),
  cacheSeconds: Schema.number().min(10).max(300).default(45).description('后端额度缓存秒数'),
});
export interface PluginConfig { providers?: string[]; baseURL?: string; apiKeyEnv?: string; discoverLocal?: boolean; cacheSeconds?: number }
export interface SourceProfile { baseURL: string; apiKeyEnv?: string; headers?: Record<string, string>; name?: string }
export interface Source { id: string; name: string; profile: SourceProfile }

export function gatewayURL(baseURL: string, path: 'quotas' | 'refresh'): URL {
  const url = new URL(baseURL);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Magpie 地址必须是有效的 HTTP/HTTPS 地址');
  const prefix = url.pathname.replace(/\/+$/, '').replace(/\/v1$/, '');
  url.pathname = `${prefix}/v1/magpie/quotas${path === 'refresh' ? '/refresh' : ''}`;
  return url;
}
export function readSources(descriptors: readonly { value: unknown }[], config: PluginConfig): Source[] {
  const all = new Map<string, Source>();
  for (const { value } of descriptors) {
    for (const [id, raw] of Object.entries(record(record(value)?.providers) ?? {})) {
      const p = record(raw);
      if (typeof p?.baseURL !== 'string') continue;
      const headers = Object.fromEntries(Object.entries(record(p.headers) ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
      const profile: SourceProfile = { baseURL: p.baseURL, headers, apiKeyEnv: typeof p.apiKeyEnv === 'string' ? p.apiKeyEnv : undefined };
      const name = typeof p.name === 'string' ? p.name : id;
      if (config.providers?.length ? config.providers.includes(id) : /magpie/i.test(`${id} ${name}`)) all.set(id, { id, name, profile });
    }
  }
  if (config.baseURL) all.set('configured-magpie', { id: 'configured-magpie', name: 'Magpie', profile: { baseURL: config.baseURL, apiKeyEnv: config.apiKeyEnv } });
  return [...all.values()];
}
export async function localSource(): Promise<Source> {
  let port = 3425;
  try {
    const settings = record(JSON.parse(await readFile(join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'magpie', 'settings.json'), 'utf8')));
    if (Number.isInteger(settings?.port) && Number(settings?.port) > 0 && Number(settings?.port) < 65536) port = Number(settings?.port);
  } catch { /* Magpie's default port also works without its settings file. */ }
  return { id: 'local-magpie', name: '本机 Magpie', profile: { baseURL: `http://127.0.0.1:${port}/v1` } };
}
