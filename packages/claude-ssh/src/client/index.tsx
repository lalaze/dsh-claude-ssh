import React, { useEffect, useState } from 'react';
import type { Host, StateView, Workspace } from '../domain.js';
import type { SshAliases } from '../ssh-config.js';
import { hostFromAlias } from './host-draft.js';
import { loadSshAliases, aliasPlaceholder } from './ssh-aliases.js';
import { Select } from './select.js';
import { PLUGIN_VERSION } from '../version.js';

// Narrow views of public 0.2.1-rc.2 client faces; source locations are documented in docs/interfaces.md.
type Props = { sessionId?: string; matched?: { sessionId: string }; close?: () => void; useProjection?: (key: string, select: (v: any) => any) => any; useSession?: (select: (v: any) => any) => any };
interface Client {
  slots: { inject(name: string, factory: () => unknown): unknown; register(spec: Record<string, unknown>, component: React.FC<Props>): unknown };
  uiWorkspace: { openSession(id: string): void };
  conversation: { blocks: { set(id: string, block: { reason: string } | undefined): void; storeFor(id: string): { getSnapshot(): { reason: string } | undefined } } };
  effect(effect: () => (() => void) | void): void;
}
const URL_PATH = '/api/claude-ssh';
let cached: StateView | undefined;
async function api<T>(body?: unknown): Promise<T> {
  const r = await fetch(URL_PATH, body === undefined ? { cache: 'no-store', credentials: 'same-origin' } : { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await r.json();
  if (!r.ok || data.ok === false) throw new Error(data.error?.message ?? `请求失败 ${r.status}`);
  if (body === undefined) cached = data;
  else { try { await api<StateView>(); } catch {} window.dispatchEvent(new Event('claude-ssh-updated')); }
  return body === undefined ? data : data.value;
}
function useStateData(): { data?: StateView; error?: string } {
  const [state, setState] = useState<{ data?: StateView; error?: string }>({});
  useEffect(() => {
    let live = true; let pending = false;
    const read = async () => { if (pending) return; pending = true; try { const data = await api<StateView>(); if (live) setState({ data }); } catch (e) { if (live) setState(old => ({ ...old, error: String(e) })); } finally { pending = false; } };
    void read(); const timer = setInterval(read, 2500);
    window.addEventListener('claude-ssh-updated', read);
    return () => { live = false; clearInterval(timer); window.removeEventListener('claude-ssh-updated', read); };
  }, []);
  return state;
}
const style: React.CSSProperties = { display: 'grid', gap: 12, padding: 16, lineHeight: 1.6 };
const card: React.CSSProperties = { border: '1px solid #8886', borderRadius: 10, padding: 14, display: 'grid', gap: 8 };
const field: React.CSSProperties = { boxSizing: 'border-box', padding: '7px 10px', border: '1px solid #8888', borderRadius: 6, background: 'transparent', color: 'inherit', minWidth: 0 };
const button: React.CSSProperties = { ...field, cursor: 'pointer' };
const identity = (h: Host | undefined, w: { user: string; path: string }) => `${h?.name ?? '主机已删除'} (${h?.destination ?? '不可用'}) / ${w.user} / ${w.path}`;
const stateName = { ready: '就绪', running: '运行中', completed: '已完成', cancelled: '已取消，需检查后恢复', interrupted: '已中断，远端结果未知' };
export const name = 'dsh-claude-ssh-client';
export const inject = ['slots', 'conversation', 'uiWorkspace'];
export async function apply(ctx: Client): Promise<void> {
  try { await api<StateView>(); } catch { /* Settings still renders a reconnect error. */ }
  const Settings: React.FC<Props> = ({ close }) => {
    const { data, error } = useStateData();
    const [host, setHost] = useState<Host>({ id: '', name: '', destination: '' });
    const [aliases, setAliases] = useState<SshAliases>(); const [aliasError, setAliasError] = useState(''); const [loadingAliases, setLoadingAliases] = useState(false);
    const loadAliases = async () => {
      setLoadingAliases(true); setAliasError('');
      try { setAliases(await loadSshAliases(api)); }
      catch (e) { setAliasError(e instanceof Error ? e.message : String(e)); }
      finally { setLoadingAliases(false); }
    };
    useEffect(() => { void loadAliases(); }, []);
    const [selected, setSelected] = useState(''); const [path, setPath] = useState('/');
    const [listing, setListing] = useState<{ path: string; user: string; names: string[] }>();
    const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false); const [model, setModel] = useState('sonnet');
    const editHost = (draft: Host) => { setHost(draft); setSelected(''); setListing(undefined); setMessage(''); };
    const act = async (operation: () => Promise<unknown>) => { setBusy(true); setMessage(''); try { await operation(); } catch (e) { setMessage(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } };
    const browse = (p: string) => act(async () => { const d = await api<{ path: string; user: string; names: string[] }>({ action: 'browse', hostId: selected, path: p }); setListing(d); setPath(d.path); });
    const open = (sessionId: string) => { ctx.uiWorkspace.openSession(sessionId); close?.(); };
    return <section style={style} aria-label="Claude SSH">
      <h2 style={{ margin: 0 }}>Claude SSH</h2>
      <p>Claude Code 在远端运行。本机仅转发文本、展示事件与权限确认。请先选择远程工作区，再创建会话。</p>
      {(error || message) && <div role="status" style={{ whiteSpace: 'pre-wrap', color: 'var(--color-text-primary, inherit)' }}>{message || error}</div>}
      <fieldset disabled={busy} style={card}><legend>SSH 主机</legend>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{data?.hosts.map(h => <button key={h.id} style={button} onClick={() => { setSelected(h.id); setHost(h); setListing(undefined); setMessage(''); }}>{h.name} / {h.destination}</button>)}</div>
        <label>从本机 SSH 配置选择<Select aria-label="从本机 SSH 配置选择" style={{ width: '100%' }} searchable kind="ssh" disabled={loadingAliases || !aliases?.aliases.length || Boolean(aliasError)} value={aliases?.aliases.includes(host.destination) ? host.destination : ''} placeholder={aliasPlaceholder(loadingAliases, aliases, aliasError)} options={aliasError ? [] : aliases?.aliases.map(alias => ({ value: alias, label: alias })) ?? []} onValueChange={alias => editHost(hostFromAlias(host, alias))} /></label>
        <div><button style={button} disabled={loadingAliases} onClick={() => void loadAliases()}>刷新 SSH 列表</button></div>
        <small>读取运行 DSH 的本机用户 ~/.ssh/config、Include 和系统 SSH 配置。选择后仍需保存、测试；用户、端口、密钥与跳板机由 OpenSSH 解析。不会列出通配规则或读取私钥。条件 Include 中的条目为候选，最终由 OpenSSH 解析。</small>
        {aliasError && <div role="alert">SSH 列表读取失败：{aliasError}；仍可手动填写。</div>}
        <small>界面 {PLUGIN_VERSION} / 后端 {data?.plugin?.version ?? '未提供版本（旧版或尚未连接）'}{(aliases?.configPath ?? data?.plugin?.sshConfigPath) && <> · 配置文件：{aliases?.configPath ?? data?.plugin?.sshConfigPath}</>}</small>
        {aliases?.warnings.map(w => <div role="status" key={w}>{w}</div>)}
        <label>稳定标识（编辑时保持不变）<input style={{ ...field, width: '100%' }} value={host.id} onChange={e => editHost({ ...host, id: e.target.value })} placeholder="dev-mac" /></label>
        <label>显示名称<input style={{ ...field, width: '100%' }} value={host.name} onChange={e => editHost({ ...host, name: e.target.value })} /></label>
        <label>SSH 目标<input style={{ ...field, width: '100%' }} value={host.destination} onChange={e => editHost({ ...host, destination: e.target.value })} placeholder="user@host 或 ~/.ssh/config 别名" /></label>
        <label>端口（留空沿用 SSH config）<input style={field} type="number" value={host.port ?? ''} onChange={e => editHost({ ...host, port: e.target.value ? Number(e.target.value) : undefined })} /></label>
        <label>Claude 绝对路径（可选）<input style={{ ...field, width: '100%' }} value={host.claudePath ?? ''} onChange={e => editHost({ ...host, claudePath: e.target.value || undefined })} placeholder="/home/user/.local/bin/claude" /></label>
        <small>沿用系统密钥、Agent、known_hosts 与 ProxyJump。端点或 Claude 路径改变会使旧绑定失效，须重新验证工作区。</small>
        <div><button style={button} onClick={() => act(async () => { await api({ action: 'saveHost', host }); setSelected(host.id); setMessage('主机已保存。'); })}>保存主机</button>{' '}
          <button style={button} onClick={() => editHost({ id: '', name: '', destination: '' })}>新增</button>{' '}
          <button style={button} disabled={!selected} onClick={() => act(async () => { const p = await api<{ user: string; path: string; version: string }>({ action: 'probe', hostId: selected }); setMessage(`SSH 连接成功 / 用户 ${p.user}\n${p.path}\n${p.version}\n远端登录状态：已登录（未调用模型）`); })}>测试连接与 Claude</button>{' '}
          <button style={button} disabled={!selected} onClick={() => { if (window.confirm('删除主机及其工作区？历史会话将停止可用，不删除远端数据。')) void act(async () => { await api({ action: 'deleteHost', hostId: selected }); setSelected(''); setHost({ id: '', name: '', destination: '' }); }); }}>删除主机</button></div>
      </fieldset>
      <fieldset disabled={busy || !selected} style={card}><legend>远程工作区 · {data?.hosts.find(h => h.id === selected)?.destination ?? '先选择主机'}</legend>
        <label>远端绝对目录<input style={{ ...field, width: '100%' }} value={path} onChange={e => { setPath(e.target.value); setListing(undefined); }} /></label>
        <div><button style={button} onClick={() => browse(path)}>浏览 / 验证目录</button>{' '}<button style={button} onClick={() => act(async () => { const w = await api<Workspace>({ action: 'createWorkspace', hostId: selected, path }); setMessage(`工作区已验证：${w.user} / ${w.path}`); })}>保存远程工作区</button></div>
        {listing && <div style={{ maxHeight: 240, overflow: 'auto' }}><div>{listing.user} / {listing.path}</div><button style={button} onClick={() => browse(listing.path.replace(/\/[^/]+\/?$/, '') || '/')}>上级目录</button>{listing.names.length === 0 && <p>空目录（可以作为工作区）</p>}{listing.names.map(n => <div key={n}><button style={button} onClick={() => browse(`${listing.path === '/' ? '' : listing.path}/${n}`)}>{n}</button></div>)}</div>}
      </fieldset>
      <div style={card}><strong>已保存的远程工作区</strong><label>模型 <Select aria-label="工作区模型" value={model} onValueChange={setModel} options={['sonnet', 'opus', 'haiku'].map(m => ({ value: m, label: m }))} /></label>
        {data?.workspaces.map(w => <div key={w.id} style={{ overflowWrap: 'anywhere' }}><div>{identity(data.hosts.find(h => h.id === w.hostId), w)}</div><button style={button} disabled={busy} onClick={() => act(async () => { const r = await api<{ sessionId: string }>({ action: 'createSession', workspaceId: w.id, model }); open(r.sessionId); })}>创建远程会话</button>{' '}<button style={button} disabled={busy} onClick={() => { if (window.confirm('删除此工作区注册？绑定它的历史会话将停止可用。')) void act(() => api({ action: 'deleteWorkspace', workspaceId: w.id })); }}>删除注册</button></div>)}
      </div>
      <div style={card}><strong>远程会话</strong>{data && Object.values(data.bindings).map(b => <div key={b.sessionId}><div style={{ overflowWrap: 'anywhere' }}>{identity(data.hosts.find(h => h.id === b.hostId), b)}</div><small>{stateName[b.state]} · Claude {b.claudeSessionId}</small><div><button style={button} onClick={() => open(b.sessionId)}>打开会话</button></div></div>)}</div>
      <p>文件面板与终端限制：DSH 内置面板面向本机，不提供此工作区的远端浏览和终端。插件不映射本地项目；远端文件请由 Claude 工具处理。不要把其他已打开的本地文件页当作远端结果。</p>
    </section>;
  };
  const Dock: React.FC<Props> = props => {
    const { data, error } = useStateData();
    const selection = props.useProjection?.('modelSelection', v => v?.next ?? v?.lastUsed);
    const sessionId = props.sessionId;
    const b = data && sessionId ? data.bindings[sessionId] : undefined;
    const h = data?.hosts.find(h => h.id === b?.hostId);
    const remote = Boolean(b || selection?.provider?.startsWith('claude-ssh-'));
    let reason: string | undefined;
    if (remote) {
      if (error || !data) reason = 'Claude SSH：无法读取远程绑定，请重连后再试。';
      else if (!b) reason = 'Claude SSH：此会话未绑定远程工作区，请在设置中创建远程会话。';
      else if (data.routeErrors?.[b.sessionId]) reason = `Claude SSH：${data.routeErrors[b.sessionId]}`;
      else if (!h || !data?.workspaces.some(w => w.id === b.workspaceId)) reason = 'Claude SSH：主机或工作区已删除。';
      else if (selection?.provider !== `claude-ssh-${b.hostId}`) reason = 'Claude SSH：所选模型与工作区主机不匹配。';
      else if (b.state === 'interrupted' || b.state === 'cancelled') reason = 'Claude SSH：任务状态未知，请检查远端后明确恢复。';
    }
    useEffect(() => {
      if (!sessionId || !remote || !reason) return;
      const blocks = ctx.conversation.blocks; const block = { reason };
      const previous = blocks.storeFor(sessionId).getSnapshot();
      if (previous) return; // Preserve a block owned by another feature.
      blocks.set(sessionId, block);
      return () => { if (blocks.storeFor(sessionId).getSnapshot() === block) blocks.set(sessionId, undefined); };
    }, [sessionId, remote, reason]);
    const [recoverError, setRecoverError] = useState('');
    if (!remote) return null;
    return <aside style={{ ...card, padding: 10 }} aria-label="Claude SSH 远程绑定"><strong style={{ overflowWrap: 'anywhere' }}>Claude SSH · {b ? identity(h, b) : '尚未绑定远程工作区'}</strong>
      {b && <small>{stateName[b.state]} · 远端 Claude session {b.claudeSessionId}</small>}
      {reason && <div role="alert">{reason}</div>}
      {b?.lastError && <div role="status">{b.lastError}</div>}
      {b && ['cancelled', 'interrupted'].includes(b.state) && <button style={button} onClick={async () => {
        if (!window.confirm('SSH 断线或取消后，远端进程是否停止需要人工核实。确认已检查远端任务，继续同一 Claude session？此操作不会重发上次消息。')) return;
        try { await api({ action: 'recover', sessionId, confirm: true }); setRecoverError(''); } catch (e) { setRecoverError(String(e)); }
      }}>已检查远端，允许继续会话</button>}
      {recoverError && <div role="alert">{recoverError}</div>}
      <small>执行目录固定为上述远端路径。内置文件 / 终端面板是本地功能，不代表远端文件。</small>
    </aside>;
  };
  const RemoteComposer: React.FC<Props> = props => {
    const { data, error } = useStateData();
    const sessionId = props.sessionId ?? props.matched?.sessionId;
    const b = data && sessionId ? data.bindings[sessionId] : undefined;
    const selection = props.useProjection?.('modelSelection', v => v?.next ?? v?.lastUsed);
    const running = props.useSession?.(s => s?.running === true) || b?.state === 'running';
    const [draft, setDraft] = useState(''); const [message, setMessage] = useState(''); const [submitting, setSubmitting] = useState(false);
    const blocked = !b || Boolean(error || data?.routeErrors?.[sessionId ?? '']) || selection?.provider !== `claude-ssh-${b?.hostId}` || ['interrupted', 'cancelled'].includes(b?.state ?? '');
    const send = async () => {
      if (blocked || running || submitting || !draft.trim()) return;
      setSubmitting(true); setMessage('');
      try { await api({ action: 'submit', sessionId, prompt: draft }); setDraft(''); }
      catch (e) { setMessage(`${String(e)}。如连接中断，提交状态可能未知，请先检查会话，勿重复发送。`); }
      finally { setSubmitting(false); }
    };
    return <div style={{ display: 'grid', gap: 8, padding: 12, maxWidth: 900, width: '100%', boxSizing: 'border-box', margin: '0 auto' }}><Dock {...props} sessionId={sessionId} />
      <textarea aria-label="Claude SSH 远端消息" rows={3} maxLength={50000} style={{ ...field, width: '100%', resize: 'vertical' }} placeholder="发送文本到此远程工作区（不上传本地文件）" value={draft} disabled={blocked || running || submitting} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(); } }} />
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><label>Claude SSH 模型 <Select aria-label="Claude SSH 模型" value={b?.model ?? selection?.model ?? 'sonnet'} disabled={blocked || running || submitting} options={['sonnet', 'opus', 'haiku'].map(m => ({ value: m, label: m }))} onValueChange={async model => { try { await api({ action: 'selectModel', sessionId, model }); } catch (e) { setMessage(String(e)); } }} /></label>
        <button style={button} disabled={blocked || running || submitting || !draft.trim()} onClick={() => void send()}>发送到远端</button>
        <button style={button} disabled={!running} onClick={async () => { try { await api({ action: 'cancel', sessionId }); } catch (e) { setMessage(String(e)); } }}>停止远端任务</button>
      </div>{message && <div role="alert">{message}</div>}
    </div>;
  };
  ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'claude-ssh', order: 65, label: () => 'Claude SSH' }, Settings));
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({ name: 'conversation.input.dock', id: 'claude-ssh-binding', order: -100 }, Dock));
  ctx.slots.inject('conversation.composer', () => ctx.slots.register({ name: 'conversation.composer', id: 'claude-ssh-composer', priority: 100,
    select: ({ sessionId, pendingInteraction }: { sessionId?: string; pendingInteraction?: unknown }) => sessionId && cached?.bindings[sessionId] && !pendingInteraction ? { sessionId } : null
  }, RemoteComposer));
}
