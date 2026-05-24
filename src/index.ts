import { loadConfig } from './infrastructure/config.js';
import { createPrismaClient } from './infrastructure/db/prismaClient.js';
import { PrismaDefaultsRepository } from './infrastructure/db/repositories/prismaDefaultsRepository.js';
import { PrismaPolicyRepository } from './infrastructure/db/repositories/prismaPolicyRepository.js';
import { PrismaPreferencesRepository } from './infrastructure/db/repositories/prismaPreferencesRepository.js';
import { buildLoggerOptions, createBootLogger } from './infrastructure/logger.js';
import { buildServer } from './http/server.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const bootLog = createBootLogger(config);

  bootLog.info({ nodeEnv: config.NODE_ENV, port: config.PORT }, 'service.starting');

  const prisma = createPrismaClient(config);

  const app = await buildServer({
    loggerOptions: buildLoggerOptions(config),
    isProduction: config.NODE_ENV === 'production',
    repos: {
      prefs: new PrismaPreferencesRepository(prisma),
      defaults: new PrismaDefaultsRepository(prisma),
      policies: new PrismaPolicyRepository(prisma),
    },
  });

  // ---- Graceful shutdown ---------------------------------------------------
  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, 'service.stopping');
    void (async () => {
      try {
        await app.close();
        await prisma.$disconnect();
        app.log.info('service.stopped');
        process.exit(0);
      } catch (err) {
        app.log.error({ err }, 'service.shutdown_failed');
        process.exit(1);
      }
    })();
  };

  process.on('SIGINT', () => {
    shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    shutdown('SIGTERM');
  });
  process.on('uncaughtException', (err) => {
    app.log.fatal({ err }, 'uncaught_exception');
    shutdown('uncaughtException');
  });
  process.on('unhandledRejection', (reason) => {
    app.log.fatal({ reason }, 'unhandled_rejection');
    shutdown('unhandledRejection');
  });

  await app.listen({ host: '0.0.0.0', port: config.PORT });
}

main().catch((err: unknown) => {
  // Last-resort: no logger yet or logger itself failed.
  console.error('Fatal during startup:', err);
  process.exit(1);
});
