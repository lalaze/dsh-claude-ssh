import { test } from "node:test";
import assert from "node:assert/strict";
import { PassThrough, Writable } from "node:stream";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { workspaceModels, discoveredModelInfo, discoveredModels } from "./catalog.js";
import { ClaudeCodeAdapter } from "../adapter/class.js";
import { Config } from "../adapter/config.js";
import type { PluginContext } from "../dsh.js";
import { pinTarget, REMOTE_PATH } from "./transport.js";
import type { WorkspaceTarget } from "./workspace.js";
import type { SubprocessRuntime, SubprocessSpawnSpec } from "../dsh.js";

const target = (name: string, seam = true): WorkspaceTarget => ({ name, workspaceId: name, path: `/mirror/${name}`, remoteCwd: `/srv/${name}`, revision: "one", seam,
  host: pinTarget({ host: `${name}.example`, port: 2222, username: "alice", destination: "saved-alias", command: "/opt/claude's bin/claude" }) });
function fake(reply?: (request: any, stdout: PassThrough) => void) {
  const stdout = new PassThrough(), stderr = new PassThrough();
  const requests: any[] = [], specs: SubprocessSpawnSpec[] = [];
  let terminations = 0;
  let done!: (result: { exitCode: number | null; signal: string | null }) => void;
  const completion = new Promise<{ exitCode: number | null; signal: string | null }>(resolve => { done = resolve; });
  const stdin = new Writable({ write(chunk, _encoding, callback) {
    const request = JSON.parse(String(chunk)); requests.push(request);
    queueMicrotask(() => reply?.(request, stdout)); callback();
  } });
  const runtime: Pick<SubprocessRuntime, "spawn"> = { spawn(spec) {
    specs.push(spec);
    return { stdin, stdout, stderr, done: completion, terminate() { terminations++; done({ exitCode: null, signal: "SIGTERM" }); }, async waitForExit() { await completion; } };
  } };
  return { runtime, stdout, stderr, requests, specs, done: () => done({ exitCode: 1, signal: null }), get terminations() { return terminations; } };
}
function success(request: any, stdout: PassThrough, payload: unknown) {
  stdout.write(JSON.stringify({ type: "control_response", response: { subtype: "success", request_id: request.request_id, response: payload } }) + "\n");
}

test("seam queries only initialize/list_models and preserves exact unknown ids and CLI capabilities", async () => {
  const ws = target("future");
  const f = fake((request, stdout) => {
    if (request.request.subtype === "initialize") { success(request, stdout, {}); return; }
    // Unrelated responses, banners and split UTF-8 must not corrupt the matching reply.
    stdout.write("startup banner\n");
    success({ request_id: "unrelated" }, stdout, { models: [{ value: "invented" }] });
    const frame = Buffer.from(JSON.stringify({ type: "control_response", response: { subtype: "success", request_id: request.request_id, response: { models: [
      { value: "opus", resolvedModel: "claude-opus-5-5", displayName: "Opus 5.5 新", supportedEffortLevels: ["low", "future", "future"], description: "Actual CLI alias" },
      { value: "claude-future[1m]", displayName: "Future", contextWindow: 1000000, inputModalities: ["text"] },
      { value: "", displayName: "invalid" }, { value: 4 },
    ] } } }) + "\n");
    const split = frame.indexOf(Buffer.from("新")) + 1;
    stdout.write(frame.subarray(0, split)); stdout.write(frame.subarray(split));
  });
  const models = await workspaceModels(ws, ws.path, f.runtime);
  assert.deepEqual(models.map(row => row.id), ["opus", "claude-future[1m]"]);
  assert.deepEqual(models[0], { provider: "claude-code", id: "opus", name: "Opus 5.5 新", description: "Actual CLI alias", reasoning: { efforts: [{ id: "low", name: "low" }, { id: "future", name: "future" }] } });
  assert.deepEqual(discoveredModelInfo("claude-code", "claude-future[1m]")?.context, { contextWindow: 1000000 });
  assert.equal(discoveredModelInfo("claude-code", "claude-opus-5-5"), undefined);
  assert.equal(discoveredModelInfo("other", "opus"), undefined);
  const adapter = new ClaudeCodeAdapter({ on() {} } as unknown as PluginContext, Config({}));
  assert.ok((await adapter.listModels("claude-code")).some(model => model.id === "claude-future[1m]"));
  const prepared = await adapter.prepareCall("claude-code", "opus");
  assert.equal(prepared.model.name, "Opus 5.5 新");
  assert.deepEqual(prepared.model.reasoning?.efforts.map(effort => effort.id), ["low", "future"]);
  adapter.disposeProcesses();
  assert.deepEqual(f.requests.map(row => [row.type, row.request.subtype]), [["control_request", "initialize"], ["control_request", "list_models"]]);
  assert.equal(f.specs[0]!.cwd, ws.path);
  assert.ok(f.specs[0]!.argv[2]!.startsWith(REMOTE_PATH));
  assert.ok(f.specs[0]!.argv[2]!.includes("'/opt/claude'\\''s bin/claude'"));
  assert.ok(f.specs[0]!.argv[2]!.includes("--no-session-persistence"));
  assert.equal(f.terminations, 1);
});

test("discovery registry includes successful targets only and returns defensive snapshots", async () => {
  const first = target("registry-a"), second = target("registry-b");
  for (const [ws, id] of [[first, "registry-only-a"], [second, "registry-only-b"]] as const) {
    const f = fake((request, stdout) => success(request, stdout, request.request.subtype === "initialize" ? {} : { models: [{ value: id, supportedEffortLevels: ["remote-effort"] }] }));
    const rows = await workspaceModels(ws, ws.path, f.runtime); rows[0]!.name = "caller mutation";
  }
  assert.ok(discoveredModels("claude-code").some(row => row.id === "registry-only-a"));
  assert.ok(discoveredModels("claude-code").some(row => row.id === "registry-only-b"));
  assert.deepEqual(discoveredModels("other-provider"), []);
  const model = discoveredModelInfo("claude-code", "registry-only-a")!;
  assert.equal(model.name, "registry-only-a"); model.name = "mutation";
  const registry = discoveredModels("claude-code"); registry.find(row => row.id === model.id)!.name = "another mutation";
  assert.equal(discoveredModelInfo("claude-code", model.id)!.name, "registry-only-a");
  const bad = fake((request, stdout) => success(request, stdout, {}));
  await assert.rejects(workspaceModels(first, first.path, bad.runtime), /no models/);
  assert.equal(discoveredModelInfo("claude-code", "registry-only-a"), undefined);
  assert.ok(discoveredModelInfo("claude-code", "registry-only-b"));
});

test("errors invalidate prior workspace metadata; empty results do not invent fallback models", async () => {
  const ws = target("invalidate");
  const good = fake((request, stdout) => success(request, stdout, request.request.subtype === "initialize" ? {} : { models: [{ value: "unique-invalidate" }] }));
  await workspaceModels(ws, ws.path, good.runtime);
  assert.ok(discoveredModelInfo("claude-code", "unique-invalidate"));
  const bad = fake((request, stdout) => success(request, stdout, {}));
  await assert.rejects(workspaceModels({ ...ws, revision: "two" }, ws.path, bad.runtime), /no models/);
  assert.equal(discoveredModelInfo("claude-code", "unique-invalidate"), undefined);
  assert.equal(bad.terminations, 1);
});

test("initialize rejection may fall back to list_models; list rejection is surfaced", async () => {
  const ws = target("declined");
  const f = fake((request, stdout) => stdout.write(JSON.stringify({ type: "control_response", response: { subtype: "error", request_id: request.request_id, error: "unsupported" } }) + "\n"));
  await assert.rejects(workspaceModels(ws, ws.path, f.runtime), /list_models failed: unsupported/);
  assert.equal(f.requests.length, 2); assert.equal(f.terminations, 1);
});

test("cancellation, premature exit and aggregate output limits terminate promptly", async () => {
  const ws = target("bounds");
  const controller = new AbortController(), cancelled = fake();
  const result = workspaceModels(ws, ws.path, cancelled.runtime, controller.signal);
  controller.abort(new Error("cancelled catalog"));
  await assert.rejects(result, /cancelled catalog/); assert.equal(cancelled.terminations, 1);
  const exited = fake();
  const early = workspaceModels(ws, ws.path, exited.runtime); exited.stderr.write("login unavailable"); exited.done();
  await assert.rejects(early, /exited before model catalog.*login unavailable/);
  for (const stream of ["stdout", "stderr"] as const) {
    const flooded = fake(); const query = workspaceModels(ws, ws.path, flooded.runtime);
    flooded[stream].write(Buffer.alloc(1024 * 1024 + 1));
    await assert.rejects(query, /output limit/); assert.equal(flooded.terminations, 1);
  }
  const aborted = new AbortController(); aborted.abort(); const unused = fake();
  await assert.rejects(workspaceModels(ws, ws.path, unused.runtime, aborted.signal)); assert.equal(unused.specs.length, 0);
});

test("timeout settles even if the handle's done promise never resolves", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const ws = target("timeout"), f = fake();
  const runtime: Pick<SubprocessRuntime, "spawn"> = { spawn(spec) {
    const handle = f.runtime.spawn(spec);
    return { ...handle, done: new Promise(() => {}) };
  } };
  const pending = workspaceModels(ws, ws.path, runtime);
  context.mock.timers.tick(20_000);
  await assert.rejects(pending, /timed out/); assert.equal(f.terminations, 1);
});

test("unverified or mismatched targets fail before spawning", async () => {
  const ws = target("guard"), f = fake();
  await assert.rejects(workspaceModels({ ...ws, host: "unverified" }, ws.path, f.runtime), /verified transport/);
  await assert.rejects(workspaceModels(ws, "/other", f.runtime), /does not match/);
  assert.equal(f.specs.length, 0);
});

test("SSH uses pinned endpoint, strict cwd and configured command without invoking seam", async () => {
  const root = mkdtempSync(join(tmpdir(), "omc-catalog-")), previous = process.env.PATH;
  try {
    const script = join(root, "ssh");
    writeFileSync(script, `#!${process.execPath}\nconst readline = require('node:readline');\nreadline.createInterface({input:process.stdin}).on('line',line=>{const row=JSON.parse(line); const args=process.argv.slice(2); const script=args.at(-1); if(!args.includes('Hostname=ssh.example') || !args.includes('2222') || !args.includes('StrictHostKeyChecking=yes') || !script.includes("cd '/srv/ssh' && exec") || !script.includes('claude')) process.exit(91); console.log(JSON.stringify({type:'control_response',response:{subtype:'success',request_id:row.request_id,response:row.request.subtype==='list_models'?{models:[{value:'ssh-exact-alias',displayName:'Remote only'}]}:{}}}));});\n`);
    chmodSync(script, 0o755); process.env.PATH = `${root}:${previous}`;
    const ws = target("ssh", false);
    const models = await workspaceModels(ws, ws.path, { spawn() { throw new Error("must not use seam"); } });
    assert.deepEqual(models, [{ provider: "claude-code", id: "ssh-exact-alias", name: "Remote only" }]);
  } finally {
    process.env.PATH = previous;
    assert.ok(root.startsWith(join(tmpdir(), "omc-catalog-")));
    rmSync(root, { recursive: true, force: true });
  }
});
