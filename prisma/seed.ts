import { PrismaClient } from '@prisma/client';
import { CHANNELS } from '../src/domain/types.js';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  // 8 default preferences: transactional_* opt-in, marketing_* opt-out.
  for (const channel of CHANNELS) {
    const txType = `transactional_${channel}`;
    const mkType = `marketing_${channel}`;

    await prisma.defaultPreference.upsert({
      where: { notificationType_channel: { notificationType: txType, channel } },
      update: { enabled: true },
      create: { notificationType: txType, channel, enabled: true },
    });
    await prisma.defaultPreference.upsert({
      where: { notificationType_channel: { notificationType: mkType, channel } },
      update: { enabled: false },
      create: { notificationType: mkType, channel, enabled: false },
    });
  }

  // Sample global policy: marketing SMS is denied in EU.
  const existing = await prisma.globalPolicy.findFirst({
    where: { notificationType: 'marketing_sms', region: 'EU', channel: 'sms' },
  });
  if (!existing) {
    await prisma.globalPolicy.create({
      data: {
        notificationType: 'marketing_sms',
        region: 'EU',
        channel: 'sms',
        action: 'deny',
        reasonCode: 'blocked_by_global_policy',
      },
    });
  }

  console.log('Seed completed.');
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
