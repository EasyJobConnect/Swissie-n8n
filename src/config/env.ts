import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly']).default('info'),

  // Security: Enforce minimum secret lengths (32 chars minimum)
  HMAC_SECRET: z.string().min(32, 'HMAC_SECRET must be at least 32 characters'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters').optional(),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().optional(),
  INTERNAL_ALLOWLIST: z.string().optional(),
  BLOCKED_IPS_CSV: z.string().optional(),

  MONGO_URI: z.string().min(1, 'MONGO_URI is required'),

  N8N_INGEST_URL: z.string().url().optional(),
  N8N_TOKEN: z.string().min(32, 'N8N_TOKEN must be at least 32 characters').optional(),

  // Micro-backend (Swissie) forwarding
  MICRO_BACKEND_URL: z.string().url().optional(),
  MICRO_BACKEND_HMAC_SECRET: z.string().min(32, 'MICRO_BACKEND_HMAC_SECRET must be at least 32 characters').optional(),
  MICRO_BACKEND_JWT: z.string().min(32, 'MICRO_BACKEND_JWT must be at least 32 characters').optional(),
  MICRO_BACKEND_DEVICE_ID: z.string().default('webhook-gateway'),
  FORWARD_TO_MICRO_BACKEND_ONLY: z.enum(['true', 'false']).default('false').transform(v => v === 'true'),

  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_MESSAGING_SERVICE_SID: z.string().optional(),

  SENDGRID_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().email().optional(),
  ALERT_EMAIL_TO: z.string().email().optional(),

  SLACK_BOT_TOKEN: z.string().optional(),
  SLACK_ALERT_CHANNEL: z.string().optional(),

  OTP_SEND_ON_GENERATE: z.enum(['true', 'false']).default('false').transform(v => v === 'true'),
  REDIS_URL: z.string().optional(),
  ENABLE_WORKERS: z.enum(['true', 'false']).default('false').transform(v => v === 'true'),
  // Queue concurrency: clamp to 1-50 range
  QUEUE_CONCURRENCY: z.coerce.number().int().default(5).transform(v => {
    const clamped = Math.max(1, Math.min(50, v));
    if (clamped !== v) {
      console.log(`Effective concurrency: ${clamped} (requested: ${v}, min: 1, max: 50)`);
    }
    return clamped;
  }),
  TEMPLATE_DIR: z.string().default('templates'),

  // Idempotency (default 3600s = 1 hour as per requirements)
  IDEMPOTENCY_TTL_SEC: z.coerce.number().int().positive().default(3600),
  ENABLE_IDEMPOTENCY_MW: z.enum(['true', 'false']).default('false').transform(v => v === 'true'),

  // Signature verification (default 60s tolerance as per requirements)
  SIGNATURE_TOLERANCE_SEC: z.coerce.number().int().positive().default(60),

  // Refunds
  ENABLE_REFUNDS: z.enum(['true', 'false']).default('false').transform(v => v === 'true'),
  REFUND_LIMIT_CENTS: z.coerce.number().int().positive().default(5000),

  // PM2 configuration
  PM2_INSTANCES: z.coerce.number().int().positive().optional(),

  // CORS configuration
  CORS_ALLOWED_ORIGINS: z.string().optional()
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const message = parsed.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; ');
  throw new Error(`Invalid environment configuration: ${message}`);
}

export const env = parsed.data;


