import { and, desc, eq, isNull } from 'drizzle-orm';
import { db } from '../db/client';
import { buyerNotifications, type BuyerNotification } from '../db/schema';
import { t } from '../i18n';
import { publishLive } from './events';

export interface QueueBuyerNotificationInput {
  buyerId: string;
  templateKey: string; // notif.* catalog key
  params?: Record<string, string | number>;
  contractId?: string;
  lotId?: string;
  demandId?: string;
  jobId?: string;
}

/** Queue an in-app notification. Message resolved NOW — what was said is archived. */
export async function queueBuyerNotification(input: QueueBuyerNotificationInput): Promise<BuyerNotification> {
  const row = (await db
        .insert(buyerNotifications)
        .values({
          buyerId: input.buyerId,
          templateKey: input.templateKey,
          message: t('en', input.templateKey, input.params),
          contractId: input.contractId ?? null,
          lotId: input.lotId ?? null,
          demandId: input.demandId ?? null,
          jobId: input.jobId ?? null,
        })
        .returning())[0]!;
  publishLive({ topic: 'notifications', audience: [`buyer:${input.buyerId}`] });
  return row;
}

export async function listBuyerNotifications(buyerId: string, limit = 15): Promise<BuyerNotification[]> {
  return (await db
      .select()
      .from(buyerNotifications)
      .where(eq(buyerNotifications.buyerId, buyerId))
      .orderBy(desc(buyerNotifications.createdAt)))
    .slice(0, limit);
}

export async function unreadNotificationCount(buyerId: string): Promise<number> {
  return (await db
      .select()
      .from(buyerNotifications)
      .where(and(eq(buyerNotifications.buyerId, buyerId), isNull(buyerNotifications.readAt)))).length;
}

/** Mark all (or specific) notifications read — scoped to the buyer's own rows. */
export async function markNotificationsRead(buyerId: string, ids?: string[]): Promise<number> {
  const now = Date.now();
  const rows = (await db
      .select()
      .from(buyerNotifications)
      .where(and(eq(buyerNotifications.buyerId, buyerId), isNull(buyerNotifications.readAt))))
    .filter((n) => !ids || ids.includes(n.id));
  for (const n of rows) {
    (await db.update(buyerNotifications).set({ readAt: now }).where(eq(buyerNotifications.id, n.id)));
  }
  return rows.length;
}
