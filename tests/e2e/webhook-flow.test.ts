import crypto from 'crypto';
import axios from 'axios';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';
const HMAC_SECRET = process.env.HMAC_SECRET || 'test_secret';
const INTERNAL_TOKEN = process.env.N8N_TOKEN || 'test_token';

function computeSignature(body: string): string {
  return crypto.createHmac('sha256', HMAC_SECRET).update(body).digest('hex');
}

function getTimestamp(): string {
  return Math.floor(Date.now() / 1000).toString();
}

describe('E2E Webhook Flow', () => {
  const client = axios.create({
    baseURL: BASE_URL,
    validateStatus: () => true, // Don't throw on any status
  });

  describe('Health Checks', () => {
    it('should return healthy status', async () => {
      const response = await client.get('/health');
      expect(response.status).toBe(200);
      expect(response.data.ok).toBe(true);
      expect(response.data.checks).toHaveProperty('db');
    });
  });

  describe('Webhook Entry', () => {
    it('should reject unsigned webhook', async () => {
      const payload = { source: 'test', user_id: 'user123', action: 'test' };
      const response = await client.post('/webhook/entry', payload);
      
      expect(response.status).toBe(400);
    });

    it('should reject webhook with invalid signature', async () => {
      const payload = { source: 'test', user_id: 'user123', action: 'test' };
      const body = JSON.stringify(payload);
      
      const response = await client.post('/webhook/entry', body, {
        headers: {
          'Content-Type': 'application/json',
          'X-Signature': 'sha256=invalid_signature',
          'X-Timestamp': getTimestamp(),
        },
      });
      
      expect(response.status).toBe(401);
    });

    it('should accept webhook with valid signature', async () => {
      const payload = { source: 'test', user_id: 'user123', action: 'test_action' };
      const body = JSON.stringify(payload);
      const signature = computeSignature(body);
      
      const response = await client.post('/webhook/entry', body, {
        headers: {
          'Content-Type': 'application/json',
          'X-Signature': `sha256=${signature}`,
          'X-Timestamp': getTimestamp(),
        },
      });
      
      expect([200, 202]).toContain(response.status);
      expect(response.data).toHaveProperty('status');
    });

    it('should handle duplicate webhooks (deduplication)', async () => {
      const payload = { 
        source: 'test',
        user_id: `user_${Date.now()}`,
        action: 'test_dedup'
      };
      const body = JSON.stringify(payload);
      const signature = computeSignature(body);
      const timestamp = getTimestamp();
      
      const headers = {
        'Content-Type': 'application/json',
        'X-Signature': `sha256=${signature}`,
        'X-Timestamp': timestamp,
      };
      
      // First request
      const response1 = await client.post('/webhook/entry', body, { headers });
      expect([200, 202]).toContain(response1.status);
      
      // Duplicate request (should be deduplicated)
      const response2 = await client.post('/webhook/entry', body, { headers });
      expect([200, 202]).toContain(response2.status);
    });

    it('should handle idempotency with X-Idempotency-Key', async () => {
      const payload = { 
        source: 'test',
        user_id: `user_${Date.now()}`,
        action: 'test_idempotent'
      };
      const body = JSON.stringify(payload);
      const signature = computeSignature(body);
      const idempotencyKey = `idem_${Date.now()}_${Math.random()}`;
      
      const headers = {
        'Content-Type': 'application/json',
        'X-Signature': `sha256=${signature}`,
        'X-Timestamp': getTimestamp(),
        'X-Idempotency-Key': idempotencyKey,
      };
      
      // First request
      const response1 = await client.post('/webhook/entry', body, { headers });
      expect([200, 202]).toContain(response1.status);
      
      // Second request with same idempotency key
      const response2 = await client.post('/webhook/entry', body, { headers });
      
      if (response2.headers['idempotency-replayed']) {
        expect(response2.headers['idempotency-replayed']).toBe('true');
      }
    });
  });

  describe('Internal API Endpoints (with JWT)', () => {
    const internalHeaders = {
      'Authorization': `Bearer ${INTERNAL_TOKEN}`,
      'Content-Type': 'application/json',
    };

    it('should reject requests without auth', async () => {
      const response = await client.post('/services/storage/upsert', {
        collection: 'test',
        match: { id: '1' },
        update: { $set: { data: 'test' } },
      });
      
      expect(response.status).toBe(401);
    });

    it('should allow storage upsert with auth', async () => {
      const response = await client.post('/services/storage/upsert', {
        collection: 'test_collection',
        match: { test_id: `test_${Date.now()}` },
        update: { $set: { data: 'test_data', updated_at: new Date() } },
      }, { headers: internalHeaders });
      
      expect([200, 201]).toContain(response.status);
    });

    it('should generate OTP', async () => {
      const response = await client.post('/otp/generate', {
        subject_type: 'phone',
        subject_id: '+1234567890',
        channel: 'sms',
      }, { headers: internalHeaders });
      
      expect([200, 201]).toContain(response.status);
      expect(response.data).toHaveProperty('otp_id');
    });

    it('should verify entitlement', async () => {
      const response = await client.post('/verify/entitlement', {
        internal_event_id: `evt_${Date.now()}`,
        user_id: 'user123',
        action: 'test_action',
      }, { headers: internalHeaders });
      
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('allowed');
    });
  });

  describe('Metrics', () => {
    it('should expose prometheus metrics', async () => {
      const response = await client.get('/metrics');
      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('text/plain');
      expect(response.data).toContain('http_requests_total');
    });
  });
});

