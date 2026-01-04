import { getDb } from '../db/mongo';
import { v4 as uuidv4 } from 'uuid';
import { sendMessageWithFallback } from './messaging';
import { env } from '../config/env';
import { logger } from '../lib/logger';

export type RefundRequestInput = {
  payment_intent_id: string;
  amount_cents: number;
  correlationId?: string;
};

export type RefundRequestResult =
  | { ok: true; status: 'accepted'; refund_id: string }
  | { ok: true; status: 'pending_approval'; refund_id: string }
  | { ok: false; error: string };

export function isLikelyValidPaymentIntentId(id: string): boolean {
  // Basic Stripe-like pattern: "pi_" prefix; alnum/underscore; length >= 10
  return /^pi_[A-Za-z0-9]{8,}$/.test(id);
}

export async function requestRefund(input: RefundRequestInput): Promise<RefundRequestResult> {
  const db = await getDb();
  const refund_id = uuidv4();
  const now = new Date();
  const needsApproval = input.amount_cents > env.REFUND_LIMIT_CENTS;

  await db.collection('refunds').insertOne({
    refund_id,
    payment_intent_id: input.payment_intent_id,
    amount_cents: input.amount_cents,
    status: needsApproval ? 'pending_approval' : 'accepted',
    correlation_id: input.correlationId,
    created_at: now,
    updated_at: now
  });

  if (needsApproval) {
    const channel = env.SLACK_ALERT_CHANNEL;
    if (channel) {
      try {
        await sendMessageWithFallback({
          channel: 'slack',
          to: channel,
          template_id: 'generic',
          params: {
            message: `Refund pending approval: ${refund_id} for ${input.amount_cents} cents on ${input.payment_intent_id}`
          },
          correlationId: input.correlationId
        });
      } catch (e: any) {
        logger.warn(`Failed to send refund approval alert: ${e?.message}`);
      }
    }
    return { ok: true, status: 'pending_approval', refund_id };
  }

  // In a future iteration, enqueue actual processing here.
  return { ok: true, status: 'accepted', refund_id };
}


