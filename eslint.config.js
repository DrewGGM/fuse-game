// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      'apps/game/android/**',
      'packages/gen/src/seeds.json',
      'test-results/**',
      'playwright-report/**',
      '.playwright-mcp/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Limits from the blueprint's code-quality baseline. Warnings, not errors:
    // a hard failure on a 51-line function trains people to disable the rule.
    rules: {
      complexity: ['warn', 12],
      'max-depth': ['warn', 3],
      'max-lines-per-function': ['warn', { max: 80, skipComments: true, skipBlankLines: true }],
      'prefer-const': 'error',
      'no-var': 'error',
      eqeqeq: ['error', 'smart'],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // Tests reach into internals on purpose; the production limits do not apply.
    files: ['**/test/**', 'e2e/**', 'scripts/**'],
    rules: {
      'max-lines-per-function': 'off',
      'no-console': 'off',
    },
  },
  {
    // Tooling scripts straddle two runtimes: Node on the outside, and browser
    // code inside page.evaluate() bodies that only ever runs in Chromium.
    // no-undef cannot see that boundary, so it is off here rather than sprinkling
    // the file with disable comments.
    files: ['scripts/**/*.mjs', 'scripts/**/*.js'],
    rules: {
      'no-undef': 'off',
    },
  }
);
