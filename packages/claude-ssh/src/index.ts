import type { Context } from '@deepseek-ai/cordis';
import Schema from '@deepseek-ai/schemastery';
import type {} from '@deepseek-ai/dsh-client-connection';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { SessionId } from '@deepseek-ai/dsh-session';
import { Store } from './store.js';
import { Ssh } from './ssh.js';
import { discoverSshAliases } from './ssh-config.js';
import { PLUGIN_VERSION } from './version.js';
import { ClaudeSshAdapter } from './adapter.js';
import { NativeClaudeAdapter } from './native.js';
import { selectionFor, type Selection } from './selection.js';
import { Manager } from './manager.js';
import { NATIVE_PROVIDER, providerFor, route, SshClaudeError } from './domain.js';

export const name = 'dsh-claude-ssh';
export const inject = ['llm', 'sessions', 'agents', 'approval', 'userQuestions', 'sessionController', 'connection', 'systemPrompt', 'workingDirectory', 'subprocess'];
const defaultStateDir = () => join(process.env.DSH_HOME?.trim() || join(homedir(), '.dsh'), 'storages', 'dsh-claude-ssh');
export const Config = Schema.object({ stateDir: Schema.string().default(defaultStateDir()) });
export async function apply(ctx: Context, config: { stateDir?: string } = {}): Promise<void> {
  const store = new Store(join(config.stateDir ?? defaultStateDir(), 'state.json'));
  await store.load();
  const ssh = new Ssh(); const adapter = new ClaudeSshAdapter(ctx, store, ssh);
  const native = new NativeClaudeAdapter(ctx, store, ssh);
  const nativeRegistration = ctx.llm.registerAdapter([NATIVE_PROVIDER], native);
  const stepSelections = new WeakMap<object, Selection>();
  const registrations = new Map<string, { signature: string; dispose: () => void }>();
  const refresh = () => {
    const hosts = store.snapshot().hosts;
    for (const [id, registration] of registrations) if (!hosts.some(h => h.id === id)) { registration.dispose(); registrations.delete(id); }
    for (const host of hosts) {
      const signature = JSON.stringify(host); const previous = registrations.get(host.id);
      if (previous?.signature === signature) continue;
      previous?.dispose();
      registrations.set(host.id, { signature, dispose: ctx.llm.registerAdapter([providerFor(host.id)], adapter) });
    }
  };
  refresh();
  ctx.effect(() => () => { adapter.cancelAll(); native.cancelAll(); nativeRegistration(); for (const r of registrations.values()) r.dispose(); });
  // Remote Claude owns instructions, hooks, tools and the loop. These supported waterfalls
  // short-circuit LOCAL instruction/directory preparation for this binding only.
  ctx.on('agent/pre-step', async ({ agent, messages }, next) => {
    const selected = selectionFor(agent);
    if (selected?.provider === NATIVE_PROVIDER) {
      stepSelections.set(agent, selected);
      return { kind: 'enter', messages };
    }
    stepSelections.delete(agent);
    if (!store.snapshot().bindings[agent.session.id]) return next();
    return { kind: 'enter', messages };
  }, { prepend: true, global: true });
  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    if (context.agent && selectionFor(context.agent)?.provider === NATIVE_PROVIDER) return { sections: [], contexts: [], tools: [], variables: {} };
    if (!context.agent || !store.snapshot().bindings[context.agent.session.id]) return next();
    return { sections: [], contexts: [], tools: [], variables: {} };
  }, { prepend: true, global: true });
  // All remote-bound requests must remain on their exact host. Local sessions pass through.
  ctx.on('agent/request', async ({ agent }, next) => {
    const call = await next();
    const selectedNative = stepSelections.get(agent);
    if (selectedNative) return { ...call, ...selectedNative, reasoningEffort: undefined };
    const binding = store.snapshot().bindings[agent.session.id];
    if (binding && agent.session.header.cwd !== binding.routingCwd) throw new SshClaudeError('BINDING_CHANGED', '会话隔离地址变化，拒绝在其他执行环境运行。');
    if (binding) {
      // Cold API resume seeds AgentOptions from DSH's GLOBAL default. Its model selection
      // capture runs in local prompt preparation, which remote sessions intentionally skip.
      // Read durable explicit selection to reject cross-host choices, then restore this binding.
      const selected = agent.session.snapshotEvents().findLast(e => e.type === 'model/selection');
      const selectedProvider = selected?.type === 'model/selection' ? selected.data.provider : call.provider;
      route(store.snapshot(), agent.session.id, selectedProvider);
      return { ...call, provider: providerFor(binding.hostId), model: binding.model ?? (selected?.type === 'model/selection' ? selected.data.model : call.model) };
    }
    if (call.provider.startsWith('claude-ssh-')) route(store.snapshot(), agent.session.id, call.provider);
    return call;
  }, { global: true, prepend: true });
  const manager = new Manager(ctx, store, ssh, adapter, refresh, id => native.active.has(id));
  const text = (v: unknown): string => { if (typeof v !== 'string' || v.length > 65536) throw new SshClaudeError('BAD_REQUEST', '参数格式无效。'); return v; };
  // Connection handles DSH authentication, Host/Origin checks, owner access, and native carriers.
  ctx.connection.fetch.register({ path: '/api/claude-ssh', methods: ['GET', 'POST'], requestBody: 'buffered', fetch: async request => {
    try {
      if (request.method === 'GET') {
        const state = store.snapshot(); const routeErrors: Record<string, string> = {};
        for (const b of Object.values(state.bindings)) {
          try { route(state, b.sessionId, providerFor(b.hostId)); } catch (e) { routeErrors[b.sessionId] = e instanceof Error ? e.message : '绑定无效'; }
        }
        return Response.json({ ...state, routeErrors, plugin: { version: PLUGIN_VERSION, capabilities: ['sshAliases', 'nativeWorkspaceModels'], sshConfigPath: join(homedir(), '.ssh', 'config') } }, { headers: { 'Cache-Control': 'no-store' } });
      }
      const raw = await request.text(); if (Buffer.byteLength(raw) > 256 * 1024) throw new Error('请求过大');
      const b = JSON.parse(raw); let value: unknown;
      switch (b.action) {
        case 'workspaceEligibility': value = await native.eligibility(text(b.sessionId), request.signal); break;
        case 'recoverNative': if (b.confirm !== true) throw new Error('请先确认已检查远端任务状态'); await native.recover(text(b.sessionId)); break;
        case 'sshAliases': value = { ...await discoverSshAliases(), configPath: join(homedir(), '.ssh', 'config') }; break;
        case 'saveHost': value = await manager.saveHost(b.host); break;
        case 'deleteHost': await manager.deleteHost(text(b.hostId)); break;
        case 'probe': value = await ssh.probe(manager.host(text(b.hostId)), request.signal); break;
        case 'browse': value = await ssh.directory(manager.host(text(b.hostId)), text(b.path), request.signal); break;
        case 'createWorkspace': value = await manager.createWorkspace(text(b.hostId), text(b.path), request.signal); break;
        case 'deleteWorkspace': await store.update(s => { s.workspaces = s.workspaces.filter(w => w.id !== text(b.workspaceId)); }); break;
        case 'createSession': value = { sessionId: await manager.createSession(text(b.workspaceId), text(b.model)) }; break;
        case 'submit': await manager.submit(text(b.sessionId), text(b.prompt), request.signal); break;
        case 'selectModel': await manager.selectModel(text(b.sessionId), text(b.model)); break;
        case 'cancel': {
          const id = text(b.sessionId); const binding = store.snapshot().bindings[id];
          route(store.snapshot(), id, providerFor(binding?.hostId ?? ''));
          // Public Controller cancellation owns inbox clearing and Agent cancellation.
          value = ctx.sessionController.cancel({ sessionId: SessionId(id) }); break;
        }
        case 'recover': if (b.confirm !== true) throw new Error('请先确认已检查远端任务状态'); await manager.recover(text(b.sessionId)); break;
        default: throw new SshClaudeError('BAD_REQUEST', '未知操作');
      }
      return Response.json({ ok: true, value: value ?? null });
    } catch (error) {
      return Response.json({ ok: false, error: { code: error instanceof SshClaudeError ? error.code : 'CLAUDE_SSH_ERROR', message: error instanceof Error ? error.message : '操作失败' } }, { status: 400 });
    }
  } });
}
