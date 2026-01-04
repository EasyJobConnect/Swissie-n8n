import { http, getJitterDelay } from '../lib/http';
import { hmacSha256Hex } from '../lib/hmac';
import { logger } from '../lib/logger';

const MAX_N8N_RETRIES = 3;

/**
 * Forward event to n8n with retry policy (exponential backoff + jitter)
 */
async function forwardWithRetry(
  url: string,
  payload: any,
  headers: Record<string, string>,
  maxRetries: number = MAX_N8N_RETRIES
): Promise<{ ok: boolean; status: number; body?: any }> {
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await http.post(url, payload, { headers });
      return { ok: true, status: res.status, body: res.data };
    } catch (err: any) {
      lastError = err;
      const status = err?.response?.status;
      
      // Don't retry on 4xx client errors (except 429 rate limit)
      if (status && status >= 400 && status < 500 && status !== 429) {
        logger.error(`N8N forward failed (non-retryable): status=${status} attempt=${attempt}`);
        return { ok: false, status, body: err?.response?.data };
      }
      
      if (attempt < maxRetries) {
        // Exponential backoff with jitter: 2^attempt * 1000ms + random jitter
        const baseDelay = Math.pow(2, attempt) * 1000;
        const jitter = getJitterDelay(500); // 250-500ms jitter
        const delay = baseDelay + jitter;
        
        logger.warn(`N8N forward failed, retrying: attempt=${attempt}/${maxRetries} delay=${delay}ms error=${err?.message}`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  logger.error(`N8N forward failed after ${maxRetries} attempts: ${lastError?.message}`);
  return { ok: false, status: 0, body: { error: lastError?.message } };
}

export async function forwardToN8n(params: {
  ingestUrl?: string;
  token?: string;
  payload: any;
  internalEventId: string;
  correlationId?: string;
}): Promise<{ ok: boolean; status: number; body?: any }> {
  const url = params.ingestUrl || process.env.N8N_INGEST_URL;
  const token = params.token || process.env.N8N_TOKEN;
  const hmacSecret = process.env.HMAC_SECRET;
  
  if (!url) {
    logger.warn('N8N_INGEST_URL not configured; skipping forward');
    return { ok: true, status: 204 };
  }
  
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Internal-Event-Id': params.internalEventId
  };
  if (params.correlationId) headers['X-Correlation-Id'] = params.correlationId;
  if (token) headers['Authorization'] = `Bearer ${token}`;
  
  // Add outbound signature headers for n8n to verify
  if (hmacSecret) {
    const timestamp = Math.floor(Date.now() / 1000);
    const body = JSON.stringify(params.payload);
    const signature = hmacSha256Hex(hmacSecret, body);
    headers['X-Backend-Signature'] = `sha256=${signature}`;
    headers['X-Backend-Timestamp'] = String(timestamp);
  }

  // Use retry policy for n8n calls
  const result = await forwardWithRetry(url, params.payload, headers);
  
  if (!result.ok) {
    logger.error(`Failed to forward to n8n: ${result.status} ${JSON.stringify(result.body)}`);
  }
  
  return result;
}


