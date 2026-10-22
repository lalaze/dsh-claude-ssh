import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Select } from './select.js';
import { NATIVE_PROVIDER, visibleGroups, type Group } from './model-filter.js';
import type { Eligibility } from '../native.js';

interface Selection { provider: string; model: string; reasoningEffort?: string }
interface DirectoryState { current: Selection | null; groups: readonly Group[]; status: string; error: string | null }
export interface Directory {
  store: { getSnapshot(): DirectoryState; subscribe(listener: () => void): () => void };
  load(): Promise<unknown>;
  select(selection: Selection): Promise<unknown>;
}
export interface ModelPickerProps {
  sessionId: string; directory: Directory; available: boolean; legacyHostId?: string;
  targetsKey?: string;
  check: (sessionId: string, signal: AbortSignal) => Promise<Eligibility>;
}

/** A session-scoped view of the native catalog; never mutate its Host-wide shared store. */
export function ModelPicker({ sessionId, directory, available, legacyHostId, targetsKey, check }: ModelPickerProps) {
  const state = useSyncExternalStore(directory.store.subscribe, directory.store.getSnapshot, directory.store.getSnapshot);
  const [eligibility, setEligibility] = useState<{ sessionId: string; value: Eligibility }>();
  const [error, setError] = useState('');
  const probe = useRef<AbortController>();
  const refresh = useCallback(() => {
    probe.current?.abort();
    setEligibility(undefined);
    if (!available || legacyHostId) return;
    const abort = new AbortController(); probe.current = abort;
    void check(sessionId, abort.signal).then(value => {
      if (!abort.signal.aborted) setEligibility({ sessionId, value });
    }).catch(() => { if (!abort.signal.aborted) setEligibility({ sessionId, value: { eligible: false } }); });
  }, [sessionId, available, legacyHostId, targetsKey, check]);
  useEffect(() => {
    void directory.load().catch(() => {}); refresh();
    window.addEventListener('claude-ssh-updated', refresh);
    window.addEventListener('focus', refresh);
    return () => { probe.current?.abort(); window.removeEventListener('claude-ssh-updated', refresh); window.removeEventListener('focus', refresh); };
  }, [directory, refresh]);
  const eligible = eligibility?.sessionId === sessionId && eligibility.value.eligible;
  const groups = visibleGroups(state.groups, eligible, legacyHostId);
  const rows = groups.flatMap(g => g.models.map(m => ({ value: JSON.stringify([g.id, m.id]), label: `${m.name} · ${g.name}`, group: g, model: m })));
  const current = rows.find(r => r.group.id === state.current?.provider && r.model.id === state.current.model);
  const select = async (selection: Selection) => {
    setError('');
    try {
      // The target may have changed since the menu was opened. Recheck before native selection.
      if (selection.provider === NATIVE_PROVIDER) {
        probe.current?.abort(); const abort = new AbortController(); probe.current = abort;
        const result = await check(sessionId, abort.signal);
        if (abort.signal.aborted) return;
        setEligibility({ sessionId, value: result });
        if (!result.eligible) throw new Error(result.reason ?? '当前项目不再匹配目标远程工作区。');
      }
      await directory.select(selection);
    } catch (e) { if (!probe.current?.signal.aborted) setError(e instanceof Error ? e.message : String(e)); }
  };
  if (!available) return null;
  return <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
    <Select aria-label="模型" searchable value={current?.value ?? ''} placeholder={state.status === 'loading' ? '加载模型…' : '选择模型'}
      options={rows} disabled={state.status === 'selecting'} onOpen={refresh}
      onValueChange={value => { const row = rows.find(r => r.value === value); if (row) void select({ provider: row.group.id, model: row.model.id }); }} />
    {current?.model.reasoning && <Select aria-label="推理等级" value={state.current?.reasoningEffort ?? ''}
      options={[{ value: '', label: 'Default' }, ...current.model.reasoning.efforts.map(e => ({ value: e.id, label: e.name }))]}
      disabled={state.status === 'selecting'} onValueChange={effort => void select({ provider: current.group.id, model: current.model.id, ...(effort ? { reasoningEffort: effort } : {}) })} />}
    {(error || state.error) && <small role="alert">{error || state.error}</small>}
    {state.status === 'error' && <button onClick={() => { void directory.load(); refresh(); }}>重试</button>}
  </div>;
}
