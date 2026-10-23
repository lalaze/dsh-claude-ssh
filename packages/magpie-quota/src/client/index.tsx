import React from 'react';
import { QuotaQuery } from './query.js';
import { QuotaStrip } from './strip.js';
import { QuotaDashboard } from './components.js';

interface Client {
  effect(factory: () => () => void): void;
  slots: {
    inject(name: string, factory: () => void): unknown;
    register(spec: Record<string, unknown>, component: React.FC): unknown;
  };
}
export const name = 'dsh-magpie-quota-client';
export const inject = ['slots'];
export function apply(ctx: Client): void {
  const query = new QuotaQuery();
  ctx.effect(() => () => query.dispose());
  ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({ name: 'conversation.composer.dock', id: 'magpie-quota', order: 20 }, () => <QuotaStrip query={query} />));
  ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'magpie-quota', order: 75, label: () => 'Magpie 额度' }, () => <QuotaDashboard query={query} />));
}
