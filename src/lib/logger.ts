import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';

const logLevel = process.env.LOG_LEVEL || 'info';

/**
 * Mask PII (Personally Identifiable Information) in log data
 * - Email: u***@e***.com
 * - Phone: +1***456 (show country code + last 3 digits)
 * - Tokens: tok_***, sk_***, pk_***
 */
export function maskPII(input: unknown): unknown {
  if (input === null || input === undefined) {
    return input;
  }

  if (typeof input === 'string') {
    let masked = input;
    
    // Mask email addresses: user@example.com → u***@e***.com
    masked = masked.replace(
      /([a-zA-Z0-9])[a-zA-Z0-9.+_-]*@([a-zA-Z0-9])[a-zA-Z0-9.-]*\.([a-z]{2,})/gi,
      '$1***@$2***.$3'
    );
    
    // Mask phone numbers: +1234567890 → +1***890
    // Handles various formats: +1234567890, 1234567890, +1 234 567 890
    masked = masked.replace(
      /(\+?\d{1,3})[\s.-]?\d+[\s.-]?\d*[\s.-]?(\d{3})\b/g,
      '$1***$2'
    );
    
    // Mask tokens: tok_xxx, sk_xxx, pk_xxx, key_xxx
    masked = masked.replace(
      /(tok_|sk_|pk_|key_|secret_|api_)[a-zA-Z0-9_-]+/gi,
      '$1***'
    );
    
    // Mask Bearer tokens
    masked = masked.replace(
      /(Bearer\s+)[a-zA-Z0-9._-]+/gi,
      '$1***'
    );
    
    return masked;
  }

  if (Array.isArray(input)) {
    return input.map(item => maskPII(item));
  }

  if (typeof input === 'object') {
    const masked: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      // Fully mask sensitive field names
      const lowerKey = key.toLowerCase();
      if (lowerKey.includes('password') || lowerKey.includes('secret') || lowerKey === 'token') {
        masked[key] = '***';
      } else {
        masked[key] = maskPII(value);
      }
    }
    return masked;
  }

  return input;
}

// Custom format to apply PII masking
const piiMaskFormat = winston.format((info) => {
  // Mask the message if it's a string
  if (typeof info.message === 'string') {
    info.message = maskPII(info.message) as string;
  }
  
  // Mask any additional metadata
  for (const key of Object.keys(info)) {
    if (key !== 'level' && key !== 'message' && key !== 'timestamp' && key !== 'service') {
      info[key] = maskPII(info[key]);
    }
  }
  
  return info;
});

const transports: winston.transport[] = [
  new winston.transports.Console({
    level: logLevel,
    handleExceptions: true,
    format: winston.format.combine(
      piiMaskFormat(),
      winston.format.colorize(),
      winston.format.timestamp(),
      winston.format.printf(info => `${info.timestamp as string} ${info.level}: ${info.message}`)
    )
  })
];

try {
  transports.push(
    new DailyRotateFile({
      level: logLevel,
      dirname: 'logs',
      filename: 'app-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxFiles: '14d',
      zippedArchive: true,
      format: winston.format.combine(
        piiMaskFormat(),
        winston.format.timestamp(),
        winston.format.json()
      )
    })
  );
} catch {
  // Ignore if file system is not writable
}

export const logger = winston.createLogger({
  level: logLevel,
  format: winston.format.combine(
    piiMaskFormat(),
    winston.format.json()
  ),
  defaultMeta: { service: 'n8n-backend' },
  transports
});


