import type { StreamChunk } from '@deepseek-ai/dsh-llm';
import type { AskUserQuestionItem, AskUserQuestionAnswer } from '@deepseek-ai/dsh-user-questions';

export type Frame = Record<string, any>;
export const line = (value: unknown): string => JSON.stringify(value) + '\n';
export const controlReply = (requestId: string, response: unknown): string => line({ type: 'control_response', response: { subtype: 'success', request_id: requestId, response } });
export const allow = (id: string, input: unknown) => ({ behavior: 'allow', updatedInput: input, toolUseID: id, decisionClassification: 'user_temporary' });
export const deny = (id: string, message: string) => ({ behavior: 'deny', message, toolUseID: id, decisionClassification: 'user_reject' });

export function questions(input: Frame, callId: string): AskUserQuestionItem[] {
  if (!Array.isArray(input.questions) || !input.questions.length || input.questions.length > 20) throw new Error('Claude 问题格式无效');
  return input.questions.map((q: Frame, i: number) => {
    if (typeof q?.question !== 'string' || !q.question) throw new Error('Claude 问题缺少内容');
    return { id: `${callId}:${i}`, question: q.question, header: typeof q.header === 'string' ? q.header : undefined, multiSelect: q.multiSelect === true,
      options: Array.isArray(q.options) ? q.options.map((o: Frame) => { if (typeof o.label !== 'string') throw new Error('选项格式无效'); return { label: o.label, description: typeof o.description === 'string' ? o.description : undefined }; }) : undefined };
  });
}
export function questionAnswers(qs: AskUserQuestionItem[], response: AskUserQuestionAnswer): Record<string, string> {
  const answers: Record<string, string> = {};
  for (const q of qs) {
    const a = response.answers.find(a => a.id === q.id);
    if (!a || (!a.selected.length && !a.custom)) throw new Error('未完整回答问题');
    answers[q.question] = !q.multiSelect && a.custom ? a.custom : [...a.selected, ...(a.custom ? [a.custom] : [])].join(', ');
  }
  return answers;
}

/** Render remote tools as activity text. Never emit a DSH executable tool-call. */
export class Translator {
  private next = 0;
  private partial = new Map<number, { index: number; type: 'text' | 'reasoning'; text: string }>();
  private partialMessage = false;
  private full(text: string, reasoning = false): StreamChunk[] {
    const index = this.next++; const type = reasoning ? 'reasoning' : 'text';
    return [{ type: 'block-start', index, blockType: type }, { type: reasoning ? 'reasoning-delta' : 'text-delta', index, text }, { type: 'block-end', index, block: { type, text } }];
  }
  feed(frame: Frame): StreamChunk[] {
    const out: StreamChunk[] = [];
    if (frame.type === 'stream_event') {
      const e = frame.event;
      if (!e || typeof e.type !== 'string') return out;
      if (e.type === 'message_start') { this.partialMessage = false; }
      if (e.type === 'content_block_start') {
        const b = e.content_block;
        if (b?.type === 'tool_use') return this.full(`\n[远端工具 ${b.name}] ${JSON.stringify(b.input ?? {})}\n`, true);
        if (b?.type === 'text' || b?.type === 'thinking') {
          this.partialMessage = true;
          const type = b.type === 'text' ? 'text' : 'reasoning'; const index = this.next++;
          this.partial.set(e.index, { index, type, text: '' });
          out.push({ type: 'block-start', index, blockType: type });
          const initial = b.text ?? b.thinking;
          if (initial) { this.partial.get(e.index)!.text += initial; out.push({ type: type === 'text' ? 'text-delta' : 'reasoning-delta', index, text: initial }); }
        }
      }
      if (e.type === 'content_block_delta') {
        const p = this.partial.get(e.index); const text = e.delta?.text ?? e.delta?.thinking;
        if (p && typeof text === 'string') { p.text += text; out.push({ type: p.type === 'text' ? 'text-delta' : 'reasoning-delta', index: p.index, text }); }
      }
      if (e.type === 'content_block_stop') {
        const p = this.partial.get(e.index);
        if (p) { out.push({ type: 'block-end', index: p.index, block: { type: p.type, text: p.text } }); this.partial.delete(e.index); }
      }
    }
    if (frame.type === 'assistant' && Array.isArray(frame.message?.content)) {
      for (const b of frame.message.content) {
        if ((b.type === 'text' || b.type === 'thinking') && !this.partialMessage) out.push(...this.full(b.text ?? b.thinking ?? '', b.type === 'thinking'));
        // Full tool frame carries complete arguments, unlike the tool's initial partial frame.
        if (b.type === 'tool_use') out.push(...this.full(`\n[远端工具 ${b.name} / ${b.id}] ${JSON.stringify(b.input)}\n`, true));
      }
      this.partialMessage = false;
    }
    if (frame.type === 'user' && Array.isArray(frame.message?.content)) for (const b of frame.message.content) {
      if (b.type === 'tool_result') out.push(...this.full(`\n[远端工具结果 ${b.tool_use_id}${b.is_error ? ' / 错误' : ''}] ${typeof b.content === 'string' ? b.content : JSON.stringify(b.content)}\n`, true));
    }
    return out;
  }
}
