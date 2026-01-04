import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import { correlationId } from './middleware/correlationId';
import { errorHandler } from './middleware/errorHandler';
import { registerWebhookRoutes } from './api/webhook';
import { registerWebhookInternalRoutes } from './api/webhookInternal';
import { registerVerifyRoutes } from './api/verify';
import { registerOtpRoutes } from './api/otp';
import { registerMessagingRoutes } from './api/messaging';
import { registerStorageRoutes } from './api/storage';
import { registerAlertRoutes } from './api/alert';
import { registerHealthRoutes } from './api/health';
import { registerMetricsRoutes, httpRequestCounter } from './api/metrics';
import { registerRefundRoutes } from './api/refunds';
import { logger } from './lib/logger';
import { getDb } from './db/mongo';
import { env } from './config/env';
import { registerAuthRoutes } from './api/auth';
import { registerUserRoutes } from './api/user';
import { registerFlowRoutes } from './api/flow';
import { validateEnvironmentIsolation } from './lib/environmentValidator';

const app = express();

// Validate environment isolation first (fail fast)
validateEnvironmentIsolation();

// Trust proxy for proper IP detection behind reverse proxy/load balancer
app.set('trust proxy', 1);

// Global middleware (ensure /webhook/entry runs BEFORE JSON parsing to preserve raw body)
// Helmet security headers (noSniff, frameguard, hidePoweredBy enabled by default)
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false, // Disable for API compatibility
  hsts: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true,
  },
}));

// CORS: Restrict to approved origins (never allow * or true in production)
const corsOrigins = env.CORS_ALLOWED_ORIGINS?.split(',').map(o => o.trim()).filter(Boolean);
const defaultOrigin = 'https://app.yourdomain.com';
app.use(cors({
  origin: corsOrigins && corsOrigins.length > 0 ? corsOrigins : defaultOrigin,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Signature',
    'X-Timestamp',
    'X-Idempotency-Key',
    'X-Correlation-Id',
    'X-Request-Id',
  ],
  exposedHeaders: ['X-Correlation-Id', 'Idempotency-Replayed'],
  credentials: true,
  maxAge: 86400, // 24 hours preflight cache
}));

app.use(compression());
app.use(correlationId);

// Request metrics
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  res.on('finish', () => {
    const route = req.route?.path || req.path;
    httpRequestCounter.inc({ method: req.method, route, status: String(res.statusCode) });
    const duration = Date.now() - start;
    logger.info(JSON.stringify({ msg: 'request_done', method: req.method, path: req.path, status: res.statusCode, durationMs: duration, correlationId: (req as any).correlationId }));
  });
  next();
});

// Register webhook route (uses raw body)
registerWebhookRoutes(app);

// Register internal webhook routes (replay, event listing)
registerWebhookInternalRoutes(app);

// JSON parsing for remaining routes
app.use(express.json({ limit: '2mb' }));

// Register remaining routes
registerVerifyRoutes(app);
registerOtpRoutes(app);
registerMessagingRoutes(app);
registerStorageRoutes(app);
registerAlertRoutes(app);
registerHealthRoutes(app);
registerMetricsRoutes(app);
registerRefundRoutes(app);
registerAuthRoutes(app);
registerUserRoutes(app);
registerFlowRoutes(app);

// 404 handler
app.use((_req, res) => res.status(404).json({ error: { message: 'Not Found' } }));

// Error handler
app.use(errorHandler);

const port = env.PORT;

async function start() {
  try {
    await getDb();
  } catch (e: any) {
    logger.error(`Database connection failed: ${e?.message}`);
    process.exit(1);
  }
  app.listen(port, () => {
    logger.info(`Server listening on port ${port}`);
    
    // Signal PM2 that the app is ready (for wait_ready: true)
    if (process.send) {
      process.send('ready');
    }
  });
}

// Graceful shutdown handler
async function shutdown(signal: string) {
  logger.info(`Received ${signal}, shutting down gracefully...`);
  
  // Give time for health checks to fail and load balancer to remove
  setTimeout(() => {
    process.exit(0);
  }, 10000);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

void start();


