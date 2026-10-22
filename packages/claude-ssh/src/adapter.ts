import { LlmAdapter, type GenerateOptions, type ResolvedRetryPolicy, type StreamChunk } from '@deepseek-ai/dsh-llm';
import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-agent';
import type {} from '@deepseek-ai/dsh-user-approval';
import type {} from '@deepseek-ai/dsh-user-questions';
import { SessionId } from '@deepseek-ai/dsh-session';
import { label, providerFor, route, SshClaudeError } from './domain.js';
import type { Store } from './store.js';
import type { Ssh } from './ssh.js';
import { allow, deny, questionAnswers, questions, type Frame } from './protocol.js';
import { runTurn } from './runner.js';

export const MODELS = ['sonnet', 'opus', 'haiku'] as const; // Claude Code's documented aliases, resolved remotely.
export function promptOf(options: GenerateOptions, sentIds?: readonly string[]): string {
  let last = -1;
  for (let i = 0; i < options.messages.length; i++) if (options.messages[i].role === 'assistant') last = i;
  const text: string[] = [];
  for (const m of options.messages.slice(last + 1)) {
    if (m.role !== 'user' || ('source' in m && m.source?.kind !== 'user')) continue;
    if (sentIds) {
      if (!('id' in m) || !m.id) throw new SshClaudeError('MESSAGE_ID_REQUIRED', '远程会话需要 DSH 持久消息标识，以防止任务重发。');
      if (sentIds.includes(m.id)) continue;
    }
    for (const b of m.content) {
      if (b.type !== 'text') throw new SshClaudeError('ATTACHMENT_UNSUPPORTED', '首版仅转发文本。请将文件放在远端项目中并提供远端路径；不自动上传本地附件。');
      text.push(b.text);
    }
  }
  if (!text.join('\n').trim()) throw new SshClaudeError('EMPTY_PROMPT', '没有可发送的用户文本；不会重放历史任务。');
  return text.join('\n\n');
}
export class ClaudeSshAdapter extends LlmAdapter {
  readonly active = new Map<string, AbortController>();
  constructor(protected ctx: Context, readonly store: Store, readonly ssh: Ssh) { super(); }
  override providerInfo(provider: string) {
    const host = this.store.snapshot().hosts.find(h => providerFor(h.id) === provider);
    return { id: provider, name: `Claude SSH / ${host?.name ?? '已删除主机'} / ${host?.destination ?? ''}` };
  }
  override providerRetryPolicy(): ResolvedRetryPolicy { return { mode: 'normal', maxRetries: 0, retryableCodes: [], initialDelayMs: 500, maxDelayMs: 500, jitterRatio: 0 }; }
  override async listModels(provider: string) { return MODELS.map(id => ({ provider, id, name: `Claude SSH ${id}`, description: this.providerInfo(provider).name, inputModalities: ['text' as const] })); }
  async decide(sessionId: string, identity: string, request: Frame, signal: AbortSignal): Promise<unknown> {
    const id = String(request.tool_use_id ?? '');
    const agent = this.ctx.agents.get(SessionId(sessionId));
    if (!agent || request.subtype !== 'can_use_tool' || typeof request.tool_name !== 'string') return deny(id, 'Unsupported control request or unavailable DSH session');
    const input = request.input;
    if (!input || typeof input !== 'object' || Array.isArray(input)) return deny(id, 'Invalid tool input');
    if (request.tool_name === 'AskUserQuestion') {
      const qs = questions(input, id);
      const answer = await this.ctx.userQuestions.ask({ agent, questions: qs.map(q => ({ ...q, detail: identity })), signal });
      return allow(id, { ...input, answers: questionAnswers(qs, answer) });
    }
    if (request.tool_name === 'ExitPlanMode' && typeof input.plan === 'string') {
      const q = { id: `plan:${id}`, question: `批准此远端计划？${identity}`, detail: input.plan, options: [{ label: '批准' }, { label: '继续规划' }], intent: { kind: 'plan-review' as const, approve: '批准' } };
      const answer = await this.ctx.userQuestions.ask({ agent, questions: [q], signal });
      const a = answer.answers.find(a => a.id === q.id);
      return a?.selected.length === 1 && a.selected[0] === '批准' && !a.custom ? allow(id, input) : deny(id, a?.custom || 'User chose to continue planning');
    }
    const outcome = await this.ctx.approval.request({ agent, toolName: `Claude SSH: ${request.tool_name}`, reason: `${identity}\n${JSON.stringify(input)}`, signal });
    return outcome === 'allowed-once' && !signal.aborted ? allow(id, input) : deny(id, `DSH permission decision: ${outcome}`);
  }
  override async *stream(options: GenerateOptions): AsyncGenerator<StreamChunk> {
    const sessionId = options.sessionId;
    let entered = false;
    let control: AbortController | undefined;
    try {
      if (options.purpose) throw new SshClaudeError('AUXILIARY_UNSUPPORTED', 'Claude SSH 不执行标题生成或本地上下文压缩辅助请求。');
      const { host, binding } = route(this.store.snapshot(), sessionId, options.provider);
      if (!MODELS.includes(options.model as typeof MODELS[number])) throw new SshClaudeError('BAD_MODEL', '请选择 sonnet、opus 或 haiku 别名。');
      if (this.active.has(binding.sessionId)) throw new SshClaudeError('SESSION_BUSY', '同一会话已有远端任务。');
      if (['interrupted', 'cancelled', 'running'].includes(binding.state)) throw new SshClaudeError('RECOVERY_REQUIRED', '上次任务已中断或状态未知。请先检查远端，再在 Claude SSH 中明确恢复；不会重发旧任务。');
      const prompt = promptOf(options, binding.sentMessageIds ?? []);
      const messageIds = options.messages.filter(m => m.role === 'user' && (!('source' in m) || m.source?.kind === 'user') && 'id' in m && m.id).map(m => 'id' in m ? String(m.id) : '');
      control = new AbortController(); this.active.set(binding.sessionId, control);
      const signal = options.signal ? AbortSignal.any([options.signal, control.signal]) : control.signal;
      signal.throwIfAborted();
      // Revalidate directory and remote identity every turn; never trust a previous probe.
      const directory = await this.ssh.directory(host, binding.path, signal);
      if (directory.path !== binding.path || directory.user !== binding.user) throw new SshClaudeError('BINDING_CHANGED', '远端目录真实路径或用户已变化，请创建新工作区。');
      const probe = await this.ssh.probe(host, signal);
      if (probe.user !== binding.user) throw new SshClaudeError('REMOTE_USER_CHANGED', '检测到远端用户变化，已停止。');
      // Check immutable routing again after asynchronous SSH preflight.
      route(this.store.snapshot(), sessionId, options.provider);
      await this.store.update(s => {
        const b = s.bindings[binding.sessionId];
        b.state = 'running'; delete b.lastError;
        b.sentMessageIds = [...new Set([...(b.sentMessageIds ?? []), ...messageIds])];
      });
      entered = true;
      yield* runTurn(this.ssh, { host, binding, binary: probe.path, model: options.model, prompt, signal,
        decide: (request, signal) => this.decide(binding.sessionId, label(host, binding), request, signal),
        initialized: async () => { await this.store.update(s => { s.bindings[binding.sessionId].initialized = true; }); }
      });
      await this.store.update(s => { s.bindings[binding.sessionId].state = 'completed'; });
      entered = false;
      yield { type: 'finish', reason: { kind: 'stop' } };
    } catch (error) {
      const cancelled = options.signal?.aborted || control?.signal.aborted || error instanceof SshClaudeError && error.code === 'CANCELLED';
      const message = error instanceof Error ? error.message : 'Claude SSH 未知错误';
      if (entered && sessionId) {
        await this.store.update(s => { const b = s.bindings[sessionId]; b.state = cancelled ? 'cancelled' : 'interrupted'; b.lastError = message; });
        entered = false;
      }
      yield { type: 'finish', reason: { kind: cancelled ? 'aborted' : 'error', failure: { code: error instanceof SshClaudeError ? error.code : 'CLAUDE_SSH_ERROR', message } } };
    } finally {
      // A consumer that abandons the generator is also an interruption, never a success.
      if (entered && sessionId) await this.store.update(s => { s.bindings[sessionId].state = 'interrupted'; s.bindings[sessionId].lastError = '流已关闭，结果未知；请检查远端后恢复。'; });
      if (sessionId && this.active.get(sessionId) === control) this.active.delete(sessionId);
    }
  }
  cancelAll(): void { for (const controller of this.active.values()) controller.abort(); }
}
