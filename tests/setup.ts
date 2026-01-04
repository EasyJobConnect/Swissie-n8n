jest.mock('twilio', () => {
  return {
    Twilio: jest.fn().mockImplementation(() => ({
      messages: {
        create: jest.fn().mockResolvedValue({ sid: 'SM_TEST' })
      }
    }))
  };
});

jest.mock('@sendgrid/mail', () => {
  const send = jest.fn().mockResolvedValue([{ headers: { 'x-message-id': 'MSG_TEST' } }]);
  return {
    __esModule: true,
    default: {
      setApiKey: jest.fn(),
      send
    }
  };
});

jest.mock('@slack/web-api', () => {
  return {
    WebClient: jest.fn().mockImplementation(() => ({
      chat: {
        postMessage: jest.fn().mockResolvedValue({ ok: true, ts: '123.456' })
      }
    }))
  };
});

// Minimal env for tests
process.env.MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/testdb';
process.env.HMAC_SECRET = process.env.HMAC_SECRET || 'test_secret';


