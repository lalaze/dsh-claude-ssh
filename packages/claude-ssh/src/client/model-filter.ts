// Client-only constants: importing domain.ts would pull node:crypto into the browser.
export const NATIVE_PROVIDER = 'claude-workspace';
export interface Model { id: string; name: string; reasoning?: { efforts: readonly { id: string; name: string }[]; defaultEffort?: string } }
export interface Group { id: string; name: string; models: readonly Model[] }
export function visibleGroups(groups: readonly Group[], eligible: boolean, legacyHostId?: string): Group[] {
  return groups.filter(g => g.id === NATIVE_PROVIDER ? eligible : g.id.startsWith('claude-ssh-') ? g.id === `claude-ssh-${legacyHostId}` : true);
}
