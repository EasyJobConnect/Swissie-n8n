import { Request, Response, NextFunction } from 'express';
import { basicPayloadSchema, normalizeBasicPayload } from '../schemas/payloads/basic';

export function validateAndNormalizePayload(req: Request, res: Response, next: NextFunction): void {
  try {
    const parsed = JSON.parse((req as any).rawBody?.toString('utf8') || JSON.stringify(req.body || {}));
    const result = basicPayloadSchema.safeParse(parsed);
    if (!result.success) {
      res.status(400).json({ error: { message: 'Invalid payload', details: result.error.issues } });
      return;
    }
    const normalized = normalizeBasicPayload(result.data);
    (req as any).normalizedPayload = normalized;
    next();
  } catch (e: any) {
    res.status(400).json({ error: { message: 'Invalid JSON body' } });
  }
}


