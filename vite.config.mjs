import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('./admin-src', import.meta.url)),
  base: './',
  publicDir: false,
  build: {
    outDir: fileURLToPath(new URL('./admin', import.meta.url)),
    emptyOutDir: true,
    sourcemap: false,
    target: ['es2020', 'chrome80', 'safari14'],
    assetsInlineLimit: 4096,
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/@cloudbase/')) return 'cloudbase';
          return undefined;
        },
      },
    },
  },
});
