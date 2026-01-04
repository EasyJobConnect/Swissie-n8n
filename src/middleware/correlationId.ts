import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { correlationStorage } from '../lib/http';

export function correlationId(req: Request, res: Response, next: NextFunction): void {
  const headerName = 'x-correlation-id';
  const incoming = req.header(headerName) || req.header('X-Correlation-Id');
  const id = incoming && String(incoming).trim().length > 0 ? String(incoming) : uuidv4();
  (req as any).correlationId = id;
  res.setHeader('X-Correlation-Id', id);
  
  // Store correlation ID in async local storage for propagation to outbound requests
  correlationStorage.run({ correlationId: id }, () => {
    next();
  });
}


