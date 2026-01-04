import { Request, Response } from 'express';
import { register } from 'prom-client';

export async function getMetricsController(_req: Request, res: Response): Promise<void> {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
}

