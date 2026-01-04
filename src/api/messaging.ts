import { Express } from 'express';
import { internalAuth } from '../middleware/internalAuth';
import { sendMessageController } from '../controllers/msgController';

export function registerMessagingRoutes(app: Express): void {
  app.post('/services/messaging/send', internalAuth, sendMessageController);
}


