import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import type { StreamChunk } from '@deepseek-ai/dsh-llm';
import { classify, enter, quote, type Ssh } from './ssh.js';
import { type Binding, type Host, SshClaudeError } from './domain.js';
import { controlReply, deny, line, Translator, type Frame } from './protocol.js';

export interface RunOptions {
  host: Host; binding: Binding; binary: string; model: string; prompt: string; signal: AbortSignal;
  decide: (request: Frame, signal: AbortSignal) => Promise<unknown>;
  initialized: () => Promise<void>;
}
export function launchScript(o: Pick<RunOptions, 'binding' | 'binary' | 'model'>): string {
  const b = o.binding;
  const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--permission-mode', 'default', '--permission-prompt-tool', 'stdio', '--tools', 'default', '--model', o.model, b.initialized ? '--resume' : '--session-id', b.claudeSessionId];
  return `${enter(b.path)} test "$(id -un)" = ${quote(b.user)} || exit 75; test -x ${quote(o.binary)} || exit 72; PATH=${quote(o.binary.slice(0, o.binary.lastIndexOf('/')))}:"$PATH"; export PATH; exec ${[o.binary, ...args].map(quote).join(' ')}`;
}
/** One SSH process per foreground turn; no detached keeper, reconnect or replay. */
export async function* runTurn(ssh: Ssh, o: RunOptions): AsyncGenerator<StreamChunk> {
  o.signal.throwIfAborted();
  const child = ssh.start(o.host, launchScript(o));
  const life = new AbortController();
  const pending = new Map<string, AbortController>();
  const seen = new Set<string>();
  let stderr = ''; let spawnError: Error | undefined; let result: Frame | undefined;
  let cancelTimer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  const send = (s: string) => { if (!closed && child.stdin.writable && !child.stdin.destroyed) child.stdin.write(s); };
  const abort = () => {
    life.abort();
    send(line({ type: 'control_request', request_id: randomUUID(), request: { subtype: 'interrupt' } }));
    cancelTimer ??= setTimeout(() => child.kill('SIGKILL'), 2000);
  };
  const exit = new Promise<number | null>(resolve => {
    child.once('error', e => { spawnError = e; });
    child.once('close', code => { closed = true; resolve(code); });
  });
  child.stdin.on('error', () => {}); // EPIPE is classified by process exit; never retry a write.
  child.stderr.on('data', b => { stderr = (stderr + b.toString()).slice(-8192); });
  o.signal.addEventListener('abort', abort, { once: true });
  const reader = createInterface({ input: child.stdout, crlfDelay: Infinity });
  const translator = new Translator();
  let gotInit = false;
  const started = setTimeout(() => { spawnError = new SshClaudeError('CLAUDE_START_TIMEOUT', 'Claude 启动超时；请检查远端 Hooks、MCP 或 CLI 环境。'); child.kill('SIGKILL'); }, 60_000);
  try {
    send(line({ type: 'user', session_id: '', message: { role: 'user', content: [{ type: 'text', text: o.prompt }] }, parent_tool_use_id: null }));
    for await (const raw of reader) {
      if (Buffer.byteLength(raw) > 8 * 1024 * 1024) throw new SshClaudeError('CLAUDE_PROTOCOL', 'Claude 输出行超出限制。');
      let frame: Frame;
      try { frame = JSON.parse(raw); } catch { if (gotInit) throw new SshClaudeError('CLAUDE_PROTOCOL', 'Claude 输出不是有效 stream-json；已停止。'); else continue; }
      if (!frame || typeof frame !== 'object') continue;
      if (frame.type === 'system' && frame.subtype === 'init') {
        clearTimeout(started); gotInit = true;
        if (frame.session_id !== o.binding.claudeSessionId) throw new SshClaudeError('SESSION_MISMATCH', '远端返回不同的 Claude session ID，已停止。');
        await o.initialized();
      }
      if (frame.type === 'control_request' && typeof frame.request_id === 'string') {
        const id = frame.request_id;
        if (seen.has(id)) continue;
        seen.add(id);
        if (frame.request?.subtype !== 'can_use_tool') {
          send(line({ type: 'control_response', response: { subtype: 'error', request_id: id, error: 'Claude SSH does not support this control request' } }));
          continue;
        }
        const control = new AbortController(); pending.set(id, control);
        const signal = AbortSignal.any([life.signal, control.signal, o.signal]);
        void o.decide(frame.request ?? {}, signal)
          .catch(() => deny(frame.request?.tool_use_id ?? '', 'DSH confirmation unavailable or cancelled'))
          .then(answer => { if (!signal.aborted) send(controlReply(id, answer)); })
          .finally(() => pending.delete(id));
      }
      if (frame.type === 'control_cancel_request') { pending.get(frame.request_id)?.abort(); pending.delete(frame.request_id); }
      if (frame.type === 'result') { result = frame; clearTimeout(started); break; }
      if (!o.signal.aborted) for (const chunk of translator.feed(frame)) yield chunk;
    }
    if (result) {
      if (result.session_id && result.session_id !== o.binding.claudeSessionId) throw new SshClaudeError('SESSION_MISMATCH', '远端结果 session ID 不匹配。');
      if (!gotInit) throw new SshClaudeError('CLAUDE_PROTOCOL', 'Claude 未发送初始化帧。');
      const u = result.usage;
      // Even an error/cancelled result may contain billable work. Publish only
      // validated counters, before surfacing the terminal failure to the adapter.
      if (u && [u.input_tokens, u.output_tokens, u.cache_read_input_tokens ?? 0, u.cache_creation_input_tokens ?? 0].every(n => Number.isSafeInteger(n) && n >= 0)) yield { type: 'usage', usage: { inputTokens: u.input_tokens, outputTokens: u.output_tokens, cacheReadTokens: u.cache_read_input_tokens ?? 0, cacheWriteTokens: u.cache_creation_input_tokens ?? 0 } };
      if (o.signal.aborted) throw new SshClaudeError('CANCELLED', '已取消；已发送远端中断。若连接已断开，远端是否停止仍需检查。');
      if (result.is_error || result.subtype !== 'success') throw new SshClaudeError('CLAUDE_ERROR', `远端 Claude：${(result.errors ?? [result.result ?? result.subtype]).join('\n')}`);
      return;
    }
    if (o.signal.aborted) throw new SshClaudeError('CANCELLED', '已取消；已发送远端中断。若连接已断开，远端是否停止仍需检查。');
    const code = await exit;
    if (spawnError) throw spawnError;
    throw classify(code, stderr);
  } finally {
    clearTimeout(started); life.abort(); for (const p of pending.values()) p.abort();
    o.signal.removeEventListener('abort', abort);
    if (cancelTimer) clearTimeout(cancelTimer);
    child.stdin.end(); reader.close();
    if (!closed) {
      const kill = setTimeout(() => child.kill('SIGKILL'), 1500);
      await exit; clearTimeout(kill);
    }
  }
}
