// The Vercel function (docs/HOSTING.md). vercel.json routes every path that is
// not a file in public/ here. The app is src/index.ts, bundled by
// `npm run vercel-build` (scripts/bundle.mjs) into dist/server.mjs; this file
// only hands each request to it, the way Fastify's serverless guide does.
import app from '../dist/server.mjs';

export default async function handler(req, res) {
  await app.ready();
  app.server.emit('request', req, res);
}
