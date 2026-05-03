import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Expose Vitest globals (describe, it, expect, beforeEach, etc.) so existing
    // test files continue to work without import changes (Jest-compatible surface).
    globals: true,
    include: [
      'src/**/__tests__/**/*.{test,spec}.{ts,tsx}',
      // .test-d.ts — type-test convention; these run as regular Vitest tests
      // but signal that the test's primary purpose is type checking via expectTypeOf.
      'src/**/__tests__/**/*.test-d.ts',
      'src/**/*.{test,spec}.{ts,tsx}',
    ],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // Exclude test files from coverage metrics — Vitest counts them by default.
      exclude: ['src/**/__tests__/**', 'src/**/*.{test,spec}.ts'],
      reporter: ['text', 'html', 'lcov'],
    },
  },
});
