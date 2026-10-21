import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { absolutePath, validateHost, SshClaudeError, type Host } from './domain.js';

export type Spawn = (file: string, args: string[]) => ChildProcessWithoutNullStreams;
export function sshEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...source, LC_ALL: 'C' };
  // A user's SendEnv patterns must not transport this DSH process's local Claude credentials
  // or config selection. Keep SSH_AUTH_SOCK and the system OpenSSH environment intact.
  for (const key of Object.keys(env)) if (/^(CLAUDE_|ANTHROPIC_)/.test(key)) delete env[key];
  return env;
}
export const spawnSsh: Spawn = (file, args) => spawn(file, args, { stdio: ['pipe', 'pipe', 'pipe'], env: sshEnvironment() });
export const quote = (s: string): string => { if (s.includes('\0')) throw new Error('NUL'); return "'" + s.replaceAll("'", "'\\''") + "'"; };
export function sshArgs(host: Host, script: string): string[] {
  validateHost(host);
  return ['-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=12', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=2', ...(host.port ? ['-p', String(host.port)] : []), '--', host.destination, `exec /bin/sh -c ${quote(script)}`];
}
export function classify(code: number | null, stderr: string): SshClaudeError {
  if (/host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED|No .*host key is known/i.test(stderr)) return new SshClaudeError('SSH_HOST_KEY', 'SSH 主机密钥校验失败。请在本机终端核实主机指纹并维护 known_hosts。');
  if (/permission denied|authentication failed|too many authentication failures/i.test(stderr)) return new SshClaudeError('SSH_AUTH', '目标远端用户 SSH 认证失败。请检查密钥、SSH Agent 和 SSH config。');
  if (code === 71) return new SshClaudeError('REMOTE_DIRECTORY', '远端目录不存在、不可访问或进入失败；已停止，未回退 HOME。');
  if (code === 72) return new SshClaudeError('CLAUDE_MISSING', '目标远端用户的非交互环境找不到 Claude。请填写 claude 绝对路径（nvm 安装请同时确保 node 在该环境可用）。');
  if (code === 73) return new SshClaudeError('CLAUDE_LOGIN', '目标远端 Claude 尚未登录；请用同一 SSH 用户在远端运行 claude auth login。');
  if (code === 74) return new SshClaudeError('CLAUDE_PROTOCOL', '远端 Claude 不支持所需的 stream-json/权限协议，请升级远端 Claude Code。');
  if (code === 75) return new SshClaudeError('REMOTE_USER_CHANGED', 'SSH 别名解析到的远端用户已变化，请重新创建绑定。');
  return new SshClaudeError(code === 255 ? 'SSH_CONNECTION' : 'REMOTE_EXECUTION', code === 255 ? 'SSH 连接失败或断开。请检查网络、主机、端口、ProxyJump；未重试或本地执行。' : `远端命令退出（${code ?? 'signal'}）；未自动重试。`);
}
export const enter = (path: string): string => `cd ${quote(absolutePath(path))} 2>/dev/null || exit 71; test -r . && test -x . || exit 71;`;
// The login shell is deliberately not invoked. Probe exactly the same SSH environment as execution.
export function findClaude(host: Host): string {
  if (host.claudePath) return `c=${quote(absolutePath(host.claudePath))}; test -x "$c" || exit 72;`;
  return `c=$(command -v claude 2>/dev/null || true); if [ -z "$c" ]; then for p in "$HOME/.local/bin/claude" /opt/homebrew/bin/claude /usr/local/bin/claude "$HOME"/.nvm/versions/node/*/bin/claude; do if [ -x "$p" ]; then c=$p; break; fi; done; fi; test -n "$c" && test -x "$c" || exit 72;`;
}
export class Ssh {
  constructor(readonly spawn: Spawn = spawnSsh) {}
  start(host: Host, script: string): ChildProcessWithoutNullStreams { return this.spawn('ssh', sshArgs(host, script)); }
  async run(host: Host, script: string, signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted();
    const mark = `DSH_SSH_${randomUUID()}`;
    const child = this.start(host, `printf '%s\\0' ${quote(mark)}; ${script}`);
    child.stdin.on('error', () => {}); // SSH exit supplies the diagnostic; never retry an EPIPE.
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []; let size = 0; let stderr = ''; let failure: Error | undefined;
      const abort = () => { failure = new SshClaudeError('CANCELLED', '操作已取消。'); child.kill('SIGKILL'); };
      const timer = setTimeout(() => { failure = new SshClaudeError('SSH_TIMEOUT', 'SSH 检测超时。'); child.kill('SIGKILL'); }, 30_000);
      signal?.addEventListener('abort', abort, { once: true });
      child.stdin.end();
      child.stdout.on('data', (b: Buffer) => { size += b.length; if (size > 8 * 1024 * 1024) { failure = new Error('远端输出超出 8 MiB 限制'); child.kill('SIGKILL'); } else chunks.push(b); });
      child.stderr.on('data', b => { stderr = (stderr + b.toString()).slice(-8192); });
      child.once('error', e => { failure = e; });
      child.once('close', code => {
        clearTimeout(timer); signal?.removeEventListener('abort', abort);
        if (failure) return reject(failure);
        if (code !== 0) return reject(classify(code, stderr));
        const out = Buffer.concat(chunks).toString('utf8'); const at = out.indexOf(mark + '\0');
        if (at === -1) return reject(new SshClaudeError('SSH_PROTOCOL', 'SSH 检测未返回有效标记。'));
        resolve(out.slice(at + mark.length + 1));
      });
    });
  }
  async directory(host: Host, path: string, signal?: AbortSignal): Promise<{ path: string; user: string; names: string[] }> {
    const out = await this.run(host, `${enter(path)} printf '%s\\0%s\\0' "$(pwd -P)" "$(id -un)"; for d in ./* ./.[!.]* ./..?*; do test -d "$d" || continue; printf '%s\\0' "\${d#./}"; done`, signal);
    const [canonical, user, ...names] = out.split('\0');
    if (!canonical || !user) throw new Error('远端目录响应无效');
    return { path: absolutePath(canonical), user, names: names.filter(Boolean).sort() };
  }
  async probe(host: Host, signal?: AbortSignal): Promise<{ user: string; path: string; version: string; loggedIn: boolean }> {
    const out = await this.run(host, `${findClaude(host)} PATH="$(dirname "$c"):$PATH"; export PATH; v=$("$c" --version) || exit 72; h=$("$c" --help) || exit 72; for flag in --input-format --output-format --permission-prompt-tool --include-partial-messages --session-id --resume; do case "$h" in *"$flag"*) ;; *) exit 74;; esac; done; a=$("$c" auth status --json 2>/dev/null); printf '%s\\0%s\\0%s\\0%s' "$(id -un)" "$c" "$v" "$a"`, signal);
    const [user, path, version, auth] = out.split('\0');
    let loggedIn = false;
    try { loggedIn = JSON.parse(auth).loggedIn === true; } catch { throw new SshClaudeError('CLAUDE_AUTH_UNKNOWN', '远端 Claude auth status --json 未返回可识别状态；请升级 CLI 并手动检查登录。'); }
    if (!loggedIn) throw classify(73, '');
    return { user, path, version, loggedIn };
  }
}
