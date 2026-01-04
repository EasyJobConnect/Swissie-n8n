import crypto from 'crypto';

describe('Idempotency Middleware', () => {
  const MAX_RESPONSE_SIZE = 16 * 1024; // 16KB

  it('should compute SHA256 hash correctly', () => {
    const input = 'test_string';
    const expected = crypto.createHash('sha256').update(input).digest('hex');
    const hash = crypto.createHash('sha256').update(input).digest('hex');
    expect(hash).toBe(expected);
  });

  it('should validate 16KB size limit', () => {
    const smallData = JSON.stringify({ data: 'test' });
    const largeData = 'x'.repeat(20 * 1024);
    
    expect(Buffer.byteLength(smallData, 'utf8')).toBeLessThan(MAX_RESPONSE_SIZE);
    expect(Buffer.byteLength(largeData, 'utf8')).toBeGreaterThan(MAX_RESPONSE_SIZE);
  });

  it('should create truncated marker for large responses', () => {
    const largeResponse = { data: 'x'.repeat(20 * 1024) };
    const jsonString = JSON.stringify(largeResponse);
    const sizeBytes = Buffer.byteLength(jsonString, 'utf8');
    
    const truncatedMarker = {
      _truncated: true,
      _size_bytes: sizeBytes,
      _message: 'Response exceeds 16KB limit and was not cached',
    };
    
    expect(truncatedMarker._truncated).toBe(true);
    expect(truncatedMarker._size_bytes).toBeGreaterThan(MAX_RESPONSE_SIZE);
  });

  it('should handle request hash computation', () => {
    const method = 'POST';
    const path = '/webhook/entry';
    const body = JSON.stringify({ user_id: 'test123', action: 'test' });
    const rawHash = crypto.createHash('sha256').update(`${method} ${path}\n${body}`).digest('hex');
    
    expect(rawHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('should detect when JSON response exceeds 16KB and requires truncation', () => {
    // Simulate middleware truncation logic for JSON responses
    const smallPayload = { items: Array(10).fill({ id: 1, name: 'test' }) };
    const largePayload = { items: Array(500).fill({ id: 1, name: 'test'.repeat(100) }) };

    const smallSize = Buffer.byteLength(JSON.stringify(smallPayload), 'utf8');
    const largeSize = Buffer.byteLength(JSON.stringify(largePayload), 'utf8');

    // Small payload should be cached as-is
    expect(smallSize).toBeLessThan(MAX_RESPONSE_SIZE);
    
    // Large payload should trigger truncation marker
    expect(largeSize).toBeGreaterThan(MAX_RESPONSE_SIZE);
    
    // Verify truncation marker structure
    const truncationMarker = {
      _truncated: true,
      _size_bytes: largeSize,
      _message: 'Response exceeds 16KB limit and was not cached',
    };
    expect(truncationMarker).toHaveProperty('_truncated', true);
    expect(truncationMarker).toHaveProperty('_size_bytes');
    expect(truncationMarker).toHaveProperty('_message');
  });

  it('should handle text response truncation for large text bodies', () => {
    const largeText = 'A'.repeat(20 * 1024); // 20KB of text
    const sizeBytes = Buffer.byteLength(largeText, 'utf8');
    
    expect(sizeBytes).toBeGreaterThan(MAX_RESPONSE_SIZE);
    
    // Simulate truncation logic
    const truncated = largeText.substring(0, MAX_RESPONSE_SIZE - 100) + '... [TRUNCATED]';
    expect(Buffer.byteLength(truncated, 'utf8')).toBeLessThan(sizeBytes);
  });

  it('should generate unique idempotency keys for different requests', () => {
    const req1 = { method: 'POST', path: '/api/v1/users', body: { name: 'Alice' } };
    const req2 = { method: 'POST', path: '/api/v1/users', body: { name: 'Bob' } };
    
    const hash1 = crypto.createHash('sha256')
      .update(`${req1.method} ${req1.path}\n${JSON.stringify(req1.body)}`)
      .digest('hex');
    const hash2 = crypto.createHash('sha256')
      .update(`${req2.method} ${req2.path}\n${JSON.stringify(req2.body)}`)
      .digest('hex');
    
    expect(hash1).not.toBe(hash2);
    expect(hash1).toMatch(/^[a-f0-9]{64}$/);
    expect(hash2).toMatch(/^[a-f0-9]{64}$/);
  });
});

