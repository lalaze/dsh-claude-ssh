import type { LlmModelInfo, LlmResolvedModelInfo, ReasoningEffortId } from "@deepseek-ai/dsh-llm";
import { randomUUID } from "node:crypto";
import { StringDecoder } from "node:string_decoder";
import type { JsonValue, SubprocessRuntime } from "../dsh.js";
import { decodeCliModels, nodeSpawner, seamSpawner, shq, sshInvocation, type SubprocessHandle } from "../process.js";
import { pinnedTarget, REMOTE_PATH } from "./transport.js";
import type { WorkspaceTarget } from "./workspace.js";

const TIMEOUT_MS = 20_000;
const MAX_BYTES = 1024 * 1024;
// Metadata for prepareCall only; workspace listings always interrogate their own CLI.
const discoveries = new Map<string, LlmResolvedModelInfo[]>();

/** Successful discoveries for provider-level selection validation; never a workspace listing. */
export function discoveredModels(provider: string): LlmModelInfo[] {
  return structuredClone([...new Map([...discoveries.values()].flat().filter(row => row.provider === provider).map(row => [row.id, row])).values()]);
}

/** Last successfully discovered exact id, without any static model-name inference. */
export function discoveredModelInfo(provider: string, model: string): LlmResolvedModelInfo | undefined {
  for (const models of [...discoveries.values()].reverse()) {
    const found = models.find(row => row.provider === provider && row.id === model);
    if (found) return structuredClone(found);
  }
  return undefined;
}

function normalize(payload: JsonValue | undefined): LlmResolvedModelInfo[] {
  const raw = payload && typeof payload === "object" && !Array.isArray(payload) && Array.isArray(payload.models) ? payload.models : [];
  return [...new Map(decodeCliModels(payload).filter(row => row.value.length > 0).map(row => {
    const model: LlmResolvedModelInfo = { provider: "claude-code", id: row.value, name: row.displayName };
    if (row.description !== undefined) model.description = row.description;
    if (row.efforts.length) model.reasoning = { efforts: [...new Set(row.efforts)].map(id => ({ id: id as ReasoningEffortId, name: id })) };
    const source = raw.find(value => value && typeof value === "object" && !Array.isArray(value) && value.value === row.value);
    if (source && typeof source === "object" && !Array.isArray(source)) {
      if (typeof source.contextWindow === "number" && Number.isSafeInteger(source.contextWindow) && source.contextWindow > 0) model.context = { contextWindow: source.contextWindow };
      if (Array.isArray(source.inputModalities) && source.inputModalities.every(value => value === "text" || value === "image")) model.inputModalities = source.inputModalities as ("text" | "image")[];
    }
    return [model.id, model] as const;
  })).values()];
}

/** Query the verified workspace's CLI control channel; never sends a user message or inference. */
export async function workspaceModels(target: WorkspaceTarget, cwd: string, runtime?: Pick<SubprocessRuntime, "spawn">, signal?: AbortSignal): Promise<LlmResolvedModelInfo[]> {
  signal?.throwIfAborted();
  const pin = pinnedTarget(target.host);
  if (!pin) throw new Error("Remote model catalog requires a verified transport target");
  if (cwd !== target.path) throw new Error("Remote model catalog workspace does not match its verified target");
  const command = pin.command || "claude";
  const key = JSON.stringify([target.host, target.revision, target.remoteCwd, cwd, command, Boolean(target.seam)]);
  // Remove older revisions for this workspace as soon as a fresh query starts, including on errors.
  for (const previous of discoveries.keys()) if (JSON.parse(previous)[3] === cwd) discoveries.delete(previous);
  const args = ["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--no-session-persistence"];
  let handle: SubprocessHandle;
  try {
    if (target.seam) {
      if (!runtime) throw new Error("Workspace has no DSH process service");
      handle = seamSpawner(runtime)("/bin/sh", ["-c", `${REMOTE_PATH}exec ${[command, ...args].map(shq).join(" ")}`], cwd);
    } else {
      const invocation = sshInvocation(target.host, command, args, target.remoteCwd);
      // SSH itself runs on this host, never through a workspace's remote process service.
      handle = nodeSpawner(invocation.command, invocation.args, ".");
    }
    const models = normalize(await query(handle, signal));
    if (!models.length) throw new Error("Remote Claude CLI returned no models");
    discoveries.set(key, structuredClone(models));
    return models;
  } catch (error) { discoveries.delete(key); throw error; }
}

function query(handle: SubprocessHandle, signal?: AbortSignal): Promise<JsonValue | undefined> {
  return new Promise((resolve, reject) => {
    const initId = randomUUID(), modelsId = randomUUID();
    let settled = false, bytes = 0, pending = "", stderr = "";
    const decoder = new StringDecoder("utf8");
    const finish = (error?: unknown, payload?: JsonValue) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      handle.stdout?.removeListener("data", stdout);
      handle.stderr?.removeListener("data", onStderr);
      // Keep error listeners attached: late EPIPE/stream errors must remain handled.
      try { handle.stdin?.end(); } catch { /* process already closed */ }
      try { handle.terminate(); } catch { /* still settle the bounded query */ }
      if (error) reject(error); else resolve(payload);
    };
    const send = (request_id: string, request: Record<string, JsonValue>) => {
      try { handle.stdin.write(`${JSON.stringify({ type: "control_request", request_id, request })}\n`); }
      catch (error) { finish(error); }
    };
    const count = (chunk: Buffer | string) => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > MAX_BYTES) { finish(new Error("Remote model catalog exceeded output limit")); return false; }
      return true;
    };
    const stdout = (chunk: Buffer | string) => {
      if (settled || !count(chunk)) return;
      pending += decoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      let index: number;
      while (!settled && (index = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, index); pending = pending.slice(index + 1);
        let event;
        try { event = JSON.parse(line); } catch { continue; }
        if (event?.type !== "control_response") continue;
        const response = event.response;
        if (response?.request_id !== initId && response?.request_id !== modelsId) continue;
        if (response.subtype !== "success") {
          // Old CLIs may lack initialize but still implement list_models.
          if (response.request_id === initId) send(modelsId, { subtype: "list_models" });
          else finish(new Error(`Remote Claude list_models failed: ${String(response.error || "request rejected")}`));
          continue;
        }
        if (response.request_id === initId) send(modelsId, { subtype: "list_models" });
        else finish(undefined, response.response);
      }
    };
    const onStderr = (chunk: Buffer | string) => { if (!settled && count(chunk)) stderr = (stderr + String(chunk)).slice(-2000); };
    const abort = () => finish(signal?.reason ?? new Error("Remote model catalog aborted"));
    const timer = setTimeout(() => finish(new Error("Remote model catalog timed out")), TIMEOUT_MS);
    // Consume rejected done promises even when pipes are missing.
    void handle.done.then(result => finish(new Error(`Remote Claude CLI exited before model catalog (${result.exitCode ?? result.signal}): ${stderr}`)), error => finish(error));
    if (!handle.stdin || !handle.stdout || !handle.stderr) { finish(new Error("Workspace process service did not provide bidirectional pipes")); return; }
    handle.stdin.on("error", finish);
    handle.stdout.on("error", finish);
    handle.stderr.on("error", finish);
    handle.stdout.on("data", stdout);
    handle.stderr.on("data", onStderr);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    send(initId, { subtype: "initialize", promptSuggestions: false });
  });
}
