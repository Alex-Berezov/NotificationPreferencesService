import { Prisma, type PrismaClient } from '@prisma/client';
import type { PreferencesRepository } from '../../../application/ports.js';
import type { PreferenceRecord } from '../../../domain/defaults.js';
import { QuietHours } from '../../../domain/quietHours.js';
import { parseChannel, parseNotificationType, type UserId } from '../../../domain/types.js';

export class PrismaPreferencesRepository implements PreferencesRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async getOverrides(userId: UserId): Promise<PreferenceRecord[]> {
    const rows = await this.prisma.userPreferenceOverride.findMany({ where: { userId } });
    return rows.map((r) => ({
      type: parseNotificationType(r.notificationType),
      channel: parseChannel(r.channel),
      enabled: r.enabled,
    }));
  }

  async getQuietHours(userId: UserId): Promise<QuietHours | null> {
    const row = await this.prisma.userQuietHours.findUnique({ where: { userId } });
    if (row === null) return null;
    return QuietHours.fromMinutes({
      startMinutes: row.startMinutes,
      endMinutes: row.endMinutes,
      timezone: row.timezone,
    });
  }

  async upsertOverrides(userId: UserId, records: readonly PreferenceRecord[]): Promise<void> {
    if (records.length === 0) return;
    // Idempotent batch UPSERT in a single transaction.
    await this.prisma.$transaction(
      records.map((r) =>
        this.prisma.userPreferenceOverride.upsert({
          where: {
            userId_notificationType_channel: {
              userId,
              notificationType: r.type,
              channel: r.channel,
            },
          },
          update: { enabled: r.enabled },
          create: {
            userId,
            notificationType: r.type,
            channel: r.channel,
            enabled: r.enabled,
          },
        }),
      ),
    );
  }

  async setQuietHours(userId: UserId, qh: QuietHours | null): Promise<void> {
    if (qh === null) {
      try {
        await this.prisma.userQuietHours.delete({ where: { userId } });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
          // Record to delete does not exist — idempotent no-op.
          return;
        }
        throw err;
      }
      return;
    }
    await this.prisma.userQuietHours.upsert({
      where: { userId },
      update: {
        startMinutes: qh.startMinutes,
        endMinutes: qh.endMinutes,
        timezone: qh.timezone,
      },
      create: {
        userId,
        startMinutes: qh.startMinutes,
        endMinutes: qh.endMinutes,
        timezone: qh.timezone,
      },
    });
  }
}
