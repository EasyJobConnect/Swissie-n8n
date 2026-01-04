import crypto from 'crypto';

export function hmacSha256Hex(secret: string, data: Buffer | string): string {
  return crypto.createHmac('sha256', secret).update(data).digest('hex');
}

export function timingSafeEqualHex(aHex: string, bHex: string): boolean {
  try {
    const a = Buffer.from(aHex, 'hex');
    const b = Buffer.from(bHex, 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function canonicalStringify(value: unknown): string {
  // Stable stringify by sorting object keys recursively
  const seen = new WeakSet();
  const stringify = (val: any): string => {
    if (val === null || typeof val !== 'object') return JSON.stringify(val);
    if (seen.has(val)) throw new TypeError('Circular reference in payload');
    seen.add(val);
    if (Array.isArray(val)) {
      return '[' + val.map(v => stringify(v)).join(',') + ']';
    }
    const keys = Object.keys(val).sort();
    const entries = keys.map(k => JSON.stringify(k) + ':' + stringify(val[k]));
    return '{' + entries.join(',') + '}';
  };
  
  // Wrap in try/catch for circular reference protection
  try {
    return stringify(value);
  } catch (err) {
    // Return [CIRCULAR] marker for circular references to allow signature computation
    if (err instanceof TypeError && String(err.message).toLowerCase().includes('circular')) {
      return '"[CIRCULAR]"';
    }
    // Fallback to regular JSON.stringify for other errors
    try {
      return JSON.stringify(value);
    } catch {
      return '"[CIRCULAR]"';
    }
  }
}


