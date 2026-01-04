import { Express } from 'express';
import { internalAuth } from '../middleware/internalAuth';
import { upsertController } from '../controllers/storageController';

export function registerStorageRoutes(app: Express): void {
  app.post('/services/storage/upsert', internalAuth, upsertController);
}


