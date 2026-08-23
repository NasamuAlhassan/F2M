import { and, desc, eq, isNull } from 'drizzle-orm';
import { db } from '../db/client';
import { buyerNotifications, type BuyerNotification } from '../db/schema';
import { t } from '../i18n';

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
export function queueBuyerNotification(input: QueueBuyerNotificationInput): BuyerNotification {
  return db
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
    .returning()
    .get();
}

export function listBuyerNotifications(buyerId: string, limit = 15): BuyerNotification[] {
  return db
    .select()
    .from(buyerNotifications)
    .where(eq(buyerNotifications.buyerId, buyerId))
    .orderBy(desc(buyerNotifications.createdAt))
    .all()
    .slice(0, limit);
}

export function unreadNotificationCount(buyerId: string): number {
  return db
    .select()
    .from(buyerNotifications)
    .where(and(eq(buyerNotifications.buyerId, buyerId), isNull(buyerNotifications.readAt)))
    .all().length;
}

/** Mark all (or specific) notifications read — scoped to the buyer's own rows. */
export function markNotificationsRead(buyerId: string, ids?: string[]): number {
  const now = Date.now();
  const rows = db
    .select()
    .from(buyerNotifications)
    .where(and(eq(buyerNotifications.buyerId, buyerId), isNull(buyerNotifications.readAt)))
    .all()
    .filter((n) => !ids || ids.includes(n.id));
  for (const n of rows) {
    db.update(buyerNotifications).set({ readAt: now }).where(eq(buyerNotifications.id, n.id)).run();
  }
  return rows.length;
}
