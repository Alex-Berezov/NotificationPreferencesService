import type { PrismaClient } from '@prisma/client';
import type { PolicyRepository } from '../../../application/ports.js';
import {
  isChannel,
  parseNotificationType,
  parseRegion,
  type GlobalPolicy,
  type NotificationType,
  type Region,
} from '../../../domain/types.js';

export class PrismaPolicyRepository implements PolicyRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findApplicable(type: NotificationType, region: Region): Promise<GlobalPolicy[]> {
    const rows = await this.prisma.globalPolicy.findMany({
      where: { notificationType: type, region, action: 'deny' },
    });
    const result: GlobalPolicy[] = [];
    for (const r of rows) {
      const channel = r.channel === null ? null : isChannel(r.channel) ? r.channel : undefined;
      // Defensive skip: a row with an unknown channel value is treated as not applicable
      // rather than throwing, so a single bad row cannot poison the whole evaluation.
      if (channel === undefined) continue;
      result.push({
        notificationType: parseNotificationType(r.notificationType),
        region: parseRegion(r.region),
        channel,
        action: 'deny',
        reasonCode: 'blocked_by_global_policy',
      });
    }
    return result;
  }
}
