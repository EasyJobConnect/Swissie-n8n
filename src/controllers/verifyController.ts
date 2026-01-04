import { Request, Response } from 'express';
import { verifyEntitlement } from '../services/verification';

export async function verifyEntitlementController(req: Request, res: Response): Promise<void> {
  const { internal_event_id, user_id, amount, action, context } = req.body || {};
  
  if (!internal_event_id || !action) {
    res.status(400).json({ error: { message: 'internal_event_id and action are required' } });
    return;
  }
  
  const result = await verifyEntitlement({ internal_event_id, user_id, amount, action, context });
  res.json(result);
}

