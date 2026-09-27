import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * A build used only for taking the README screenshots. It drops the crx plugin and
 * mounts src/content/App as an ordinary page instead of a content script (the UI
 * and CSS it renders are identical to the extension's). See the comments in
 * capture.mjs for the background.
 *
 * The out/ directory is deleted by capture.mjs after capturing, so only
 * docs/images/*.png remain.
 */
export default defineConfig({
  root: import.meta.dirname,
  base: './',
  plugins: [react()],
  build: {
    outDir: 'out',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, 'index.html'),
      },
    },
  },
});
