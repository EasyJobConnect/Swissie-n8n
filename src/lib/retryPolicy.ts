/**
 * Webhook retry policy and execution
 * - Max 5 retries for transient failures (5xx, network timeouts, 429)
 * - Exponential backoff: 2^attempt * 1000ms + random jitter
 * - No retry for validation/auth/4xx errors
 */

export interface RetryPolicy {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export const WEBHOOK_RETRY_POLICY: RetryPolicy = {
  maxRetries: 5,
  baseDelayMs: 1000,
  maxDelayMs: 32000, // Max 32 seconds
};

/**
 * Determine if an error is retryable based on HTTP status
 */
export function isRetryableError(status?: number | null, error?: string): boolean {
  // No status = network error (retryable)
  if (status === null || status === undefined) {
    return true;
  }

  // 5xx server errors (retryable)
  if (status >= 500) {
    return true;
  }

  // 429 rate limit (retryable)
  if (status === 429) {
    return true;
  }

  // 408 request timeout (retryable)
  if (status === 408) {
    return true;
  }

  // Specific non-retryable 4xx client errors
  if (status >= 400 && status < 500) {
    return false;
  }

  // Success codes
  if (status >= 200 && status < 300) {
    return false;
  }

  return false;
}

/**
 * Calculate delay for retry with exponential backoff + jitter
 */
export function calculateRetryDelay(
  attempt: number,
  policy: RetryPolicy = WEBHOOK_RETRY_POLICY
): number {
  // Exponential backoff: 2^attempt * baseDelayMs
  const exponential = Math.pow(2, attempt) * policy.baseDelayMs;
  
  // Add jitter: ±25% random variance
  const jitter = exponential * (0.75 + Math.random() * 0.5);
  
  // Cap at max delay
  return Math.min(jitter, policy.maxDelayMs);
}

/**
 * Check if more retries are allowed
 */
export function canRetry(
  currentAttempt: number,
  policy: RetryPolicy = WEBHOOK_RETRY_POLICY
): boolean {
  return currentAttempt < policy.maxRetries;
}

/**
 * Format retry information for logging
 */
export function formatRetryInfo(
  attempt: number,
  nextDelayMs: number,
  reason: string
): string {
  return `retry_attempt=${attempt} next_delay_ms=${Math.round(nextDelayMs)} reason=${reason}`;
}
