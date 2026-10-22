import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { hostname, userInfo } from 'node:os';
import type { Readable, Writable } from 'node:stream';
import type { Context } from '@deepseek-ai/cordis';
import { SessionId } from '@deepseek-ai/dsh-session';
import type { SubprocessHandle, SubprocessRuntime } from '@deepseek-ai/dsh-subprocess';
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm';
import { ClaudeSshAdapter, MODELS, promptOf } from './adapter.js';
import { absolutePath, NATIVE_PROVIDER, revision, SshClaudeError, type Host, type NativeBinding } from './domain.js';
import { Ssh, type PipeProcess } from './ssh.js';
import { runTurn } from './runner.js';

/** Adapt the public DSH process handle; termination stays owned by its provider. */
class DshProcess extends EventEmitter implements PipeProcess {
  readonly stdin: Writable; readonly stdout: Readable; readonly stderr: Readable;
  constructor(private handle: SubprocessHandle) {
    super();
    if (!handle.stdin || !handle.stdout || !handle.stderr) {
      handle.terminate(); void handle.done.catch(() => {});
      throw new Error('工作区进程服务没有提供 Claude 所需的双向管道。');
    }
    this.stdin = handle.stdin; this.stdout = handle.stdout; this.stderr = handle.stderr;
    void handle.done.then(outcome => this.emit('close', outcome.exitCode), error => {
      this.emit('error', error instanceof Error ? error : new Error(String(error)));
      this.stdout.destroy(); this.stderr.destroy(); this.stdin.destroy();
      this.emit('close', null);
    });
  }
  kill(): boolean { this.handle.terminate(); return true; }
}

const identityScript = `printf '%s\\0%s\\0' "$(uname -n)" "$(id -un)"`;

/** cwd is passed ONLY to DSH, which owns its mapping to the execution world. */
export class WorkspaceTransport extends Ssh {
  constructor(private runtime: Pick<SubprocessRuntime, 'spawn'>, readonly cwd: string) { super(); absolutePath(cwd); }
  override start(_host: Host, script: string): PipeProcess {
    return new DshProcess(this.runtime.spawn({ argv: ['/bin/sh', '-c', script], cwd: this.cwd,
      stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' }, graceMs: 1500,
      env: { LC_ALL: 'C' },
    }));
  }
  async inspect(signal?: AbortSignal): Promise<{ machine: string; user: string; path: string }> {
    const out = await this.run({ id: 'workspace', name: '工作区', destination: 'workspace' },
      `test -r . && test -x . || exit 71; ${identityScript}; printf '%s\\0' "$(pwd -P)"`, signal);
    const [machine, user, path] = out.split('\0');
    if (!machine || !user || !path) throw new Error('工作区执行环境未返回有效身份。');
    return { machine, user, path: absolutePath(path) };
  }
}

export interface Eligibility { eligible: boolean; reason?: string; hostId?: string; path?: string; user?: string }

/** Native sessions never infer a host from a project label or a local path. */
export class NativeClaudeAdapter extends ClaudeSshAdapter {
  localIdentity = { machine: hostname(), user: userInfo().username };
  override providerInfo() { return { id: NATIVE_PROVIDER, name: 'Claude' }; }
  override async listModels() {
    return MODELS.map(id => ({ provider: NATIVE_PROVIDER, id, name: `Claude ${id[0].toUpperCase()}${id.slice(1)}`, description: '当前远程工作区的 Claude Code', inputModalities: ['text' as const] }));
  }
  private async resolve(sessionId: string, signal?: AbortSignal) {
    const agent = this.ctx.agents.get(SessionId(sessionId));
    const cwd = agent?.session.header.cwd;
    if (!agent || !cwd) throw new SshClaudeError('WORKSPACE_REQUIRED', '请先在左侧选择远程项目。');
    const state = this.store.snapshot();
    if (state.bindings[sessionId]) throw new SshClaudeError('WORKSPACE_REQUIRED', '此历史会话使用独立 SSH 绑定，请沿用原模型。');
    if (!state.hosts.length) throw new SshClaudeError('HOST_NOT_FOUND', '请先在 Claude SSH 设置中保存目标 SSH 主机。');
    // Use the injected runtime just like oh-my-claude's spawn:dsh path. The native
    // cwd is its routing input; reading agent.ctx.subprocess bypasses Cordis injection.
    const runtime = this.ctx.subprocess;
    if (!runtime) throw new SshClaudeError('WORKSPACE_UNSUPPORTED', '此工作区没有 DSH 进程服务。');
    const transport = new WorkspaceTransport(runtime, cwd);
    const identity = await transport.inspect(signal);
    // A stock/local provider must never make Claude visible on a remote-looking placeholder.
    if (identity.machine === this.localIdentity.machine && identity.user === this.localIdentity.user)
      throw new SshClaudeError('LOCAL_WORKSPACE', '当前工作区使用本机执行环境，Claude 远程模型不适用。');
    const previous = state.nativeBindings[sessionId];
    const candidates = previous ? state.hosts.filter(h => h.id === previous.hostId) : state.hosts;
    const matches = await Promise.all(candidates.map(async host => {
      try {
        const [machine, user] = (await this.ssh.run(host, identityScript, signal)).split('\0');
        return machine === identity.machine && user === identity.user ? host : undefined;
      } catch (error) { if (signal?.aborted) throw error; return undefined; }
    }));
    const host = matches.find(h => h !== undefined);
    if (!host) throw new SshClaudeError('HOST_MISMATCH', '当前远程工作区不属于已配置的目标 SSH 主机，或主机暂时不可验证。');
    if (previous && (previous.cwd !== cwd || previous.path !== identity.path || previous.machine !== identity.machine || previous.user !== identity.user || previous.hostRevision !== revision(host)))
      throw new SshClaudeError('BINDING_CHANGED', '工作区执行主机、目录或用户已变化，请在目标项目中新建会话。');
    const probe = await transport.probe(host, signal);
    if (probe.user !== identity.user) throw new SshClaudeError('BINDING_CHANGED', 'Claude 与工作区的执行用户不一致。');
    // Settings may change while network checks are in flight.
    const current = this.store.snapshot().hosts.find(h => h.id === host.id);
    if (!current || revision(current) !== revision(host) || agent.session.header.cwd !== cwd)
      throw new SshClaudeError('BINDING_CHANGED', '验证期间工作区或主机配置已变化。');
    return { transport, host, cwd, identity, binary: probe.path };
  }
  async eligibility(sessionId: string, signal?: AbortSignal): Promise<Eligibility> {
    try {
      const { host, identity } = await this.resolve(sessionId, signal);
      return { eligible: true, hostId: host.id, path: identity.path, user: identity.user };
    } catch (error) {
      return { eligible: false, reason: error instanceof Error ? error.message : '工作区暂时不可验证。' };
    }
  }
  async recover(sessionId: string): Promise<void> {
    if (this.active.has(sessionId)) throw new Error('会话仍在运行。');
    await this.resolve(sessionId);
    await this.store.update(s => {
      const b = s.nativeBindings[sessionId];
      if (!b) throw new Error('此会话还没有 Claude 执行记录。');
      if (b.state === 'interrupted' || b.state === 'cancelled') b.initialized = true;
      b.state = 'ready'; delete b.lastError;
    });
  }
  override async *stream(options: GenerateOptions): AsyncGenerator<StreamChunk> {
    const sessionId = options.sessionId;
    let entered = false; let control: AbortController | undefined;
    try {
      if (options.purpose || !sessionId || options.provider !== NATIVE_PROVIDER)
        throw new SshClaudeError('WORKSPACE_REQUIRED', 'Claude 仅用于目标远程工作区中的用户会话。');
      if (!MODELS.includes(options.model as typeof MODELS[number])) throw new SshClaudeError('BAD_MODEL', '请选择 Sonnet、Opus 或 Haiku。');
      if (this.active.has(sessionId)) throw new SshClaudeError('SESSION_BUSY', '会话正在运行。');
      control = new AbortController(); this.active.set(sessionId, control);
      const signal = options.signal ? AbortSignal.any([options.signal, control.signal]) : control.signal;
      const { transport, host, cwd, identity, binary } = await this.resolve(sessionId, signal);
      let binding = this.store.snapshot().nativeBindings[sessionId];
      if (binding && !['ready', 'completed'].includes(binding.state)) throw new SshClaudeError('RECOVERY_REQUIRED', '上次 Claude 任务状态未知，请检查远端后恢复。');
      const prompt = promptOf(options, binding?.sentMessageIds ?? []);
      const messageIds = options.messages.filter(m => m.role === 'user' && (!('source' in m) || m.source?.kind === 'user') && 'id' in m && m.id).map(m => 'id' in m ? String(m.id) : '');
      binding ??= { sessionId, workspaceId: '', hostId: host.id, hostRevision: revision(host), cwd, ...identity, claudeSessionId: randomUUID(), initialized: false, state: 'ready' } satisfies NativeBinding;
      const pinned = binding;
      await this.store.update(s => {
        const current = s.hosts.find(h => h.id === host.id);
        if (!current || revision(current) !== pinned.hostRevision || this.ctx.agents.get(sessionId)?.session.header.cwd !== cwd)
          throw new SshClaudeError('BINDING_CHANGED', '提交前工作区或主机配置已变化。');
        s.nativeBindings[sessionId] = { ...pinned, state: 'running', model: options.model, lastError: undefined, sentMessageIds: [...new Set([...(pinned.sentMessageIds ?? []), ...messageIds])] };
      });
      entered = true;
      yield* runTurn(transport, { host, binding, binary, model: options.model, prompt, signal,
        decide: (request, signal) => this.decide(sessionId, `${host.name} / ${identity.user} / ${identity.path}`, request, signal),
        initialized: async () => { await this.store.update(s => { s.nativeBindings[sessionId].initialized = true; }); },
      });
      await this.store.update(s => { s.nativeBindings[sessionId].state = 'completed'; });
      entered = false;
      yield { type: 'finish', reason: { kind: 'stop' } };
    } catch (error) {
      const cancelled = options.signal?.aborted || control?.signal.aborted;
      const message = error instanceof Error ? error.message : String(error);
      if (entered && sessionId) await this.store.update(s => { const b = s.nativeBindings[sessionId]; b.state = cancelled ? 'cancelled' : 'interrupted'; b.lastError = message; });
      entered = false;
      yield { type: 'finish', reason: { kind: cancelled ? 'aborted' : 'error', failure: { code: error instanceof SshClaudeError ? error.code : 'CLAUDE_WORKSPACE_ERROR', message } } };
    } finally {
      if (entered && sessionId) await this.store.update(s => { s.nativeBindings[sessionId].state = 'interrupted'; s.nativeBindings[sessionId].lastError = 'Claude 流已关闭，结果未知；请检查远端后恢复。'; });
      if (sessionId && this.active.get(sessionId) === control) this.active.delete(sessionId);
    }
  }
}
