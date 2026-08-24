import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
