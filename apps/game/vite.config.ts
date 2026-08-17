import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  base: './', // Capacitor serves from a file:// style origin, so no absolute paths.
  resolve: {
    alias: {
      '@fuse/sim': r('../../packages/sim/src/index.ts'),
      '@fuse/gen': r('../../packages/gen/src/index.ts'),
    },
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: true,
    // The whole point of dropping a game framework was a small bundle on
    // mid-range Android. Fail the build if that ever silently regresses.
    chunkSizeWarningLimit: 260,
  },
  server: {
    port: 5173,
    host: true,
  },
});
