import type { FetchFunction } from '@earendil-works/pi-ai';
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm';
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm';
import type { PiAiModelProfile } from '@deepseek-ai/dsh-llm-pi-ai';
import type { SourceProvider, Protocol } from '../src/config.js';

export const MODEL = 'codex/gpt-6.1-sol';
export const model: PiAiModelProfile = {
  id: MODEL, name: 'GPT test', contextWindow: 196608, maxTokens: 16384,
  input: ['text', 'image'], reasoningEfforts: { low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh' },
};
export function source(api: Protocol = 'openai-completions'): SourceProvider {
  return { id: 'remote-magpie', profile: { api, baseURL: 'https://magpie.example.invalid/v1', apiKeyEnv: 'MAGPIE_GATEWAY_KEY', headers: { 'X-Deployment': 'test' }, models: [structuredClone(model)] } };
}
export const request = (extra: Partial<GenerateOptions> = {}): GenerateOptions => ({
  provider: 'remote-magpie', model: MODEL, reasoningEffort: ReasoningEffortId('high'),
  messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }], ...extra,
});
export async function collect(stream: AsyncIterable<StreamChunk>) {
  const result: StreamChunk[] = []; for await (const chunk of stream) result.push(chunk); return result;
}
export interface WireRequest { url: string; headers: Headers; body: Record<string, any> }
export function fakeTransport(reply?: (request: WireRequest) => Response | Promise<Response>) {
  const calls: WireRequest[] = [];
  const fetch: FetchFunction = async (input, init) => {
    const req = new Request(input, init);
    const call: WireRequest = { url: req.url, headers: req.headers, body: req.method === 'GET' ? {} : await req.json() };
    calls.push(call);
    return reply ? reply(call) : chatReply();
  };
  return { fetch, calls };
}
export function sse(events: unknown[]) {
  return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
}
export function chatReply(tool = false) {
  const frame = (delta: unknown, finish_reason: string | null, usage?: unknown) => ({ id: 'chat-test', object: 'chat.completion.chunk', created: 1, model: MODEL, choices: [{ index: 0, delta, finish_reason }], ...(usage ? { usage } : {}) });
  return sse([
    frame(tool ? { role: 'assistant', tool_calls: [{ index: 0, id: 'call_test', type: 'function', function: { name: 'lookup', arguments: '{"q":' } }] } : { role: 'assistant', content: 'hello' }, null),
    frame(tool ? { tool_calls: [{ index: 0, function: { arguments: '"value"}' } }] } : {}, tool ? 'tool_calls' : 'stop', { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 }),
  ]);
}
export function responsesReply() {
  const message = { id: 'msg_test', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'hello', annotations: [] }] };
  return sse([
    { type: 'response.created', response: { id: 'resp_test', model: MODEL, status: 'in_progress', output: [] } },
    { type: 'response.output_item.added', output_index: 0, item: { ...message, status: 'in_progress', content: [] } },
    { type: 'response.content_part.added', output_index: 0, content_index: 0, item_id: message.id, part: { type: 'output_text', text: '', annotations: [] } },
    { type: 'response.output_text.delta', output_index: 0, content_index: 0, item_id: message.id, delta: 'hello' },
    { type: 'response.output_text.done', output_index: 0, content_index: 0, item_id: message.id, text: 'hello' },
    { type: 'response.output_item.done', output_index: 0, item: message },
    { type: 'response.completed', response: { id: 'resp_test', model: MODEL, status: 'completed', output: [message], service_tier: 'priority', usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } } },
  ]);
}
