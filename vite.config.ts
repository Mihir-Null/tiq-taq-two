import { defineConfig, type PluginOption } from 'vite';
import preact from '@preact/preset-vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

/**
 * Vite configuration.
 *
 * - `base: './'` makes every asset URL relative, so the same build works at
 *   https://you.github.io/tiq-taq-two/, at the root of your own domain, or
 *   opened from a sub-folder — no rebuild needed. (The app uses hash routes
 *   like `#/room/ABCDE`, so no server-side rewrite rules are required either.)
 * - `npm run build:single` (mode "single") inlines JS + CSS + fonts into ONE
 *   index.html — handy for sharing a file or embedding somewhere simple.
 * - In development the Node lobby server runs on :8787 and Vite proxies
 *   `/api` and `/ws` to it, so the browser sees everything on one origin.
 */
export default defineConfig(({ mode }) => {
  const single = mode === 'single';
  const plugins: PluginOption[] = [preact()];
  if (single) plugins.push(viteSingleFile());

  return {
    base: './',
    plugins,
    build: {
      outDir: single ? 'dist-single' : 'dist',
      target: 'es2022',
      // Big inline-able assets (fonts) are fine in single-file mode.
      assetsInlineLimit: single ? 100_000_000 : 4096,
      chunkSizeWarningLimit: 900,
    },
    worker: { format: 'es' },
    server: {
      port: 5173,
      proxy: {
        '/api': 'http://localhost:8787',
        '/ws': { target: 'ws://localhost:8787', ws: true },
      },
    },
  };
});
