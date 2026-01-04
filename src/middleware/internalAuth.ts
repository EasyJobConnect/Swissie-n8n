import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import ipaddr from 'ipaddr.js';

function isIpAllowed(ip: string | undefined | null): boolean {
  const allowlistCsv = process.env.INTERNAL_ALLOWLIST || '';
  const cidrs = allowlistCsv
    .split(',')
    .map(x => x.trim())
    .filter(Boolean);
  if (cidrs.length === 0) return false;
  // Express may give values like '::ffff:127.0.0.1'
  const ipNormalized = (ip || '').replace('::ffff:', '');
  try {
    let addr = ipaddr.parse(ipNormalized);
    if (addr.kind() === 'ipv6' && (addr as any).isIPv4MappedAddress?.()) {
      addr = (addr as any).toIPv4Address();
    }
    for (const cidr of cidrs) {
      try {
        const range = ipaddr.parseCIDR(cidr);
        if (addr.match(range)) return true;
      } catch {
        // ignore invalid cidr entries
      }
    }
  } catch {
    return false;
  }
  return false;
}

interface JwtPayload {
  iss?: string;
  [key: string]: any;
}

function isTokenValid(authHeader: string | undefined | null): boolean {
  if (!authHeader) return false;
  const m = /^Bearer\s+(.+)$/.exec(authHeader);
  if (!m) return false;
  const token = m[1];
  const staticToken = process.env.N8N_TOKEN;
  if (staticToken && token === staticToken) return true;
  const secret = process.env.JWT_SECRET;
  if (!secret) return false;
  try {
    const decoded = jwt.verify(token, secret) as JwtPayload;
    // Verify JWT issuer claim
    if (decoded.iss !== 'internal-backend') return false;
    return true;
  } catch {
    return false;
  }
}

export function internalAuth(req: Request, res: Response, next: NextFunction): void {
  const allowedByIp = isIpAllowed(req.ip || (req.connection as any)?.remoteAddress);
  const allowedByToken = isTokenValid(req.headers.authorization);
  if (allowedByIp || allowedByToken) {
    next();
    return;
  }
  res.status(401).json({ error: { message: 'Unauthorized' } });
}


