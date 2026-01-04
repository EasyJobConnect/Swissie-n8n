import crypto from 'crypto';
import { http, getJitterDelay } from '../lib/http';
import { logger } from '../lib/logger';
import { env } from '../config/env';

const MAX_MICRO_BACKEND_RETRIES = 3;

/**
 * Generate HMAC signature for Swissie micro-backend
 * Format: HMAC_SHA256(secret, `${timestamp}.${JSON.stringify(payload)}`)
 * This matches the micro-backend's expected format from README
 */
function generateMicroBackendSignature(payload: any, secret: string): {
  signature: string;
  timestamp: string;
} {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const message = `${timestamp}.${JSON.stringify(payload)}`;

  const signature = crypto
    .createHmac('sha256', secret)
    .update(message)
    .digest('hex');

  return { signature, timestamp };
}

/**
 * Adapt webhook payload to micro-backend flow schema
 * Maps inbound webhook → flow creation format expected by micro-backend
 */
function adaptPayloadForMicroBackend(
  normalizedPayload: any,
  internalEventId: string,
  correlationId?: string
): any {
  return {
    source: 'webhook-gateway',
    event_type: normalizedPayload.type || 'webhook_received',
    external_id: normalizedPayload.id || internalEventId,
    payload: normalizedPayload,
    occurred_at: new Date().toISOString(),
    correlation_id: correlationId,
    internal_event_id: internalEventId,
  };
}

/**
 * Forward event to Swissie micro-backend with retry policy
 */
async function forwardWithRetry(
  url: string,
  payload: any,
  headers: Record<string, string>,
  maxRetries: number = MAX_MICRO_BACKEND_RETRIES
): Promise<{ ok: boolean; status: number; body?: any }> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await http.post(url, payload, { headers });
      logger.info(
        `Micro-backend forward successful: status=${res.status} attempt=${attempt}`
      );
      return { ok: true, status: res.status, body: res.data };
    } catch (err: any) {
      lastError = err;
      const status = err?.response?.status;

      // Don't retry on 4xx client errors (except 429 rate limit)
      if (status && status >= 400 && status < 500 && status !== 429) {
        logger.error(
          `Micro-backend forward failed (non-retryable): status=${status} attempt=${attempt} error=${err?.message}`
        );
        return { ok: false, status, body: err?.response?.data };
      }

      if (attempt < maxRetries) {
        // Exponential backoff with jitter: 2^attempt * 1000ms + random jitter
        const baseDelay = Math.pow(2, attempt) * 1000;
        const jitter = getJitterDelay(500); // 250-500ms jitter
        const delay = baseDelay + jitter;

        logger.warn(
          `Micro-backend forward failed, retrying: attempt=${attempt}/${maxRetries} delay=${delay}ms error=${err?.message}`
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  logger.error(
    `Micro-backend forward failed after ${maxRetries} attempts: ${lastError?.message}`
  );
  return {
    ok: false,
    status: 0,
    body: { error: lastError?.message },
  };
}

/**
 * Forward to Swissie micro-backend (main entry point)
 *
 * This handles the complete backend-to-backend handshake:
 * 1. Adapt payload to micro-backend schema
 * 2. Generate new HMAC signature (NOT forwarding inbound HMAC)
 * 3. Include JWT authentication
 * 4. Set device ID for audit trail
 * 5. Retry with exponential backoff
 *
 * @param params.payload - Normalized webhook payload
 * @param params.internalEventId - Unique event ID for tracking
 * @param params.correlationId - Optional correlation ID for logging
 * @returns Promise with success/failure result
 */
export async function forwardToMicroBackend(params: {
  payload: any;
  internalEventId: string;
  correlationId?: string;
}): Promise<{ ok: boolean; status: number; body?: any }> {
  const baseUrl = env.MICRO_BACKEND_URL;
  const hmacSecret = env.MICRO_BACKEND_HMAC_SECRET;
  const jwtToken = env.MICRO_BACKEND_JWT;
  const deviceId = env.MICRO_BACKEND_DEVICE_ID;

  // Validate configuration
  if (!baseUrl) {
    logger.warn(
      'MICRO_BACKEND_URL not configured; skipping micro-backend forward'
    );
    return { ok: true, status: 204 };
  }

  if (!hmacSecret) {
    logger.error('MICRO_BACKEND_HMAC_SECRET not configured');
    return {
      ok: false,
      status: 0,
      body: { error: 'MICRO_BACKEND_HMAC_SECRET not configured' },
    };
  }

  // Adapt payload to micro-backend schema
  const adaptedPayload = adaptPayloadForMicroBackend(
    params.payload,
    params.internalEventId,
    params.correlationId
  );

  // Generate new HMAC signature (NOT forwarding inbound signature)
  const { signature, timestamp } = generateMicroBackendSignature(
    adaptedPayload,
    hmacSecret
  );

  // Build headers per micro-backend README contract
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Signature': signature,
    'X-Timestamp': timestamp,
    'X-Device-ID': deviceId,
  };

  // Add optional JWT authentication
  if (jwtToken) {
    headers['Authorization'] = `Bearer ${jwtToken}`;
  }

  // Add correlation ID if present
  if (params.correlationId) {
    headers['X-Correlation-Id'] = params.correlationId;
  }

  // Target endpoint: micro-backend flow creation
  const endpoint = `${baseUrl}/api/v1/flow/create`;

  logger.info(
    `Forwarding to micro-backend: url=${endpoint} internalEventId=${params.internalEventId} correlationId=${params.correlationId}`
  );

  // Use retry policy for micro-backend calls
  const result = await forwardWithRetry(endpoint, adaptedPayload, headers);

  if (!result.ok) {
    logger.error(
      `Failed to forward to micro-backend: ${result.status} ${JSON.stringify(result.body)}`
    );
  }

  return result;
}

/**
 * Determine which forwarder to use based on configuration
 * Allows gradual migration or parallel forwarding
 */
export async function forwardToDestination(params: {
  payload: any;
  internalEventId: string;
  correlationId?: string;
}): Promise<{ ok: boolean; status: number; body?: any }> {
  // If FORWARD_TO_MICRO_BACKEND_ONLY is true, use ONLY micro-backend
  if (env.FORWARD_TO_MICRO_BACKEND_ONLY) {
    return forwardToMicroBackend(params);
  }

  // Otherwise, use N8N (legacy behavior)
  const { forwardToN8n } = await import('./eventRouter');
  return forwardToN8n({
    payload: params.payload,
    internalEventId: params.internalEventId,
    correlationId: params.correlationId,
  });
}
