import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Group } from './model-filter.js';

export interface ModelSelection { provider: string; model: string; reasoningEffort?: string }
interface Props {
  groups: readonly Group[]; current: ModelSelection | null; locked?: boolean; busy: boolean;
  error?: string | null; onOpen(): void; onSelect(value: ModelSelection): Promise<boolean>;
}
const css = `
.dsh-cm{min-width:0;max-width:100%;position:relative}
.dsh-cm-trigger{box-sizing:border-box;display:flex;align-items:center;gap:4px;min-width:0;max-width:min(360px,45cqw,100%);height:28px;padding:0 4px 0 8px;border:0;border-radius:var(--dsw-radius-sm,6px);background:transparent;color:var(--dsw-alias-label-secondary,#aaa);font:inherit;font-size:13px;font-weight:400;line-height:20px;cursor:pointer;white-space:nowrap}
.dsh-cm-trigger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,#ffffff0d)}
.dsh-cm-trigger:focus-visible:not([data-selection-focus=true]){outline:2px solid var(--dsw-focus-ring-color,#739de2);outline-offset:1px}
.dsh-cm-trigger:disabled{color:var(--dsw-alias-label-dimmed,#777);cursor:default}
.dsh-cm-name,.dsh-cm-effort{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:var(--dsh-composer-model-text-display,block)}
.dsh-cm-effort{flex-shrink:1000;color:var(--dsw-alias-label-caption,#888)}
.dsh-cm-icon{display:var(--dsh-composer-model-icon-display,none);flex:none}
.dsh-cm-chevron{flex:none;color:var(--dsw-alias-label-caption,#888);transition:transform .12s}
.dsh-cm-trigger[aria-expanded=true] .dsh-cm-chevron{transform:rotate(180deg)}
.dsh-cm-menu{box-sizing:border-box;position:fixed;inset:auto;margin:0;z-index:1100;width:min(320px,calc(100vw - 24px));max-height:min(360px,calc(100dvh - 24px));padding:4px;border:1px solid var(--dsw-alias-border-l1,#ffffff12);border-radius:var(--dsw-radius-lg,12px);background:var(--dsw-alias-bg-layer-2,#303030);color:var(--dsw-alias-label-primary,#eee);box-shadow:var(--dsw-elevation-prominent,0 10px 30px #0004);font:13px/20px system-ui;overflow:hidden}
.dsh-cm-row{box-sizing:border-box;display:flex;align-items:center;gap:8px;width:100%;min-height:34px;padding:5px 8px;border:0;border-radius:var(--dsw-radius-md,7px);background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer;outline:none}
.dsh-cm-row:hover:not(:disabled),.dsh-cm-row:focus-visible,.dsh-cm-row[data-active=true]{background:var(--dsw-alias-interactive-bg-hover,#ffffff0c)}
.dsh-cm-row:disabled{opacity:.45;cursor:default}
.dsh-cm-value{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:right;color:var(--dsw-alias-label-tertiary,#999)}
.dsh-cm-copy{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-cm-back{color:var(--dsw-alias-label-secondary,#aaa);margin-bottom:3px}
.dsh-cm-search{box-sizing:border-box;display:block;width:100%;padding:7px 8px;margin:0 0 4px;border:0;border-radius:6px;background:transparent;color:inherit;font:inherit;outline:none}
.dsh-cm-search::placeholder{color:var(--dsw-alias-label-caption,#888)}
.dsh-cm-list{max-height:260px;overflow:auto;overscroll-behavior:contain;scrollbar-width:thin}
.dsh-cm-group{padding:8px 8px 3px;font-size:11px;color:var(--dsw-alias-label-caption,#999)}
.dsh-cm-notice{padding:8px;font-size:12px;color:var(--dsw-alias-label-tertiary,#aaa)}
.dsh-cm-error{color:var(--dsw-alias-state-error-primary,#ef9292)}
`;
function Chevron({ left = false }: { left?: boolean }) {
  return <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true" style={{ flex: 'none', transform: left ? 'rotate(180deg)' : undefined }}><path d="m6 3 5 5-5 5" /></svg>;
}

/** Match DSH's existing 28px model/effort trigger and two-level menu. */
export function ModelMenu({ groups, current, locked, busy, error, onOpen, onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const [pane, setPane] = useState<'root' | 'model' | 'effort'>('root');
  const [query, setQuery] = useState(''); const [active, setActive] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [selectionFocus, setSelectionFocus] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null); const menu = useRef<HTMLDivElement>(null); const search = useRef<HTMLInputElement>(null);
  const rows = groups.flatMap(group => group.models.map(model => ({ group, model })));
  const choice = rows.find(r => r.group.id === current?.provider && r.model.id === current.model);
  const reasoning = choice?.model.reasoning;
  const effectiveEffort = current?.reasoningEffort ?? reasoning?.defaultEffort;
  const effortLabel = reasoning ? reasoning.efforts.find(e => e.id === effectiveEffort)?.name ?? effectiveEffort ?? 'Default' : undefined;
  const label = choice?.model.name ?? '选择模型';
  const filtered = rows.filter(r => `${r.model.name} ${r.group.name}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const close = () => { setOpen(false); trigger.current?.focus(); };
  const choose = async (value: ModelSelection) => {
    if (locked || busy || submitting) return;
    setSubmitting(true);
    try { if (await onSelect(value)) { setSelectionFocus(true); close(); } } finally { setSubmitting(false); }
  };
  const chooseModel = (row: typeof rows[number]) => void choose({ provider: row.group.id, model: row.model.id, ...(row.model.reasoning?.defaultEffort ? { reasoningEffort: row.model.reasoning.defaultEffort } : {}) });
  const show = () => { setSelectionFocus(false); onOpen(); setPane(choice ? 'root' : 'model'); setQuery(''); setActive(0); setOpen(true); };
  useLayoutEffect(() => {
    if (!open || !menu.current || !trigger.current) return;
    const panel = menu.current; const button = trigger.current; const doc = button.ownerDocument; const view = doc.defaultView!;
    panel.setAttribute('popover', 'manual'); panel.showPopover();
    const place = () => {
      const rect = button.getBoundingClientRect();
      panel.style.left = `${Math.max(12, Math.min(rect.right - panel.offsetWidth, view.innerWidth - panel.offsetWidth - 12))}px`;
      const above = rect.top - panel.offsetHeight - 8;
      panel.style.top = `${Math.max(12, Math.min(above >= 12 ? above : rect.bottom + 8, view.innerHeight - panel.offsetHeight - 12))}px`;
    };
    place(); const resize = new ResizeObserver(place); resize.observe(panel);
    view.addEventListener('resize', place); doc.addEventListener('scroll', place, true);
    return () => { resize.disconnect(); view.removeEventListener('resize', place); doc.removeEventListener('scroll', place, true); };
  }, [open, pane]);
  useEffect(() => {
    if (!open) return;
    const doc = trigger.current!.ownerDocument;
    const outside = (e: Event) => { if (!menu.current?.contains(e.target as Node) && !trigger.current?.contains(e.target as Node)) setOpen(false); };
    doc.addEventListener('pointerdown', outside, true); doc.addEventListener('focusin', outside);
    if (pane === 'model') search.current?.focus();
    else (menu.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]') ?? menu.current?.querySelector<HTMLButtonElement>('[role="menuitem"]'))?.focus();
    return () => { doc.removeEventListener('pointerdown', outside, true); doc.removeEventListener('focusin', outside); };
  }, [open, pane]);
  useEffect(() => { if (locked) setOpen(false); }, [locked]);
  const keyboard = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (pane !== 'root' && choice) setPane('root'); else close(); }
    else if (e.key === 'Tab') setOpen(false);
    else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
      e.preventDefault();
      const buttons = Array.from(menu.current!.querySelectorAll<HTMLButtonElement>('[role="menuitem"],[role="menuitemradio"]')).filter(b => !b.disabled);
      if (!buttons.length) return;
      const index = pane === 'model' ? Math.min(active, buttons.length - 1) : buttons.indexOf(e.currentTarget.ownerDocument.activeElement as HTMLButtonElement);
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (index + (e.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length;
      setActive(next); buttons[next]?.scrollIntoView({ block: 'nearest' }); if (pane !== 'model') buttons[next]?.focus();
    } else if (e.key === 'Enter' && e.target === search.current && filtered[active]) { e.preventDefault(); chooseModel(filtered[active]); }
  };
  return <div className="dsh-cm"><style>{css}</style>
    <button type="button" ref={trigger} className="dsh-cm-trigger" aria-label="选择模型" aria-haspopup="menu" aria-expanded={open} data-selection-focus={selectionFocus} title={`${label}${effortLabel ? ` · ${effortLabel}` : ''}`} disabled={locked || busy || submitting} onBlur={() => setSelectionFocus(false)} onClick={() => open ? close() : show()} onKeyDown={e => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); show(); } }}>
      <span className="dsh-cm-icon" aria-hidden="true">◇</span><span className="dsh-cm-name">{label}</span>
      {effortLabel && <span className="dsh-cm-effort">{effortLabel}</span>}
      <svg className="dsh-cm-chevron" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
    </button>
    {open && <div ref={menu} className="dsh-cm-menu" role="menu" aria-label={pane === 'effort' ? '推理等级' : '模型菜单'} onKeyDown={keyboard}>
      {pane === 'root' ? <>
        <button className="dsh-cm-row" role="menuitem" onClick={() => { setPane('model'); setActive(0); }}><span>模型</span><span className="dsh-cm-value">{label}</span><Chevron /></button>
        {reasoning && <button className="dsh-cm-row" role="menuitem" onClick={() => setPane('effort')}><span>推理等级</span><span className="dsh-cm-value">{effortLabel}</span><Chevron /></button>}
      </> : <>
        <button className="dsh-cm-row dsh-cm-back" aria-label="返回模型菜单" onClick={() => setPane('root')}><Chevron left />{pane === 'model' ? '模型' : '推理等级'}</button>
        {pane === 'model' ? <>
          <input ref={search} className="dsh-cm-search" role="searchbox" aria-label="搜索模型" placeholder="搜索模型…" value={query} onChange={e => { setQuery(e.target.value); setActive(0); }} />
          <div className="dsh-cm-list">{filtered.map((r, i) => <React.Fragment key={JSON.stringify([r.group.id, r.model.id])}>
            {filtered[i - 1]?.group.id !== r.group.id && <div className="dsh-cm-group">{r.group.name}</div>}
            <button className="dsh-cm-row" role="menuitemradio" aria-checked={r.group.id === current?.provider && r.model.id === current.model} data-active={i === active} disabled={busy || submitting} onPointerMove={() => setActive(i)} onClick={() => chooseModel(r)}><span className="dsh-cm-copy">{r.model.name}</span>{r.group.id === current?.provider && r.model.id === current.model && <span aria-hidden="true">✓</span>}</button>
          </React.Fragment>)}{!filtered.length && <div className="dsh-cm-notice">没有可用的匹配模型</div>}</div>
        </> : choice && <div className="dsh-cm-list">{[...(reasoning?.defaultEffort ? [] : [{ id: '', name: 'Default' }]), ...(reasoning?.efforts ?? [])].map(e => <button key={e.id} className="dsh-cm-row" role="menuitemradio" aria-checked={(effectiveEffort ?? '') === e.id} disabled={busy || submitting} onClick={() => void choose({ provider: choice.group.id, model: choice.model.id, ...(e.id ? { reasoningEffort: e.id } : {}) })}><span className="dsh-cm-copy">{e.name}</span>{(effectiveEffort ?? '') === e.id && <span aria-hidden="true">✓</span>}</button>)}</div>}
      </>}
      {error && <div role="alert" className="dsh-cm-notice dsh-cm-error">{error}</div>}
    </div>}
  </div>;
}
