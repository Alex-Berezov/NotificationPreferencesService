import { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildServer } from '../../src/http/server.js';
import { PrismaDefaultsRepository } from '../../src/infrastructure/db/repositories/prismaDefaultsRepository.js';
import { PrismaPolicyRepository } from '../../src/infrastructure/db/repositories/prismaPolicyRepository.js';
import { PrismaPreferencesRepository } from '../../src/infrastructure/db/repositories/prismaPreferencesRepository.js';

let prisma: PrismaClient;
let app: FastifyInstance;

beforeAll(async () => {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set — globalSetup did not run');
  }
  prisma = new PrismaClient({
    datasources: { db: { url: databaseUrl } },
  });
  app = await buildServer({
    loggerOptions: { level: 'silent' },
    isProduction: false,
    repos: {
      prefs: new PrismaPreferencesRepository(prisma),
      defaults: new PrismaDefaultsRepository(prisma),
      policies: new PrismaPolicyRepository(prisma),
    },
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  // Wipe only user-scoped data; keep defaults + seeded policies.
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE user_preference_overrides, user_quiet_hours RESTART IDENTITY CASCADE',
  );
});

// ---------------------------------------------------------------------------
// GET /users/:id/preferences
// ---------------------------------------------------------------------------

describe('GET /users/:id/preferences', () => {
  it('returns 8 default entries for a brand-new user with quietHours=null', async () => {
    const res = await app.inject({ method: 'GET', url: '/users/new-user/preferences' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      userId: string;
      entries: { type: string; channel: string; enabled: boolean; source: string }[];
      quietHours: unknown;
    }>();
    expect(body.userId).toBe('new-user');
    expect(body.quietHours).toBeNull();
    expect(body.entries).toHaveLength(8);
    expect(body.entries.every((e) => e.source === 'default')).toBe(true);
    const tx = body.entries.find((e) => e.type === 'transactional_email' && e.channel === 'email');
    const mk = body.entries.find((e) => e.type === 'marketing_email' && e.channel === 'email');
    expect(tx?.enabled).toBe(true);
    expect(mk?.enabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// POST /users/:id/preferences — toggles & idempotency
// ---------------------------------------------------------------------------

describe('POST /users/:id/preferences (toggles)', () => {
  it('persists an override and is idempotent on repeated calls', async () => {
    const userId = 'user-toggle';
    const body = {
      toggles: [{ type: 'marketing_email', channel: 'email', enabled: false }],
    };

    const first = await app.inject({
      method: 'POST',
      url: `/users/${userId}/preferences`,
      payload: body,
    });
    expect(first.statusCode).toBe(200);

    const get1 = await app.inject({ method: 'GET', url: `/users/${userId}/preferences` });
    const j1 = get1.json<{
      entries: { type: string; channel: string; enabled: boolean; source: string }[];
    }>();
    const e1 = j1.entries.find((e) => e.type === 'marketing_email' && e.channel === 'email');
    expect(e1).toMatchObject({ enabled: false, source: 'override' });

    // Repeat — must be idempotent.
    const second = await app.inject({
      method: 'POST',
      url: `/users/${userId}/preferences`,
      payload: body,
    });
    expect(second.statusCode).toBe(200);

    const get2 = await app.inject({ method: 'GET', url: `/users/${userId}/preferences` });
    expect(get2.json()).toEqual(get1.json());
  });
});

// ---------------------------------------------------------------------------
// POST /users/:id/preferences — quietHours set / clear
// ---------------------------------------------------------------------------

describe('POST /users/:id/preferences (quietHours)', () => {
  it('sets quietHours and clears them with quietHours:null (idempotent clear)', async () => {
    const userId = 'user-qh';
    const set = await app.inject({
      method: 'POST',
      url: `/users/${userId}/preferences`,
      payload: {
        quietHours: { start: '22:00', end: '08:00', timezone: 'Europe/Berlin' },
      },
    });
    expect(set.statusCode).toBe(200);

    const get1 = await app.inject({ method: 'GET', url: `/users/${userId}/preferences` });
    expect(get1.json<{ quietHours: unknown }>().quietHours).toMatchObject({
      start: '22:00',
      end: '08:00',
      timezone: 'Europe/Berlin',
    });

    const clear = await app.inject({
      method: 'POST',
      url: `/users/${userId}/preferences`,
      payload: { quietHours: null },
    });
    expect(clear.statusCode).toBe(200);

    const get2 = await app.inject({ method: 'GET', url: `/users/${userId}/preferences` });
    expect(get2.json<{ quietHours: unknown }>().quietHours).toBeNull();

    // Clearing again must not error (no row to delete).
    const clearAgain = await app.inject({
      method: 'POST',
      url: `/users/${userId}/preferences`,
      payload: { quietHours: null },
    });
    expect(clearAgain.statusCode).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// POST /evaluate — full decision matrix
// ---------------------------------------------------------------------------

describe('POST /evaluate', () => {
  it('denies marketing_push during quiet hours and allows transactional_push', async () => {
    const userId = 'user-eval-qh';
    // Enable marketing_push (otherwise it's `disabled_by_default` and QH never reached),
    // then set quiet window 22:00..08:00 Berlin. 2026-06-15T21:30Z = 23:30 CEST → inside.
    await app.inject({
      method: 'POST',
      url: `/users/${userId}/preferences`,
      payload: {
        toggles: [{ type: 'marketing_push', channel: 'push', enabled: true }],
        quietHours: { start: '22:00', end: '08:00', timezone: 'Europe/Berlin' },
      },
    });

    const inWindow = '2026-06-15T21:30:00Z';

    const mk = await app.inject({
      method: 'POST',
      url: '/evaluate',
      payload: {
        userId,
        notificationType: 'marketing_push',
        channel: 'push',
        region: 'US',
        datetime: inWindow,
      },
    });
    expect(mk.statusCode).toBe(200);
    expect(mk.json()).toEqual({ decision: 'deny', reason: 'quiet_hours' });

    const tx = await app.inject({
      method: 'POST',
      url: '/evaluate',
      payload: {
        userId,
        notificationType: 'transactional_push',
        channel: 'push',
        region: 'US',
        datetime: inWindow,
      },
    });
    expect(tx.statusCode).toBe(200);
    expect(tx.json()).toEqual({ decision: 'allow', reason: 'allowed' });
  });

  it('denies marketing_sms in EU by seeded global policy', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/evaluate',
      payload: {
        userId: 'any-user',
        notificationType: 'marketing_sms',
        channel: 'sms',
        region: 'EU',
        datetime: '2026-06-15T12:00:00Z',
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      decision: 'deny',
      reason: 'blocked_by_global_policy',
    });
  });

  it('global policy beats user override for marketing_sms in EU', async () => {
    const userId = 'user-policy';
    await app.inject({
      method: 'POST',
      url: `/users/${userId}/preferences`,
      payload: {
        toggles: [{ type: 'marketing_sms', channel: 'sms', enabled: true }],
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/evaluate',
      payload: {
        userId,
        notificationType: 'marketing_sms',
        channel: 'sms',
        region: 'EU',
        datetime: '2026-06-15T12:00:00Z',
      },
    });
    expect(res.json()).toEqual({
      decision: 'deny',
      reason: 'blocked_by_global_policy',
    });
  });

  it('allows transactional_email by default outside quiet hours', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/evaluate',
      payload: {
        userId: 'fresh',
        notificationType: 'transactional_email',
        channel: 'email',
        region: 'US',
        datetime: '2026-06-15T12:00:00Z',
      },
    });
    expect(res.json()).toEqual({ decision: 'allow', reason: 'allowed' });
  });
});

// ---------------------------------------------------------------------------
// Validation errors — 400
// ---------------------------------------------------------------------------

describe('validation errors', () => {
  it('rejects body without toggles and without quietHours (400)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/users/u1/preferences',
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('validation_error');
  });

  it('rejects invalid timezone (400)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/users/u1/preferences',
      payload: {
        quietHours: { start: '22:00', end: '08:00', timezone: 'Mars/Olympus' },
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects invalid HH:mm (400)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/users/u1/preferences',
      payload: {
        quietHours: { start: '25:00', end: '08:00', timezone: 'UTC' },
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('validation_error');
  });

  it('rejects unknown notificationType in /evaluate (400)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/evaluate',
      payload: {
        userId: 'u1',
        notificationType: 'spam_email',
        channel: 'email',
        region: 'EU',
        datetime: '2026-06-15T12:00:00Z',
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects unknown channel in /evaluate (400)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/evaluate',
      payload: {
        userId: 'u1',
        notificationType: 'marketing_email',
        channel: 'pigeon',
        region: 'EU',
        datetime: '2026-06-15T12:00:00Z',
      },
    });
    expect(res.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

describe('GET /healthz', () => {
  it('returns ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });
});
