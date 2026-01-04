import { Express } from 'express';
import client from 'prom-client';
import { getMetricsController } from '../controllers/metricsController';

const register = new client.Registry();
client.collectDefaultMetrics({ register });

export const httpRequestCounter = new client.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status']
});
register.registerMetric(httpRequestCounter);

export function registerMetricsRoutes(app: Express): void {
  app.get('/metrics', getMetricsController);
}


