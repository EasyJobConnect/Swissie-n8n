import crypto from 'crypto';
import {
  forwardToMicroBackend,
  forwardToDestination,
} from '../src/services/microBackendForwarder';
import { http } from '../src/lib/http';
import { logger } from '../src/lib/logger';

jest.mock('../src/lib/http');
jest.mock('../src/lib/logger');

describe('Micro-Backend Forwarder', () => {
  const testSecret = 'test_micro_backend_secret_at_least_32_chars_long_!!';
  const testPayload = {
    type: 'user.created',
    id: 'evt_123',
    data: { user_id: '456', email: 'test@example.com' },
  };

  beforeEach(() => {
    process.env.MICRO_BACKEND_URL = 'http://localhost:3000';
    process.env.MICRO_BACKEND_HMAC_SECRET = testSecret;
    process.env.MICRO_BACKEND_JWT = 'jwt_token_min_32_chars_long_!!!!!!';
    process.env.MICRO_BACKEND_DEVICE_ID = 'webhook-gateway';
    process.env.FORWARD_TO_MICRO_BACKEND_ONLY = 'true';
    jest.clearAllMocks();
  });

  test('generates correct HMAC signature format', async () => {
    // Mock successful response
    (http.post as jest.Mock).mockResolvedValue({
      status: 201,
      data: { flow_id: 'flow_123' },
    });

    const internalEventId = 'evt_internal_789';
    const correlationId = 'corr_123';

    await forwardToMicroBackend({
      payload: testPayload,
      internalEventId,
      correlationId,
    });

    // Verify http.post was called
    expect(http.post).toHaveBeenCalledTimes(1);
    const [url, payload, { headers }] = (http.post as jest.Mock).mock
      .calls[0];

    // Verify endpoint
    expect(url).toBe('http://localhost:3000/api/v1/flow/create');

    // Verify HMAC signature format: HMAC_SHA256(secret, `${timestamp}.${JSON.stringify(payload)}`)
    const timestamp = headers['X-Timestamp'];
    const message = `${timestamp}.${JSON.stringify(payload)}`;
    const expectedSignature = crypto
      .createHmac('sha256', testSecret)
      .update(message)
      .digest('hex');

    expect(headers['X-Signature']).toBe(expectedSignature);
  });

  test('includes required headers per micro-backend contract', async () => {
    (http.post as jest.Mock).mockResolvedValue({
      status: 201,
      data: { flow_id: 'flow_123' },
    });

    await forwardToMicroBackend({
      payload: testPayload,
      internalEventId: 'evt_789',
      correlationId: 'corr_123',
    });

    const [, , { headers }] = (http.post as jest.Mock).mock.calls[0];

    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['X-Signature']).toBeDefined();
    expect(headers['X-Timestamp']).toBeDefined();
    expect(headers['X-Device-ID']).toBe('webhook-gateway');
    expect(headers['Authorization']).toBe(
      `Bearer jwt_token_min_32_chars_long_!!!!!!`
    );
    expect(headers['X-Correlation-Id']).toBe('corr_123');
  });

  test('adapts payload to micro-backend schema', async () => {
    (http.post as jest.Mock).mockResolvedValue({
      status: 201,
      data: { flow_id: 'flow_123' },
    });

    const internalEventId = 'evt_internal_789';

    await forwardToMicroBackend({
      payload: testPayload,
      internalEventId,
    });

    const [, payload] = (http.post as jest.Mock).mock.calls[0];

    // Verify payload adaptation
    expect(payload.source).toBe('webhook-gateway');
    expect(payload.event_type).toBe('user.created');
    expect(payload.external_id).toBeDefined();
    expect(payload.payload).toEqual(testPayload);
    expect(payload.internal_event_id).toBe(internalEventId);
    expect(payload.occurred_at).toBeDefined();
  });

  test('returns success result on 201 response', async () => {
    (http.post as jest.Mock).mockResolvedValue({
      status: 201,
      data: { flow_id: 'flow_123' },
    });

    const result = await forwardToMicroBackend({
      payload: testPayload,
      internalEventId: 'evt_789',
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe(201);
    expect(result.body.flow_id).toBe('flow_123');
  });

  test('skips if MICRO_BACKEND_URL not configured', async () => {
    delete process.env.MICRO_BACKEND_URL;

    const result = await forwardToMicroBackend({
      payload: testPayload,
      internalEventId: 'evt_789',
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe(204);
    expect(http.post).not.toHaveBeenCalled();
  });

  test('handles 4xx errors without retry', async () => {
    const error = new Error('Bad Request');
    (error as any).response = { status: 400, data: { error: 'Invalid payload' } };
    (http.post as jest.Mock).mockRejectedValueOnce(error);

    const result = await forwardToMicroBackend({
      payload: testPayload,
      internalEventId: 'evt_789',
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    expect(http.post).toHaveBeenCalledTimes(1); // No retry
  });

  test('retries on 5xx errors', async () => {
    const error = new Error('Internal Server Error');
    (error as any).response = { status: 500, data: { error: 'Server error' } };

    // Fail twice, then succeed
    (http.post as jest.Mock)
      .mockRejectedValueOnce(error)
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce({
        status: 201,
        data: { flow_id: 'flow_123' },
      });

    const result = await forwardToMicroBackend({
      payload: testPayload,
      internalEventId: 'evt_789',
    });

    expect(result.ok).toBe(true);
    expect(http.post).toHaveBeenCalledTimes(3); // 2 failures + 1 success
  });

  test('respects FORWARD_TO_MICRO_BACKEND_ONLY flag', async () => {
    process.env.FORWARD_TO_MICRO_BACKEND_ONLY = 'true';

    (http.post as jest.Mock).mockResolvedValue({
      status: 201,
      data: { flow_id: 'flow_123' },
    });

    const result = await forwardToDestination({
      payload: testPayload,
      internalEventId: 'evt_789',
    });

    // Should use micro-backend
    expect(http.post).toHaveBeenCalledWith(
      'http://localhost:3000/api/v1/flow/create',
      expect.any(Object),
      expect.any(Object)
    );
  });
});
