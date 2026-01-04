import axios, { InternalAxiosRequestConfig } from 'axios';
import { AsyncLocalStorage } from 'async_hooks';

// AsyncLocalStorage for correlation ID propagation
export const correlationStorage = new AsyncLocalStorage<{ correlationId?: string }>();

/**
 * Get random jitter delay (50-150ms) for retry operations
 */
export function getJitterDelay(baseMs: number = 100): number {
  return Math.floor(baseMs * 0.5 + Math.random() * baseMs);
}

export const http = axios.create({
  timeout: 10000,
  maxRedirects: 3,
  // Fix: Only accept 2xx as success (was incorrectly accepting 2xx-4xx)
  validateStatus: status => status >= 200 && status < 300
});

// Add correlation ID to all outbound requests
http.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const store = correlationStorage.getStore();
  if (store?.correlationId) {
    config.headers = config.headers || {};
    config.headers['X-Correlation-Id'] = store.correlationId;
  }
  return config;
});


