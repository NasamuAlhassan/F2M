// Vercel build step (docs/HOSTING.md): bundle the server into one ESM file,
// dist/server.mjs, that Node runs as-is. Without this, Vercel compiles
// src/index.ts itself, which fails three ways: our relative imports have no
// file extensions, @ftm/core is TypeScript source inside node_modules, and its
// compiler cannot see our type definitions.
//
// npm packages are bundled too, all but two. Vercel's module loader cannot
// require() an ES module from CommonJS (plain Node 24 can), and some packages do
// exactly that: @fastify/static requires the ESM-only content-disposition, which
// crashed every request. Bundled, esbuild links them at build time. Reproduce the
// loader locally with `node --no-experimental-require-module`.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const SERVER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Left in node_modules: sharp loads native binaries and PGlite its WebAssembly
// files, both by path relative to their own package.
const external = ['sharp', '@electric-sql/pglite'];

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
console.log(`[bundle] dist/server.mjs ready (${(bytes / 1024).toFixed(0)} KB; external: ${external.join(', ')})`);
