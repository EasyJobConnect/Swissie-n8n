import { Express } from 'express';
import { healthCheckController } from '../controllers/healthController';

export function registerHealthRoutes(app: Express): void {
  app.get('/health', healthCheckController);
}


