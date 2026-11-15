// Vercel build step (docs/HOSTING.md): bundle the server into one ESM file,
// dist/server.mjs, that Node runs as-is. Without this, Vercel compiles
// src/index.ts itself, which fails three ways: our relative imports have no
// file extensions, @ftm/core is TypeScript source inside node_modules, and its
// compiler cannot see our type definitions. The bundle holds our code (server +
// @ftm/core); npm packages stay external and Vercel ships them from node_modules.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const SERVER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = (p) => JSON.parse(readFileSync(path.join(SERVER, p, 'package.json'), 'utf8'));
const deps = { ...pkg('.').dependencies, ...pkg('../../packages/core').dependencies };
// A package name also covers its subpaths (drizzle-orm/pg-core, ...).
const external = Object.keys(deps).filter((name) => !name.startsWith('@ftm/'));

const result = await build({
  entryPoints: [path.join(SERVER, 'src/index.ts')],
  outfile: path.join(SERVER, 'dist/server.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external,
  sourcemap: 'linked',
  // Bundled CommonJS (if any) may call require(); give ESM one.
  banner: { js: "import { createRequire as __f2mRequire } from 'node:module'; const require = __f2mRequire(import.meta.url);" },
  logLevel: 'warning',
  metafile: true,
});
const bytes = Object.values(result.metafile.outputs).reduce((n, o) => n + o.bytes, 0);
console.log(`[bundle] dist/server.mjs ready (${(bytes / 1024).toFixed(0)} KB, ${external.length} packages external)`);
