import { Job } from 'bullmq';
import { logger } from '../lib/logger';
import { getDb } from '../db/mongo';
import { sendMessageWithFallback } from '../services/messaging';
import { getJitterDelay } from '../lib/http';

interface MessagingRetryJobData {
  message_id: string;
  attempt: number;
  original_error?: string;
}

/**
 * Messaging Retry Worker
 * Retries failed message deliveries with exponential backoff
 */
export async function processMessagingRetry(job: Job<MessagingRetryJobData>): Promise<any> {
  const { message_id, attempt, original_error } = job.data;
  
  logger.info(`Messaging retry job started: id=${job.id} message=${message_id} attempt=${attempt}`);

  try {
    const db = await getDb();
    
    // Fetch the original message
    const message = await db.collection('messages').findOne({ message_id });
    
    if (!message) {
      logger.warn(`Message not found for retry: message_id=${message_id}`);
      return { ok: false, reason: 'message_not_found' };
    }

    // Check if message has already been delivered
    if (message.status === 'delivered' || message.status === 'sent') {
      logger.info(`Message already delivered: message_id=${message_id}`);
      return { ok: true, reason: 'already_delivered' };
    }

    // Check retry limit (max 5 retries)
    const retryCount = message.retry_count || 0;
    if (retryCount >= 5) {
      logger.warn(`Max retries reached for message: message_id=${message_id}`);
      
      await db.collection('messages').updateOne(
        { message_id },
        {
          $set: {
            status: 'failed',
            error: 'Max retries exceeded',
            updated_at: new Date(),
          },
        }
      );
      
      return { ok: false, reason: 'max_retries_exceeded' };
    }

    // Update retry count
    await db.collection('messages').updateOne(
      { message_id },
      {
        $set: {
          status: 'retrying',
          retry_count: retryCount + 1,
          last_retry_at: new Date(),
          updated_at: new Date(),
        },
      }
    );

    // Add jitter delay before retry to prevent thundering herd
    const jitterMs = getJitterDelay(100); // 50-150ms jitter
    await new Promise(resolve => setTimeout(resolve, jitterMs));
    
    // Retry sending the message
    const result = await sendMessageWithFallback({
      channel: message.channel,
      to: message.to,
      template_id: message.template_id,
      params: message.params || {},
      fallback: message.fallback,
    });

    if (result.ok) {
      // Update message status to delivered
      await db.collection('messages').updateOne(
        { message_id },
        {
          $set: {
            status: 'delivered',
            delivered_at: new Date(),
            channel_used: result.channel_used,
            updated_at: new Date(),
          },
        }
      );

      logger.info(`Message retry successful: message_id=${message_id} attempt=${retryCount + 1} channel=${result.channel_used}`);
      return { ok: true, message_id, channel_used: result.channel_used };
    } else {
      // Retry failed, will be retried again if under limit
      logger.warn(`Message retry failed: message_id=${message_id} attempt=${retryCount + 1}`);
      
      await db.collection('messages').updateOne(
        { message_id },
        {
          $set: {
            status: 'retry_failed',
            updated_at: new Date(),
          },
        }
      );

      throw new Error('Message delivery failed');
    }
  } catch (err: any) {
    logger.error(`Messaging retry job failed: id=${job.id} message=${message_id} error=${err?.message}`);
    throw err;
  }
}

