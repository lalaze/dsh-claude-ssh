import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, rmSync, chmodSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { resolveMirror, verifyWorkspace, workspaceEligibility, compatibilityWorkspace, setCompatibilityWorkspaces } from "./workspace.js";
import { pinTarget, pinnedSshArgs } from "./transport.js";
import type { SubprocessRuntime, PluginContext } from "../dsh.js";
import type { GenerateOptions } from "@deepseek-ai/dsh-llm";
import { ClaudeCodeAdapter } from "../adapter/class.js";
import { Config } from "../adapter/config.js";

test("default remote catalog ignores local login and public stream rejects unbound or auxiliary calls", async () => {
  const adapter = new ClaudeCodeAdapter({ on() {} } as unknown as PluginContext, Config({}));
  let replacements = 0;
  adapter.registration = { replace() { replacements++; } };
  adapter.setLoggedIn(false);
  assert.equal(adapter.providerInfo("claude-code").name, "Claude");
  adapter.setLoggedIn(true);
  adapter.setLoggedIn(false);
  assert.equal(adapter.providerInfo("claude-code").name, "Claude");
  assert.equal(replacements, 0, "local Settings login probes cannot change the remote workspace provider");
  assert.ok((await adapter.listModels("claude-code")).length > 0);
  let spawns = 0;
  adapter.subprocess = { spawn() { spawns++; throw new Error("Must not spawn"); } };
  await assert.rejects(adapter.stream({ purpose: "session-title", sessionId: "aux", messages: [] } as unknown as GenerateOptions).next(), /only for user sessions/);
  await assert.rejects(adapter.stream({ messages: [] } as unknown as GenerateOptions).next(), /only for user sessions/);
  await assert.rejects(adapter.stream({ sessionId: "unknown", messages: [] } as unknown as GenerateOptions).next(), /Select a remote workspace/);
  assert.equal(spawns, 0); adapter.disposeProcesses();
});
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "omc-compat-")));
  const registry = join(root, "remote-workspaces"), mirror = join(registry, "machine", "project");
  mkdirSync(mirror, { recursive: true });
  const metaPath = join(mirror, ".dsh-remote-meta.json");
  const meta = { host: "remote.example", port: 2222, username: "remote_user", remotePath: "/srv/project" };
  const save = (overrides: Record<string, unknown> = {}) => writeFileSync(metaPath, JSON.stringify({ ...meta, ...overrides })); save();
  return { root, registry, mirror, metaPath, meta, save, dispose() { assert.ok(root.startsWith(join(realpathSync(tmpdir()), "omc-compat-"))); rmSync(root, { recursive: true, force: true }); } };
}
test("registered mirrors map nested paths and reject malformed origins, forged metadata and escaped symlinks", () => {
  const f = fixture();
  try {
    const nested = join(f.mirror, "quoted ' directory"); mkdirSync(nested);
    assert.equal(resolveMirror(nested, f.registry)?.path, "/srv/project/quoted ' directory");
    const revision = resolveMirror(f.mirror, f.registry)!.revision;
    f.save({ alias: "ignored", password: "ignored" }); assert.equal(resolveMirror(f.mirror, f.registry)!.revision, revision);
    for (const meta of [{ port: "2222" }, { username: "-oProxyCommand=bad" }, { host: "host;bad" }, { remotePath: "relative" }]) { f.save(meta); assert.throws(() => resolveMirror(f.mirror, f.registry)); }
    writeFileSync(f.metaPath, "{broken"); assert.throws(() => resolveMirror(f.mirror, f.registry));
    f.save(); const outside = join(f.root, "outside"); mkdirSync(outside); writeFileSync(join(outside, ".dsh-remote-meta.json"), JSON.stringify(f.meta));
    assert.equal(resolveMirror(outside, f.registry), undefined);
    symlinkSync(outside, join(f.mirror, "escape")); assert.throws(() => resolveMirror(join(f.mirror, "escape"), f.registry));
  } finally { f.dispose(); }
});
test("pinned target keys isolate endpoint revisions while retaining configured SSH aliases", () => {
  const one = pinTarget({ host: "one", port: 2222, username: "u", destination: "alias" });
  const two = pinTarget({ host: "two", port: 22, username: "u", destination: "alias" });
  assert.notEqual(one, two);
  assert.deepEqual(pinnedSshArgs(one), ["-o", "Hostname=one", "-l", "u", "-p", "2222", "-o", "StrictHostKeyChecking=yes", "--", "alias"]);
  assert.throws(() => pinnedSshArgs("dsh-remote-missing"));
});
test("unbound and local subprocess workspaces are ineligible before Claude starts", async () => {
  assert.equal((await workspaceEligibility(undefined, "missing")).eligible, false);
  let scripts: string[] = [];
  const runtime: Pick<SubprocessRuntime, "spawn"> = { spawn(spec) {
    scripts.push(spec.argv.join(" "));
    const child = spawn(spec.argv[0]!, spec.argv.slice(1), { cwd: process.cwd(), stdio: ["pipe", "pipe", "pipe"] });
    const done = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => { child.once("error", reject); child.once("close", (exitCode, signal) => resolve({ exitCode, signal })); });
    return { stdin: child.stdin, stdout: child.stdout, stderr: child.stderr, done, terminate: () => { child.kill(); }, collected: {}, waitForExit: async () => { await done; } };
  } };
  assert.equal((await workspaceEligibility(process.cwd(), "local", undefined, runtime)).eligible, false);
  assert.equal(scripts.length, 1); assert.ok(!scripts[0]!.includes("auth status"));
});
test("mirror endpoint mismatch and metadata drift fail closed before execution", async () => {
  const f = fixture(), previousHome = process.env.DSH_HOME, previousPath = process.env.PATH;
  try {
    process.env.DSH_HOME = f.root;
    const state = join(f.root, "storages", "dsh-claude-ssh"); mkdirSync(state, { recursive: true });
    writeFileSync(join(state, "state.json"), JSON.stringify({ hosts: [{ destination: "saved-alias" }] }));
    const bin = join(f.root, "bin"); mkdirSync(bin);
    const ssh = join(bin, "ssh");
    writeFileSync(ssh, '#!/bin/sh\nif [ "$1" = "-G" ]; then printf "hostname remote.example\\nport 22\\nuser remote_user\\n"; else exit 99; fi\n'); chmodSync(ssh, 0o755);
    process.env.PATH = `${bin}:${previousPath}`;
    await assert.rejects(verifyWorkspace(f.mirror, "mismatch"), /do not match/);
    writeFileSync(ssh, '#!/bin/sh\nif [ "$1" = "-G" ]; then printf "hostname remote.example\\nport 2222\\nuser remote_user\\n"; else printf "far-machine\\000remote_user\\000/srv/project\\000Claude 1.0\\n{\\"loggedIn\\":true}\\n"; fi\n');
    const target = await verifyWorkspace(f.mirror, "valid"); assert.equal(target.remoteCwd, "/srv/project");
    assert.deepEqual(await workspaceEligibility(f.mirror, "valid"), { eligible: true, providerIds: ["claude-code"] });
    const loggedInSsh = readFileSync(ssh, "utf8");
    writeFileSync(ssh, loggedInSsh.replace("true", "false"));
    const loggedOut = await workspaceEligibility(f.mirror, "valid");
    assert.equal(loggedOut.eligible, false);
    assert.deepEqual(loggedOut.providerIds, []);
    assert.match(loggedOut.reason!, /not logged in on the remote host/);
    writeFileSync(ssh, loggedInSsh);
    const seamCalls: string[] = [];
    const runtime: Pick<SubprocessRuntime, "spawn"> = { spawn(spec) {
      seamCalls.push(spec.cwd);
      const script = spec.argv[2]!.includes("uname") ? "printf 'far-machine\\000remote_user\\000/srv/project\\000'" : "printf 'Claude 1.0\\n{\"loggedIn\":true}\\n'";
      const child = spawn("/bin/sh", ["-c", script], { stdio: ["pipe", "pipe", "pipe"] });
      const done = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => { child.once("error", reject); child.once("close", (exitCode, signal) => resolve({ exitCode, signal })); });
      return { stdin: child.stdin, stdout: child.stdout, stderr: child.stderr, done, terminate: () => { child.kill(); }, collected: {}, waitForExit: async () => { await done; } };
    } };
    const seam = await verifyWorkspace("/native/remote/project", "seam", undefined, false, runtime);
    assert.equal(seam.seam, true); assert.equal(seam.remoteCwd, "/srv/project"); assert.deepEqual(seamCalls, ["/native/remote/project", "/native/remote/project"]);
    const standIn = join(f.root, "stand-in"); mkdirSync(standIn);
    setCompatibilityWorkspaces([{ path: standIn, host: "saved-alias", remoteCwd: "/srv/project", workspaceId: "workspace", name: "Remote" }]);
    const upstream = await verifyWorkspace(standIn, "upstream"); assert.equal(upstream.upstream, true); assert.equal(upstream.remoteCwd, "/srv/project");
    setCompatibilityWorkspaces([]); assert.throws(() => compatibilityWorkspace(standIn), /binding changed/);
    f.save({ remotePath: "/srv/changed" }); assert.throws(() => compatibilityWorkspace(f.mirror), /binding changed/);
  } finally { if (previousHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previousHome; process.env.PATH = previousPath; f.dispose(); }
});
