import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { emptyState, type State } from './domain.js';

/** One serialized atomic journal per plugin instance. Never contains SSH keys or auth tokens. */
export class Store {
  private value = emptyState();
  private tail: Promise<unknown> = Promise.resolve();
  constructor(readonly file: string) {}
  async load(): Promise<void> {
    try {
      const data = JSON.parse(await readFile(this.file, 'utf8'));
      if (data.version !== 1 || !Array.isArray(data.hosts) || !Array.isArray(data.workspaces) || !data.bindings || typeof data.bindings !== 'object') throw new Error('存储格式无效');
      this.value = data;
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    await this.update(s => { for (const b of Object.values(s.bindings)) if (b.state === 'running') { b.state = 'interrupted'; b.lastError = 'DSH 已重启；远端任务结果未知。请先检查远端，再明确恢复。'; } });
  }
  snapshot(): State { return structuredClone(this.value); }
  async update<T>(change: (state: State) => T): Promise<T> {
    const op = this.tail.then(async () => {
      const next = this.snapshot();
      const result = change(next);
      await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
      const temp = `${this.file}.${randomUUID()}.tmp`;
      await writeFile(temp, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
      await rename(temp, this.file);
      this.value = next;
      return result;
    });
    this.tail = op.catch(() => {});
    return op;
  }
}
