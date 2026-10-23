import React, { useEffect, useRef, useState } from 'react';
import { isGpt, type FastState, type Selection } from '../gpt.js';

const css = `.dsh-fast-control{position:relative;display:inline-flex;flex:none}.dsh-fast-button{width:28px;height:28px;padding:0;display:inline-flex;align-items:center;justify-content:center;flex:none;border:0;border-radius:var(--dsw-radius-sm,6px);background:transparent;color:var(--dsw-alias-label-secondary,#929292);cursor:pointer}.dsh-fast-button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.12))}.dsh-fast-button:focus-visible{outline:2px solid var(--dsw-focus-ring-color,#668fff);outline-offset:1px}.dsh-fast-button[aria-pressed=true]{color:var(--dsw-alias-state-warn-label,#d89a25)}.dsh-fast-button:disabled{cursor:default;opacity:.5}.dsh-fast-error{position:absolute;bottom:34px;left:0;z-index:1200;max-width:240px;width:max-content;padding:7px 10px;border-radius:7px;background:var(--dsw-alias-bg-elevated,#303030);color:var(--dsw-alias-label-primary,#eee);box-shadow:0 3px 16px #0003;font:12px/1.5 system-ui}`;

export function FastControl({ sessionId, selection }: { sessionId: string; selection: Selection | null }) {
  if (!selection || !isGpt(selection.model)) return null;
  // A separate component ensures all asynchronous state is retired when selection/session changes.
  return <Toggle key={`${sessionId}/${selection.provider}/${selection.model}`} sessionId={sessionId} selection={selection} />;
}
function Toggle({ sessionId, selection }: { sessionId: string; selection: Selection }) {
  const [state, setState] = useState<FastState>();
  const [pending, setPending] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const lifetime = useRef<AbortController>();
  const writing = useRef(false);
  useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller;
    const read = async () => {
      if (writing.current) return;
      try {
        const query = new URLSearchParams({ sessionId, ...selection });
        const response = await fetch(`/api/magpie-fast?${query}`, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error('无法读取 GPT Fast 状态，点击重试');
        const data: FastState = await response.json();
        if (typeof data.enabled !== 'boolean' || typeof data.supported !== 'boolean') throw new Error('GPT Fast 状态无效，点击重试');
        if (!controller.signal.aborted && !writing.current) { setState(data); setError(''); }
      } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : '无法读取 GPT Fast 状态，点击重试'); }
      finally { if (!controller.signal.aborted && !writing.current) setPending(false); }
    };
    void read();
    const timer = setInterval(read, 15000);
    const visible = () => { if (!document.hidden) void read(); };
    document.addEventListener('visibilitychange', visible);
    return () => { controller.abort(); clearInterval(timer); document.removeEventListener('visibilitychange', visible); };
  }, [sessionId, selection, retry]);
  const toggle = async () => {
    if (!state) { setPending(true); setRetry(v => v + 1); return; }
    const controller = lifetime.current;
    if (!controller || controller.signal.aborted || writing.current) return;
    writing.current = true; setPending(true); setError('');
    try {
      const response = await fetch('/api/magpie-fast', { method: 'POST', credentials: 'same-origin', signal: controller.signal,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId, ...selection, enabled: !state.enabled }),
      });
      if (!response.ok) throw new Error('无法保存 GPT Fast 开关，请重试');
      const data: FastState = await response.json();
      if (typeof data.enabled !== 'boolean' || typeof data.supported !== 'boolean') throw new Error('GPT Fast 状态无效，请重试');
      if (!controller.signal.aborted) setState(data);
    } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : '无法保存 GPT Fast 开关，请重试'); }
    finally { writing.current = false; if (!controller.signal.aborted) setPending(false); }
  };
  const label = state?.enabled ? '关闭 GPT Fast' : '开启 GPT Fast';
  const title = error || (state?.supported === false ? state.reason : `${state?.enabled ? 'GPT Fast 已开启' : 'GPT Fast 已关闭'}；优先处理，按上游规则计费`);
  return <span className="dsh-fast-control" data-dsh-gpt-fast>
    <style>{css}</style>
    <button type="button" className="dsh-fast-button" aria-label={label} aria-pressed={state?.enabled ?? false} aria-busy={pending || undefined}
      disabled={(!state && pending) || state?.supported === false} aria-disabled={pending || state?.supported === false || undefined}
      title={title} onMouseDown={event => event.preventDefault()} onClick={() => void toggle()}>
      <svg width="16" height="16" viewBox="0 0 16 16" fill={state?.enabled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9.5 1.5 3 9h4.5l-1 5.5L13 7H8.5l1-5.5Z" /></svg>
    </button>
    {error && <span className="dsh-fast-error" role="alert">{error}</span>}
  </span>;
}
