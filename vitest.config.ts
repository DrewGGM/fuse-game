import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@fuse/sim': r('./packages/sim/src/index.ts'),
      '@fuse/gen': r('./packages/gen/src/index.ts'),
    },
  },
  test: {
    globals: true,
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts'],
    // The board grader runs thousands of simulations; give it room.
    testTimeout: 120_000,
    hookTimeout: 120_000,
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      include: ['packages/*/src/**/*.ts', 'apps/api/src/**/*.ts'],
      // d1.ts is interface declarations only; there is no runtime code to cover.
      exclude: ['apps/api/src/d1.ts'],
      thresholds: {
        // Risk-based floors from the blueprint. Tripwires, not targets.
        'packages/sim/src/**': { branches: 85, functions: 90, lines: 90, statements: 90 },
        'packages/gen/src/**': { branches: 70, functions: 80, lines: 80, statements: 80 },
      },
    },
  },
});
