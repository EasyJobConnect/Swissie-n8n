import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { getDb } from '../db/mongo';
import { env } from '../config/env';
import { canonicalStringify } from '../lib/hmac';
import { logger } from '../lib/logger';

type IdempotencyStatus = 'in_progress' | 'succeeded' | 'failed';

interface IdempotencyRecord {
  key: string;
  requestHash: string;
  status: IdempotencyStatus;
  responseStatus?: number;
  responseBodyJson?: unknown;
  responseBodyText?: string;
  responseIsJson?: boolean;
  responseTruncated?: boolean;
  created_at: Date;
  updated_at: Date;
  expires_at: Date;
}

function sha256Hex(input: string | Buffer): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function computeRequestHash(req: Request): string {
  const method = req.method.toUpperCase();
  const path = req.originalUrl || req.url;
  // Prefer raw body if present (e.g., webhook), else canonical JSON, else empty
  const raw = (req as any).rawBody as Buffer | undefined;
  if (raw) {
    return sha256Hex(Buffer.concat([Buffer.from(method + ' ' + path + '\n'), raw]));
  }
  const body = (req as any).normalizedPayload || req.body || {};
  const canonical = canonicalStringify(body);
  return sha256Hex(`${method} ${path}\n${canonical}`);
}

/**
 * Idempotency middleware using MongoDB.
 *
 * - Requires header: X-Idempotency-Key
 * - First request inserts a record with status "in_progress"
 * - On response finish, the record is updated with outcome and cached payload
 * - Subsequent requests with the same key:
 *   - If a cached response exists => return the cached response
 *   - If still in progress => 409 Conflict
 */
export function idempotency(): (req: Request, res: Response, next: NextFunction) => Promise<void> {
  const ttlSec = env.IDEMPOTENCY_TTL_SEC;
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const key = (req.header('X-Idempotency-Key') || '').trim();
    if (!key) {
      next();
      return;
    }
    const db = await getDb();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlSec * 1000);
    const requestHash = computeRequestHash(req);

    try {
      // Try to create a new record (first writer wins)
      const initialRecord: IdempotencyRecord = {
        key,
        requestHash,
        status: 'in_progress',
        created_at: now,
        updated_at: now,
        expires_at: expiresAt
      };
      await db.collection<IdempotencyRecord>('idempotency_keys').insertOne(initialRecord);
    } catch (e: any) {
      // Duplicate key => either in progress or completed
      if (e?.code === 11000) {
        const existing = await db.collection<IdempotencyRecord>('idempotency_keys').findOne({ key });
        if (existing) {
          // Defensive: if request hash differs, it's a misuse of the same key
          if (existing.requestHash !== requestHash) {
            res.status(409).json({ error: { message: 'Idempotency key reuse with different request', code: 'IDEMPOTENCY_HASH_MISMATCH' } });
            return;
          }
          if (existing.status === 'succeeded' || existing.status === 'failed') {
            res.setHeader('Idempotency-Replayed', 'true');
            const statusCode = existing.responseStatus ?? 200;
            if (existing.responseIsJson && existing.responseBodyJson !== undefined) {
              // Add _idempotent flag to response
              const responseWithFlag = typeof existing.responseBodyJson === 'object' && existing.responseBodyJson !== null
                ? { ...existing.responseBodyJson, _idempotent: true }
                : existing.responseBodyJson;
              res.status(statusCode).json(responseWithFlag);
              return;
            }
            if (!existing.responseIsJson && typeof existing.responseBodyText === 'string') {
              res.status(statusCode).send(existing.responseBodyText);
              return;
            }
            // No stored body, return 200 minimal
            res.status(200).json({ status: 'accepted', _idempotent: true });
            return;
          }
          // Still in progress
          res.status(409).json({ error: { message: 'Request with this Idempotency-Key is in progress' } });
          return;
        }
        // Rare: unique error but not found; proceed to create again
      } else {
        throw e;
      }
    }

    // First execution path: wrap response to capture payload
    let capturedJson: any;
    let capturedText: string | undefined;
    let wasJson = false;

    const originalJson = res.json.bind(res);
    const originalSend = res.send.bind(res);

    (res as any).json = (body: any) => {
      wasJson = true;
      capturedJson = body;
      return originalJson(body);
    };
    (res as any).send = (body?: any) => {
      if (typeof body === 'string' || Buffer.isBuffer(body)) {
        capturedText = Buffer.isBuffer(body) ? body.toString('utf8') : body;
      } else if (body !== undefined) {
        // If a non-string is sent, treat as JSON-like
        wasJson = true;
        capturedJson = body;
      }
      return originalSend(body);
    };

    res.once('finish', async () => {
      try {
        const responseStatus = res.statusCode;
        const status: IdempotencyStatus = responseStatus >= 500 ? 'failed' : 'succeeded';
        const update: Partial<IdempotencyRecord> = {
          status,
          updated_at: new Date(),
          responseStatus,
          responseIsJson: wasJson
        };
        
        // Apply 16KB size cap on stored responses
        const MAX_RESPONSE_SIZE = 16 * 1024; // 16KB
        
        if (wasJson) {
          const jsonString = JSON.stringify(capturedJson);
          const sizeBytes = Buffer.byteLength(jsonString, 'utf8');
          
          if (sizeBytes <= MAX_RESPONSE_SIZE) {
            update.responseBodyJson = capturedJson;
          } else {
            // Response too large - store truncated marker instead
            update.responseBodyJson = {
              _truncated: true,
              _size_bytes: sizeBytes,
              _message: 'Response exceeds 16KB limit and was not cached',
            };
            logger.warn(`Idempotency response too large: key=${key} size=${sizeBytes} bytes`);
          }
        } else if (capturedText !== undefined) {
          const sizeBytes = Buffer.byteLength(capturedText, 'utf8');
          
          if (sizeBytes <= MAX_RESPONSE_SIZE) {
            update.responseBodyText = capturedText;
          } else {
            // Truncate text response
            const truncated = capturedText.substring(0, MAX_RESPONSE_SIZE - 100) + '... [TRUNCATED]';
            update.responseBodyText = truncated;
            update.responseTruncated = true;
            logger.warn(`Idempotency response truncated: key=${key} original_size=${sizeBytes} bytes`);
          }
        }
        
        await db.collection<IdempotencyRecord>('idempotency_keys').updateOne(
          { key },
          { $set: update }
        );
      } catch (err: any) {
        logger.warn(`Idempotency record update failed for key=${key}: ${err?.message || String(err)}`);
      }
    });

    next();
  };
}

export default idempotency;


