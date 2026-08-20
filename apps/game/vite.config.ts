import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

import pkg from './package.json' with { type: 'json' };

const API_BASE = process.env.FUSE_API_BASE ?? 'https://api-fuse-app.andrewgarcia.dev';

/**
 * Keeps the CSP's connect-src in step with the API the build actually targets.
 *
 * Without this the policy names the production host only, so a build pointed at
 * a local worker has its own API refused — an error that looks like a network
 * fault and is really a policy one.
 */
function cspOrigin() {
  return {
    name: 'fuse-csp-origin',
    transformIndexHtml(html: string) {
      return html.replaceAll('%API_ORIGIN%', new URL(API_BASE).origin);
    },
  };
}

export default defineConfig({
  plugins: [cspOrigin()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    // Point the client at a local `wrangler dev` with:
    //   FUSE_API_BASE=http://localhost:8787 npm run build
    __API_BASE__: JSON.stringify(API_BASE),
  },
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
