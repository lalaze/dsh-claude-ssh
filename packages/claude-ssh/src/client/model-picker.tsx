import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ModelMenu, type ModelSelection } from './model-menu.js';
import { NATIVE_PROVIDER, visibleGroups, type Group } from './model-filter.js';
import type { Eligibility } from '../native.js';

interface DirectoryState { current: ModelSelection | null; groups: readonly Group[]; status: string; error: string | null }
export interface Directory {
  store: { getSnapshot(): DirectoryState; subscribe(listener: () => void): () => void };
  load(): Promise<unknown>;
  select(selection: ModelSelection): Promise<unknown>;
}
export interface ModelPickerProps {
  sessionId: string; directory: Directory; available: boolean; legacyHostId?: string;
  targetsKey?: string;
  locked?: boolean;
  check: (sessionId: string, signal: AbortSignal) => Promise<Eligibility>;
}

/** A session-scoped view of the native catalog; never mutate its Host-wide shared store. */
export function ModelPicker({ sessionId, directory, available, legacyHostId, targetsKey, locked, check }: ModelPickerProps) {
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
  const select = async (selection: ModelSelection): Promise<boolean> => {
    setError('');
    try {
      // The target may have changed since the menu was opened. Recheck before native selection.
      if (selection.provider === NATIVE_PROVIDER) {
        probe.current?.abort(); const abort = new AbortController(); probe.current = abort;
        const result = await check(sessionId, abort.signal);
        if (abort.signal.aborted) return false;
        setEligibility({ sessionId, value: result });
        if (!result.eligible) throw new Error(result.reason ?? '当前项目不再匹配目标远程工作区。');
      }
      const result = await directory.select(selection);
      return !(result && typeof result === 'object' && 'ok' in result && result.ok === false);
    } catch (e) { if (!probe.current?.signal.aborted) setError(e instanceof Error ? e.message : String(e)); return false; }
  };
  if (!available) return null;
  return <ModelMenu groups={groups} current={state.current} locked={locked} busy={state.status === 'selecting'} error={error || state.error}
    onOpen={() => { void directory.load().catch(() => {}); refresh(); }} onSelect={select} />;
}
