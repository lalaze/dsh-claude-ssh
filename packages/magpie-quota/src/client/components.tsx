import React, { useEffect, useState } from 'react';
import { accountLabel, type AccountQuota, type GatewayQuota, type QuotaWindow } from '../types.js';
import { ProviderIcon, RefreshIcon } from './icons.js';
import { QuotaQuery, refreshKey, useQuota } from './query.js';
import { styles } from './styles.js';

export const tone = (remaining: number | null): string => remaining !== null && remaining <= 10 ? 'danger' : remaining !== null && remaining <= 25 ? 'warning' : 'normal';
const time = (at: string) => new Date(at).toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
export function resetLabel(at: string | undefined, now: number): string {
  if (!at) return '未提供重置时间';
  const seconds = Math.ceil((Date.parse(at) - now) / 1000);
  if (seconds <= 0) return '已到重置时间，等待读取';
  const minutes = Math.ceil(seconds / 60);
  return `${minutes >= 1440 ? `${Math.floor(minutes / 1440)} 天 ${Math.floor(minutes % 1440 / 60)} 小时` : minutes >= 60 ? `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟` : `${minutes} 分钟`}后重置`;
}
export function useClock(): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  return now;
}
const windowName = (name: string) => ({ '5 hours': '5 小时', '7 days': '7 天', '1 day': '1 天', Credits: '积分', Month: '本月' })[name] || name;
function Meter({ window: w, now }: { window: QuotaWindow; now: number }) {
  const value = w.unlimited ? '∞' : w.remaining === null ? '—' : `${Number(w.remaining.toFixed(1))}%`;
  const amount = w.limit !== undefined && w.amount !== undefined && w.unit ? `剩余 ${Math.max(0, w.limit - w.amount).toLocaleString(undefined, { maximumFractionDigits: 2 })} / ${w.limit.toLocaleString()} ${w.unit}` : w.display;
  return <div className="mq-meter">
    <div className="mq-meter-top"><span className="mq-meter-name">{windowName(w.name)}{w.pool ? ` · ${w.pool}` : ''}</span><span className="mq-number" data-tone={tone(w.remaining)}>{value}</span></div>
    {!w.unlimited && w.remaining !== null && <div className="mq-track" role="progressbar" aria-label={`${windowName(w.name)}剩余额度`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={w.remaining}><span className="mq-fill" data-tone={tone(w.remaining)} style={{ width: `${w.remaining}%` }} /></div>}
    <div className="mq-meter-bottom"><span>{amount || (w.unlimited ? '不限额' : w.remaining === null ? '暂无读数' : '剩余额度')}</span><span title={w.resetsAt ? time(w.resetsAt) : undefined}>{!w.unlimited && resetLabel(w.resetsAt, now)}</span></div>
  </div>;
}
export function AccountCard({ gateway, account, query, now }: { gateway: GatewayQuota; account: AccountQuota; query: QuotaQuery; now: number }) {
  const state = useQuota(query);
  const key = refreshKey(gateway.id, account.id);
  const seconds = Math.max(0, Math.ceil(((state.cooldowns[key] ?? 0) - now) / 1000));
  const busy = state.refreshing === key;
  const readAt = account.readAt || account.asOf;
  const old = gateway.stale || !!account.asOf || !!account.readDeferred || !!account.error;
  return <>
    <div className="mq-account-head"><span className="mq-provider-mark"><ProviderIcon provider={account.provider} size={20} /></span><div className="mq-account-label"><div className="mq-account-title">{account.name}<span className="mq-tag">{account.plan || (account.kind === 'balance' ? '余额' : '账号')}</span>{account.last && <span className="mq-last" title="最近服务过请求" />}</div><div className="mq-caption">{accountLabel(account)}{account.alias && account.user ? ` · ${account.user}` : ''}</div></div></div>
    {account.error && <div className="mq-notice" role="status">{account.error}</div>}
    {account.balance && <div className="mq-balance">{account.balance}<span className="mq-caption"> 余额</span></div>}
    {account.windows.map(w => <Meter key={w.id} window={w} now={now} />)}
    {!account.windows.length && !account.balance && <div className="mq-empty">{account.error ? '暂无可用的额度读数' : 'Magpie 尚未提供此账号的额度'}</div>}
    {account.until && <div className="mq-caption" style={{ marginBottom: 12 }}>套餐{account.renew === 'auto' ? '续期' : account.renew === 'off' ? '到期' : '有效期至'} {time(account.until)}</div>}
    <div className="mq-panel-foot"><div className={`mq-caption${old ? ' mq-stale' : ''}`} title={readAt ? `额度读数时间：${time(readAt)}` : undefined}>{readAt ? `${old ? '上次读数' : '读数时间'} ${time(readAt)}` : '尚无读数时间'}{account.readDeferred && <div>本次未请求刷新</div>}</div>
      <button type="button" className="mq-button" aria-label={`刷新 ${accountLabel(account)} 的额度`} aria-busy={busy || undefined} disabled={!!state.refreshing || seconds > 0 || !account.refreshable} title={!account.refreshable ? '请在账号所属 Magpie 刷新' : '让 Magpie 重新读取此账号的额度'} onClick={() => void query.refresh(gateway.id, account.id)}><RefreshIcon />{busy ? '读取中…' : seconds ? `${seconds}s` : '刷新'}</button>
    </div>
  </>;
}
export function QuotaDashboard({ query }: { query: QuotaQuery }) {
  const state = useQuota(query); const now = useClock();
  return <section className="mq mq-page" aria-label="Magpie 额度"><style>{styles}</style>
    <header className="mq-page-head"><div><h2>Magpie 额度</h2><p>各账号的窗口剩余量与重置时间</p></div><button type="button" className="mq-button" onClick={() => void query.read(true)} disabled={state.loading || !!state.refreshing}><RefreshIcon />重新读取</button></header>
    {state.error && <div className="mq-notice" role="alert">{state.error}</div>}
    {state.loading && <div className="mq-empty" role="status">正在读取额度…</div>}
    {state.report?.gateways.map(gateway => <section key={gateway.id} className="mq-gateway" aria-label={gateway.name}><div className="mq-gateway-head"><ProviderIcon provider="magpie" />{gateway.name}<span>· {gateway.accounts.length} 个账号</span></div>
      {gateway.error && <div className="mq-notice" role="status">{gateway.error.message}{gateway.stale && '；以下保留上次读数。'}</div>}
      <div className="mq-grid">{gateway.accounts.map(account => <article className="mq-card" key={account.id} aria-label={`${account.name} ${accountLabel(account)}`}><AccountCard gateway={gateway} account={account} query={query} now={now} /></article>)}</div>
      {!gateway.accounts.length && !gateway.error && <div className="mq-empty">Magpie 尚未返回可见的账号额度。</div>}
    </section>)}
    {!state.loading && state.report?.gateways.length === 0 && <div className="mq-empty">未配置 Magpie。请添加 Magpie 提供商，或在插件配置中指定提供商 ID。</div>}
    <p className="mq-small">输入框下方的图标显示每个账号已知窗口中的最低剩余百分比。额度以 Magpie 返回的读数为准，页面自动同步；账号主动刷新间隔为 30 秒。</p>
  </section>;
}
