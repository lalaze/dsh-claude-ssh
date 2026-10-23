import assert from "node:assert/strict";
import { test } from "node:test";
import { asSessionId, type PluginContext, type SessionHeader } from "../dsh.js";
import { registerWorkspaceEligibility } from "./routes.js";
import type { WorkspaceTarget } from "./workspace.js";

type Services = NonNullable<Parameters<typeof registerWorkspaceEligibility>[1]>;
type Stored = SessionHeader | { header: SessionHeader };
const cwd = "/remote/zeGame2";
const models = [{ provider: "claude-code", id: "opus", name: "Remote Opus" }];
const target: WorkspaceTarget = {
  name: "zeGame2", workspaceId: "remote-workspace", path: cwd,
  host: "verified-target", remoteCwd: "/srv/zeGame2", revision: "same-binding", seam: true,
};
const header = (id: string, path: string | undefined = cwd): SessionHeader => ({
  id: asSessionId(id), cwd: path, version: 1, createdAt: 0, isSeeded: false,
});
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
function harness(overrides: Partial<Services> = {}) {
  let fetchRoute!: (request: Request) => Promise<Response>;
  const attached = new Map<string, { header: SessionHeader }>();
  const agents = new Map<string, { session: { header: SessionHeader } }>();
  let stored: Stored[] = [];
  let persistenceReads = 0;
  const checked: Array<{ cwd: string | undefined; sessionId: string }> = [];
  const discovered: WorkspaceTarget[] = [];
  const ctx = {
    agents: { get: (id: string) => agents.get(id) },
    sessions: { get: (id: string) => attached.get(id) },
    sessionPersistence: { list: async () => { persistenceReads++; return stored; } },
    connection: { fetch: { register(route: { path: string; methods: string[]; requestBody: string; fetch: typeof fetchRoute }) {
      assert.equal(route.path, "/api/claude-ssh/workspace-eligibility");
      assert.deepEqual(route.methods, ["POST"]);
      assert.equal(route.requestBody, "buffered");
      fetchRoute = route.fetch;
    } } },
    inject(names: string[], apply: (host: unknown) => void) {
      assert.deepEqual(names, ["connection", "subprocess", "sessionPersistence"]);
      apply(ctx);
    },
  };
  registerWorkspaceEligibility(ctx as unknown as PluginContext, {
    workspaceEligibility: async (path, sessionId) => {
      checked.push({ cwd: path, sessionId });
      return path ? { eligible: true, providerIds: ["claude-code"] } :
        { eligible: false, providerIds: [], reason: "Select a remote workspace first" };
    },
    compatibilityWorkspace: () => target,
    workspaceModels: async value => { discovered.push(value); return models; },
    ...overrides,
  });
  return {
    attached, agents, checked, discovered,
    setStored(value: Stored[]) { stored = value; },
    get persistenceReads() { return persistenceReads; },
    request(sessionId: string) {
      return fetchRoute(new Request("http://localhost/api/claude-ssh/workspace-eligibility", {
        method: "POST", body: JSON.stringify({ sessionId }),
      }));
    },
  };
}

for (const wrapped of [false, true]) {
  test(`cold persisted session discovers its workspace models (${wrapped ? "snapshot" : "legacy header"})`, async () => {
    const h = harness();
    const saved = header("cold");
    h.setStored([wrapped ? { header: saved } : saved]);
    const response = await h.request("cold");
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { eligible: true, providerIds: ["claude-code"], models });
    assert.deepEqual(h.checked, [{ cwd, sessionId: "cold" }]);
    assert.equal(h.discovered.length, 1);
    assert.equal(h.persistenceReads, 2, "re-read durable placement after discovery");
    assert.equal(h.attached.size, 0, "eligibility does not activate a cold session");
  });
}

test("unknown session cannot borrow another persisted session's workspace", async () => {
  const h = harness();
  h.setStored([{ header: header("other") }]);
  const response = await h.request("unknown");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    eligible: false, providerIds: [], reason: "Select a remote workspace first", models: [],
  });
  assert.deepEqual(h.checked, [{ cwd: undefined, sessionId: "unknown" }]);
  assert.equal(h.discovered.length, 0);
});

test("live agent and attached session placement take precedence over persisted headers", async () => {
  const h = harness();
  h.setStored([header("attached", "/stale"), header("agent", "/stale"), header("no-cwd", "/stale")]);
  h.attached.set("attached", { header: header("attached", "/attached") });
  h.attached.set("agent", { header: header("agent", "/attached") });
  h.agents.set("agent", { session: { header: header("agent", "/agent") } });
  h.attached.set("no-cwd", { header: { ...header("no-cwd"), cwd: undefined } });
  for (const id of ["attached", "agent", "no-cwd"]) await h.request(id);
  assert.deepEqual(h.checked, [
    { cwd: "/attached", sessionId: "attached" }, { cwd: "/agent", sessionId: "agent" },
    { cwd: undefined, sessionId: "no-cwd" },
  ]);
  assert.equal(h.persistenceReads, 0);
});

test("concurrent checks accept refreshed equivalent targets for the same workspace", async () => {
  const entered = deferred(), release = deferred();
  let current = target;
  let discoveries = 0;
  const h = harness({
    workspaceEligibility: async () => {
      current = { ...target };
      return { eligible: true, providerIds: ["claude-code"] };
    },
    compatibilityWorkspace: () => current,
    workspaceModels: async () => {
      if (++discoveries === 1) { entered.resolve(); await release.promise; }
      return models;
    },
  });
  h.setStored([header("first"), header("second")]);
  const first = h.request("first");
  await entered.promise;
  const second = await h.request("second");
  release.resolve();
  const responses = [await first, second];
  for (const response of responses) {
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { eligible: true, providerIds: ["claude-code"], models });
  }
});

for (const changed of [
  { revision: "different-binding" }, { host: "different-host" }, { remoteCwd: "/different" },
  { path: "/different-mirror" }, { workspaceId: "different-workspace" },
  { seam: false }, { upstream: true },
] satisfies Partial<WorkspaceTarget>[]) {
  test(`rejects target changes during discovery: ${Object.keys(changed)[0]}`, async () => {
    let current: WorkspaceTarget | undefined = target;
    const h = harness({
      compatibilityWorkspace: () => current,
      workspaceModels: async () => { current = { ...target, ...changed }; return models; },
    });
    h.setStored([header("cold")]);
    const response = await h.request("cold");
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      eligible: false, providerIds: [], reason: "Workspace changed during model discovery",
    });
  });
}

test("rejects a target removed during discovery", async () => {
  let current: WorkspaceTarget | undefined = target;
  const h = harness({
    compatibilityWorkspace: () => current,
    workspaceModels: async () => { current = undefined; return models; },
  });
  h.setStored([header("cold")]);
  const response = await h.request("cold");
  assert.equal(response.status, 400);
  assert.equal((await response.json()).eligible, false);
});

test("rejects persisted cwd changes and session deletion during discovery", async () => {
  for (const replacement of [[header("cold", "/moved")], []]) {
    const h = harness({ workspaceModels: async () => { h.setStored(replacement); return models; } });
    h.setStored([header("cold")]);
    const response = await h.request("cold");
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      eligible: false, providerIds: [], reason: "Workspace changed during verification",
    });
  }
});
