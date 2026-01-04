import { Express } from 'express';
import { internalAuth } from '../middleware/internalAuth';
import { verifyEntitlementController } from '../controllers/verifyController';

export function registerVerifyRoutes(app: Express): void {
  app.post('/verify/entitlement', internalAuth, verifyEntitlementController);
}


