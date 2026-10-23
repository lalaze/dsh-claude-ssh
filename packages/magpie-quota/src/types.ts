export interface QuotaWindow {
  id: string;
  name: string;
  remaining: number | null;
  unlimited: boolean;
  resetsAt?: string;
  amount?: number;
  limit?: number;
  unit?: string;
  display?: string;
  pool?: string;
}
export interface AccountQuota {
  id: string;
  provider: string;
  name: string;
  kind: string;
  user?: string;
  alias?: string;
  plan?: string;
  from?: string;
  windows: QuotaWindow[];
  balance?: string;
  readAt?: string;
  asOf?: string;
  readDeferred?: boolean;
  error?: string;
  last?: boolean;
  lastServedAt?: string;
  until?: string;
  renew?: string;
  refreshable: boolean;
}
export interface GatewayQuota {
  id: string;
  name: string;
  accounts: AccountQuota[];
  fetchedAt?: string;
  stale?: boolean;
  error?: { code: string; message: string };
}
export interface QuotaReport { generatedAt: string; gateways: GatewayQuota[] }

export function summary(account: AccountQuota): { text: string; remaining: number | null } {
  const known = account.windows.flatMap(w => !w.unlimited && w.remaining !== null ? [w.remaining] : []);
  const remaining = known.length ? Math.min(...known) : null;
  return { remaining, text: remaining !== null ? remaining > 0 && remaining < 1 ? '<1%' : `${Math.round(remaining)}%` : account.windows.length && account.windows.every(w => w.unlimited) ? '∞' : account.balance || '—' };
}
export function accountLabel(account: AccountQuota): string {
  return account.alias || account.user || account.plan || account.name;
}
