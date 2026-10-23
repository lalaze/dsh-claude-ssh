import assert from "node:assert/strict";
import { installWorkspaceModels } from "./workspace-models.js";
import type { ClientCtx } from "./shared.js";
import { workspaceDirectory, type DirectorySnapshot } from "./workspace-directory.js";
import type { WorkspaceEligibility } from "./workspace-eligibility.js";
import type { WorkspaceModelSelection } from "./workspace-model-types.js";

const allowed: WorkspaceEligibility = { eligible: true, providerIds: ["claude-code"], models: [{ id: "opus", name: "Remote Opus", reasoning: { efforts: [{ id: "high", name: "High" }] } }] };
const denied: WorkspaceEligibility = { eligible: false, providerIds: [], reason: "remote login required" };
const groups = Object.freeze([
  { id: "deepseek", name: "DeepSeek", models: [{ id: "chat" }] },
  { id: "claude-code-lalaze-mac-mini", name: "lalaze 的 Mac mini", models: [{ id: "opus" }] },
  { id: "claude-code", name: "Claude", models: [{ id: "opus", reasoning: { efforts: [{ id: "high", name: "High" }] } }] },
]);
class HostDirectory {
  #loads = 0;
  selected: WorkspaceModelSelection[] = [];
  result = { ok: false, error: { code: "session/writer-held", message: "Session is in use" } };
  listeners = new Set<() => void>();
  snapshot: DirectorySnapshot & { status: string; pending: null; error: null } = {
    current: { provider: "deepseek", model: "chat" }, groups,
    failures: [{ id: "claude-code-offline" }, { id: "other-offline" }],
    routable: true, status: "ready", pending: null, error: null,
  };
  store = {
    getSnapshot: () => this.snapshot,
    subscribe: (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; },
  };
  async load() { this.#loads++; return this.snapshot; }
  async select(selection: WorkspaceModelSelection) { this.selected.push(selection); return this.result; }
  loadCount() { return this.#loads; }
}
const ids = (snapshot: DirectorySnapshot) => snapshot.groups?.map(group => group.id);
{
  const source = new HostDirectory();
  let origin = "/remote/project";
  let response = allowed;
  const directory = workspaceDirectory(source, { key: () => origin, check: async () => response });
  const view = directory.view;
  assert.deepEqual(ids(view.store.getSnapshot()), ["deepseek"], "native menus start fail closed");
  assert.equal(view.store.getSnapshot(), view.store.getSnapshot(), "React external-store snapshots remain stable");
  let updates = 0;
  const unsubscribe = view.store.subscribe(() => { updates++; });
  const loaded = await view.load();
  assert.deepEqual(ids(loaded), ["deepseek", "claude-code"], "native dropdown and /model load the same single Claude group");
  assert.equal(view.loadCount(), 1, "unwrapped host methods retain their class receiver");
  assert.equal(loaded.status, "ready");
  assert.deepEqual(loaded.failures?.map(failure => failure.id), ["other-offline"]);
  assert.equal(source.store.getSnapshot().groups, groups, "host-wide shared catalog is unchanged");
  assert.equal(source.store.getSnapshot().groups?.length, 3);
  assert.ok(updates > 0, "eligibility publication reaches native menu subscribers");
  const result = await view.select({ provider: "claude-code", model: "opus", reasoningEffort: "high" });
  assert.equal(result, source.result, "native selection receives the original rejected Result");
  assert.equal(source.selected.length, 1);
  const otherBox = await view.select({ provider: "claude-code-lalaze-mac-mini", model: "opus" });
  assert.equal(otherBox.ok, false); assert.match(otherBox.error.message, /unavailable/);
  const unsupported = await view.select({ provider: "claude-code", model: "opus", reasoningEffort: "unsupported" });
  assert.equal(unsupported.ok, false); assert.match(unsupported.error.message, /reasoning effort/);
  origin = "/local/project";
  assert.deepEqual(ids(view.store.getSnapshot()), ["deepseek"], "workspace changes hide stale Claude entries before a new request completes");
  response = denied;
  await directory.refresh();
  assert.deepEqual(ids(view.store.getSnapshot()), ["deepseek"]);
  const noLogin = await view.select({ provider: "claude-code", model: "opus" });
  assert.equal(noLogin.ok, false); assert.match(noLogin.error.message, /remote login required/);
  const count = source.selected.length;
  await view.select({ provider: "deepseek", model: "chat" });
  assert.equal(source.selected.length, count + 1, "other providers remain selectable when Claude verification fails");
  unsubscribe();
  directory.dispose();
  assert.equal(source.listeners.size, 0);
  assert.equal(view.store.getSnapshot(), source.snapshot, "disposal restores the original view for retained readers");
}
{
  const source = new HostDirectory();
  let settle!: (value: WorkspaceEligibility) => void;
  const pending = new Promise<WorkspaceEligibility>(resolve => { settle = resolve; });
  const directory = workspaceDirectory(source, { key: () => "cwd", check: () => pending });
  const selection = directory.view.select({ provider: "claude-code", model: "opus" });
  directory.dispose();
  settle(allowed);
  const result = await selection;
  assert.equal(result.ok, false); assert.match(result.error.message, /unavailable/);
  assert.equal(source.selected.length, 0, "an eligibility reply after teardown cannot select a model");
}
{
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousFetch = globalThis.fetch;
  Object.defineProperty(globalThis, "window", { value: new EventTarget(), configurable: true });
  const remote = new HostDirectory(), local = new HostDirectory();
  const sessions = { remote: { cwd: "/remote" }, local: { cwd: "/local" } };
  const resolver = {
    directoryFor(id: string) {
      assert.equal(this, resolver, "host resolver retains its original receiver");
      return id === "remote" ? remote : local;
    },
  };
  const original = resolver.directoryFor;
  let dispose!: () => void;
  try {
    globalThis.fetch = async (_url, init) => new Response(JSON.stringify(
      JSON.parse(String(init?.body)).sessionId === "remote" ? allowed : denied,
    ));
    const ctx = {
      modelDirectories: resolver,
      sessions: { list: { getSnapshot: () => ({ byId: sessions }), subscribe: () => () => {} } },
      workspaces: { list: { getSnapshot: () => ({ items: [] }), subscribe: () => () => {} } },
      effect: (effect: () => () => void) => { dispose = effect(); },
      slots: { inject() { assert.fail("the native picker must not be replaced"); } },
    } as unknown as ClientCtx;
    installWorkspaceModels(ctx);
    const nativeRemote = resolver.directoryFor("remote");
    assert.equal(resolver.directoryFor("remote"), nativeRemote, "all native consumers share the session view");
    assert.deepEqual(ids(await nativeRemote.load()), ["deepseek", "claude-code"]);
    assert.deepEqual(ids(await resolver.directoryFor("local").load()), ["deepseek"]);
    assert.equal(remote.snapshot.groups, groups);
    assert.equal(local.snapshot.groups, groups);
    dispose();
    assert.equal(resolver.directoryFor, original);
    assert.equal(remote.listeners.size, 0);
    assert.equal(local.listeners.size, 0);
  } finally {
    dispose?.();
    globalThis.fetch = previousFetch;
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
}
{
  const source = new HostDirectory();
  const remoteModels = [{ id: "opus", name: "Opus 5.5", reasoning: { efforts: [{ id: "xhigh", name: "xhigh" }] } },
    { id: "future-model-from-cli", name: "Future CLI model" }];
  const directory = workspaceDirectory(source, { key: () => "new-cli", check: async () => ({ ...allowed, models: remoteModels }) });
  const snapshot = await directory.view.load();
  const claude = snapshot.groups?.find(group => group.id === "claude-code");
  assert.deepEqual(claude?.models, remoteModels, "replace static model rows with the exact remote CLI lineup");
  assert.equal((await directory.view.select({ provider: "claude-code", model: "future-model-from-cli" })), source.result);
  assert.equal(source.selected.at(-1)?.model, "future-model-from-cli");
  directory.dispose();
  const missing = workspaceDirectory(source, { key: () => "old-server", check: async () => ({ eligible: true, providerIds: ["claude-code"] }) });
  assert.deepEqual(ids(await missing.view.load()), ["deepseek"], "missing remote catalog must not expose template fallback models");
  missing.dispose();
}
{
  const source = new HostDirectory();
  let resolve!: (value: WorkspaceEligibility) => void;
  let pending = new Promise<WorkspaceEligibility>(done => { resolve = done; });
  let checks = 0;
  const directory = workspaceDirectory(source, { key: () => "same-cwd", check: () => { checks++; return pending; } });
  const loading = directory.view.load();
  let loaded = false;
  void loading.then(() => { loaded = true; });
  const concurrent = directory.refresh();
  assert.equal(checks, 1, "menu load and focus share the current workspace check");
  assert.equal(directory.view.store.getSnapshot().status, "loading", "an unverified menu reports loading rather than ready/empty");
  await Promise.resolve();
  assert.equal(loaded, false);
  resolve(allowed);
  await concurrent;
  assert.deepEqual(ids(await loading), ["deepseek", "claude-code"]);
  pending = new Promise<WorkspaceEligibility>(done => { resolve = done; });
  const refresh = directory.refresh();
  assert.deepEqual(ids(directory.view.store.getSnapshot()), ["deepseek", "claude-code"], "focus refresh retains the visible Claude row");
  assert.equal(directory.view.store.getSnapshot().status, "ready");
  resolve(denied);
  await refresh;
  assert.deepEqual(ids(directory.view.store.getSnapshot()), ["deepseek"], "a completed rejection removes Claude");
  pending = Promise.resolve(allowed);
  await directory.refresh();
  directory.invalidate();
  assert.deepEqual(ids(directory.view.store.getSnapshot()), ["deepseek"], "configuration invalidation revokes cached rows immediately");
  directory.dispose();
}
console.log("native workspace directory ok");
