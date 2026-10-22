import { open, readdir, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, parse, resolve } from 'node:path';

export interface SshAliases { aliases: string[]; warnings: string[] }
const selectable = /^[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/;

// Read only Host/Include directives. Never evaluate Match exec, ProxyCommand,
// identity files, or ssh -G (which can execute commands from the user's config).
function directive(line: string): { key: string; values: string[] } | undefined {
  const match = /^\s*([^\s=#]+)(?:\s*=\s*|\s+)(.*)$/.exec(line);
  if (!match) return;
  const key = match[1].toLowerCase();
  if (key !== 'host' && key !== 'include') return;
  const values: string[] = []; let value = ''; let quoted = false; let started = false;
  for (let i = 0; i < match[2].length; i++) {
    const c = match[2][i];
    if (c === '\\' && i + 1 < match[2].length) { value += match[2][++i]; started = true; }
    else if (c === '"') { quoted = !quoted; started = true; }
    else if (!quoted && c === '#') break;
    else if (!quoted && /\s/.test(c)) { if (started) values.push(value); value = ''; started = false; }
    else { value += c; started = true; }
  }
  if (quoted) throw new Error('引号未闭合');
  if (started) values.push(value);
  return { key, values };
}

// Include uses glob(7), not shell expansion. In particular, ** is not recursive.
function globSegment(pattern: string): RegExp {
  let source = '^';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*') source += '.*';
    else if (c === '?') source += '.';
    else if (c === '[') {
      const end = pattern.indexOf(']', i + 1);
      if (end < 0) source += '\\[';
      else {
        const chars = pattern.slice(i + 1, end);
        source += '[' + (chars.startsWith('!') || chars.startsWith('^') ? '^' + chars.slice(1) : chars).replaceAll('\\', '\\\\') + ']';
        i = end;
      }
    } else source += c.replace(/[\\^$+?.()|{}]/g, '\\$&');
  }
  return new RegExp(source + '$');
}

export async function discoverSshAliases(options: { home?: string; systemConfig?: string; env?: NodeJS.ProcessEnv } = {}): Promise<SshAliases> {
  const home = options.home ?? homedir(); const env = options.env ?? process.env;
  const aliases = new Set<string>(); const warnings = new Set<string>(); const seen = new Set<string>();
  let bytes = 0; let entries = 0;
  const warn = (s: string) => { warnings.add(s); };
  const expand = async (pattern: string): Promise<string[]> => {
    let paths = [parse(pattern).root];
    const parts = pattern.slice(parse(pattern).root.length).split('/').filter(Boolean);
    if (parts.length > 64) throw new Error('Include 路径层级过多');
    for (const part of parts) {
      if (!/[*?[]/.test(part)) { paths = paths.map(p => join(p, part)); continue; }
      const next: string[] = []; const matcher = globSegment(part);
      for (const p of paths) {
        let names: string[];
        try { names = await readdir(p); } catch (e) { if (['ENOENT', 'ENOTDIR'].includes((e as NodeJS.ErrnoException).code ?? '')) continue; throw e; }
        entries += names.length;
        if (entries > 20000) throw new Error('Include 目录枚举超过限制');
        for (const name of names.sort()) if ((!name.startsWith('.') || part.startsWith('.')) && matcher.test(name)) next.push(join(p, name));
      }
      paths = next;
    }
    return paths.sort();
  };
  const visit = async (file: string, base: string, depth: number): Promise<void> => {
    if (depth > 16 || seen.size >= 128) { warn('SSH Include 层级或文件数超过限制，部分别名未列出。'); return; }
    try {
      const canonical = await realpath(file);
      if (seen.has(canonical)) return;
      seen.add(canonical);
      // Bound reads and reject devices/FIFOs before reading. Never return file contents.
      const handle = await open(canonical, constants.O_RDONLY | constants.O_NONBLOCK); let source: string;
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size > 256 * 1024 || bytes + stat.size > 2 * 1024 * 1024) throw new Error('文件类型或大小超过限制');
        const buffer = Buffer.alloc(256 * 1024 + 1);
        let bytesRead = 0;
        while (bytesRead < buffer.length) {
          const chunk = await handle.read(buffer, bytesRead, buffer.length - bytesRead, bytesRead);
          if (!chunk.bytesRead) break;
          bytesRead += chunk.bytesRead;
        }
        bytes += bytesRead;
        if (bytesRead > 256 * 1024) throw new Error('文件大小超过限制');
        source = buffer.subarray(0, bytesRead).toString('utf8');
      } finally { await handle.close(); }
      for (const line of source.split(/\r?\n/)) {
        let d: ReturnType<typeof directive>;
        try { d = directive(line); } catch { warn('SSH 配置中存在无法解析的 Host/Include 行，已跳过。'); continue; }
        if (d?.key === 'host') for (const alias of d.values) {
          // Wildcards and negations describe rules, not selectable connections.
          if (selectable.test(alias) && alias.length <= 253) {
            if (aliases.size < 1000 || aliases.has(alias)) aliases.add(alias);
            else warn('SSH 别名数超过 1000，部分条目未列出，可手动输入。');
          }
        }
        if (d?.key !== 'include') continue;
        for (const value of d.values) {
          let unsupported = false;
          let path = value.replace(/\$\{([^}]+)\}/g, (_m, key: string) => { if (env[key] === undefined) unsupported = true; return env[key] ?? ''; });
          path = path.replace(/%([%d])/g, (_m, token: string) => token === '%' ? '\0' : home);
          if (path.includes('%') || /^~[^/]/.test(path)) unsupported = true;
          path = path.replaceAll('\0', '%');
          if (path === '~' || path.startsWith('~/')) path = home + path.slice(1);
          if (unsupported || !path || path.includes('\0')) { warn('含动态令牌、其他用户 HOME 或未定义变量的 Include 未展开，可手动输入别名。'); continue; }
          try { for (const included of await expand(isAbsolute(path) ? path : resolve(base, path))) await visit(included, base, depth + 1); }
          catch { warn('部分 SSH Include 无法展开或超过限制，可手动输入别名。'); }
        }
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') warn('部分 SSH 配置无法读取或超过限制，列表可能不完整。');
    }
  };
  await visit(join(home, '.ssh', 'config'), join(home, '.ssh'), 0);
  const systemConfig = options.systemConfig ?? '/etc/ssh/ssh_config';
  await visit(systemConfig, dirname(systemConfig), 0);
  return { aliases: [...aliases].sort(), warnings: [...warnings] };
}
