import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { accountLabel, summary, type AccountQuota, type GatewayQuota } from '../types.js';
import { AccountCard, tone, useClock } from './components.js';
import { ProviderIcon, RefreshIcon } from './icons.js';
import { QuotaQuery, useQuota } from './query.js';
import { styles } from './styles.js';

export function QuotaStrip({ query }: { query: QuotaQuery }) {
  const state = useQuota(query);
  const [opened, setOpened] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>();
  const [position, setPosition] = useState({ left: 12, top: 12, maxHeight: 500 });
  const rows = state.report?.gateways.flatMap(gateway => gateway.accounts.map(account => ({ gateway, account, key: JSON.stringify([gateway.id, account.id]) }))) ?? [];
  const selected = rows.find(row => row.key === opened) ?? rows[0];
  const visible = opened !== null;
  const close = (restore = false) => { setOpened(null); if (restore) trigger.current?.focus(); };
  const open = (key: string, button: HTMLButtonElement) => { trigger.current = button; setOpened(opened === key ? null : key); };
  useLayoutEffect(() => {
    if (!visible) return;
    const place = () => {
      const anchor = trigger.current?.getBoundingClientRect() ?? root.current?.getBoundingClientRect();
      if (!anchor) return;
      const viewport = window.visualViewport;
      const height = viewport?.height ?? innerHeight; const offset = viewport?.offsetTop ?? 0;
      const width = Math.min(360, innerWidth - 24);
      const above = anchor.top - offset - 20; const below = height + offset - anchor.bottom - 20;
      const maxHeight = Math.max(80, Math.min(520, height - 24, Math.max(above, below)));
      const panelHeight = Math.min(panel.current?.scrollHeight ?? 350, maxHeight);
      const top = above >= panelHeight || above >= below ? anchor.top - panelHeight - 8 : anchor.bottom + 8;
      setPosition({ left: Math.max(12, Math.min(anchor.left, innerWidth - width - 12)), top: Math.max(offset + 12, Math.min(top, height + offset - panelHeight - 12)), maxHeight });
    };
    place();
    const observer = new ResizeObserver(place); if (panel.current) observer.observe(panel.current);
    window.addEventListener('resize', place); window.addEventListener('scroll', place, true); window.visualViewport?.addEventListener('resize', place);
    return () => { observer.disconnect(); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); window.visualViewport?.removeEventListener('resize', place); };
  }, [visible, opened]);
  useEffect(() => {
    if (!visible) return;
    panel.current?.focus();
    const pointer = (event: PointerEvent) => { if (!panel.current?.contains(event.target as Node) && !root.current?.contains(event.target as Node)) close(); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); } };
    const focus = (event: FocusEvent) => { if (!panel.current?.contains(event.target as Node) && !root.current?.contains(event.target as Node)) close(); };
    document.addEventListener('pointerdown', pointer); document.addEventListener('keydown', key, true); document.addEventListener('focusin', focus);
    return () => { document.removeEventListener('pointerdown', pointer); document.removeEventListener('keydown', key, true); document.removeEventListener('focusin', focus); };
  }, [visible]);
  const failed = !!state.error || state.report?.gateways.some(g => g.error);
  return <div className="mq mq-shell" ref={root} data-dsh-magpie-quota><style>{styles}</style>
    <div className="mq-strip" role="group" aria-label="Magpie 各账号剩余额度">
      {rows.map(({ gateway, account, key }) => {
        const value = summary(account);
        const stale = !!gateway.stale || !!account.asOf || !!account.readDeferred;
        const warning = !!account.error || !!gateway.error || stale || account.windows.some(w => !w.unlimited && w.remaining === null);
        const title = `${account.name} · ${accountLabel(account)}${account.plan ? ` · ${account.plan}` : ''}\n${value.remaining !== null ? `已知窗口最低剩余 ${value.text}` : value.text === '∞' ? '不限额' : account.balance ? `余额 ${account.balance}` : '暂无读数'}${warning ? '\n读数待更新，点击查看详情' : ''}`;
        return <button type="button" key={key} className="mq-chip" data-tone={tone(value.remaining)} data-stale={stale || undefined} aria-label={`${account.name} ${accountLabel(account)} ${value.text}`} aria-haspopup="dialog" aria-expanded={opened === key} title={title} onClick={e => open(key, e.currentTarget)}><ProviderIcon provider={account.provider} /><span className="mq-chip-value">{value.text}</span>{warning && <span className="mq-warning-dot" />}</button>;
      })}
      {(!rows.length || failed) && <button type="button" className="mq-chip" aria-label="查看 Magpie 额度状态" aria-haspopup="dialog" aria-expanded={opened === 'status'} title={state.loading ? '正在读取额度' : '查看 Magpie 连接和额度状态'} onClick={e => open('status', e.currentTarget)}><ProviderIcon provider="magpie" /><span>{state.loading ? '…' : '额度'}</span>{failed && <span className="mq-warning-dot" />}</button>}
    </div>
    {visible && createPortal(<div className="mq mq-popover" role="dialog" aria-label="账号额度详情" tabIndex={-1} ref={panel} style={position}>
      <div className="mq-panel-top"><strong>账号额度</strong><button type="button" className="mq-close" aria-label="关闭额度详情" onClick={() => close(true)}>×</button></div>
      {state.error && <div className="mq-notice" role="alert">{state.error}</div>}
      {opened === 'status' && state.report?.gateways.filter(g => g.error).map(g => <div key={g.id} className="mq-notice" role="status">{g.name}：{g.error?.message}</div>)}
      {rows.length > 1 && <select className="mq-select" aria-label="选择额度账号" value={selected?.key} onChange={e => setOpened(e.target.value)}>{rows.map(row => <option key={row.key} value={row.key}>{row.account.name} · {accountLabel(row.account)}{row.account.plan ? ` · ${row.account.plan}` : ''}</option>)}</select>}
      {selected ? <SelectedAccount query={query} row={selected} /> : <><div className="mq-empty">{state.loading ? '正在读取额度…' : state.error ? '暂时无法读取额度，请重试' : state.report?.gateways.length ? '暂时没有可见的账号额度' : '请添加 Magpie 提供商，或在插件配置中指定网关。'}</div><button className="mq-button" type="button" disabled={state.loading} onClick={() => void query.read(true)}><RefreshIcon />重新读取</button></>}
    </div>, document.body)}
  </div>;
}
function SelectedAccount({ query, row }: { query: QuotaQuery; row: { gateway: GatewayQuota; account: AccountQuota } }) {
  const now = useClock();
  return <>{row.gateway.error && <div className="mq-notice" role="status">{row.gateway.error.message}；保留上次读数。</div>}<AccountCard gateway={row.gateway} account={row.account} query={query} now={now} /><p className="mq-small">{row.gateway.name} · 各窗口单独计量，百分比不相加</p></>;
}
