import { defineConfig } from 'vitest/config';

/**
 * Integration tests: spin up real PostgreSQL via Testcontainers, run Prisma
 * migrations + seed, exercise the Fastify app via `inject`.
 *
 * Run sequentially in a single fork — tests share the container and rely on
 * `TRUNCATE` cleanup between cases.
 */
export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    environment: 'node',
    globalSetup: ['tests/integration/globalSetup.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 180_000,
    reporters: ['default'],
  },
});
