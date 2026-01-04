import crypto from 'crypto';

const HMAC_SECRET = 'test_secret_key_123';

function computeSignature(body: string | Buffer, secret: string): string {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

function verifySignature(body: string | Buffer, signature: string, secret: string): boolean {
  const expected = computeSignature(body, secret);
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

function isValidTimestamp(timestamp: string, toleranceSec: number = 60): boolean {
  const requestTime = parseInt(timestamp, 10);
  if (!Number.isFinite(requestTime)) return false;
  
  const now = Math.floor(Date.now() / 1000);
  const diff = Math.abs(now - requestTime);
  return diff <= toleranceSec;
}

describe('Signature Verification', () => {
  it('should compute HMAC-SHA256 signature correctly', () => {
    const body = JSON.stringify({ user_id: 'test123', action: 'test' });
    const signature = computeSignature(body, HMAC_SECRET);
    expect(signature).toMatch(/^[a-f0-9]{64}$/);
  });

  it('should verify valid signature', () => {
    const body = JSON.stringify({ user_id: 'test123', action: 'test' });
    const signature = computeSignature(body, HMAC_SECRET);
    const isValid = verifySignature(body, signature, HMAC_SECRET);
    expect(isValid).toBe(true);
  });

  it('should reject invalid signature', () => {
    const body = JSON.stringify({ user_id: 'test123', action: 'test' });
    const fakeSignature = 'a'.repeat(64);
    const isValid = verifySignature(body, fakeSignature, HMAC_SECRET);
    expect(isValid).toBe(false);
  });

  it('should reject signature with wrong secret', () => {
    const body = JSON.stringify({ user_id: 'test123', action: 'test' });
    const signature = computeSignature(body, HMAC_SECRET);
    const isValid = verifySignature(body, signature, 'wrong_secret');
    expect(isValid).toBe(false);
  });

  it('should reject modified body with original signature', () => {
    const body1 = JSON.stringify({ user_id: 'test123', action: 'test' });
    const body2 = JSON.stringify({ user_id: 'test456', action: 'test' });
    const signature = computeSignature(body1, HMAC_SECRET);
    const isValid = verifySignature(body2, signature, HMAC_SECRET);
    expect(isValid).toBe(false);
  });

  it('should validate timestamp within tolerance', () => {
    const now = Math.floor(Date.now() / 1000);
    expect(isValidTimestamp(String(now), 60)).toBe(true);
    expect(isValidTimestamp(String(now - 30), 60)).toBe(true);
    expect(isValidTimestamp(String(now + 30), 60)).toBe(true);
  });

  it('should reject old timestamps', () => {
    const old = Math.floor(Date.now() / 1000) - 120; // 2 minutes ago
    expect(isValidTimestamp(String(old), 60)).toBe(false);
  });

  it('should reject future timestamps', () => {
    const future = Math.floor(Date.now() / 1000) + 120; // 2 minutes ahead
    expect(isValidTimestamp(String(future), 60)).toBe(false);
  });

  it('should reject invalid timestamp format', () => {
    expect(isValidTimestamp('invalid', 60)).toBe(false);
    expect(isValidTimestamp('', 60)).toBe(false);
    expect(isValidTimestamp('abc123', 60)).toBe(false);
  });
});

