// Offline self-check: node --import tsx src/client/workspace-eligibility.test.ts.
import assert from "node:assert/strict";
import {
  checkWorkspaceEligibility,
  isClaudeProvider,
  parseWorkspaceEligibility,
  visibleWorkspaceGroups,
  WorkspaceEligibilityGate,
  type WorkspaceEligibility,
} from "./workspace-eligibility.js";
import { selectWorkspaceModel } from "./workspace-model-selection.js";

const allowed: WorkspaceEligibility = { eligible: true, providerIds: ["claude-code"] };
const denied: WorkspaceEligibility = { eligible: false, reason: "local", providerIds: [] };
const groups = Object.freeze([
  Object.freeze({ id: "deepseek", models: [{ id: "chat" }] }),
  Object.freeze({ id: "claude-code", models: [{ id: "sonnet" }] }),
  Object.freeze({ id: "claude-code-box", models: [{ id: "opus" }] }),
  Object.freeze({ id: "claude-workspace", models: [{ id: "legacy" }] }),
  Object.freeze({ id: "other", models: [{ id: "other" }] }),
]);
const ids = (value?: WorkspaceEligibility) => visibleWorkspaceGroups(groups, value).map((g) => g.id);
assert.deepEqual(ids(), ["deepseek", "other"], "unverified/local defaults hide every Claude group");
assert.deepEqual(ids(denied), ["deepseek", "other"]);
assert.deepEqual(ids(allowed), ["deepseek", "claude-code", "other"]);
assert.deepEqual(ids({ eligible: true, providerIds: ["claude-code-box"] }), ["deepseek", "claude-code-box", "other"]);
assert.equal(visibleWorkspaceGroups(groups, allowed)[0], groups[0], "catalog objects remain untouched");
assert.equal(groups.length, 5);
assert.equal(isClaudeProvider("claude-code"), true);
assert.equal(isClaudeProvider("claude-code-box"), true);
assert.equal(isClaudeProvider("claude-codeish"), false);
for (const value of [null, {}, { eligible: true }, { eligible: "true", providerIds: [] }, { eligible: true, providerIds: [4] }, { ok: true, value: allowed }]) {
  assert.throws(() => parseWorkspaceEligibility(value), /Invalid workspace eligibility/);
}

function pending<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

// A cwd change hides an old successful result synchronously, even before the listener runs.
{
  let cwd = "/remote/project";
  const gate = new WorkspaceEligibilityGate(() => cwd, async () => allowed);
  await gate.refresh();
  assert.equal(gate.getSnapshot()?.eligible, true);
  cwd = "/local/project";
  assert.equal(gate.getSnapshot(), undefined);
  gate.dispose();
}

// Session eligibility is isolated, and an in-flight reply for an old cwd is discarded.
{
  let cwd = "/remote";
  const answer = pending<WorkspaceEligibility>();
  const remote = new WorkspaceEligibilityGate(() => cwd, () => answer.promise);
  const local = new WorkspaceEligibilityGate(() => "/local", async () => denied);
  const request = remote.refresh();
  await local.refresh();
  cwd = "/changed";
  answer.resolve(allowed);
  assert.equal(await request, undefined);
  assert.equal(remote.getSnapshot(), undefined);
  assert.equal(local.getSnapshot()?.eligible, false);
  remote.dispose();
  local.dispose();
}

// Superseded requests cannot republish eligibility, including fetch implementations ignoring abort.
{
  const first = pending<WorkspaceEligibility>();
  const second = pending<WorkspaceEligibility>();
  const signals: AbortSignal[] = [];
  const gate = new WorkspaceEligibilityGate(() => "cwd", (signal) => {
    signals.push(signal);
    return signals.length === 1 ? first.promise : second.promise;
  });
  const old = gate.refresh();
  gate.invalidate();
  const fresh = gate.refresh();
  assert.equal(signals[0]!.aborted, true);
  second.resolve(denied);
  await fresh;
  first.resolve(allowed);
  assert.equal(await old, undefined);
  assert.equal(gate.getSnapshot()?.eligible, false);
  gate.dispose();
}

// A configuration event immediately clears cached eligibility and aborts pending verification.
{
  const answer = pending<WorkspaceEligibility>();
  let signal!: AbortSignal;
  const gate = new WorkspaceEligibilityGate(() => "same-cwd", (s) => { signal = s; return answer.promise; });
  const request = gate.refresh();
  gate.invalidate();
  assert.equal(signal.aborted, true);
  answer.resolve(allowed);
  assert.equal(await request, undefined);
  assert.equal(gate.getSnapshot(), undefined);
  gate.dispose();
}

// Unmount cancellation is silent and cannot resurrect the catalog.
{
  const answer = pending<WorkspaceEligibility>();
  let signal!: AbortSignal;
  const gate = new WorkspaceEligibilityGate(() => "cwd", (s) => { signal = s; return answer.promise; });
  const request = gate.refresh();
  gate.dispose();
  assert.equal(signal.aborted, true);
  answer.resolve(allowed);
  assert.equal(await request, undefined);
  assert.equal(gate.getSnapshot(), undefined);
  assert.equal(await gate.refresh(), undefined);
}

// Network errors fail closed while other providers remain usable.
{
  const gate = new WorkspaceEligibilityGate(() => "cwd", async () => { throw new Error("offline"); });
  const result = await gate.refresh();
  assert.equal(result?.eligible, false);
  assert.deepEqual(ids(result), ["deepseek", "other"]);
  gate.dispose();
}

// Selection always rechecks, so eligibility revoked since open cannot be committed.
{
  let result = allowed;
  let checks = 0;
  let selected = 0;
  const gate = new WorkspaceEligibilityGate(() => "cwd", async () => { checks++; return result; });
  await gate.refresh();
  result = denied;
  const options = { gate, canSelect: () => true, catalog: () => groups, select: async () => { selected++; } };
  await assert.rejects(selectWorkspaceModel({ provider: "claude-code", model: "sonnet" }, options), /local/);
  assert.equal(checks, 2);
  assert.equal(selected, 0);
  assert.equal(await selectWorkspaceModel({ provider: "deepseek", model: "chat" }, options), true);
  assert.equal(selected, 1, "a denied Claude workspace must retain non-Claude model selection");
  assert.equal(checks, 2, "other providers do not depend on Claude verification availability");
  gate.dispose();
}

// Locks acquired during verification and unmounts prevent the eventual selection.
for (const stop of ["lock", "unmount"] as const) {
  const answer = pending<WorkspaceEligibility>();
  let canSelect = true;
  let selected = false;
  const gate = new WorkspaceEligibilityGate(() => "cwd", () => answer.promise);
  const selection = selectWorkspaceModel({ provider: "claude-code", model: "sonnet" }, {
    gate, canSelect: () => canSelect, catalog: () => groups,
    select: async () => { selected = true; },
  });
  canSelect = false;
  if (stop === "unmount") gate.dispose();
  answer.resolve(allowed);
  assert.equal(await selection, false);
  assert.equal(selected, false);
  gate.dispose();
}

// An already locked picker must not even start verification; catalog/effort disappearances are checked.
{
  let checks = 0;
  const gate = new WorkspaceEligibilityGate(() => "cwd", async () => { checks++; return allowed; });
  const options = { gate, canSelect: () => false, catalog: () => groups, select: async () => { assert.fail("locked"); } };
  assert.equal(await selectWorkspaceModel({ provider: "claude-code", model: "sonnet" }, options), false);
  assert.equal(checks, 0);
  const enabled = { ...options, canSelect: () => true };
  await assert.rejects(selectWorkspaceModel({ provider: "claude-code", model: "removed" }, enabled), /no longer available/);
  await assert.rejects(selectWorkspaceModel({ provider: "claude-code", model: "sonnet", reasoningEffort: "unsupported" }, enabled), /reasoning effort/);
  gate.dispose();
}

// The direct endpoint contract includes the session, request credentials and caller's abort signal.
{
  const originalFetch = globalThis.fetch;
  const abort = new AbortController();
  try {
    globalThis.fetch = async (url, init) => {
      assert.equal(url, "/api/claude-ssh/workspace-eligibility");
      assert.equal(init?.method, "POST");
      assert.equal(init?.credentials, "same-origin");
      assert.equal(init?.signal, abort.signal);
      assert.deepEqual(JSON.parse(String(init?.body)), { sessionId: "session-a" });
      return new Response(JSON.stringify(allowed), { status: 200 });
    };
    assert.deepEqual(await checkWorkspaceEligibility("session-a", abort.signal), allowed);
    globalThis.fetch = async () => new Response("unavailable", { status: 503 });
    await assert.rejects(checkWorkspaceEligibility("session-a", abort.signal), /503/);
  } finally { globalThis.fetch = originalFetch; }
}
// Rechecks for one binding share their in-flight result and retain the accepted catalog.
for (const outcome of ["allowed", "denied", "error"] as const) {
  const answer = pending<WorkspaceEligibility>();
  let first = true;
  let checks = 0;
  const gate = new WorkspaceEligibilityGate(() => "same-cwd", async () => {
    checks++;
    if (first) { first = false; return allowed; }
    const value = await answer.promise;
    if (outcome === "error") throw new Error("offline");
    return value;
  });
  await gate.refresh();
  const accepted = gate.getSnapshot();
  const check = gate.refresh();
  assert.equal(gate.refresh(), check, "same-key refreshes share one promise");
  assert.equal(checks, 2);
  assert.equal(gate.isPending(), true);
  assert.equal(gate.getSnapshot(), accepted, "pending same-key recheck keeps its accepted snapshot");
  answer.resolve(outcome === "allowed" ? allowed : denied);
  await check;
  assert.equal(gate.isPending(), false);
  assert.equal(gate.getSnapshot()?.eligible, outcome === "allowed", "rejection and errors revoke acceptance");
  gate.dispose();
}

// Explicit configuration invalidation revokes an already accepted catalog synchronously.
{
  const gate = new WorkspaceEligibilityGate(() => "cwd", async () => allowed);
  await gate.refresh();
  gate.invalidate();
  assert.equal(gate.getSnapshot(), undefined);
  assert.equal(gate.isPending(), false);
  gate.dispose();
}
console.log("workspace eligibility ok");
