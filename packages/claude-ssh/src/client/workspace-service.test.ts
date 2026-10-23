import assert from "node:assert/strict";
import { Context, Service, symbols } from "@deepseek-ai/cordis";
import { installWorkspaceModels, workspaceModelKey } from "./workspace-models.js";
import type { ClientCtx } from "./shared.js";
import type { WorkspaceModelSelection } from "./workspace-model-types.js";

const keyRows = [{ path: "/remote", workspaceId: "root", title: "before" },
  { path: "/remote/project", workspaceId: "project", title: "before" },
  { path: "/other", workspaceId: "other", title: "before" }];
const key = workspaceModelKey("remote", "/remote/project/subdir", keyRows);
assert.equal(workspaceModelKey("remote", "/remote/project/subdir", keyRows.map(row => ({ ...row, title: "after", updatedAt: 100 }))), key,
  "workspace metadata and unrelated workspaces do not change execution placement");
assert.equal(workspaceModelKey("remote", "/remote/project/subdir", keyRows.filter(row => row.path !== "/other")), key);
assert.notEqual(workspaceModelKey("remote", "/remote/project/subdir", keyRows.map(row => row.workspaceId === "project" ? { ...row, workspaceId: "replacement" } : row)), key);
assert.notEqual(workspaceModelKey("remote", "/remote/project", keyRows), key);
assert.equal(workspaceModelKey("remote", "/remote/project-other", keyRows),
  JSON.stringify(["remote", "/remote/project-other", "root", "/remote"]), "workspace prefix matching honors directory boundaries");

const groups = [
  { id: "deepseek", name: "DeepSeek", models: [{ id: "chat" }] },
  { id: "claude-code-box", name: "Saved box", models: [{ id: "opus" }] },
  { id: "claude-code", name: "Claude", models: [{ id: "opus" }] },
];
class Directory {
  listeners = new Set<() => void>();
  snapshot = { current: null, groups, status: "ready", error: null };
  store = {
    getSnapshot: () => this.snapshot,
    subscribe: (listener: () => void) => {
      this.listeners.add(listener);
      return () => { this.listeners.delete(listener); };
    },
  };
  async load() { return this.snapshot; }
  async select(_selection: WorkspaceModelSelection) { return { ok: true as const, value: undefined }; }
}
class Resolver extends Service {
  directories = { remote: new Directory(), local: new Directory() };
  constructor(ctx: Context) { super(ctx, "modelDirectories"); }
  directoryFor(id: string) { return this.directories[id as keyof typeof this.directories]; }
}
const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const previousFetch = globalThis.fetch;
const root = new Context();
const raw = new Resolver(root);
const original = raw.directoryFor;
const subscribe = () => () => {};
root.provide("sessions", {
  list: { getSnapshot: () => ({ byId: { remote: { cwd: "/remote" }, local: { cwd: "/local" } } }), subscribe },
});
root.provide("workspaces", { list: { getSnapshot: () => ({ items: [] }), subscribe } });
let native!: Resolver;
let installed!: Resolver;
try {
  Object.defineProperty(globalThis, "window", { value: new EventTarget(), configurable: true });
  globalThis.fetch = async (_url, init) => {
    const remote = JSON.parse(String(init?.body)).sessionId === "remote";
    return new Response(JSON.stringify({ eligible: remote, providerIds: remote ? ["claude-code"] : [], models: remote ? [{ id: "opus", name: "Opus 5.5" }] : [] }));
  };
  const consumer = root.plugin((ctx) => {
    native = ctx.get("modelDirectories") as Resolver;
  });
  const installer = root.plugin((ctx) => {
    installed = ctx.get("modelDirectories") as Resolver;
    installWorkspaceModels(ctx as unknown as ClientCtx);
  });
  await consumer.await();
  await installer.await();
  assert.notEqual(installed, native, "each plugin receives its own scoped service proxy");
  assert.equal((installed as unknown as Record<symbol, unknown>)[symbols.original], raw);
  assert.equal((native as unknown as Record<symbol, unknown>)[symbols.original], raw);
  const remote = native.directoryFor("remote");
  assert.deepEqual((await remote.load()).groups.map(group => group.id), ["deepseek", "claude-code"],
    "a native consumer in another Cordis scope sees only the admitted Claude provider");
  assert.deepEqual((await native.directoryFor("local").load()).groups.map(group => group.id), ["deepseek"],
    "local sessions hide every Claude group");
  assert.equal(raw.directories.remote.snapshot.groups, groups, "the shared source catalog stays intact");
  assert.notEqual(raw.directoryFor, original);
  const replies: Array<(response: Response) => void> = [];
  globalThis.fetch = async (_url, init) => {
    if (JSON.parse(String(init?.body)).sessionId !== "remote") return new Response(JSON.stringify({ eligible: false, providerIds: [] }));
    return new Promise<Response>(resolve => { replies.push(resolve); });
  };
  window.dispatchEvent(new Event("focus"));
  assert.deepEqual(remote.store.getSnapshot().groups.map(group => group.id), ["deepseek", "claude-code"],
    "window focus retains the previously accepted Claude group while checking");
  window.dispatchEvent(new Event("omc-ssh-boxes"));
  assert.deepEqual(remote.store.getSnapshot().groups.map(group => group.id), ["deepseek"],
    "SSH target configuration changes immediately revoke the old group");
  assert.equal(remote.store.getSnapshot().status, "loading");
  assert.equal(replies.length, 2, "configuration change replaces the ordinary focus check");
  for (const reply of replies) reply(new Response(JSON.stringify({ eligible: true, providerIds: ["claude-code"], models: [{ id: "opus", name: "Opus 5.5" }] })));
  assert.deepEqual((await remote.load()).groups.map(group => group.id), ["deepseek", "claude-code"]);
  await installer.dispose();
  assert.equal(raw.directoryFor, original, "disposing the installing fiber restores the exact raw method");
  assert.equal(native.directoryFor("remote"), raw.directories.remote,
    "other scopes receive the original directory, with no disposed decorator closure");
  assert.deepEqual((await native.directoryFor("local").load()).groups.map(group => group.id),
    ["deepseek", "claude-code-box", "claude-code"]);
  assert.equal(raw.directories.remote.listeners.size, 0);
  assert.equal(raw.directories.local.listeners.size, 0);
  await consumer.dispose();
} finally {
  await root.fiber.dispose();
  globalThis.fetch = previousFetch;
  if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
  else Reflect.deleteProperty(globalThis, "window");
}
console.log("workspace directory service cross-context lifecycle ok");
