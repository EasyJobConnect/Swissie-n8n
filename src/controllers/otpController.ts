import { Request, Response } from 'express';
import { generateOtp as generateOtpService, verifyOtp as verifyOtpService } from '../services/otp';
import { env } from '../config/env';
import { sendMessageWithFallback } from '../services/messaging';
import { logger } from '../lib/logger';

export async function generateOtpController(req: Request, res: Response): Promise<void> {
  const { subject_type, subject_id } = req.body || {};
  if (!subject_type || !subject_id) {
    res.status(400).json({ error: { message: 'subject_type and subject_id are required' } });
    return;
  }
  const { otp_id, code } = await generateOtpService({ subject_type, subject_id });
  res.json({ otp_id });

  if (env.OTP_SEND_ON_GENERATE) {
    const to = String(req.body?.to || '').trim();
    const channel = String(req.body?.channel || '').trim();
    if (!to || !channel) {
      logger.warn('OTP_SEND_ON_GENERATE enabled but missing to/channel in request');
      return;
    }
    const correlationId = (req as any).correlationId as string | undefined;
    try {
      await sendMessageWithFallback({
        channel: channel as any,
        to,
        template_id: 'otp',
        params: { code },
        correlationId
      });
    } catch (e: any) {
      logger.error(`Failed to send OTP via messaging: ${e?.message}`);
    }
  }
}

export async function verifyOtpController(req: Request, res: Response): Promise<void> {
  const { otp_id, code } = req.body || {};
  if (!otp_id || !code) {
    res.status(400).json({ error: { message: 'otp_id and code are required' } });
    return;
  }
  const result = await verifyOtpService({ otp_id, code });
  res.json(result);
}


