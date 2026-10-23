import { symbols } from "@deepseek-ai/cordis";
import type { ClientCtx } from "./shared.js";
import { BOXES_EVENT, RW_EVENT } from "./picker.js";
import { checkWorkspaceEligibility } from "./workspace-eligibility.js";
import { workspaceDirectory } from "./workspace-directory.js";

/** Unrelated workspace titles, activity and session summaries do not change execution placement. */
export function workspaceModelKey(sessionId: string, cwd: string | undefined, workspaces: readonly { path: string; workspaceId: string }[]): string {
  const workspace = cwd ? workspaces.filter(item => cwd === item.path ||
    cwd.startsWith(item.path.endsWith("/") ? item.path : `${item.path}/`) ||
    cwd.startsWith(item.path.endsWith("\\") ? item.path : `${item.path}\\`))
    .sort((left, right) => right.path.length - left.path.length)[0] : undefined;
  return JSON.stringify([sessionId, cwd, workspace?.workspaceId, workspace?.path]);
}

/** Decorate each session directory so the native picker and /model share the same admission rule. */
export function installWorkspaceModels(ctx: ClientCtx): void {
  const install = () => {
    const scoped = ctx.modelDirectories;
    const resolver = (scoped as unknown as Record<symbol, ClientCtx["modelDirectories"] | undefined>)[symbols.original] ?? scoped;
    const original = resolver.directoryFor;
    type Directory = ReturnType<typeof original>;
    const views = new Map<string, { source: Directory; directory: ReturnType<typeof workspaceDirectory<Directory>> }>();
    const directoryFor = (sessionId: string): Directory => {
      const source = original.call(resolver, sessionId);
      const previous = views.get(sessionId);
      if (previous?.source === source) return previous.directory.view;
      previous?.directory.dispose();
      const directory = workspaceDirectory(source, {
        key: () => workspaceModelKey(sessionId,
          ctx.sessions.list.getSnapshot()?.byId[sessionId]?.cwd,
          ctx.workspaces.list.getSnapshot()?.items ?? []),
        check: signal => checkWorkspaceEligibility(sessionId, signal),
      });
      views.set(sessionId, { source, directory });
      void directory.refresh();
      return directory.view;
    };
    resolver.directoryFor = directoryFor;
    const prune = () => {
      for (const [sessionId, entry] of views) if ((entry.source as Directory & { disposed?: boolean }).disposed) {
        entry.directory.dispose(); views.delete(sessionId);
      }
    };
    const changed = () => { prune(); for (const { directory } of views.values()) directory.changed(); };
    const refresh = () => { prune(); for (const { directory } of views.values()) void directory.refresh(); };
    const configurationChanged = () => {
      prune();
      for (const { directory } of views.values()) {
        directory.invalidate();
        void directory.refresh();
      }
    };
    const offSession = ctx.sessions.list.subscribe?.(changed);
    const offWorkspace = ctx.workspaces.list.subscribe(changed);
    const events = [BOXES_EVENT, RW_EVENT, "claude-ssh-updated"];
    for (const event of events) window.addEventListener(event, configurationChanged);
    window.addEventListener("focus", refresh);
    return () => {
      if (resolver.directoryFor === directoryFor) resolver.directoryFor = original;
      offSession?.(); offWorkspace();
      for (const event of events) window.removeEventListener(event, configurationChanged);
      window.removeEventListener("focus", refresh);
      for (const { directory } of views.values()) directory.dispose();
      views.clear();
    };
  };
  if (ctx.effect) ctx.effect(install);
  else install();
}
