import { hmacSha256Hex } from '../src/lib/hmac';
import { verifyHmacSignature } from '../src/middleware/signature';

// Mock DB layer for replay guard
jest.mock('../src/db/mongo', () => {
  return {
    getDb: async () => ({
      collection: () => ({
        insertOne: jest.fn().mockResolvedValue({ acknowledged: true })
      })
    })
  };
});

function makeRes() {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('verifyHmacSignature middleware', () => {
  const secret = 'test_secret';

  beforeEach(() => {
    process.env.HMAC_SECRET = secret;
    jest.clearAllMocks();
  });

  test('returns 401 when signature is missing', async () => {
    const handler = verifyHmacSignature();
    const now = Math.floor(Date.now() / 1000);
    const req: any = {
      header: (name: string) => {
        if (name.toLowerCase() === 'x-signature') return '';
        if (name.toLowerCase() === 'x-timestamp') return String(now);
        return '';
      },
      rawBody: Buffer.from('{}')
    };
    const res = makeRes();
    const next = jest.fn();
    await handler(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  test('calls next() when signature is valid', async () => {
    const payload = Buffer.from('{"ok":true}');
    const signature = hmacSha256Hex(secret, payload);
    const handler = verifyHmacSignature();
    const now = Math.floor(Date.now() / 1000);
    const req: any = {
      header: (name: string) => {
        if (name.toLowerCase() === 'x-signature') return signature;
        if (name.toLowerCase() === 'x-timestamp') return String(now);
        return '';
      },
      rawBody: payload
    };
    const res = makeRes();
    const next = jest.fn();
    await handler(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('returns 401 when signature is invalid', async () => {
    const payload = Buffer.from('{"ok":true}');
    const handler = verifyHmacSignature();
    const now = Math.floor(Date.now() / 1000);
    const req: any = {
      header: (name: string) => {
        if (name.toLowerCase() === 'x-signature') return 'deadbeef';
        if (name.toLowerCase() === 'x-timestamp') return String(now);
        return '';
      },
      rawBody: payload
    };
    const res = makeRes();
    const next = jest.fn();
    await handler(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });
});


