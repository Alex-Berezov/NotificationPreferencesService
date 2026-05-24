import { PrismaClient } from '@prisma/client';
import type { AppConfig } from '../config.js';

export function createPrismaClient(
  config: Pick<AppConfig, 'DATABASE_URL' | 'LOG_LEVEL'>,
): PrismaClient {
  return new PrismaClient({
    datasources: { db: { url: config.DATABASE_URL } },
    log: config.LOG_LEVEL === 'debug' ? ['warn', 'error'] : ['error'],
  });
}
