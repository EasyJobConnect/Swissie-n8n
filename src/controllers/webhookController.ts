import { Request, Response } from 'express';
import { forwardToDestination } from '../services/microBackendForwarder';
import { logger } from '../lib/logger';
import { env } from '../config/env';

export async function handleWebhookEntry(req: Request, res: Response): Promise<void> {
  const internalEventId = (req as any).internal_event_id as string;
  const correlationId = (req as any).correlationId as string | undefined;
  const normalized = (req as any).normalizedPayload || {};

  try {
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
      logger.error(`${destination} forward failed: status=${result.status}`);
    }

    // Always return 200 to acknowledge receipt (async processing)
    res.status(200).json({
      status: 'accepted',
      internal_event_id: internalEventId,
    });
  } catch (err: any) {
    logger.error(`Webhook entry handler error: ${err?.message}`);
    res.status(500).json({
      error: { message: 'Internal server error' },
      internal_event_id: internalEventId,
    });
  }
}


