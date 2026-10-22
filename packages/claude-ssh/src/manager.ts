import { randomUUID } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import type { Context } from '@deepseek-ai/cordis';
import { SessionId } from '@deepseek-ai/dsh-session';
import type {} from '@deepseek-ai/dsh-api-session-controller';
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller';
import { label, providerFor, revision, route, validateHost, SshClaudeError, type Host, type Workspace } from './domain.js';
import type { Store } from './store.js';
import type { Ssh } from './ssh.js';
import { MODELS, type ClaudeSshAdapter } from './adapter.js';

export class Manager {
  constructor(readonly ctx: Context, readonly store: Store, readonly ssh: Ssh, readonly adapter: ClaudeSshAdapter, readonly refresh: () => void, readonly nativeActive: (id: string) => boolean = () => false) {}
  private hostBusy(id: string): boolean {
    const state = this.store.snapshot();
    return [...Object.values(state.bindings), ...Object.values(state.nativeBindings)].some(b => b.hostId === id && (this.adapter.active.has(b.sessionId) || this.nativeActive(b.sessionId)));
  }
  host(id: string): Host { const h = this.store.snapshot().hosts.find(h => h.id === id); if (!h) throw new SshClaudeError('HOST_NOT_FOUND', '主机已删除。'); return h; }
  async saveHost(input: Host): Promise<Host> {
    const host = validateHost(input);
    if (this.hostBusy(host.id)) throw new SshClaudeError('HOST_BUSY', '此主机有活动会话，暂不能编辑。');
    await this.store.update(s => { const at = s.hosts.findIndex(h => h.id === host.id); if (at === -1) s.hosts.push(host); else s.hosts[at] = host; });
    this.refresh(); return host;
  }
  async deleteHost(id: string): Promise<void> {
    if (this.hostBusy(id)) throw new SshClaudeError('HOST_BUSY', '请先停止此主机上的活动会话。');
    await this.store.update(s => { s.hosts = s.hosts.filter(h => h.id !== id); s.workspaces = s.workspaces.filter(w => w.hostId !== id); });
    this.refresh();
  }
  async createWorkspace(hostId: string, path: string, signal?: AbortSignal): Promise<Workspace> {
    const host = this.host(hostId); const rev = revision(host);
    const d = await this.ssh.directory(host, path, signal);
    const workspace = { id: randomUUID(), hostId, hostRevision: rev, path: d.path, user: d.user };
    return this.store.update(s => {
      if (revision(this.host(hostId)) !== rev) throw new SshClaudeError('BINDING_CHANGED', '主机在验证期间已变化。');
      const existing = s.workspaces.find(w => w.hostId === hostId && w.hostRevision === rev && w.path === d.path && w.user === d.user);
      if (existing) return existing;
      s.workspaces.push(workspace); return workspace;
    });
  }
  async createSession(workspaceId: string, model: string): Promise<string> {
    if (!MODELS.includes(model as typeof MODELS[number])) throw new Error('模型无效');
    const ws = this.store.snapshot().workspaces.find(w => w.id === workspaceId);
    if (!ws) throw new SshClaudeError('WORKSPACE_REQUIRED', '请先选择远程工作区。');
    const host = this.host(ws.hostId);
    if (revision(host) !== ws.hostRevision) throw new SshClaudeError('BINDING_CHANGED', '主机配置已修改，请重新验证并创建工作区。');
    const d = await this.ssh.directory(host, ws.path);
    if (d.path !== ws.path || d.user !== ws.user) throw new SshClaudeError('BINDING_CHANGED', '远端目录或用户变化，已停止。');
    const sessionId = SessionId(randomUUID());
    // DSH's public history/resume API rejects headers without cwd. Use a NONEXISTENT
    // namespaced address as a routing key only. Never mkdir it or use it for execution.
    const routingCwd = `/__dsh_claude_ssh_remote__/${host.id}/${ws.id}`;
    try { await lstat(routingCwd); throw new Error('隔离路由地址在本机已存在，拒绝使用以免展示本地文件。'); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    await this.store.update(s => { s.bindings[sessionId] = { sessionId, workspaceId, hostId: ws.hostId, hostRevision: ws.hostRevision, path: ws.path, user: ws.user, claudeSessionId: randomUUID(), initialized: false, state: 'ready', model, routingCwd }; });
    try {
      route(this.store.snapshot(), sessionId, providerFor(ws.hostId));
      const handle = await this.ctx.agents.create({ sessionId, meta: { cwd: routingCwd }, agentOptions: { provider: providerFor(ws.hostId), model }, setup: (_agentCtx, agent) => {
        // Persist an initial event before publication, so the cold history reader never sees
        // an announced session whose zero-event log has not yet materialized.
        agent.session.append('model/selection', { provider: providerFor(ws.hostId), model });
      } });
      this.ctx.effect(() => () => handle.dispose());
      // Public durable model-selection event, before the API Controller composes its selection.
      // Unlike selectModel(), this does not save a remote model as the global default for local sessions.
      await this.ctx.sessionController.rename({ sessionId, title: `Claude SSH / ${label(host, ws)}` });
      return sessionId;
    } catch (e) {
      // Keep the binding if an Agent was published; orphan bindings cannot execute without an Agent.
      throw e;
    }
  }
  async submit(sessionId: string, prompt: string, signal: AbortSignal): Promise<void> {
    const b = this.store.snapshot().bindings[sessionId];
    const { binding } = route(this.store.snapshot(), sessionId, providerFor(b?.hostId ?? ''));
    if (!prompt.trim() || prompt.length > 50000) throw new Error('请输入最多 50000 字符的文本。');
    if (!['ready', 'completed'].includes(binding.state)) throw new Error('请等待当前任务完成，或检查远端后明确恢复。');
    if (this.adapter.active.has(sessionId) || this.ctx.agents.get(SessionId(sessionId))?.status === 'running') throw new Error('会话正在运行。');
    // UUID minted once per explicit submit; this endpoint never retries an uncertain delivery.
    await this.ctx.sessionController.prompt({ sessionId: SessionId(sessionId), requestId: randomUUID() as SessionRequestId, mode: 'queue', content: [{ type: 'text', text: prompt }] }, signal);
  }
  async selectModel(sessionId: string, model: string): Promise<void> {
    if (!MODELS.includes(model as typeof MODELS[number])) throw new Error('模型无效');
    const b = this.store.snapshot().bindings[sessionId];
    route(this.store.snapshot(), sessionId, providerFor(b?.hostId ?? ''));
    if (this.adapter.active.has(sessionId) || this.ctx.agents.get(SessionId(sessionId))?.status === 'running') throw new Error('请在任务结束后切换模型。');
    await this.store.update(s => { s.bindings[sessionId].model = model; });
    this.ctx.agents.get(SessionId(sessionId))?.session.append('model/selection', { provider: providerFor(b.hostId), model });
  }
  async recover(sessionId: string): Promise<void> {
    if (this.adapter.active.has(sessionId)) throw new Error('会话仍在运行');
    const { host, binding } = route(this.store.snapshot(), sessionId, providerFor(this.store.snapshot().bindings[sessionId]?.hostId ?? ''));
    const d = await this.ssh.directory(host, binding.path);
    if (d.path !== binding.path || d.user !== binding.user) throw new Error('绑定变化，请创建新会话');
    await this.ssh.probe(host);
    await this.store.update(s => {
      const b = s.bindings[sessionId];
      if (b.state === 'interrupted' || b.state === 'cancelled') b.initialized = true;
      b.state = 'ready'; delete b.lastError;
    });
  }
}
