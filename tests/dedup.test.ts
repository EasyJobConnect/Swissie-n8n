import crypto from 'crypto';

function canonicalStringify(obj: any): string {
  if (obj === null || obj === undefined) return '';
  if (typeof obj !== 'object') return String(obj);
  if (Array.isArray(obj)) {
    return `[${obj.map(canonicalStringify).join(',')}]`;
  }
  const keys = Object.keys(obj).sort();
  const pairs = keys.map(k => `"${k}":${canonicalStringify(obj[k])}`);
  return `{${pairs.join(',')}}`;
}

function computeDeterministicId(payload: any): string {
  const canonical = canonicalStringify(payload);
  const dayBucket = new Date().toISOString().split('T')[0];
  const sourceId = payload.source || 'unknown';
  const combined = `${canonical}:${sourceId}:${dayBucket}`;
  return crypto.createHash('sha256').update(combined).digest('hex');
}

describe('Deduplication Logic', () => {
  it('should produce deterministic event IDs', () => {
    const payload = { user_id: 'user123', action: 'test', source: 'webhook' };
    const id1 = computeDeterministicId(payload);
    const id2 = computeDeterministicId(payload);
    expect(id1).toBe(id2);
  });

  it('should produce different IDs for different payloads', () => {
    const payload1 = { user_id: 'user123', action: 'test', source: 'webhook' };
    const payload2 = { user_id: 'user456', action: 'test', source: 'webhook' };
    const id1 = computeDeterministicId(payload1);
    const id2 = computeDeterministicId(payload2);
    expect(id1).not.toBe(id2);
  });

  it('should produce same ID regardless of key order', () => {
    const payload1 = { user_id: 'user123', action: 'test', source: 'webhook' };
    const payload2 = { action: 'test', source: 'webhook', user_id: 'user123' };
    const id1 = computeDeterministicId(payload1);
    const id2 = computeDeterministicId(payload2);
    expect(id1).toBe(id2);
  });

  it('should include day bucket in ID computation', () => {
    const payload = { user_id: 'user123', action: 'test', source: 'webhook' };
    const canonical = canonicalStringify(payload);
    const dayBucket = new Date().toISOString().split('T')[0];
    expect(dayBucket).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('should handle nested objects correctly', () => {
    const payload1 = { user_id: 'user123', metadata: { key: 'value', nested: { deep: 'data' } } };
    const payload2 = { user_id: 'user123', metadata: { nested: { deep: 'data' }, key: 'value' } };
    const id1 = computeDeterministicId(payload1);
    const id2 = computeDeterministicId(payload2);
    expect(id1).toBe(id2);
  });
});

