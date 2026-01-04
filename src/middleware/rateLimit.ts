import rateLimit from 'express-rate-limit';

export function webhookRateLimiter() {
  const windowMs = 60 * 1000; // 1 minute
  const max = Number(process.env.RATE_LIMIT_PER_MINUTE || '100');
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: { message: 'Too many requests, please try again later.' } }
  });
}


