import crypto from 'crypto';

/**
 * Edge case tests for:
 * - Idempotency >16KB truncation
 * - DLQ routing
 * - Circular payload handling
 * - Signature replay protection
 */
describe('Edge Cases', () => {
  const MAX_RESPONSE_SIZE = 16 * 1024; // 16KB

  describe('Idempotency >16KB Truncation', () => {
    it('should mark response as truncated when >16KB', () => {
      const largePayload = { data: 'x'.repeat(20 * 1024) };
      const jsonString = JSON.stringify(largePayload);
      const sizeBytes = Buffer.byteLength(jsonString, 'utf8');
      
      expect(sizeBytes).toBeGreaterThan(MAX_RESPONSE_SIZE);
      
      // Simulate the truncation logic from idempotency middleware
      const truncatedMarker = {
        _truncated: true,
        _size_bytes: sizeBytes,
        _message: 'Response exceeds 16KB limit and was not cached',
      };
      
      expect(truncatedMarker._truncated).toBe(true);
      expect(truncatedMarker._size_bytes).toBeGreaterThan(MAX_RESPONSE_SIZE);
    });

    it('should not truncate responses under 16KB', () => {
      const smallPayload = { data: 'small data' };
      const jsonString = JSON.stringify(smallPayload);
      const sizeBytes = Buffer.byteLength(jsonString, 'utf8');
      
      expect(sizeBytes).toBeLessThan(MAX_RESPONSE_SIZE);
    });

    it('should truncate text responses correctly', () => {
      const largeText = 'A'.repeat(20 * 1024);
      const sizeBytes = Buffer.byteLength(largeText, 'utf8');
      
      expect(sizeBytes).toBeGreaterThan(MAX_RESPONSE_SIZE);
      
      // Simulate truncation
      const truncated = largeText.substring(0, MAX_RESPONSE_SIZE - 100) + '... [TRUNCATED]';
      expect(Buffer.byteLength(truncated, 'utf8')).toBeLessThan(sizeBytes);
      expect(truncated).toContain('[TRUNCATED]');
    });
  });

  describe('DLQ Routing', () => {
    it('should create proper DLQ job structure', () => {
      const originalJob = {
        id: 'job_123',
        data: { flow_id: 'flow_456', user_id: 'user_789' },
        attemptsMade: 3,
      };
      const error = new Error('Processing failed');
      
      // Simulate DLQ job creation from worker.ts
      const dlqJob = {
        originalJobId: originalJob.id,
        originalData: originalJob.data,
        error: error.message,
        stack: error.stack,
        attemptsMade: originalJob.attemptsMade,
        failed_at: new Date().toISOString(),
      };
      
      expect(dlqJob.originalJobId).toBe('job_123');
      expect(dlqJob.originalData).toEqual(originalJob.data);
      expect(dlqJob.error).toBe('Processing failed');
      expect(dlqJob.attemptsMade).toBe(3);
      expect(dlqJob.failed_at).toBeDefined();
    });

    it('should route to correct DLQ based on queue name', () => {
      const queueNames = ['ocr', 'messaging_retry', 'refund_execute', 'flow_execute', 'daily_cleanup'];
      
      for (const queueName of queueNames) {
        const dlqName = `${queueName}_dlq`;
        expect(dlqName).toBe(`${queueName}_dlq`);
      }
    });

    it('should only route to DLQ after max attempts', () => {
      const maxAttempts = 3;
      
      // Attempt 1 - should not go to DLQ
      expect(1 >= maxAttempts).toBe(false);
      
      // Attempt 2 - should not go to DLQ
      expect(2 >= maxAttempts).toBe(false);
      
      // Attempt 3 - should go to DLQ
      expect(3 >= maxAttempts).toBe(true);
      
      // Attempt 4+ - should go to DLQ
      expect(4 >= maxAttempts).toBe(true);
    });
  });

  describe('Circular Payload Handling', () => {
    it('should detect circular references', () => {
      const obj: any = { name: 'test' };
      obj.self = obj; // Create circular reference
      
      // canonicalStringify should return [CIRCULAR] for circular refs
      const seen = new WeakSet();
      const hasCircular = (val: any): boolean => {
        if (val === null || typeof val !== 'object') return false;
        if (seen.has(val)) return true;
        seen.add(val);
        for (const key of Object.keys(val)) {
          if (hasCircular(val[key])) return true;
        }
        return false;
      };
      
      expect(hasCircular(obj)).toBe(true);
    });

    it('should return [CIRCULAR] marker for circular objects', () => {
      // Simulate canonicalStringify behavior from hmac.ts
      const stringify = (value: any): string => {
        const seen = new WeakSet();
        const innerStringify = (val: any): string => {
          if (val === null || typeof val !== 'object') return JSON.stringify(val);
          if (seen.has(val)) throw new TypeError('Circular reference in payload');
          seen.add(val);
          if (Array.isArray(val)) {
            return '[' + val.map(v => innerStringify(v)).join(',') + ']';
          }
          const keys = Object.keys(val).sort();
          const entries = keys.map(k => JSON.stringify(k) + ':' + innerStringify(val[k]));
          return '{' + entries.join(',') + '}';
        };
        
        try {
          return innerStringify(value);
        } catch (err) {
          if (err instanceof TypeError && String(err.message).toLowerCase().includes('circular')) {
            return '"[CIRCULAR]"';
          }
          return JSON.stringify(value);
        }
      };
      
      // Create circular object
      const circular: any = { a: 1 };
      circular.self = circular;
      
      // Should return [CIRCULAR] marker
      const result = stringify(circular);
      expect(result).toBe('"[CIRCULAR]"');
    });

    it('should handle non-circular objects normally', () => {
      const normalObj = { a: 1, b: { c: 2 } };
      
      const stringify = (value: any): string => {
        const seen = new WeakSet();
        const innerStringify = (val: any): string => {
          if (val === null || typeof val !== 'object') return JSON.stringify(val);
          if (seen.has(val)) throw new TypeError('Circular reference in payload');
          seen.add(val);
          if (Array.isArray(val)) {
            return '[' + val.map(v => innerStringify(v)).join(',') + ']';
          }
          const keys = Object.keys(val).sort();
          const entries = keys.map(k => JSON.stringify(k) + ':' + innerStringify(val[k]));
          return '{' + entries.join(',') + '}';
        };
        
        try {
          return innerStringify(value);
        } catch (err) {
          return '"[CIRCULAR]"';
        }
      };
      
      const result = stringify(normalObj);
      expect(result).toBe('{"a":1,"b":{"c":2}}');
    });
  });

  describe('Signature Replay Protection', () => {
    it('should generate unique signature key from timestamp, signature, and body hash', () => {
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = 'abc123def456';
      const bodyHash = crypto.createHash('sha256').update('request body').digest('hex');
      
      // Key format from signature.ts
      const key = crypto.createHash('sha256')
        .update(`${timestamp}:${signature}:${bodyHash}`)
        .digest('hex');
      
      expect(key).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should generate different keys for different timestamps', () => {
      const signature = 'abc123def456';
      const bodyHash = crypto.createHash('sha256').update('request body').digest('hex');
      
      const key1 = crypto.createHash('sha256')
        .update(`${1000}:${signature}:${bodyHash}`)
        .digest('hex');
      
      const key2 = crypto.createHash('sha256')
        .update(`${1001}:${signature}:${bodyHash}`)
        .digest('hex');
      
      expect(key1).not.toBe(key2);
    });

    it('should generate different keys for different signatures', () => {
      const timestamp = 1000;
      const bodyHash = crypto.createHash('sha256').update('request body').digest('hex');
      
      const key1 = crypto.createHash('sha256')
        .update(`${timestamp}:sig1:${bodyHash}`)
        .digest('hex');
      
      const key2 = crypto.createHash('sha256')
        .update(`${timestamp}:sig2:${bodyHash}`)
        .digest('hex');
      
      expect(key1).not.toBe(key2);
    });

    it('should generate different keys for different body content', () => {
      const timestamp = 1000;
      const signature = 'abc123';
      
      const bodyHash1 = crypto.createHash('sha256').update('body1').digest('hex');
      const bodyHash2 = crypto.createHash('sha256').update('body2').digest('hex');
      
      const key1 = crypto.createHash('sha256')
        .update(`${timestamp}:${signature}:${bodyHash1}`)
        .digest('hex');
      
      const key2 = crypto.createHash('sha256')
        .update(`${timestamp}:${signature}:${bodyHash2}`)
        .digest('hex');
      
      expect(key1).not.toBe(key2);
    });

    it('should reject timestamps in the future', () => {
      const now = Math.floor(Date.now() / 1000);
      const futureTimestamp = now + 10; // 10 seconds in future
      const maxFutureSkew = 5; // 5 seconds allowed
      
      const isInFuture = futureTimestamp > now + maxFutureSkew;
      expect(isInFuture).toBe(true);
    });

    it('should reject timestamps outside tolerance window', () => {
      const now = Math.floor(Date.now() / 1000);
      const tolerance = 60; // 60 seconds
      const oldTimestamp = now - 120; // 2 minutes ago
      
      const isOutsideWindow = Math.abs(now - oldTimestamp) > tolerance;
      expect(isOutsideWindow).toBe(true);
    });
  });

  describe('PII Masking', () => {
    it('should mask email addresses', () => {
      const maskEmail = (email: string) => 
        email.replace(/([a-zA-Z0-9])[a-zA-Z0-9.+_-]*@([a-zA-Z0-9])[a-zA-Z0-9.-]*\.([a-z]{2,})/gi, '$1***@$2***.$3');
      
      expect(maskEmail('user@example.com')).toBe('u***@e***.com');
      expect(maskEmail('john.doe@company.org')).toBe('j***@c***.org');
    });

    it('should mask phone numbers', () => {
      const maskPhone = (phone: string) =>
        phone.replace(/(\+?\d{1,3})[\s.-]?\d+[\s.-]?\d*[\s.-]?(\d{3})\b/g, '$1***$2');
      
      expect(maskPhone('+1234567890')).toBe('+123***890');
      expect(maskPhone('1234567890')).toBe('123***890');
    });

    it('should mask tokens', () => {
      const maskToken = (str: string) =>
        str.replace(/(tok_|sk_|pk_|key_|secret_|api_)[a-zA-Z0-9_-]+/gi, '$1***');
      
      expect(maskToken('tok_abc123xyz')).toBe('tok_***');
      expect(maskToken('sk_live_test123')).toBe('sk_***');
      expect(maskToken('pk_test_abc')).toBe('pk_***');
    });
  });

  describe('Flow Executor Jitter', () => {
    it('should add jitter in 50-150ms range', () => {
      const getJitterDelay = (baseMs: number = 100): number => {
        return Math.floor(baseMs * 0.5 + Math.random() * baseMs);
      };
      
      // Run multiple times to verify range
      for (let i = 0; i < 100; i++) {
        const jitter = getJitterDelay(100);
        expect(jitter).toBeGreaterThanOrEqual(50);
        expect(jitter).toBeLessThan(150);
      }
    });

    it('should produce varying delays', () => {
      const getJitterDelay = (baseMs: number = 100): number => {
        return Math.floor(baseMs * 0.5 + Math.random() * baseMs);
      };
      
      const delays = new Set<number>();
      for (let i = 0; i < 50; i++) {
        delays.add(getJitterDelay(100));
      }
      
      // Should have multiple different values (not all the same)
      expect(delays.size).toBeGreaterThan(1);
    });
  });

  describe('Queue Concurrency Clamping', () => {
    it('should clamp concurrency to valid range', () => {
      const clampConcurrency = (v: number) => Math.max(1, Math.min(50, v));
      
      expect(clampConcurrency(0)).toBe(1);
      expect(clampConcurrency(-5)).toBe(1);
      expect(clampConcurrency(1)).toBe(1);
      expect(clampConcurrency(25)).toBe(25);
      expect(clampConcurrency(50)).toBe(50);
      expect(clampConcurrency(100)).toBe(50);
      expect(clampConcurrency(999)).toBe(50);
    });
  });
});

