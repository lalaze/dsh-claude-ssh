import { readFileSync, realpathSync, statSync, mkdirSync, writeFileSync, renameSync } from "node:fs";
import { homedir, hostname, userInfo } from "node:os";
import { isAbsolute, join, relative, resolve, sep, posix } from "node:path";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import type { SubprocessRuntime } from "../dsh.js";
import { STATE_DIR } from "../state.js";
import { normalizedHost, pinTarget, REMOTE_PATH, type Endpoint } from "./transport.js";

interface Host { destination: string; port?: number; claudePath?: string }
export interface Mirror extends Endpoint { mirrorDir: string; path: string; revision: string }
interface UpstreamWorkspace { path: string; host: string; remoteCwd: string; workspaceId: string; name: string }
let upstreamWorkspaces: readonly UpstreamWorkspace[] = [];
export function setCompatibilityWorkspaces(rows: readonly UpstreamWorkspace[]): void { upstreamWorkspaces = rows; }
const upstreamAt = (cwd: string) => upstreamWorkspaces.find(row => row.path === cwd);
const upstreamRevision = (row: UpstreamWorkspace) => createHash("sha256").update(JSON.stringify(row)).digest("hex");
export interface WorkspaceTarget { name: string; workspaceId: string; path: string; host: string; remoteCwd: string; revision: string; seam?: boolean; upstream?: boolean }
export interface Eligibility { eligible: boolean; providerIds: string[]; reason?: string }
const home = () => process.env.DSH_HOME?.trim() || join(homedir(), ".dsh");
const under = (root: string, path: string) => { const r = relative(root, path); return r === "" || (!r.startsWith(`..${sep}`) && r !== ".." && !isAbsolute(r)); };
const absolute = (path: unknown): string => {
  if (typeof path !== "string" || !path.startsWith("/") || /[\0\r\n]/.test(path)) throw new Error("Invalid remote absolute directory");
  return path;
};
const destinationPattern = /^(?:[a-zA-Z0-9_][a-zA-Z0-9_.-]*@)?(?:[a-zA-Z0-9_][a-zA-Z0-9_.-]*|\[[a-fA-F0-9:]+\])$/;
function validHost(host: Host): boolean {
  return typeof host.destination === "string" && destinationPattern.test(host.destination) && (host.port === undefined || (Number.isInteger(host.port) && host.port >= 1 && host.port <= 65535));
}
/** Only dsh-remote's durable registered layout supplies a remote origin. */
export function resolveMirror(cwd: string, registryRoot = join(home(), "remote-workspaces")): Mirror | undefined {
  const root = resolve(registryRoot), local = resolve(cwd);
  if (!under(root, local)) return undefined;
  const parts = relative(root, local).split(sep);
  if (parts.length < 2 || !parts[0] || !parts[1]) throw new Error("Invalid dsh-remote workspace binding");
  const mirrorDir = join(root, parts[0], parts[1]);
  try {
    const metaPath = join(mirrorDir, ".dsh-remote-meta.json");
    const realRoot = realpathSync(root), realMirror = realpathSync(mirrorDir);
    if (!under(realRoot, realMirror) || !under(realMirror, realpathSync(local)) || !under(realMirror, realpathSync(metaPath))) throw new Error("Escaped mirror");
    const stat = statSync(metaPath);
    if (!stat.isFile() || stat.size > 65536) throw new Error("Invalid metadata file");
    const meta = JSON.parse(readFileSync(metaPath, "utf8"));
    if (typeof meta.host !== "string" || typeof meta.username !== "string" || !/^[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/.test(meta.username)) throw new Error("Invalid endpoint");
    const port = meta.port === undefined ? 22 : meta.port;
    const host = normalizedHost(meta.host);
    const destination = `${meta.username}@${host.includes(":") ? `[${host}]` : host}`;
    if (!validHost({ destination, port })) throw new Error("Invalid endpoint");
    const path = posix.join(absolute(meta.remotePath), ...parts.slice(2));
    const revision = createHash("sha256").update(JSON.stringify([realMirror, host, port, meta.username, path])).digest("hex");
    return { mirrorDir, host, port, username: meta.username, path, revision };
  } catch { throw new Error("Cannot read a valid dsh-remote workspace binding; select the remote workspace again"); }
}
function json(path: string): any {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
export function configuredHosts(): Host[] {
  const legacy = json(join(home(), "storages", "dsh-claude-ssh", "state.json"));
  const boxes = json(join(STATE_DIR, "ssh-boxes.json"));
  const rows = Array.isArray(boxes) ? boxes : boxes?.boxes ?? [];
  return [...(legacy?.hosts ?? []), ...rows.map((box: { host: string }) => ({ destination: box.host }))].filter(validHost);
}
function execute(file: string, args: string[], signal?: AbortSignal): Promise<string> {
  return new Promise((accept, reject) => execFile(file, args, { signal, timeout: 20000, maxBuffer: 1024 * 1024 }, (error, stdout) => error ? reject(error) : accept(stdout)));
}
export async function endpointFor(host: Host, signal?: AbortSignal): Promise<Endpoint> {
  const output = await execute("ssh", ["-G", ...(host.port ? ["-p", String(host.port)] : []), "--", host.destination], signal);
  const values = new Map(output.split(/\r?\n/).map(line => { const i = line.indexOf(" "); return [line.slice(0, i), line.slice(i + 1).trim()]; }));
  return { host: normalizedHost(values.get("hostname") ?? ""), port: Number(values.get("port")), username: values.get("user") ?? "" };
}
const verified = new Map<string, WorkspaceTarget>();
/** Synchronous lookup is checked against disk on every upstream transport lookup. */
export function compatibilityWorkspace(cwd: string): WorkspaceTarget | undefined {
  const target = verified.get(cwd);
  if (!target) return undefined;
  const upstream = upstreamAt(cwd);
  const currentRevision = target.upstream ? (upstream ? upstreamRevision(upstream) : undefined) : resolveMirror(cwd)?.revision;
  if (!target.seam && currentRevision !== target.revision) throw new Error("Remote workspace binding changed; create a new session");
  return target;
}
const bindingPath = join(STATE_DIR, "compatibility-bindings.json");
export async function verifyWorkspace(cwd: string, sessionId: string, signal?: AbortSignal, bind = false, runtime?: Pick<SubprocessRuntime, "spawn">): Promise<WorkspaceTarget> {
  let mirror = resolveMirror(cwd);
  const upstream = upstreamAt(cwd);
  if (!mirror && upstream) {
    if (!validHost({ destination: upstream.host })) throw new Error("Invalid upstream SSH target");
    const endpoint = await endpointFor({ destination: upstream.host }, signal);
    mirror = { ...endpoint, mirrorDir: cwd, path: absolute(upstream.remoteCwd), revision: upstreamRevision(upstream) };
  }
  if (!mirror && under(join(STATE_DIR, "remote-workspaces"), resolve(cwd))) throw new Error("This remote workspace was removed; add the same folder on the same box again");
  if (!mirror) return verifySeamWorkspace(cwd, sessionId, signal, bind, runtime);
  const bindings: Record<string, string> = json(bindingPath) ?? {};
  const original = bindings[sessionId];
  const matches = configuredHosts();
  for (const configured of matches) {
    let endpoint: Endpoint;
    try { endpoint = await endpointFor(configured, signal); } catch (error) { if (signal?.aborted) throw error; continue; }
    if (endpoint.host !== mirror.host || endpoint.port !== mirror.port || endpoint.username !== mirror.username) continue;
    const fingerprint = JSON.stringify([cwd, mirror.revision, configured]);
    if (original && original !== fingerprint) throw new Error("Remote workspace or SSH configuration changed; create a new session");
    const host = pinTarget({ ...endpoint, destination: configured.destination, command: configured.claudePath });
    const command = configured.claudePath || "claude";
    const quote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;
    const args = ["-o", `Hostname=${endpoint.host}`, "-l", endpoint.username, "-p", String(endpoint.port), "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes", "-o", "ConnectTimeout=12", "--", configured.destination];
    const output = await execute("ssh", [...args, `${REMOTE_PATH}cd ${quote(mirror.path)} && printf '%s\\0%s\\0%s\\0' "$(uname -n)" "$(id -un)" "$(pwd -P)" && ${quote(command)} --version && ${quote(command)} auth status`], signal);
    const [machine, user, remotePath, status] = output.split("\0");
    if (!machine || user !== mirror.username || !remotePath || (machine === hostname() && user === userInfo().username)) throw new Error("Workspace is local or does not match the configured remote user");
    const authStart = status?.indexOf("{") ?? -1;
    if (authStart < 0 || JSON.parse(status!.slice(authStart)).loggedIn !== true) throw new Error("Claude is not logged in on the remote host");
    const currentUpstream = upstreamAt(cwd);
    const currentRevision = upstream ? (currentUpstream ? upstreamRevision(currentUpstream) : undefined) : resolveMirror(cwd)?.revision;
    if (currentRevision !== mirror.revision) throw new Error("Remote workspace binding changed during verification");
    const identity = JSON.stringify([fingerprint, machine, user, remotePath]);
    const identityKey = `${sessionId}:identity`;
    if (bindings[identityKey] && bindings[identityKey] !== identity) throw new Error("Remote execution identity changed; create a new session");
    if (bind) {
      const latest: Record<string, string> = json(bindingPath) ?? {};
      latest[sessionId] = fingerprint; latest[identityKey] = identity;
      mkdirSync(STATE_DIR, { recursive: true });
      const temporary = `${bindingPath}.${process.pid}.tmp`;
      writeFileSync(temporary, JSON.stringify(latest), { mode: 0o600 });
      renameSync(temporary, bindingPath);
    }
    const target = { name: upstream?.name ?? "dsh-remote", workspaceId: upstream?.workspaceId ?? "", path: cwd, host, remoteCwd: absolute(remotePath), revision: mirror.revision, upstream: Boolean(upstream) };
    verified.set(cwd, target);
    return target;
  }
  throw new Error("The workspace host, user and port do not match a saved Claude SSH target");
}
export async function seamRun(runtime: Pick<SubprocessRuntime, "spawn">, cwd: string, script: string, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  const handle = runtime.spawn({ argv: ["/bin/sh", "-c", REMOTE_PATH + script], cwd, env: { LC_ALL: "C" }, stdio: { stdin: "pipe", stdout: "pipe", stderr: "pipe" }, graceMs: 1500 });
  if (!handle.stdin || !handle.stdout || !handle.stderr) { handle.terminate(); void handle.done.catch(() => {}); throw new Error("Workspace process service did not provide bidirectional pipes"); }
  let out = "", err = "";
  handle.stdout.on("data", chunk => { out += String(chunk); });
  handle.stderr.on("data", chunk => { err += String(chunk); });
  handle.stdin.end();
  const abort = () => handle.terminate();
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, 20000);
  try { const result = await handle.done; signal?.throwIfAborted(); if (result.exitCode !== 0) throw new Error(err || "Workspace process verification failed"); return out; }
  finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
}
async function verifySeamWorkspace(cwd: string, sessionId: string, signal: AbortSignal | undefined, bind: boolean, runtime?: Pick<SubprocessRuntime, "spawn">): Promise<WorkspaceTarget> {
  if (!runtime) throw new Error("Workspace has no DSH process service");
  const quote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;
  const identityScript = `printf '%s\\0%s\\0%s\\0' "$(uname -n)" "$(id -un)" "$(pwd -P)"`;
  const identity = await seamRun(runtime, cwd, `test -r . && test -x . && ${identityScript}`, signal);
  const [machine, user, remotePath] = identity.split("\0");
  if (!machine || !user || !remotePath || (machine === hostname() && user === userInfo().username)) throw new Error("Claude remote models are unavailable in a local workspace");
  for (const configured of configuredHosts()) {
    const args = ["-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes", "-o", "ConnectTimeout=12", ...(configured.port ? ["-p", String(configured.port)] : []), "--", configured.destination];
    let other: string;
    try { other = await execute("ssh", [...args, identityScript], signal); } catch (error) { if (signal?.aborted) throw error; continue; }
    const [otherMachine, otherUser] = other.split("\0");
    if (otherMachine !== machine || otherUser !== user) continue;
    const endpoint = await endpointFor(configured, signal);
    const fingerprint = JSON.stringify([cwd, machine, user, remotePath, configured]);
    const bindings: Record<string, string> = json(bindingPath) ?? {};
    if (bindings[sessionId] && bindings[sessionId] !== fingerprint) throw new Error("Remote execution identity changed; create a new session");
    const command = configured.claudePath || "claude";
    const status = await seamRun(runtime, cwd, `${quote(command)} --version && ${quote(command)} auth status`, signal);
    const authStart = status.indexOf("{");
    if (authStart < 0 || JSON.parse(status.slice(authStart)).loggedIn !== true) throw new Error("Claude is not logged in on the remote workspace");
    if (bind) {
      const latest: Record<string, string> = json(bindingPath) ?? {}; latest[sessionId] = fingerprint;
      mkdirSync(STATE_DIR, { recursive: true });
      const temporary = `${bindingPath}.${process.pid}.tmp`; writeFileSync(temporary, JSON.stringify(latest), { mode: 0o600 }); renameSync(temporary, bindingPath);
    }
    const host = pinTarget({ ...endpoint, destination: configured.destination, command: configured.claudePath });
    const target = { name: "DSH remote workspace", workspaceId: "", path: cwd, host, remoteCwd: absolute(remotePath), revision: fingerprint, seam: true };
    verified.set(cwd, target); return target;
  }
  throw new Error("Workspace execution host and user do not match a saved Claude SSH target");
}
export async function workspaceEligibility(cwd: string | undefined, sessionId: string, signal?: AbortSignal, runtime?: Pick<SubprocessRuntime, "spawn">): Promise<Eligibility> {
  try {
    if (!cwd) throw new Error("Select a remote workspace first");
    await verifyWorkspace(cwd, sessionId, signal, false, runtime);
    return { eligible: true, providerIds: ["claude-code"] };
  } catch (error) { return { eligible: false, providerIds: [], reason: error instanceof Error ? error.message : String(error) }; }
}
