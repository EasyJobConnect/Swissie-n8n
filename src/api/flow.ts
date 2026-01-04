import { Express } from 'express';
import { internalAuth } from '../middleware/internalAuth';
import { executeFlowController, getFlowStatusController } from '../controllers/flowController';

export function registerFlowRoutes(app: Express): void {
  app.post('/flow/execute', internalAuth, executeFlowController);
  app.get('/flow/:id/status', internalAuth, getFlowStatusController);
}


