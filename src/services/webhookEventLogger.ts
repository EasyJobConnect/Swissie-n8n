import { Db } from 'mongodb';
import { logger } from '../lib/logger';
import { env } from '../config/env';

export interface WebhookEventLog {
  event_id: string;
  env: string;
  service_role: string;
  source: string; // 'webhook'
  error_code?: string;
  error_message?: string;
  retry_count: number;
  last_error?: string;
  status: 'received' | 'processing' | 'success' | 'failed';
  response_status?: number;
  timestamp: Date;
  correlation_id?: string;
  raw_payload?: any;
}

/**
 * Structured failure logging for webhooks
 * Used for replay support and failure investigation
 */
export class WebhookEventLogger {
  constructor(private db: Db) {}

  /**
   * Initialize webhook event tracking collection with indexes
   */
  async ensureCollection(): Promise<void> {
    try {
      const collection = this.db.collection<WebhookEventLog>('webhook_events');
      
      // Ensure indexes
      await collection.createIndex({ event_id: 1 }, { unique: true });
      await collection.createIndex({ env: 1, timestamp: -1 });
      await collection.createIndex({ status: 1 });
      await collection.createIndex(
        { timestamp: 1 },
        { expireAfterSeconds: 86400 * 7 } // Auto-delete after 7 days
      );
    } catch (e: any) {
      logger.warn(`Failed to ensure webhook_events collection: ${e?.message}`);
    }
  }

  /**
   * Log webhook event with structured format
   */
  async log(event: WebhookEventLog): Promise<void> {
    try {
      const collection = this.db.collection<WebhookEventLog>('webhook_events');
      
      await collection.updateOne(
        { event_id: event.event_id },
        { $set: event },
        { upsert: true }
      );
    } catch (e: any) {
      // Fail gracefully - don't block webhook processing on logging error
      logger.warn(`Failed to log webhook event ${event.event_id}: ${e?.message}`);
    }
  }

  /**
   * Log webhook failure with context
   */
  async logFailure(
    eventId: string,
    errorCode: string,
    errorMessage: string,
    retryCount: number = 0,
    correlationId?: string,
    responseStatus?: number
  ): Promise<void> {
    const event: WebhookEventLog = {
      event_id: eventId,
      env: env.APP_ENV,
      service_role: env.SERVICE_ROLE,
      source: 'webhook',
      error_code: errorCode,
      error_message: errorMessage,
      last_error: errorMessage,
      retry_count: retryCount,
      status: retryCount > 5 ? 'failed' : 'processing',
      response_status: responseStatus,
      timestamp: new Date(),
      correlation_id: correlationId,
    };

    await this.log(event);

    // Also log to structured logger
    logger.error(
      JSON.stringify({
        msg: 'webhook_failure',
        event_id: eventId,
        env: env.APP_ENV,
        error_code: errorCode,
        error_message: errorMessage,
        retry_count: retryCount,
        correlation_id: correlationId,
        response_status: responseStatus,
        timestamp: new Date().toISOString(),
      })
    );
  }

  /**
   * Mark webhook as successfully processed
   */
  async logSuccess(
    eventId: string,
    correlationId?: string,
    responseStatus: number = 200
  ): Promise<void> {
    const event: WebhookEventLog = {
      event_id: eventId,
      env: env.APP_ENV,
      service_role: env.SERVICE_ROLE,
      source: 'webhook',
      retry_count: 0,
      status: 'success',
      response_status: responseStatus,
      timestamp: new Date(),
      correlation_id: correlationId,
    };

    await this.log(event);
  }

  /**
   * Retrieve webhook event for replay validation
   */
  async getEvent(eventId: string): Promise<WebhookEventLog | null> {
    try {
      const collection = this.db.collection<WebhookEventLog>('webhook_events');
      return await collection.findOne({ event_id: eventId });
    } catch (e: any) {
      logger.warn(`Failed to retrieve webhook event ${eventId}: ${e?.message}`);
      return null;
    }
  }
}
