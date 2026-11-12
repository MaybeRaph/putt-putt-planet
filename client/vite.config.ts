import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

// Single source of truth for the version shown in the game: the root package.json.
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(version) },
  server: {
    port: 5173,
    host: true,
    // The game server runs on :8787; proxy the WebSocket so the client always uses same-origin /ws.
    proxy: { '/ws': { target: 'ws://localhost:8787', ws: true } },
  },
  build: {
    target: 'es2022',
    // Rapier ships its WASM inlined (~3 MB); vendors are split so app updates don't re-download them.
    chunkSizeWarningLimit: 4000,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'rapier', test: /rapier3d/ },
            { name: 'three', test: /node_modules[\\/]three/ },
          ],
        },
      },
    },
  },
  optimizeDeps: { exclude: ['@dimforge/rapier3d-compat'] },
});
