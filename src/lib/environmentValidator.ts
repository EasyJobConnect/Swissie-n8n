import { env } from '../config/env';
import { logger } from './logger';

/**
 * Validate environment isolation constraints at startup.
 * Ensures staging/prod cannot cross-access resources and fail-fast on misconfiguration.
 */
export function validateEnvironmentIsolation(): void {
  const errors: string[] = [];

  // 1. Enforce NODE_ENV=production when APP_ENV=production
  if (env.APP_ENV === 'production' && env.NODE_ENV !== 'production') {
    errors.push(
      `Production APP_ENV requires NODE_ENV=production (got NODE_ENV=${env.NODE_ENV})`
    );
  }

  // 2. Ensure MONGO_URI includes environment identifier
  const dbName = env.MONGO_URI.split('/').pop();
  if (dbName && !dbName.includes(env.APP_ENV)) {
    logger.warn(
      `⚠️  MONGO_URI database name should include APP_ENV (${env.APP_ENV}), but got: ${dbName}. ` +
      `For isolation, use: mongodb://.../${dbName}_${env.APP_ENV} or similar`
    );
  }

  // 3. Redis URL should have environment-specific DB index or namespace
  if (env.REDIS_URL && env.APP_ENV === 'production') {
    if (!env.REDIS_URL.includes('db=') && !env.REDIS_URL.includes('prod')) {
      logger.warn(
        `⚠️  REDIS_URL should specify environment-specific db index or namespace for production. ` +
        `Consider appending ?db=1 for staging, ?db=2 for production, or use separate Redis instances`
      );
    }
  }

  // 4. Webhook-edge service must NOT have direct access to workers or high-privilege operations
  if (env.SERVICE_ROLE === 'webhook-edge') {
    // Warn if workers are enabled in webhook-edge role (they should only run in worker role)
    if (env.ENABLE_WORKERS) {
      logger.warn(
        `⚠️  ENABLE_WORKERS=true on SERVICE_ROLE=webhook-edge. Workers should only run on SERVICE_ROLE=worker. ` +
        `Webhook-edge is a public edge service and must NOT process jobs directly.`
      );
    }
  }

  // 5. Ensure n8n or micro-backend URLs are configured correctly per environment
  if (env.APP_ENV === 'production') {
    if (!env.N8N_INGEST_URL && !env.MICRO_BACKEND_URL) {
      errors.push(
        `Production requires at least N8N_INGEST_URL or MICRO_BACKEND_URL to be configured`
      );
    }
  }

  // Report all validation errors (fail fast)
  if (errors.length > 0) {
    const message = errors.join('\n  ');
    logger.error(`Environment validation failed:\n  ${message}`);
    process.exit(1);
  }

  logger.info(
    `✓ Environment isolation validated: APP_ENV=${env.APP_ENV}, SERVICE_ROLE=${env.SERVICE_ROLE}, NODE_ENV=${env.NODE_ENV}`
  );
}
