import { Express } from 'express';
import { internalAuth } from '../middleware/internalAuth';
import { env } from '../config/env';
import { requestRefundController } from '../controllers/payController';
import { createRefundController, getRefundStatusController } from '../controllers/refundController';

export function registerRefundRoutes(app: Express): void {
  if (!env.ENABLE_REFUNDS) return;

  app.post('/refunds/request', internalAuth, requestRefundController);
  app.post('/refunds', internalAuth, createRefundController);
  app.get('/refunds/:id', internalAuth, getRefundStatusController);
}


