import type { Host } from '../domain.js';

export function hostFromAlias(current: Host, alias: string): Host {
  return {
    ...current,
    id: current.id || `ssh-${alias}`.slice(0, 80),
    name: current.name || alias,
    destination: alias,
    // A different alias must inherit its own configured Port, not the last draft's.
    port: current.destination === alias ? current.port : undefined,
  };
}
