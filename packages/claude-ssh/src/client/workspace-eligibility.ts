import { t } from "./i18n.js";
import type { WorkspaceModel } from "./workspace-model-types.js";

/** The bridge only narrows the session's view; it never edits the shared model catalog. */
export interface WorkspaceEligibility {
  eligible: boolean;
  reason?: string;
  providerIds: string[];
  models?: WorkspaceModel[];
}

export const isClaudeProvider = (id: string): boolean =>
  id === "claude-code" || id.startsWith("claude-code-") || id === "claude-workspace";

export function visibleWorkspaceGroups<T extends { id: string }>(
  groups: readonly T[],
  eligibility?: WorkspaceEligibility,
): T[] {
  return groups.filter((group) =>
    !isClaudeProvider(group.id) ||
    (eligibility?.eligible === true && eligibility.providerIds.includes(group.id)),
  );
}

/** Reject malformed/old responses rather than revealing Claude on an ambiguous answer. */
export function parseWorkspaceEligibility(value: unknown): WorkspaceEligibility {
  if (!value || typeof value !== "object") throw new Error(t("workspaceModels.invalidResponse"));
  const data = value as Partial<WorkspaceEligibility>;
  if (typeof data.eligible !== "boolean" || !Array.isArray(data.providerIds) ||
      !data.providerIds.every((id) => typeof id === "string")) {
    throw new Error(t("workspaceModels.invalidResponse"));
  }
  if (data.models !== undefined && (!Array.isArray(data.models) || !data.models.every(model =>
    model && typeof model.id === "string" && model.id.length > 0 && typeof model.name === "string" &&
    (model.reasoning === undefined || (Array.isArray(model.reasoning.efforts) && model.reasoning.efforts.every(effort =>
      typeof effort.id === "string" && typeof effort.name === "string")))))) {
    throw new Error(t("workspaceModels.invalidResponse"));
  }
  return {
    eligible: data.eligible,
    providerIds: data.providerIds,
    ...(data.models === undefined ? {} : { models: data.models }),
    ...(typeof data.reason === "string" ? { reason: data.reason } : {}),
  };
}

export async function checkWorkspaceEligibility(
  sessionId: string,
  signal: AbortSignal,
): Promise<WorkspaceEligibility> {
  const response = await fetch("/api/claude-ssh/workspace-eligibility", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId }),
  });
  if (!response.ok) throw new Error(t("workspaceModels.httpFailed", { status: response.status }));
  return parseWorkspaceEligibility(await response.json());
}

/** Abort superseded checks, and reject replies for a cwd/configuration that has since changed. */
export class WorkspaceEligibilityGate {
  private value: WorkspaceEligibility | undefined;
  private key: string | undefined;
  private request: AbortController | undefined;
  private requestKey: string | undefined;
  private pending: Promise<WorkspaceEligibility | undefined> | undefined;
  private listeners = new Set<() => void>();
  private disposed = false;

  constructor(
    private readonly currentKey: () => string,
    private readonly check: (signal: AbortSignal) => Promise<WorkspaceEligibility>,
  ) {}

  getSnapshot = (): WorkspaceEligibility | undefined =>
    this.key === this.currentKey() ? this.value : undefined;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private emit(): void { for (const listener of this.listeners) listener(); }

  isPending = (): boolean =>
    this.request !== undefined && this.requestKey === this.currentKey();

  invalidate = (): void => {
    this.request?.abort();
    this.request = undefined;
    this.requestKey = undefined;
    this.pending = undefined;
    this.value = undefined;
    this.key = undefined;
    this.emit();
  };

  refresh(): Promise<WorkspaceEligibility | undefined> {
    if (this.disposed) return Promise.resolve(undefined);
    const key = this.currentKey();
    if (this.request && this.requestKey === key && this.pending) return this.pending;
    this.request?.abort();
    // A normal recheck may keep this exact binding's accepted catalog visible. A changed
    // binding or explicit invalidate() revokes it immediately; selection still awaits the check.
    if (this.key !== key) {
      this.value = undefined;
      this.key = undefined;
    }
    const request = new AbortController();
    this.request = request;
    this.requestKey = key;
    const pending = (async () => {
      let value: WorkspaceEligibility;
      try {
        value = parseWorkspaceEligibility(await this.check(request.signal));
      } catch (error) {
        if (request.signal.aborted) return undefined;
        value = { eligible: false, providerIds: [], reason: error instanceof Error ? error.message : t("workspaceModels.verifyFailed") };
      }
      if (this.disposed || request.signal.aborted || this.request !== request || key !== this.currentKey()) return undefined;
      this.request = undefined;
      this.requestKey = undefined;
      this.pending = undefined;
      this.key = key;
      this.value = value;
      this.emit();
      return value;
    })();
    this.pending = pending;
    this.emit();
    return pending;
  }

  activate(): void { this.disposed = false; }

  dispose(): void {
    this.disposed = true;
    this.invalidate();
    this.listeners.clear();
  }
}
