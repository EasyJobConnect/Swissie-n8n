import { Request, Response, NextFunction } from 'express';
import { env } from '../config/env';
import { logger } from '../lib/logger';

/**
 * Service role-based access guard
 * Prevents webhook-edge services from accessing protected resources:
 * - Database writes (beyond idempotency/logging)
 * - Redis operations
 * - Worker/queue operations
 */

export class AccessGuardError extends Error {
  constructor(message: string, public readonly serviceRole: string) {
    super(message);
    this.name = 'AccessGuardError';
  }
}

/**
 * Check if current service is allowed to access a resource
 */
export function requireRole(...allowedRoles: string[]): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!allowedRoles.includes(env.SERVICE_ROLE)) {
      const msg = `Access denied: SERVICE_ROLE=${env.SERVICE_ROLE} is not in allowed roles [${allowedRoles.join(', ')}]`;
      logger.warn(msg);
      res.status(403).json({ error: { message: 'Forbidden' } });
      return;
    }
    next();
  };
}

/**
 * Guard against webhook-edge accessing restricted operations
 * Throws immediately on misconfiguration
 */
export function guardPublicEdgeAccess(operationName: string): void {
  if (env.SERVICE_ROLE === 'webhook-edge') {
    const msg = `FATAL: webhook-edge service attempted to access restricted operation: ${operationName}`;
    logger.error(msg);
    throw new AccessGuardError(msg, env.SERVICE_ROLE);
  }
}

/**
 * Guard database access for public edge services
 */
export function guardDatabaseAccess(operationName: string): void {
  if (env.SERVICE_ROLE === 'webhook-edge') {
    const msg = `FATAL: webhook-edge service attempted direct database operation: ${operationName}. Use only for idempotency/audit logging.`;
    logger.error(msg);
    throw new AccessGuardError(msg, env.SERVICE_ROLE);
  }
}

/**
 * Guard Redis/queue access for public edge services
 */
export function guardRedisAccess(operationName: string): void {
  if (env.SERVICE_ROLE === 'webhook-edge') {
    const msg = `FATAL: webhook-edge service attempted Redis operation: ${operationName}. Queue jobs only in worker role.`;
    logger.error(msg);
    throw new AccessGuardError(msg, env.SERVICE_ROLE);
  }
}

/**
 * Guard worker initialization for non-worker services
 */
export function guardWorkerInitialization(): void {
  if (env.SERVICE_ROLE !== 'worker' && env.ENABLE_WORKERS) {
    logger.warn(
      `WARN: ENABLE_WORKERS=true on SERVICE_ROLE=${env.SERVICE_ROLE}. ` +
      `Workers should only run on SERVICE_ROLE=worker. This is likely a configuration error.`
    );
  }
}
