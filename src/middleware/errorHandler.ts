import { Request, Response, NextFunction } from 'express';
import { logger } from '../lib/logger';

export function errorHandler(err: any, req: Request, res: Response, _next: NextFunction): void {
  const status = err.status || err.statusCode || 500;
  const correlationId = (req as any).correlationId;
  logger.error(
    JSON.stringify({
      message: err.message || 'Unhandled error',
      stack: process.env.NODE_ENV === 'production' ? undefined : err.stack,
      status,
      correlationId
    })
  );
  res.status(status).json({
    error: {
      message: err.message || 'Internal Server Error',
      correlationId
    }
  });
}


