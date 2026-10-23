import { asSessionId, type PluginContext } from "../dsh.js";
import { compatibilityWorkspace, workspaceEligibility, type WorkspaceTarget } from "./workspace.js";
import { workspaceModels } from "./catalog.js";

interface FetchConnection {
  fetch: { register(route: { path: string; methods: string[]; requestBody: string; fetch(request: Request): Promise<Response> }): unknown };
}
type RouteHost = Pick<PluginContext, "agents" | "sessions" | "sessionPersistence">;

/** Read durable placement without activating a cold session or taking its writer lock. */
async function sessionCwd(host: RouteHost, sessionId: string): Promise<string | undefined> {
  const id = asSessionId(sessionId);
  const live = () => host.agents.get(id)?.session ?? host.sessions.get(id);
  const attached = live();
  if (attached) return attached.header.cwd;
  const stored = (await host.sessionPersistence?.list() ?? [])
    .map(entry => "header" in entry ? entry.header : entry)
    .find(header => header.id === sessionId);
  // An activation during the persistence read takes precedence over its older header.
  const activated = live();
  return activated ? activated.header.cwd : stored?.cwd;
}

/** Verification refreshes replace cache objects even when execution placement is unchanged. */
function sameTarget(left: WorkspaceTarget, right: WorkspaceTarget | undefined): boolean {
  return right !== undefined && left.path === right.path && left.host === right.host &&
    left.remoteCwd === right.remoteCwd && left.revision === right.revision &&
    left.workspaceId === right.workspaceId && Boolean(left.seam) === Boolean(right.seam) &&
    Boolean(left.upstream) === Boolean(right.upstream);
}

/** DSH's connection service supplies authentication and request-origin checks. */
export function registerWorkspaceEligibility(ctx: PluginContext, services = {
  compatibilityWorkspace, workspaceEligibility, workspaceModels,
}): void {
  ctx.inject?.(["connection", "subprocess", "sessionPersistence"], host => {
    const connection = host.connection as unknown as FetchConnection | undefined;
    if (!connection?.fetch?.register) return;
    connection.fetch.register({
      path: "/api/claude-ssh/workspace-eligibility", methods: ["POST"], requestBody: "buffered",
      async fetch(request) {
        try {
          const text = await request.text();
          if (text.length > 8192) throw new Error("Request too large");
          const body = JSON.parse(text);
          if (typeof body.sessionId !== "string" || !body.sessionId || body.sessionId.length > 256) throw new Error("Invalid session id");
          const cwd = await sessionCwd(host, body.sessionId);
          const result = await services.workspaceEligibility(cwd, body.sessionId, request.signal, host.subprocess);
          const target = cwd && result.eligible ? services.compatibilityWorkspace(cwd) : undefined;
          const models = target ? await services.workspaceModels(target, cwd!, host.subprocess, request.signal) : [];
          const current = await sessionCwd(host, body.sessionId);
          if (target && !sameTarget(target, services.compatibilityWorkspace(cwd!))) throw new Error("Workspace changed during model discovery");
          return Response.json(current === cwd ? { ...result, models } : { eligible: false, providerIds: [], reason: "Workspace changed during verification" }, { headers: { "Cache-Control": "no-store" } });
        } catch (error) {
          return Response.json({ eligible: false, providerIds: [], reason: error instanceof Error ? error.message : String(error) }, { status: 400 });
        }
      },
    });
  });
}
