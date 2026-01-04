import { Request, Response, NextFunction } from 'express';
import { getDb } from '../db/mongo';
import { logger } from '../lib/logger';

interface AuditRateLimitRecord {
  ip: string;
  event_type: string;
  count: number;
  window_start: Date;
  expires_at: Date;
}

const AUDIT_RATE_LIMIT = 5; // events per minute per IP
const WINDOW_MS = 60 * 1000; // 1 minute

/**
 * Rate limits audit events (signature failures, blocked IPs) to prevent flooding
 * Limits to 5 events per minute per IP
 */
export async function checkAuditRateLimit(
  ip: string,
  eventType: string
): Promise<{ allowed: boolean; remaining: number }> {
  try {
    const db = await getDb();
    const now = new Date();
    const windowStart = new Date(now.getTime() - WINDOW_MS);
    const expires_at = new Date(now.getTime() + WINDOW_MS);
    
    const key = `${ip}:${eventType}`;
    
    // Find or create rate limit record
    const existing = await db.collection<AuditRateLimitRecord>('audit_rate_limits').findOne({
      ip,
      event_type: eventType,
      window_start: { $gte: windowStart },
    });
    
    if (existing) {
      const count = existing.count;
      
      if (count >= AUDIT_RATE_LIMIT) {
        // Rate limit exceeded
        logger.warn(`Audit rate limit exceeded: ip=${ip} event=${eventType} count=${count}`);
        return { allowed: false, remaining: 0 };
      }
      
      // Increment count
      await db.collection<AuditRateLimitRecord>('audit_rate_limits').updateOne(
        { ip, event_type: eventType, window_start: existing.window_start },
        {
          $inc: { count: 1 },
          $set: { expires_at },
        }
      );
      
      return { allowed: true, remaining: AUDIT_RATE_LIMIT - count - 1 };
    } else {
      // Create new rate limit window
      await db.collection<AuditRateLimitRecord>('audit_rate_limits').insertOne({
        ip,
        event_type: eventType,
        count: 1,
        window_start: now,
        expires_at,
      });
      
      return { allowed: true, remaining: AUDIT_RATE_LIMIT - 1 };
    }
  } catch (err: any) {
    // If rate limiting fails, allow the event (fail open)
    logger.error(`Audit rate limit check failed: ${err?.message}`);
    return { allowed: true, remaining: AUDIT_RATE_LIMIT };
  }
}

/**
 * Middleware to rate limit audit log creation for specific event types
 * Apply this before creating audit logs for potentially spammy events
 */
export function auditRateLimitMiddleware(eventType: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    
    const { allowed, remaining } = await checkAuditRateLimit(ip, eventType);
    
    if (!allowed) {
      logger.warn(`Audit rate limit blocked: ip=${ip} event=${eventType}`);
      res.status(429).json({
        error: {
          message: 'Too many audit events',
          code: 'AUDIT_RATE_LIMIT_EXCEEDED',
        },
      });
      return;
    }
    
    // Add rate limit info to request
    (req as any).auditRateLimit = { remaining };
    
    next();
  };
}

/**
 * Helper to check if audit event should be logged (without middleware)
 * Use this in services where you want to silently skip audit logs when rate limited
 */
export async function shouldLogAuditEvent(ip: string, eventType: string): Promise<boolean> {
  const { allowed } = await checkAuditRateLimit(ip, eventType);
  return allowed;
}

