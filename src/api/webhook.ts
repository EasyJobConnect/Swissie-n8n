import { Express, Request, Response } from 'express';
import { verifyHmacSignature } from '../middleware/signature';
import { webhookRateLimiter } from '../middleware/rateLimit';
import { blockList } from '../middleware/blockList';
import { validateAndNormalizePayload } from '../middleware/validatePayload';
import { deduplicate } from '../middleware/dedup';
import bodyParser from 'body-parser';
import { idempotency } from '../middleware/idempotency';
import { env } from '../config/env';
import { handleWebhookEntry } from '../controllers/webhookController';

export function registerWebhookRoutes(app: Express): void {
  app.post(
    '/webhook/entry',
    // Limit raw body size to 1MB for security
    bodyParser.raw({ type: '*/*', limit: '1mb' }),
    (req: Request, _res: Response, next) => {
      // Expose raw body for HMAC
      (req as any).rawBody = req.body as Buffer;
      next();
    },
    blockList,
    webhookRateLimiter(),
    verifyHmacSignature(),
    (env.ENABLE_IDEMPOTENCY_MW ? idempotency() : (_req, _res, next) => next()),
    validateAndNormalizePayload,
    async (req: Request, res: Response, next) => {
      try {
        await deduplicate(req, res, next);
      } catch (e) {
        next(e);
      }
    },
    handleWebhookEntry
  );
}


