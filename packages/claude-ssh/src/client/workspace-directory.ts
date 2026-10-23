import { t } from "./i18n.js";
import { isClaudeProvider, visibleWorkspaceGroups, WorkspaceEligibilityGate, type WorkspaceEligibility } from "./workspace-eligibility.js";
import type { WorkspaceModelSelection, WorkspaceModel } from "./workspace-model-types.js";

type Group = { id: string; models: readonly Pick<WorkspaceModel, "id" | "reasoning">[] };
export interface DirectorySnapshot {
  current: WorkspaceModelSelection | null;
  groups?: readonly Group[];
  failures?: readonly { id: string }[];
  routable?: boolean | null;
  status?: string;
  error?: string | null;
}
export interface SessionDirectory {
  store: {
    getSnapshot(): DirectorySnapshot;
    subscribe(listener: () => void): () => void;
  };
  load?(): Promise<unknown>;
  select?(selection: WorkspaceModelSelection): Promise<unknown>;
}

/** A per-session read view: the host's catalog and durable selection stay untouched. */
export function workspaceDirectory<D extends SessionDirectory>(directory: D, options: {
  key(): string;
  check(signal: AbortSignal): Promise<WorkspaceEligibility>;
}) {
  const gate = new WorkspaceEligibilityGate(options.key, options.check);
  const listeners = new Set<() => void>();
  let disposed = false;
  let previousKey = options.key();
  let lastSource: DirectorySnapshot | undefined;
  let lastEligibility: WorkspaceEligibility | undefined;
  let lastPending = false;
  let lastValue: DirectorySnapshot | undefined;
  const publish = () => { for (const listener of listeners) listener(); };
  const unsubscribeSource = directory.store.subscribe(publish);
  const unsubscribeGate = gate.subscribe(publish);
  const getSnapshot = () => {
    const source = directory.store.getSnapshot();
    if (disposed) return source;
    const eligibility = gate.getSnapshot();
    const pending = gate.isPending();
    if (lastValue && lastSource === source && lastEligibility === eligibility && lastPending === pending) return lastValue;
    lastSource = source;
    lastEligibility = eligibility;
    lastPending = pending;
    const groups: Group[] = visibleWorkspaceGroups(source.groups ?? [], eligibility).filter(group => !isClaudeProvider(group.id));
    if (eligibility?.eligible && eligibility.providerIds.includes("claude-code") && eligibility.models?.length) {
      groups.push({ id: "claude-code", name: "Claude", models: eligibility.models } as Group);
    }
    lastValue = {
      ...source,
      groups,
      ...(eligibility === undefined && pending ? { status: "loading" } : {}),
      ...(source.failures ? { failures: visibleWorkspaceGroups(source.failures, eligibility) } : {}),
      ...(source.current && isClaudeProvider(source.current.provider) ? {
        routable: groups.some(group => group.id === source.current!.provider && group.models.some(model => model.id === source.current!.model)),
      } : {}),
    };
    return lastValue;
  };
  const store = {
    ...directory.store,
    getSnapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
  const refresh = async () => {
    if (disposed) return undefined;
    previousKey = options.key();
    return gate.refresh();
  };
  const load = async () => {
    if (disposed) return directory.load?.();
    const checking = refresh();
    await directory.load?.();
    await checking;
    while (!disposed && (previousKey !== options.key() || gate.isPending())) await refresh();
    return getSnapshot();
  };
  const select = async (selection: WorkspaceModelSelection) => {
    try {
      if (disposed) throw new Error(t("workspaceModels.unavailable"));
      if (isClaudeProvider(selection.provider)) {
        const verified = await refresh();
        if (disposed || gate.getSnapshot() !== verified || !verified?.eligible ||
            !verified.providerIds.includes(selection.provider)) {
          throw new Error(verified?.reason ?? t("workspaceModels.unavailable"));
        }
        const model = verified.models?.find(model => model.id === selection.model);
        if (!model) throw new Error(t("workspaceModels.modelGone"));
        if (selection.reasoningEffort && !model.reasoning?.efforts.some(effort => effort.id === selection.reasoningEffort)) {
          throw new Error(t("workspaceModels.effortGone"));
        }
      }
      // Preserve the host's Result, including writer-held and other rejected selections.
      return await directory.select?.(selection);
    } catch (error) {
      return { ok: false as const, error: {
        code: "claude/workspace-unavailable",
        message: error instanceof Error ? error.message : String(error),
      } };
    }
  };
  const view = new Proxy(directory, {
    get(target, property) {
      if (property === "store") return store;
      if (property === "load") return load;
      if (property === "select") return select;
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return {
    view,
    refresh,
    invalidate() { if (!disposed) gate.invalidate(); },
    changed() { if (!disposed && previousKey !== options.key()) void refresh(); },
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribeSource(); unsubscribeGate(); gate.dispose();
      publish(); listeners.clear();
    },
  };
}
