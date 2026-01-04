import { Express } from 'express';
import { internalAuth } from '../middleware/internalAuth';
import { getUserController, createUserController, updateUserController } from '../controllers/userController';

export function registerUserRoutes(app: Express): void {
  app.get('/user/:id', internalAuth, getUserController);
  app.post('/user', internalAuth, createUserController);
  app.patch('/user/:id', internalAuth, updateUserController);
}


