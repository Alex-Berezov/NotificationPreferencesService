import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    globals: false,
    reporters: ['default'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/domain/**', 'src/application/**'],
      exclude: ['**/*.test.ts'],
    },
  },
});
