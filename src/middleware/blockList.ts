import { Request, Response, NextFunction } from 'express';
import { getDb } from '../db/mongo';
import { auditLog } from '../services/audit';

const envBlocked = new Set(
  (process.env.BLOCKED_IPS_CSV || '')
    .split(',')
    .map(x => x.trim())
    .filter(Boolean)
);

/**
 * Normalize IPv6-mapped IPv4 addresses to plain IPv4
 * Example: '::ffff:127.0.0.1' -> '127.0.0.1'
 */
function normalizeIp(ip: string): string {
  // Remove IPv6 prefix for IPv4-mapped addresses
  return ip.replace(/^::ffff:/, '');
}

export async function blockList(req: Request, res: Response, next: NextFunction): Promise<void> {
  const rawIp = req.ip || req.connection.remoteAddress || '';
  // Normalize IPv6 -> IPv4 for consistent matching
  const ip = normalizeIp(rawIp);
  
  if (envBlocked.has(ip)) {
    void auditLog({
      action: 'blocked_ip',
      ip,
      path: req.path,
      correlationId: (req as any).correlationId,
      details: { source: 'env' }
    });
    res.status(403).json({ error: { message: 'Forbidden' } });
    return;
  }
  try {
    const db = await getDb();
    const found = await db.collection('blocked_ips').findOne({ ip });
    if (found) {
      void auditLog({
        action: 'blocked_ip',
        ip,
        path: req.path,
        correlationId: (req as any).correlationId,
        details: { source: 'db' }
      });
      res.status(403).json({ error: { message: 'Forbidden' } });
      return;
    }
  } catch {
    // If DB not available, continue rather than blocking all
  }
  next();
}


