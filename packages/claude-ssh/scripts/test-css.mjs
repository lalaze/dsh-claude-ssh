import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';

// Node tests load real browser components. CSS modules expose their class names;
// painting and layout remain the responsibility of browser verification.
registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith('.css')) {
      const text = readFileSync(new URL(url), 'utf8');
      const names = Object.fromEntries([...text.matchAll(/\.([a-zA-Z_][\w-]*)/g)].map(match => [match[1], match[1]]));
      return { format: 'module', source: `export default ${JSON.stringify(names)};`, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});
