import { createHash } from "node:crypto";

export interface Endpoint { host: string; port: number; username: string }
export interface PinnedTarget extends Endpoint { destination: string; command?: string }
export const REMOTE_PATH = 'PATH="$HOME/.local/bin:$HOME/.npm-global/bin:/usr/local/bin:/opt/homebrew/bin:$PATH"; export PATH; ';
const targets = new Map<string, PinnedTarget>();
export const normalizedHost = (host: string) => host.replace(/^\[|\]$/g, "").toLowerCase();
export function pinTarget(target: PinnedTarget): string {
  const key = `dsh-remote-${createHash("sha256").update(JSON.stringify(target)).digest("hex")}`;
  targets.set(key, target);
  return key;
}
export const pinnedTarget = (key: string) => targets.get(key);
export function pinnedSshArgs(host: string): string[] | undefined {
  const target = targets.get(host);
  if (!target) {
    if (host.startsWith("dsh-remote-")) throw new Error("Remote target has not been verified in this process");
    return undefined;
  }
  return ["-o", `Hostname=${target.host}`, "-l", target.username, "-p", String(target.port), "-o", "StrictHostKeyChecking=yes", "--", target.destination];
}
