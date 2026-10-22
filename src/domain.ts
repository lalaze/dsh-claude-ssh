import { createHash } from 'node:crypto';

export class SshClaudeError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}
export interface Host { id: string; name: string; destination: string; port?: number; claudePath?: string }
export interface Workspace { id: string; hostId: string; hostRevision: string; path: string; user: string }
export type RunState = 'ready' | 'running' | 'completed' | 'cancelled' | 'interrupted';
export interface Binding {
  sessionId: string; workspaceId: string; hostId: string; hostRevision: string; path: string; user: string;
  claudeSessionId: string; initialized: boolean; state: RunState; lastError?: string;
  sentMessageIds?: string[];
  model?: string;
  routingCwd?: string;
}
export interface State { version: 1; hosts: Host[]; workspaces: Workspace[]; bindings: Record<string, Binding> }
export interface StateView extends State {
  routeErrors: Record<string, string>;
  plugin?: { version: string; capabilities: string[]; sshConfigPath: string };
}
export const emptyState = (): State => ({ version: 1, hosts: [], workspaces: [], bindings: {} });
export function absolutePath(value: string): string {
  if (!value.startsWith('/') || /[\0\r\n]/.test(value)) throw new SshClaudeError('BAD_PATH', '请输入远端绝对路径（不支持换行或 NUL）。');
  return value;
}
export function validateHost(host: Host): Host {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(host.id)) throw new SshClaudeError('BAD_HOST', '主机标识格式无效。');
  if (!host.name?.trim() || host.name.length > 120) throw new SshClaudeError('BAD_HOST', '请输入主机名称。');
  // No options, URLs, whitespace, shell syntax, or extra @ components. IPv6 may be bracketed.
  if (!/^(?:[a-zA-Z0-9_][a-zA-Z0-9_.-]*@)?(?:[a-zA-Z0-9_][a-zA-Z0-9_.-]*|\[[a-fA-F0-9:]+\])$/.test(host.destination))
    throw new SshClaudeError('BAD_HOST', 'SSH 目标必须为 config 别名、主机名或 user@host。IPv6 请使用方括号。');
  if (host.port !== undefined && (!Number.isInteger(host.port) || host.port < 1 || host.port > 65535)) throw new SshClaudeError('BAD_HOST', '端口必须为 1–65535。');
  if (host.claudePath) absolutePath(host.claudePath);
  return { id: host.id, name: host.name.trim(), destination: host.destination, ...(host.port ? { port: host.port } : {}), ...(host.claudePath ? { claudePath: host.claudePath } : {}) };
}
export function revision(host: Host): string {
  return createHash('sha256').update(JSON.stringify([host.destination, host.port ?? 22, host.claudePath ?? ''])).digest('hex');
}
export const providerFor = (hostId: string): string => `claude-ssh-${hostId}`;
export function route(state: State, sessionId: string | undefined, provider: string): { host: Host; binding: Binding } {
  const binding = sessionId && Object.hasOwn(state.bindings, sessionId) ? state.bindings[sessionId] : undefined;
  if (!binding) throw new SshClaudeError('WORKSPACE_REQUIRED', '请先在设置 → Claude SSH 选择远程工作区并创建会话；本地或未绑定会话不能启动远端 Claude。');
  const host = state.hosts.find(h => h.id === binding.hostId);
  const ws = state.workspaces.find(w => w.id === binding.workspaceId);
  if (!host || !ws || provider !== providerFor(binding.hostId) || ws.hostId !== host.id)
    throw new SshClaudeError('HOST_MISMATCH', '模型主机与此远程工作区不匹配，请返回工作区所属主机。');
  if (revision(host) !== binding.hostRevision || ws.hostRevision !== binding.hostRevision || ws.path !== binding.path || ws.user !== binding.user)
    throw new SshClaudeError('BINDING_CHANGED', '主机配置或工作区绑定已变化；请重新验证并创建远程工作区和会话。');
  absolutePath(binding.path);
  return { host, binding };
}
export const label = (host: Host, target: { user: string; path: string }): string => `${host.name} (${host.destination}) / ${target.user} / ${target.path}`;
