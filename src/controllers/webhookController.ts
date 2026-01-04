import { Request, Response } from 'express';
import { forwardToDestination } from '../services/microBackendForwarder';
import { logger } from '../lib/logger';
import { env } from '../config/env';
import { getDb } from '../db/mongo';
import { WebhookEventLogger } from '../services/webhookEventLogger';

export async function handleWebhookEntry(req: Request, res: Response): Promise<void> {
  const internalEventId = (req as any).internal_event_id as string;
  const correlationId = (req as any).correlationId as string | undefined;
  const normalized = (req as any).normalizedPayload || {};

  try {
    const db = await getDb();
    const eventLogger = new WebhookEventLogger(db);
    await eventLogger.ensureCollection();

    // Route to appropriate destination based on configuration
    const result = await forwardToDestination({
      payload: normalized,
      internalEventId,
      correlationId,
    });

    if (!result.ok) {
      const destination = env.FORWARD_TO_MICRO_BACKEND_ONLY
        ? 'micro-backend'
        : 'n8n';
      const errorCode = `forward_failed_${result.status || 'unknown'}`;
      const errorMsg = `${destination} forward failed: status=${result.status}`;
      
      logger.error(errorMsg);
      
      // Log failure for replay support
      await eventLogger.logFailure(
        internalEventId,
        errorCode,
        errorMsg,
        0, // retry count
        correlationId,
        result.status
      );
    } else {
      // Log success
      await eventLogger.logSuccess(internalEventId, correlationId, 200);
    }

    // Always return 202 Accepted to acknowledge receipt (async processing)
    // This prevents retry of webhook by upstream sender
    res.status(202).json({
      status: 'accepted',
      internal_event_id: internalEventId,
    });
  } catch (err: any) {
    logger.error(`Webhook entry handler error: ${err?.message}`);
    
    // Log error for investigation
    try {
      const db = await getDb();
      const eventLogger = new WebhookEventLogger(db);
      await eventLogger.logFailure(
        internalEventId,
        'handler_error',
        err?.message || 'Unknown error',
        0,
        correlationId
      );
    } catch (logErr: any) {
      logger.warn(`Failed to log webhook error: ${logErr?.message}`);
    }

    res.status(500).json({
      error: { message: 'Internal server error' },
      internal_event_id: internalEventId,
    });
  }
}


