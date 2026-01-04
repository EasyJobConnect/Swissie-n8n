import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { canonicalStringify } from '../lib/hmac';
import { getDb } from '../db/mongo';

function sha256Hex(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

export async function deduplicate(req: Request, res: Response, next: NextFunction): Promise<void> {
  const db = await getDb();
  const idempotencyKey = req.header('X-Idempotency-Key') || '';
  const payload = (req as any).normalizedPayload || req.body || {};
  const source = (payload && payload.source) || 'unknown';
  const dayBucket = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const canonical = canonicalStringify(payload);
  const internalEventId = idempotencyKey
    ? String(idempotencyKey)
    : sha256Hex(`${canonical}|${source}|${dayBucket}`);

  (req as any).internal_event_id = internalEventId;

  try {
    const now = new Date();
    // TTL: 72 hours for dedup records
    const expiresAt = new Date(now.getTime() + 72 * 60 * 60 * 1000);
    await db.collection('processed_events').insertOne({
      internal_event_id: internalEventId,
      created_at: now,
      expires_at: expiresAt
    });
    next();
  } catch (e: any) {
    // Duplicate key => already processed
    if (e?.code === 11000) {
      res.status(200).json({ status: 'accepted', internal_event_id: internalEventId, duplicate: true });
      return;
    }
    throw e;
  }
}


