import { Request, Response } from 'express';
import { sendAdminAlert } from '../services/alerts';

export async function sendAlertController(req: Request, res: Response): Promise<void> {
  const { severity, message, context } = req.body || {};
  
  if (!severity || !message) {
    res.status(400).json({ error: { message: 'severity and message are required' } });
    return;
  }
  
  await sendAdminAlert({ severity, message, context });
  res.status(204).send();
}

