import type { PrismaClient } from '@prisma/client';
import type { DefaultsRepository } from '../../../application/ports.js';
import type { PreferenceRecord } from '../../../domain/defaults.js';
import { parseChannel, parseNotificationType } from '../../../domain/types.js';

export class PrismaDefaultsRepository implements DefaultsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async getAll(): Promise<PreferenceRecord[]> {
    const rows = await this.prisma.defaultPreference.findMany();
    return rows.map((r) => ({
      type: parseNotificationType(r.notificationType),
      channel: parseChannel(r.channel),
      enabled: r.enabled,
    }));
  }
}
