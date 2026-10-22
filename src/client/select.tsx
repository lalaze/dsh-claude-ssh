import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { selectStyles } from './select-styles.js';

export interface SelectOption { value: string; label: string }
interface SelectProps {
  value: string;
  options: SelectOption[];
  onValueChange: (value: string) => void;
  'aria-label': string;
  placeholder?: string;
  disabled?: boolean;
  searchable?: boolean;
  kind?: 'ssh';
  style?: React.CSSProperties;
}

function Icon({ name }: { name: 'chevron' | 'search' | 'check' | 'ssh' }) {
  return <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    {name === 'chevron' ? <path d="m4.5 6.5 3.5 3.5 3.5-3.5" />
      : name === 'search' ? <><circle cx="6.8" cy="6.8" r="4.1" /><path d="m10 10 3.2 3.2" /></>
      : name === 'check' ? <path d="m3.5 8 3 3 6-6" />
      : <><rect x="2" y="2.5" width="12" height="9" rx="2" /><path d="m5 5 2 2-2 2m4 0h2m-5.5 5h5" /></>}
  </svg>;
}

/** Use the trigger's document: settings may render in a separate window/document. */
export function Select({ value, options, onValueChange, placeholder = '请选择', disabled, searchable, kind, style, 'aria-label': label }: SelectProps): React.ReactElement {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState<React.CSSProperties>();
  const filtered = options.filter(o => o.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const selected = options.find(o => o.value === value);
  const activeIndex = Math.min(active, Math.max(0, filtered.length - 1));
  const close = (restoreFocus: boolean) => { setOpen(false); if (restoreFocus) trigger.current?.focus(); };
  const show = (last = false) => {
    if (disabled || trigger.current?.matches(':disabled')) return;
    setQuery(''); setActive(last ? options.length - 1 : Math.max(0, options.findIndex(o => o.value === value)));
    setOpen(true);
  };
  const choose = (option: SelectOption) => { onValueChange(option.value); close(true); };

  useLayoutEffect(() => {
    if (!open) return;
    const doc = trigger.current?.ownerDocument;
    const view = doc?.defaultView;
    if (!doc || !view) return;
    const place = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const below = view.innerHeight - rect.bottom - 12;
      const above = rect.top - 12;
      const upward = below < 220 && above > below;
      const maxHeight = Math.min(360, Math.max(120, upward ? above : below));
      const width = Math.min(Math.max(rect.width, 220), 420, view.innerWidth - 24);
      setPosition({ width, maxHeight, left: Math.max(12, Math.min(rect.left, view.innerWidth - width - 12)), ...(upward ? { bottom: view.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }) });
    };
    place();
    const scroll = (event: Event) => { if (!panel.current?.contains(event.target as Node)) place(); };
    view.addEventListener('resize', place);
    doc.addEventListener('scroll', scroll, true);
    const frame = view.requestAnimationFrame(() => { if (searchable) search.current?.focus(); });
    return () => { view.cancelAnimationFrame(frame); view.removeEventListener('resize', place); doc.removeEventListener('scroll', scroll, true); };
  }, [open, searchable]);
  useEffect(() => {
    if (!open) return;
    const doc = trigger.current?.ownerDocument;
    const view = doc?.defaultView;
    if (!doc || !view) return;
    const outside = (event: Event) => {
      const target = event.target as Node;
      if (!trigger.current?.contains(target) && !panel.current?.contains(target)) setOpen(false);
    };
    const blur = () => setOpen(false);
    doc.addEventListener('pointerdown', outside, true);
    doc.addEventListener('focusin', outside);
    view.addEventListener('blur', blur);
    return () => { doc.removeEventListener('pointerdown', outside, true); doc.removeEventListener('focusin', outside); view.removeEventListener('blur', blur); };
  }, [open]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  useEffect(() => { if (open) list.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' }); }, [activeIndex, query, open]);

  const navigate = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
    else if (event.key === 'Tab') { close(true); }
    else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      if ((event.key === 'Home' || event.key === 'End') && event.target === search.current && query) return;
      event.preventDefault(); event.stopPropagation();
      setActive(i => event.key === 'Home' ? 0 : event.key === 'End' ? Math.max(0, filtered.length - 1) : (Math.min(i, filtered.length - 1) + (event.key === 'ArrowDown' ? 1 : -1) + filtered.length) % (filtered.length || 1));
    } else if (event.key === 'Enter' || (event.key === ' ' && event.target !== search.current)) {
      event.preventDefault(); event.stopPropagation(); if (filtered[activeIndex]) choose(filtered[activeIndex]);
    }
  };

  return <span className="dsh-ssh-select-root" style={style}>
    <style>{selectStyles}</style>
    <button type="button" ref={trigger} className="dsh-ssh-select-trigger" role="combobox" aria-label={label} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? `${id}-list` : undefined} aria-activedescendant={open && filtered[activeIndex] ? `${id}-option-${activeIndex}` : undefined} disabled={disabled} data-open={open} onClick={() => open ? close(false) : show()} onKeyDown={event => {
      if (open) navigate(event);
      else if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) { event.preventDefault(); show(event.key === 'ArrowUp'); }
    }}>
      {kind === 'ssh' && <span className="dsh-ssh-select-leading"><Icon name="ssh" /></span>}
      <span className="dsh-ssh-select-value" data-placeholder={!selected}>{selected?.label ?? placeholder}</span>
      <span className="dsh-ssh-select-chevron"><Icon name="chevron" /></span>
    </button>
    {open && trigger.current && createPortal(<div ref={panel} className="dsh-ssh-select-panel" style={position} onKeyDown={navigate}>
      {searchable && <div className="dsh-ssh-select-search"><Icon name="search" /><input ref={search} aria-label={`搜索${label}`} role="searchbox" aria-controls={`${id}-list`} aria-activedescendant={filtered[activeIndex] ? `${id}-option-${activeIndex}` : undefined} placeholder="搜索 SSH 别名…" value={query} onChange={event => { setQuery(event.target.value); setActive(0); }} /><kbd>esc</kbd></div>}
      <div ref={list} className="dsh-ssh-select-list" role="listbox" id={`${id}-list`} aria-label={label}>
        {filtered.map((option, index) => <div key={option.value} id={`${id}-option-${index}`} className="dsh-ssh-select-option" role="option" aria-selected={option.value === value} data-active={index === activeIndex} onPointerMove={() => setActive(index)} onPointerDown={event => event.preventDefault()} onClick={() => choose(option)}>
          {kind === 'ssh' && <span className="dsh-ssh-select-leading"><Icon name="ssh" /></span>}
          <span className="dsh-ssh-select-value">{option.label}</span>
          {option.value === value && <span className="dsh-ssh-select-check"><Icon name="check" /></span>}
        </div>)}
        {filtered.length === 0 && <div className="dsh-ssh-select-empty" role="status">没有匹配的连接</div>}
      </div>
      {searchable && <div className="dsh-ssh-select-footer"><span>{filtered.length} 个连接</span><span>↑↓ 选择 <span className="dsh-ssh-select-hint">↵ 确认</span></span></div>}
    </div>, trigger.current.ownerDocument.body)}
  </span>;
}
