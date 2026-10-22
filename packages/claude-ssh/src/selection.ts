/** Native menu choices are durable events; cold resumes must not use a global default over them. */
export interface Selection { provider: string; model: string }
export interface SelectionAgent {
  session: {
    snapshotEvents?(): readonly { type: string; data?: unknown }[];
    requestHeader?(): { config: Selection } | undefined;
  };
  options?: { provider?: string; model?: string };
}
export function selectionFor(agent: SelectionAgent): Selection | undefined {
  const event = agent.session.snapshotEvents?.().findLast(e => e.type === 'model/selection');
  const data = event?.data as Partial<Selection> | undefined;
  if (typeof data?.provider === 'string' && typeof data.model === 'string') return { provider: data.provider, model: data.model };
  const config = agent.session.requestHeader?.()?.config;
  if (config) return { provider: config.provider, model: config.model };
  if (agent.options?.provider && agent.options.model) return { provider: agent.options.provider, model: agent.options.model };
  return undefined;
}
