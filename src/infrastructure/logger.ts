import { pino, type Logger as PinoLogger, type LoggerOptions } from 'pino';
import type { Logger } from '../application/ports.js';
import type { AppConfig } from './config.js';

/** Shared pino options used both for the standalone boot logger and Fastify. */
export function buildLoggerOptions(
  config: Pick<AppConfig, 'LOG_LEVEL' | 'NODE_ENV'>,
): LoggerOptions {
  const isDev = config.NODE_ENV === 'development';
  return {
    level: config.LOG_LEVEL,
    base: { service: 'notification-preferences' },
    timestamp: pino.stdTimeFunctions.isoTime,
    ...(isDev
      ? {
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'SYS:standard', singleLine: false },
          },
        }
      : {}),
  };
}

/** Standalone logger for boot / shutdown phases (before Fastify is alive). */
export function createBootLogger(config: Pick<AppConfig, 'LOG_LEVEL' | 'NODE_ENV'>): PinoLogger {
  return pino(buildLoggerOptions(config));
}

/**
 * Adapter: any pino-shaped logger (incl. Fastify's `req.log`) is structurally
 * a {@link Logger} port. This helper is purely a type narrowing —
 * no runtime work involved.
 */
export const asLoggerPort = (l: Pick<Logger, 'info' | 'warn' | 'error' | 'debug'>): Logger => l;
