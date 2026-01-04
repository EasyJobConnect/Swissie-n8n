import { Request, Response, NextFunction } from 'express';
import { hmacSha256Hex, timingSafeEqualHex } from '../lib/hmac';
import { env } from '../config/env';
import { getDb } from '../db/mongo';
import crypto from 'crypto';
import { auditLog } from '../services/audit';
import { logger } from '../lib/logger';

function sha256Hex(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

/**
 * Normalize IPv6-mapped IPv4 addresses to plain IPv4
 */
function normalizeIp(ip: string | undefined): string {
  if (!ip) return '';
  return ip.replace(/^::ffff:/, '');
}

export function verifyHmacSignature() {
  const secret = env.HMAC_SECRET;
  if (!secret) {
    throw new Error('HMAC_SECRET is not configured (via src/config/env.ts)');
  }
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const signatureHeader = (req.header('X-Signature') || '').trim();
    const timestampHeader = (req.header('X-Timestamp') || '').trim();
    // Normalize IP for consistent logging
    const clientIp = normalizeIp(req.ip);
    
    if (!signatureHeader) {
      logger.warn('signature_failure: missing_signature');
      void auditLog({
        action: 'signature_failure',
        path: req.path,
        correlationId: (req as any).correlationId,
        ip: clientIp,
        details: { reason: 'missing_signature' }
      });
      res.status(401).json({ error: { message: 'Missing signature' } });
      return;
    }
    // Accept formats: "sha256=<hex>" or "<hex>"
    const parts = signatureHeader.split('=');
    const sigHex = parts.length === 2 ? parts[1] : parts[0];
    const raw = (req as any).rawBody as Buffer | undefined;
    if (!raw) {
      logger.warn('signature_failure: missing_raw_body');
      void auditLog({
        action: 'signature_failure',
        path: req.path,
        correlationId: (req as any).correlationId,
        ip: clientIp,
        details: { reason: 'missing_raw_body' }
      });
      res.status(400).json({ error: { message: 'Missing raw body for signature verification' } });
      return;
    }
    // Require timestamp and enforce drift window
    const now = Math.floor(Date.now() / 1000);
    const ts = Number(timestampHeader);
    if (!timestampHeader || !Number.isFinite(ts)) {
      logger.warn('signature_failure: missing_or_invalid_timestamp');
      void auditLog({
        action: 'signature_failure',
        path: req.path,
        correlationId: (req as any).correlationId,
        ip: clientIp,
        details: { reason: 'missing_or_invalid_timestamp' }
      });
      res.status(401).json({ error: { message: 'Missing or invalid timestamp' } });
      return;
    }
    const tolerance = env.SIGNATURE_TOLERANCE_SEC;
    
    // Reject timestamps more than 5 seconds in the future (clock skew protection)
    if (ts > now + 5) {
      logger.warn('signature_failure: timestamp_in_future');
      void auditLog({
        action: 'signature_failure',
        path: req.path,
        correlationId: (req as any).correlationId,
        ip: clientIp,
        details: { reason: 'timestamp_in_future', ts, now }
      });
      res.status(401).json({ error: { message: 'Timestamp too far in the future' } });
      return;
    }
    
    if (Math.abs(now - ts) > tolerance) {
      logger.warn('signature_failure: timestamp_out_of_window');
      void auditLog({
        action: 'signature_failure',
        path: req.path,
        correlationId: (req as any).correlationId,
        ip: clientIp,
        details: { reason: 'timestamp_out_of_window', ts, now, tolerance }
      });
      res.status(401).json({ error: { message: 'Signature timestamp out of allowed window' } });
      return;
    }
    // Bind signature to endpoint path for additional security
    const pathAndBody = Buffer.concat([Buffer.from(req.path + '\n'), raw]);
    const computed = hmacSha256Hex(secret, pathAndBody);
    if (!timingSafeEqualHex(sigHex, computed)) {
      logger.warn('signature_failure: invalid_signature');
      void auditLog({
        action: 'signature_failure',
        path: req.path,
        correlationId: (req as any).correlationId,
        ip: clientIp,
        details: { reason: 'invalid_signature' }
      });
      res.status(401).json({ error: { message: 'Invalid signature' } });
      return;
    }
    // Replay guard within tolerance window - include raw body hash for uniqueness
    try {
      const db = await getDb();
      const rawHash = crypto.createHash('sha256').update(raw).digest('hex');
      const key = sha256Hex(`${ts}:${sigHex}:${rawHash}`);
      const nowDate = new Date();
      const expiresAt = new Date(nowDate.getTime() + (env.SIGNATURE_TOLERANCE_SEC * 1000));
      await db.collection('signature_replays').insertOne({
        key,
        created_at: nowDate,
        expires_at: expiresAt
      });
    } catch (e: any) {
      if (e?.code === 11000) {
        logger.warn('signature_failure: replay_detected');
        void auditLog({
          action: 'signature_failure',
          path: req.path,
          correlationId: (req as any).correlationId,
          ip: clientIp,
          details: { reason: 'replay_detected' }
        });
        res.status(401).json({ error: { message: 'Replay detected' } });
        return;
      }
      throw e;
    }
    next();
  };
}


