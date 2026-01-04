import { Express, Request, Response } from 'express';
import { internalAuth } from '../middleware/internalAuth';
import { WebhookEventLogger } from '../services/webhookEventLogger';
import { getDb } from '../db/mongo';
import { logger } from '../lib/logger';
import { env } from '../config/env';

export function registerWebhookInternalRoutes(app: Express): void {
  /**
   * Internal-only endpoint to replay a webhook event
   * Guards:
   * - Internal JWT authentication
   * - IP allowlist
   * - APP_ENV must match
   * - Idempotency enforced
   * 
   * POST /internal/webhooks/replay/:event_id
   */
  app.post(
    '/internal/webhooks/replay/:event_id',
    internalAuth,
    async (req: Request, res: Response) => {
      const eventId = (req.params.event_id || '').trim();
      const correlationId = (req as any).correlationId as string | undefined;

      if (!eventId) {
        res.status(400).json({ error: { message: 'Missing event_id parameter' } });
        return;
      }

      try {
        const db = await getDb();
        const eventLogger = new WebhookEventLogger(db);

        // Check if event exists and matches current environment
        const event = await eventLogger.getEvent(eventId);
        if (!event) {
          res.status(404).json({ error: { message: 'Event not found' } });
          return;
        }

        // Verify event belongs to same environment (prevent cross-env replay)
        if (event.env !== env.APP_ENV) {
          logger.warn(
            `Replay denied: event env=${event.env} does not match current APP_ENV=${env.APP_ENV}`
          );
          res.status(403).json({
            error: {
              message: `Event belongs to different environment (${event.env}); cannot replay across environments`,
            },
          });
          return;
        }

        // Log replay attempt
        logger.info(
          JSON.stringify({
            msg: 'webhook_replay_requested',
            event_id: eventId,
            env: env.APP_ENV,
            correlation_id: correlationId,
            original_correlation_id: event.correlation_id,
            timestamp: new Date().toISOString(),
          })
        );

        // Return event details for replay (actual re-processing would be done by calling service)
        res.status(200).json({
          ok: true,
          event: {
            event_id: event.event_id,
            env: event.env,
            source: event.source,
            status: event.status,
            retry_count: event.retry_count,
            last_error: event.last_error,
            original_correlation_id: event.correlation_id,
            timestamp: event.timestamp,
            message: 'Event retrieved for replay. Caller must re-submit to /webhook/entry with same or new X-Idempotency-Key.',
          },
        });
      } catch (err: any) {
        logger.error(`Internal replay endpoint error: ${err?.message}`);
        res.status(500).json({ error: { message: 'Internal server error' } });
      }
    }
  );

  /**
   * Internal endpoint to get webhook events by environment
   * Guards:
   * - Internal JWT authentication
   * - Pagination
   * 
   * GET /internal/webhooks/events?env=staging&status=failed&limit=50
   */
  app.get(
    '/internal/webhooks/events',
    internalAuth,
    async (req: Request, res: Response) => {
      const queryEnv = (req.query.env as string)?.trim() || env.APP_ENV;
      const status = (req.query.status as string)?.trim();
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
      const skip = parseInt(req.query.skip as string) || 0;

      // Prevent cross-environment queries
      if (queryEnv !== env.APP_ENV) {
        res.status(403).json({
          error: { message: `Cannot query events from different environment: ${queryEnv}` },
        });
        return;
      }

      try {
        const db = await getDb();
        const collection = db.collection('webhook_events');

        const filter: any = { env: queryEnv };
        if (status) {
          filter.status = status;
        }

        const events = await collection
          .find(filter)
          .sort({ timestamp: -1 })
          .skip(skip)
          .limit(limit)
          .toArray();

        const total = await collection.countDocuments(filter);

        res.status(200).json({
          ok: true,
          events,
          pagination: { limit, skip, total },
        });
      } catch (err: any) {
        logger.error(`Internal events endpoint error: ${err?.message}`);
        res.status(500).json({ error: { message: 'Internal server error' } });
      }
    }
  );
}
