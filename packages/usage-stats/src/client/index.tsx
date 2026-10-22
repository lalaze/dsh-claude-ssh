import React, { useEffect, useState } from 'react';
import type { GroupBy, UsageReport, Totals } from '../domain.js';
import { compact, dateRange, trendBuckets } from './metrics.js';
import { styles } from './styles.js';

interface Client {
  slots: { inject(name: string, factory: () => unknown): unknown; register(spec: Record<string, unknown>, component: React.FC): unknown };
}
const number = (value: number) => value.toLocaleString('zh-CN');
const percent = (value: number, total: number) => total ? `${(value / total * 100).toFixed(1)}%` : '—';
const shortDate = (value: string) => value.slice(5).replace('-', '/');
function UsageMark() {
  return <svg width="28" height="28" viewBox="0 0 32 32" fill="none" aria-hidden="true">
    <circle cx="16" cy="16" r="12.5" stroke="currentColor" strokeOpacity=".14" strokeWidth="2.5" />
    <path d="M16 3.5a12.5 12.5 0 0 1 12.5 12.5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    <path d="M27.4 21.1a12.5 12.5 0 0 1-19.1 4.7" stroke="var(--us-purple)" strokeWidth="2.5" strokeLinecap="round" />
    <rect x="9" y="15" width="3" height="7" rx="1.5" fill="currentColor" fillOpacity=".55" />
    <rect x="14.5" y="10" width="3" height="12" rx="1.5" fill="currentColor" />
    <rect x="20" y="13" width="3" height="9" rx="1.5" fill="var(--us-purple)" />
  </svg>;
}
function Icon({ kind = 'chart' }: { kind?: 'chart' | 'download' | 'refresh' }) {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{kind === 'chart' ? <><path d="M4 19h16M7 15V9m5 6V5m5 10v-4" /></> : kind === 'download' ? <><path d="M12 3v12m-4-4 4 4 4-4M5 16v4h14v-4" /></> : <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6.2 6.2A8 8 0 0 1 20 12M4 12a8 8 0 0 0 13.8 5.8" /></>}</svg>;
}
function Trend({ data }: { data: UsageReport }) {
  const [metric, setMetric] = useState<'tokens' | 'requests'>('tokens');
  const [hovered, setHovered] = useState<number>();
  const buckets = trendBuckets(data.series ?? [], data.query.from, data.query.to);
  const max = Math.max(1, ...buckets.map(b => b[metric]));
  const selected = hovered === undefined ? undefined : buckets[hovered];
  const total = metric === 'tokens' ? data.totals.totalTokens : data.totals.requests;
  return <section className="us-panel" aria-label="用量趋势">
    <div className="us-panel-head"><div><h3>用量趋势</h3><p className="us-subtitle">{buckets.length && buckets[0].from !== buckets[0].to ? '按时间段汇总' : '每日用量'} · UTC</p></div><div className="us-segment" role="group" aria-label="趋势指标">{(['tokens', 'requests'] as const).map(value => <button key={value} aria-pressed={metric === value} onClick={() => { setMetric(value); setHovered(undefined); }}>{value === 'tokens' ? 'Token' : '调用次数'}</button>)}</div></div>
    {buckets.length ? <div className="us-chart">
      <div className="us-chart-readout" aria-live="polite"><span>{selected ? `${selected.from}${selected.to !== selected.from ? ` → ${selected.to}` : ''}` : '所选时段'}</span><span className="us-number">{number(selected ? selected[metric] : total)} {metric === 'tokens' ? 'Token' : '次调用'}</span></div>
      <div className="us-chart-body"><div className="us-y-axis" aria-hidden="true"><span>{compact(max)}</span><span>{compact(max / 2)}</span><span>0</span></div><div className="us-plot"><div className="us-grid" aria-hidden="true"><span /><span /><span /></div><div className="us-bars" role="group" aria-label="每日用量趋势">{buckets.map((b, i) => <button key={b.from} className="us-bar-hit" aria-label={`${b.from}${b.from !== b.to ? ` 至 ${b.to}` : ''}：${number(b[metric])} ${metric === 'tokens' ? 'Token' : '次调用'}`} aria-pressed={hovered === i} onMouseEnter={() => setHovered(i)} onMouseLeave={() => setHovered(undefined)} onFocus={() => setHovered(i)} onBlur={() => setHovered(undefined)} onClick={() => setHovered(i)}><span className="us-bar" style={{ height: `${b[metric] ? Math.max(1.5, b[metric] / max * 100) : 0}%` }} /></button>)}</div></div></div>
      <div className="us-x-axis" aria-hidden="true"><span>{shortDate(buckets[0].from)}</span>{buckets.length > 3 && <span>{shortDate(buckets[Math.floor(buckets.length / 2)].from)}</span>}<span>{shortDate(buckets.at(-1)!.to)}</span></div>
    </div> : <div className="us-empty"><Icon /><p>暂无趋势数据</p></div>}
    <div className="us-token-parts">{([['输入 · 未缓存', data.totals.inputTokens], ['输出 Token', data.totals.outputTokens], ['缓存读取', data.totals.cacheReadTokens], ['缓存写入', data.totals.cacheWriteTokens]] as const).map(([label, value]) => <div key={label}><span>{label}</span><b className="us-number" title={number(value)}>{compact(value)}</b></div>)}</div>
  </section>;
}
function Sources({ data }: { data: UsageReport }) {
  const total = data.totals.totalTokens;
  const dsh = data.sources?.find(s => s.key === 'dsh')?.totals.totalTokens ?? 0;
  const ssh = data.sources?.find(s => s.key === 'claude-ssh')?.totals.totalTokens ?? 0;
  const share = total ? dsh / total * 100 : 0;
  return <section className="us-panel" aria-label="来源占比"><div className="us-panel-head"><div><h3>来源占比</h3><p className="us-subtitle">按已返回的 Token 用量</p></div></div><div className="us-source-content"><div className="us-ring-wrap"><div className="us-ring" role="img" aria-label={`DSH ${number(dsh)} Token，Claude SSH ${number(ssh)} Token`}>
    <svg viewBox="0 0 140 140" aria-hidden="true"><circle cx="70" cy="70" r="61" fill="none" stroke="var(--us-line)" strokeWidth="12" />{total > 0 && <g transform="rotate(-90 70 70)"><circle cx="70" cy="70" r="61" pathLength="100" fill="none" stroke="var(--us-accent)" strokeWidth="12" strokeDasharray={`${share} ${100 - share}`} /><circle cx="70" cy="70" r="61" pathLength="100" fill="none" stroke="var(--us-purple)" strokeWidth="12" strokeDasharray={`${100 - share} ${share}`} strokeDashoffset={-share} /></g>}</svg>
    <div className="us-ring-center"><b className="us-number" title={number(total)}>{compact(total)}</b><span>Total Token</span></div>
    </div></div><div className="us-source-list">{([['DSH 模型调用', dsh, 'var(--us-accent)'], ['Claude SSH 远端', ssh, 'var(--us-purple)']] as const).map(([label, value, color]) => <div className="us-source-item" key={label}><div className="us-source-title"><span><i className="us-dot" style={{ background: color }} />{label}</span><b className="us-number">{percent(value, total)}</b></div><div className="us-track"><span style={{ width: `${total ? value / total * 100 : 0}%`, background: color }} /></div><div className="us-muted us-number" style={{ fontSize: 10 }}>{number(value)} Token</div></div>)}</div></div></section>;
}
function Metric({ label, value, detail, title }: { label: string; value: string; detail: string; title?: string }) {
  return <article className="us-metric" aria-label={label}><div className="us-metric-label">{label}</div><strong className="us-number" title={title}>{value}</strong><small>{detail}</small></article>;
}
function Status({ totals: t }: { totals: Totals }) {
  return t.errors || t.cancelled ? <span className="us-badge us-error">{t.errors ? `${number(t.errors)} 失败` : ''}{t.errors && t.cancelled ? ' · ' : ''}{t.cancelled ? `${number(t.cancelled)} 取消` : ''}</span> : <span className="us-badge">已完成</span>;
}
export function Dashboard() {
  const [groupBy, setGroupBy] = useState<GroupBy>('model');
  const [source, setSource] = useState(''); const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [period, setPeriod] = useState<'today' | '7d' | '30d' | 'all' | 'custom'>('all');
  const [provider, setProvider] = useState(''); const [model, setModel] = useState(''); const [sessionId, setSessionId] = useState('');
  const [data, setData] = useState<UsageReport>(); const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0); const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false); const [exportError, setExportError] = useState(''); const [page, setPage] = useState(0);
  const params = new URLSearchParams({ groupBy });
  for (const [key, value] of Object.entries({ source, from, to, provider, model, sessionId })) if (value) params.set(key, value);
  const path = `/api/usage-stats?${params}`;
  const exportCsv = async () => {
    setExporting(true); setExportError('');
    try {
      const response = await fetch(`${path}&format=csv`, { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) throw new Error(`导出失败 ${response.status}`);
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'dsh-usage.csv';
      document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { setExportError(e instanceof Error ? e.message : String(e)); }
    finally { setExporting(false); }
  };
  useEffect(() => {
    const controller = new AbortController(); let pending = false;
    setData(undefined); setPage(0); setLoading(true); setError('');
    const read = async () => {
      if (period !== 'custom') {
        const range = dateRange(period);
        if (from !== range.from || to !== range.to) {
          setFrom(range.from); setTo(range.to);
          return; // The updated path starts a fresh read and aborts the old one.
        }
      }
      if (pending) return;
      pending = true;
      try {
        const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || `请求失败 ${response.status}`);
        if (!controller.signal.aborted) { setData(body); setError(''); }
      } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e)); }
      finally { pending = false; if (!controller.signal.aborted) setLoading(false); }
    };
    void read(); const timer = setInterval(() => { if (!document.hidden) void read(); }, 5000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [path, refresh, period]);
  const choosePeriod = (value: 'today' | '7d' | '30d' | 'all') => { const range = dateRange(value); setPeriod(value); setFrom(range.from); setTo(range.to); };
  const reset = () => { setProvider(''); setModel(''); setSessionId(''); choosePeriod('all'); };
  const filterCount = [provider, model, sessionId].filter(Boolean).length;
  const select = (label: string, value: string, set: (value: string) => void, options: string[]) => <label className="us-field">{label}<select aria-label={label} value={value} onChange={e => set(e.target.value)}><option value="">全部{label}</option>{options.map(v => <option key={v} value={v}>{v}</option>)}</select></label>;
  const t = data?.totals;
  const lastPage = data ? Math.max(0, Math.ceil(data.groups.length / 10) - 1) : 0;
  const currentPage = Math.min(page, lastPage);
  return <section className="dsh-usage" aria-label="使用量统计"><style>{styles}</style>
    <header className="us-top"><div className="us-title"><span className="us-logo"><UsageMark /></span><div><h2>使用量统计</h2><p className="us-subtitle">DSH 与 Claude SSH 的模型调用用量</p></div></div><div className="us-actions"><span className="us-live"><i className="us-dot" />每 5 秒更新</span><button className="us-button" onClick={() => setRefresh(n => n + 1)} aria-label="刷新"><Icon kind="refresh" />刷新</button><button className="us-button us-primary" disabled={exporting} onClick={() => void exportCsv()}><Icon kind="download" />{exporting ? '正在导出…' : '导出 CSV'}</button></div></header>
    <nav className="us-tabs" aria-label="调用来源">{([['', '全部来源'], ['dsh', 'DSH 模型调用'], ['claude-ssh', 'Claude SSH 远端']] as const).map(([value, label]) => <button className="us-tab" key={value} aria-pressed={source === value} onClick={() => setSource(value)}>{value && <i className="us-dot" style={{ background: value === 'dsh' ? 'var(--us-accent)' : 'var(--us-purple)' }} />}{label}</button>)}</nav>
    <div className="us-toolbar"><div className="us-period"><div className="us-segment" role="group" aria-label="时间范围">{([['today', '今天'], ['7d', '近 7 天'], ['30d', '近 30 天'], ['all', '全部']] as const).map(([value, label]) => <button key={value} aria-pressed={period === value} onClick={() => choosePeriod(value)}>{label}</button>)}<button aria-pressed={period === 'custom'} onClick={() => setPeriod('custom')}>自定义</button></div><span className="us-muted" style={{ fontSize: 11 }}>{from || to ? `${from || '最早记录'} → ${to || '最新记录'}` : '全部记录'} · UTC</span></div>{(filterCount > 0 || period === 'custom') && <button className="us-button" onClick={reset}>重置筛选</button>}</div>
    {period === 'custom' && <div className="us-custom-dates"><label className="us-field">开始日期<input aria-label="开始日期" type="date" value={from} onChange={e => setFrom(e.target.value)} /></label><span className="us-muted">—</span><label className="us-field">结束日期<input aria-label="结束日期" type="date" value={to} onChange={e => setTo(e.target.value)} /></label></div>}
    <details className="us-filters"><summary>更多筛选{filterCount ? ` · 已应用 ${filterCount} 项` : ' · 服务商、模型、会话'}</summary><div className="us-filter-grid">{select('服务商', provider, setProvider, data?.filters.providers ?? (provider ? [provider] : []))}{select('模型', model, setModel, data?.filters.models ?? (model ? [model] : []))}<label className="us-field">会话 ID<input aria-label="会话 ID" value={sessionId} onChange={e => setSessionId(e.target.value)} placeholder="按完整会话 ID 筛选" /></label></div></details>
    {error && <div className="us-notice us-warning" role="alert">读取失败：{error}<button className="us-button" onClick={() => setRefresh(n => n + 1)}>重试</button></div>}
    {exportError && <div className="us-notice us-warning" role="alert">{exportError}</div>}
    {loading && <div className="us-loading" role="status">正在读取使用量…</div>}
    {data && t && <>
      {data.failedWrites > 0 && <div className="us-notice us-warning" role="alert">有 {number(data.failedWrites)} 条记录写入失败，统计可能不完整。请检查 DSH 日志和磁盘权限。</div>}
      <div className="us-summary"><Metric label="总 Token" value={compact(t.totalTokens)} title={number(t.totalTokens)} detail={`输入 ${compact(t.inputTokens)} / 输出 ${compact(t.outputTokens)}`} /><Metric label="调用次数" value={number(t.requests)} detail={`已返回用量 ${number(t.withUsage)}/${number(t.requests)}`} /><Metric label="缓存读取占比" value={t.withUsage ? percent(t.cacheReadTokens, t.inputTokens + t.cacheReadTokens + t.cacheWriteTokens) : '—'} detail={`缓存读取 ${compact(t.cacheReadTokens)} Token`} /><Metric label="调用完成率" value={percent(t.completed, t.requests)} detail={`失败 ${number(t.errors)} · 取消 ${number(t.cancelled)}`} /></div>
      {t.withUsage < t.requests && <div className="us-notice us-warning" role="status">{number(t.requests - t.withUsage)} 次调用未返回用量，Token 统计仅涵盖已返回的数据。</div>}
      <div className="us-charts"><Trend data={data} /><Sources data={data} /></div>
      <section className="us-panel" aria-label="用量明细"><div className="us-details-head"><div><h3>用量明细</h3><p className="us-subtitle">定位用量来自哪里</p></div><label className="us-actions"><span className="us-muted" style={{ fontSize: 11 }}>分组</span><select className="us-group-select" aria-label="分组方式" value={groupBy} onChange={e => setGroupBy(e.target.value as GroupBy)}>{([['model', '按模型'], ['day', '按日期'], ['source', '按来源'], ['session', '按会话']] as const).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label></div>
        {data.groups.length ? <><div className="us-scroll" tabIndex={0} aria-label="用量明细，可横向滚动"><table className="us-table"><thead><tr>{['model' === groupBy ? '模型 / 服务商' : groupBy === 'day' ? '日期 · UTC' : groupBy === 'source' ? '调用来源' : '会话', '调用次数', '输入', '输出', '缓存读 / 写', '总 Token', '状态'].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead><tbody>{data.groups.slice(currentPage * 10, (currentPage + 1) * 10).map(g => {
          const split = groupBy === 'model' ? g.label.indexOf(' / ') : -1;
          const name = split >= 0 ? g.label.slice(split + 3) : g.label; const sub = split >= 0 ? g.label.slice(0, split) : '';
          return <tr key={g.key}><th scope="row" title={g.label}><div className="us-table-main">{name}</div>{sub && <span className="us-table-sub">{sub}</span>}</th><td>{number(g.totals.requests)}<span className="us-table-sub" style={{ marginLeft: 'auto' }}>有用量 {g.totals.withUsage}/{g.totals.requests}</span></td><td title={`未缓存输入：${number(g.totals.inputTokens)}`}>{number(g.totals.inputTokens)}</td><td>{number(g.totals.outputTokens)}</td><td>{compact(g.totals.cacheReadTokens)} / {compact(g.totals.cacheWriteTokens)}</td><td className="us-total-cell">{number(g.totals.totalTokens)}<span className="us-table-sub">占 {percent(g.totals.totalTokens, t.totalTokens)}</span></td><td><Status totals={g.totals} /></td></tr>;
        })}</tbody></table></div><div className="us-pagination"><span>共 {number(data.groups.length)} 组 · 第 {currentPage + 1} / {lastPage + 1} 页</span><div className="us-actions"><button className="us-button" aria-label="上一页" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>←</button><button className="us-button" aria-label="下一页" disabled={currentPage === lastPage} onClick={() => setPage(currentPage + 1)}>→</button></div></div></> : <div className="us-empty" role="status"><Icon /><h3>暂无符合条件的记录</h3><p>完成一次模型或 Claude SSH 调用后，用量会显示在这里。</p></div>}
      </section>
      <footer className="us-foot"><span>更新于 {new Date(data.generatedAt).toLocaleTimeString()} · 数据保存在本地</span><details><summary>统计口径与范围</summary><p>日期按 UTC，以调用开始时间归属；输入不含缓存，缓存读取/写入单独统计。缓存读取占比 = 缓存读取 ÷（未缓存输入 + 缓存读取 + 缓存写入）。推理 Token {number(t.reasoningTokens)} 已包含在输出中。仅统计本 DSH 实例发起的调用（含标题生成、压缩）；Claude SSH 按远端每轮汇总一次，远端独立运行的 Claude Code 不在范围内。未返回的用量不作估算。最早记录：{data.recordedSince ? new Date(data.recordedSince).toLocaleString() : '暂无'}。</p></details></footer>
    </>}
  </section>;
}
export const name = 'dsh-usage-stats-client';
export const inject = ['slots'];
export function apply(ctx: Client): void {
  ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'usage-stats', order: 70, label: () => '使用量统计' }, Dashboard));
}
