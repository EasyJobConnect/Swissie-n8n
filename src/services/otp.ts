import { getDb } from '../db/mongo';
import { randomInt } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import argon2 from 'argon2';

export async function generateOtp(input: {
  subject_type: string;
  subject_id: string;
  ttlSeconds?: number;
}): Promise<{ otp_id: string; code: string }> {
  const code = String(randomInt(0, 1000000)).padStart(6, '0');
  const hash = await argon2.hash(code);
  const otp_id = uuidv4();
  const ttl = input.ttlSeconds ?? 600;
  const expiresAt = new Date(Date.now() + ttl * 1000);
  const db = await getDb();
  await db.collection('otps').insertOne({
    otp_id,
    subject: { type: input.subject_type, id: input.subject_id },
    hash,
    attempts: 0,
    expires_at: expiresAt,
    created_at: new Date()
  });
  return { otp_id, code };
}

export async function verifyOtp(input: { otp_id: string; code: string }): Promise<{ valid: boolean; remaining?: number }> {
  const db = await getDb();
  const doc = await db.collection('otps').findOne({ otp_id: input.otp_id });
  if (!doc) return { valid: false, remaining: 0 };
  if (doc.expires_at && new Date(doc.expires_at) < new Date()) {
    return { valid: false, remaining: 0 };
  }
  if (doc.attempts >= 3) return { valid: false, remaining: 0 };
  const valid = await argon2.verify(doc.hash, input.code);
  if (valid) {
    await db.collection('otps').deleteOne({ otp_id: input.otp_id });
    return { valid: true };
  }
  await db.collection('otps').updateOne({ otp_id: input.otp_id }, { $inc: { attempts: 1 } });
  const updated = await db.collection('otps').findOne({ otp_id: input.otp_id });
  const remaining = Math.max(0, 3 - (updated?.attempts ?? 0));
  return { valid: false, remaining };
}


