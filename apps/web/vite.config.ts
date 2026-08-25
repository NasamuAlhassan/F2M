import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // One .env for the whole monorepo (the repo root, same file
  // apps/server/src/config.ts already loads) instead of a second one Vite
  // would otherwise want at apps/web/.env. Safe to share: Vite only ever
  // exposes VITE_-prefixed vars to the browser bundle, so the server's own
  // secrets in this file (JWT_SECRET, HF_TOKEN, ...) never reach the client.
  envDir: '../../',
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/photos': 'http://localhost:3000',
      // The handset (src/pages/Phone.tsx) speaks the real Africa's Talking
      // wire directly — POST /ussd, POST /voice/answer — the same paths the
      // production server serves from one origin (apps/server/src/app.ts).
      // Only the dev split needs a proxy for them; the old static testers
      // never did, because they lived inside apps/server/public/ already.
      '/ussd': 'http://localhost:3000',
      '/voice': 'http://localhost:3000',
    },
  },
});
