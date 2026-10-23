import assert from 'node:assert/strict';
import test from 'node:test';
import { QuotaQuery } from '../src/client/query.js';
import type { QuotaReport } from '../src/types.js';

const report = (remaining: number): QuotaReport => ({ generatedAt: '2026-10-23T10:00:00Z', gateways: [{ id: 'office', name: 'Magpie', accounts: [
  { id: 'account', provider: 'codex', name: 'Codex', kind: 'subscription', windows: [{ id: 'weekly', name: '7 days', remaining, unlimited: false }], refreshable: true },
] }] });
const documentStub = () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const doc = Object.assign(new EventTarget(), { hidden: false });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: doc });
  return { doc, restore: () => { if (original) Object.defineProperty(globalThis, 'document', original); else Reflect.deleteProperty(globalThis, 'document'); } };
};

test('多个视图共用一次查询，后台页面恢复可见后读取；请求失败保留读数', async () => {
  const stub = documentStub(); let reads = 0; let fail = false;
  const query = new QuotaQuery(async () => { reads++; if (fail) throw new Error('offline'); return Response.json(report(63)); });
  const a = query.subscribe(() => {}); const b = query.subscribe(() => {});
  try {
    await query.read(); assert.equal(reads, 1);
    fail = true; await query.read(); assert.equal(query.getSnapshot().report?.gateways[0].accounts[0].windows[0].remaining, 63); assert.ok(query.getSnapshot().error);
    stub.doc.hidden = true; stub.doc.dispatchEvent(new Event('visibilitychange')); assert.equal(reads, 2);
    stub.doc.hidden = false; stub.doc.dispatchEvent(new Event('visibilitychange')); await query.read(); assert.equal(reads, 3);
  } finally { a(); b(); query.dispose(); stub.restore(); }
});
test('刷新期间晚到的旧查询不会覆盖新读数，拒绝刷新后清除旧账号并同步权限', async () => {
  const stub = documentStub(); let reads = 0; let finishOld!: (response: Response) => void; let denied = false;
  const query = new QuotaQuery(async (_input, init) => {
    if (init?.method === 'POST') return denied ? Response.json({ error: 'permission changed' }, { status: 403 }) : Response.json(report(92));
    reads++;
    if (reads === 2) return new Promise<Response>(resolve => { finishOld = resolve; });
    return Response.json(denied ? { generatedAt: '2026-10-23T10:01:00Z', gateways: [{ id: 'office', name: 'Magpie', accounts: [], error: { code: 'FORBIDDEN', message: 'permission changed' } }] } : report(63));
  });
  const stop = query.subscribe(() => {});
  try {
    await query.read(); const old = query.read(); await query.refresh('office', 'account');
    finishOld(Response.json(report(10))); await old;
    assert.equal(query.getSnapshot().report?.gateways[0].accounts[0].windows[0].remaining, 92);
    // A different account ID avoids the first account's successful-refresh cooldown.
    denied = true; await query.refresh('office', 'other-account');
    assert.equal(query.getSnapshot().report?.gateways[0].accounts.length, 0);
    assert.equal(query.getSnapshot().report?.gateways[0].error?.code, 'FORBIDDEN');
  } finally { stop(); query.dispose(); stub.restore(); }
});
test('卸载最后一个视图可取消刷新；重新挂载后不会卡在刷新状态', async () => {
  const stub = documentStub(); let finish!: (response: Response) => void;
  const query = new QuotaQuery(async (_input, init) => init?.method === 'POST' ? new Promise<Response>(resolve => { finish = resolve; }) : Response.json(report(63)));
  let stop = query.subscribe(() => {});
  try {
    await query.read(); const pending = query.refresh('office', 'account'); assert.ok(query.getSnapshot().refreshing);
    stop(); finish(Response.json(report(92))); await pending;
    stop = query.subscribe(() => {}); await query.read();
    assert.equal(query.getSnapshot().refreshing, undefined); assert.equal(query.getSnapshot().loading, false);
  } finally { stop(); query.dispose(); stub.restore(); }
});
