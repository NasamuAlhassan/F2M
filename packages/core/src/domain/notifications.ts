import { desc, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { notifications, type Notification } from '../db/schema';
import { t } from '../i18n';
import { getNotifyProvider } from '../providers/notify/index';

export interface QueueSmsInput {
  phone: string; // E.164
  locale: string;
  templateKey: string; // sms.* catalog key
  params?: Record<string, string | number>;
  contractId?: string;
  lotId?: string;
}

/**
 * Queue an SMS in the outbox. The message text is resolved into the
 * recipient's locale NOW — what was promised is what gets archived, even if
 * catalogs change later. Delivery happens on the sweep.
 */
export function queueSms(input: QueueSmsInput): Notification {
  return db
    .insert(notifications)
    .values({
      phone: input.phone,
      templateKey: input.templateKey,
      message: t(input.locale, input.templateKey, input.params),
      contractId: input.contractId ?? null,
      lotId: input.lotId ?? null,
    })
    .returning()
    .get();
}

/** Deliver pending outbox entries via the configured provider. Sweep-driven. */
export async function sendPendingNotifications(): Promise<number> {
  const provider = getNotifyProvider();
  const pending = db.select().from(notifications).where(eq(notifications.status, 'pending')).all();
  let delivered = 0;
  for (const notification of pending) {
    try {
      await provider.send(notification.phone, notification.message);
      db.update(notifications)
        .set({ status: 'sent', provider: provider.name, sentAt: Date.now() })
        .where(eq(notifications.id, notification.id))
        .run();
      delivered += 1;
    } catch (err) {
      db.update(notifications)
        .set({ status: 'failed', provider: provider.name, error: String(err) })
        .where(eq(notifications.id, notification.id))
        .run();
    }
  }
  return delivered;
}

export function listNotificationsForPhone(phone: string, limit = 10): Notification[] {
  return db
    .select()
    .from(notifications)
    .where(eq(notifications.phone, phone))
    .orderBy(desc(notifications.createdAt))
    .all()
    .slice(0, limit);
}
