import { Express } from 'express';
import { internalAuth } from '../middleware/internalAuth';
import { loginController, logoutController, getMeController } from '../controllers/authController';

export function registerAuthRoutes(app: Express): void {
  app.post('/auth/login', loginController);
  app.post('/auth/logout', internalAuth, logoutController);
  app.get('/auth/me', internalAuth, getMeController);
}


