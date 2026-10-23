import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-client-connection';
import { createGalleryHandler } from './bing.js';

export const name = 'dsh-gallery';
export const inject = ['connection'];
export function apply(ctx: Context): void {
  const fetch = createGalleryHandler();
  for (const path of ['/api/gallery/bing', '/api/gallery/image']) {
    ctx.connection.fetch.register({ path, methods: ['GET'], requestBody: 'buffered', fetch });
  }
}
