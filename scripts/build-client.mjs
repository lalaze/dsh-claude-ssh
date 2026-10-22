import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';

// Package scripts run in their own directory, including through pnpm --filter.
const packageDir = process.cwd();
const { name } = JSON.parse(await readFile(resolve(packageDir, 'package.json'), 'utf8'));
if (!name) throw new Error('Client builds require a package name.');

await build({
  absWorkingDir: packageDir,
  entryPoints: ['src/client/index.tsx'],
  outfile: 'lib/client.js',
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  minify: true,
  external: ['react', 'react/jsx-runtime', 'react-dom', '@deepseek-ai/*'],
  banner: {
    js: `window.__ModuleLoader__.load({id:${JSON.stringify(name)},factory:(require)=>{var module={exports:{}};var exports=module.exports;`,
  },
  footer: { js: 'return module.exports;}});' },
});
