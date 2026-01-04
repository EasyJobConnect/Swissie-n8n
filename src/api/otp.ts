import { Express } from 'express';
import { internalAuth } from '../middleware/internalAuth';
import { generateOtpController, verifyOtpController } from '../controllers/otpController';

export function registerOtpRoutes(app: Express): void {
  app.post('/otp/generate', internalAuth, generateOtpController);

  app.post('/otp/verify', internalAuth, verifyOtpController);
}


