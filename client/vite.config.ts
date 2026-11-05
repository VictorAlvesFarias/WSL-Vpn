import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

// The app's version (package.json at the repo root), shown in Ajuda › Sobre.
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  server: {
    host: '127.0.0.1',
    port: 5312,
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:4312',
    },
  },
});
