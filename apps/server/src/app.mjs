// Vercel's entry (docs/HOSTING.md). Its Fastify preset picks src/app.* first and
// wants that file to import fastify itself. The server is src/index.ts, bundled
// to dist/server.mjs by `npm run vercel-build` (scripts/bundle.mjs). Locally
// nothing loads this file: `npm run dev` runs src/index.ts directly.
import Fastify from 'fastify';
import app from '../dist/server.mjs';

export { Fastify };
export default app;
