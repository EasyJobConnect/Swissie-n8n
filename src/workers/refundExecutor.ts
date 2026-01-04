import { Job } from 'bullmq';
import { logger } from '../lib/logger';
import { getDb } from '../db/mongo';
import { env } from '../config/env';
import { v4 as uuidv4 } from 'uuid';

interface RefundExecuteJobData {
  refund_id: string;
  user_id: string;
  transaction_id: string;
  amount_cents: number;
  reason?: string;
  metadata?: Record<string, any>;
}

/**
 * Refund Executor Worker
 * Processes refund requests with payment provider integration
 */
export async function processRefundExecute(job: Job<RefundExecuteJobData>): Promise<any> {
  const { refund_id, user_id, transaction_id, amount_cents, reason, metadata } = job.data;
  
  logger.info(`Refund job started: id=${job.id} refund=${refund_id} amount=${amount_cents}`);

  try {
    if (!env.ENABLE_REFUNDS) {
      logger.warn(`Refunds disabled: refund_id=${refund_id}`);
      return { ok: false, reason: 'refunds_disabled' };
    }

    // Check refund limit
    const refundLimitCents = env.REFUND_LIMIT_CENTS;
    if (amount_cents > refundLimitCents) {
      logger.warn(`Refund exceeds limit: refund_id=${refund_id} amount=${amount_cents} limit=${refundLimitCents}`);
      
      const db = await getDb();
      await db.collection('refunds').updateOne(
        { refund_id },
        {
          $set: {
            status: 'rejected',
            rejection_reason: 'amount_exceeds_limit',
            updated_at: new Date(),
          },
        },
        { upsert: true }
      );
      
      return { ok: false, reason: 'amount_exceeds_limit' };
    }

    const db = await getDb();
    
    // Verify transaction exists
    const transaction = await db.collection('transactions').findOne({ transaction_id });
    
    if (!transaction) {
      logger.warn(`Transaction not found for refund: transaction_id=${transaction_id}`);
      
      await db.collection('refunds').updateOne(
        { refund_id },
        {
          $set: {
            status: 'failed',
            error: 'transaction_not_found',
            updated_at: new Date(),
          },
        },
        { upsert: true }
      );
      
      return { ok: false, reason: 'transaction_not_found' };
    }

    // Check if already refunded
    const existingRefund = await db.collection('refunds').findOne({
      transaction_id,
      status: 'completed',
    });
    
    if (existingRefund) {
      logger.warn(`Transaction already refunded: transaction_id=${transaction_id}`);
      return { ok: false, reason: 'already_refunded' };
    }

    // Update refund status to processing (using snake_case for timestamps)
    const now = new Date();
    await db.collection('refunds').updateOne(
      { refund_id },
      {
        $set: {
          status: 'processing',
          user_id,
          transaction_id,
          amount_cents,
          reason,
          metadata,
          started_at: now,
          updated_at: now,
        },
      },
      { upsert: true }
    );

    // TODO: Call payment provider API (Stripe, PayPal, etc.)
    // Placeholder implementation - replace with actual payment provider
    const providerRefundId = `ref_${uuidv4()}`;
    
    // Simulate payment provider call
    // const providerResult = await callPaymentProvider({
    //   transaction_id: transaction.provider_transaction_id,
    //   amount: amount_cents,
    //   reason,
    // });

    const providerResult = {
      success: true,
      refund_id: providerRefundId,
      status: 'succeeded',
      processed_at: new Date(),
    };

    // Update refund with provider response (using snake_case for timestamps)
    await db.collection('refunds').updateOne(
      { refund_id },
      {
        $set: {
          status: 'completed',
          provider_refund_id: providerResult.refund_id,
          provider_status: providerResult.status,
          completed_at: new Date(),
          updated_at: new Date(),
        },
      }
    );

    // Update transaction with refund info (using snake_case for timestamps)
    await db.collection('transactions').updateOne(
      { transaction_id },
      {
        $set: {
          refunded: true,
          refund_id: refund_id,
          refund_amount_cents: amount_cents,
          refunded_at: new Date(),
          updated_at: new Date(),
        },
      }
    );

    // Audit log
    await db.collection('audit_logs').insertOne({
      event_type: 'refund_executed',
      refund_id,
      user_id,
      transaction_id,
      amount_cents,
      reason,
      provider_refund_id: providerResult.refund_id,
      at: new Date(),
    });

    logger.info(`Refund job completed: id=${job.id} refund=${refund_id} provider_id=${providerResult.refund_id}`);

    return {
      ok: true,
      refund_id,
      provider_refund_id: providerResult.refund_id,
      amount_cents,
    };
  } catch (err: any) {
    logger.error(`Refund job failed: id=${job.id} refund=${refund_id} error=${err?.message}`);
    
    // Update refund with error (using snake_case for timestamps)
    try {
      const db = await getDb();
      await db.collection('refunds').updateOne(
        { refund_id },
        {
          $set: {
            status: 'failed',
            error: err?.message,
            failed_at: new Date(),
            updated_at: new Date(),
          },
        }
      );
    } catch (updateErr: any) {
      logger.warn(`Failed to update refund error status: ${updateErr?.message}`);
    }

    throw err;
  }
}

