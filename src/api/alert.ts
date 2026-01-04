import { Express } from 'express';
import { internalAuth } from '../middleware/internalAuth';
import { sendAlertController } from '../controllers/alertController';

export function registerAlertRoutes(app: Express): void {
  app.post('/alert/admin', internalAuth, sendAlertController);
}


