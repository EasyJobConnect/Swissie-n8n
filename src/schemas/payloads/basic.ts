import { z } from 'zod';
import validator from 'validator';
import { toE164OrNull } from '../../lib/e164';

// Supported payload versions
export const PAYLOAD_VERSIONS = ['1.0', '1.1'] as const;
export type PayloadVersion = typeof PAYLOAD_VERSIONS[number];

/**
 * Versioned payload schema with backward compatibility
 * - payload_version: optional, defaults to '1.0'
 * - All fields normalized for consistency
 */
export const basicPayloadSchema = z.object({
  // Version field for future schema evolution
  payload_version: z.enum(PAYLOAD_VERSIONS).optional().default('1.0'),
  
  // Required fields
  source: z.string().min(1, 'source is required'),
  type: z.string().min(1, 'type is required'),
  
  // Optional fields
  timestamp: z.union([z.number(), z.string()]).optional(),
  user: z
    .object({
      user_id: z.string().optional(),
      email: z.string().email().optional(),
      phone: z.string().optional()
    })
    .optional(),
  data: z.record(z.any()).optional(),
  
  // Metadata fields (v1.1+)
  metadata: z.object({
    request_id: z.string().optional(),
    trace_id: z.string().optional(),
    client_version: z.string().optional(),
  }).optional(),
});

export type BasicPayload = z.infer<typeof basicPayloadSchema>;

/**
 * Response schema for standardized API responses
 */
export const responseSchema = z.object({
  status: z.enum(['accepted', 'success', 'error']),
  internal_event_id: z.string().optional(),
  message: z.string().optional(),
  data: z.any().optional(),
  error: z.object({
    message: z.string(),
    code: z.string().optional(),
    details: z.any().optional(),
  }).optional(),
  _idempotent: z.boolean().optional(),
  payload_version: z.enum(PAYLOAD_VERSIONS).optional(),
});

export type StandardResponse = z.infer<typeof responseSchema>;

/**
 * Normalize a basic payload for consistent processing
 * - Normalizes emails to lowercase
 * - Converts phone to E.164 format
 * - Normalizes email fields in data object
 */
export function normalizeBasicPayload(payload: BasicPayload): BasicPayload {
  const normalized: BasicPayload = { 
    ...payload,
    // Ensure payload_version is set
    payload_version: payload.payload_version || '1.0',
  };
  
  if (payload.user?.email) {
    const email = String(payload.user.email).trim().toLowerCase();
    normalized.user = { ...(normalized.user || {}), email };
  }
  if (payload.user?.phone) {
    const e164 = toE164OrNull(String(payload.user.phone));
    if (e164) {
      normalized.user = { ...(normalized.user || {}), phone: e164 };
    } else {
      // If invalid, drop phone to avoid propagating bad data
      normalized.user = { ...(normalized.user || {}) };
      delete (normalized.user as any).phone;
    }
  }

  if (payload.data) {
    // Normalize email fields in data object
    const normalizedData = { ...payload.data };
    for (const [k, v] of Object.entries(payload.data)) {
      if (k.toLowerCase().includes('email') && typeof v === 'string') {
        normalizedData[k] = validator.normalizeEmail(v) || v.toLowerCase();
      }
    }
    normalized.data = normalizedData;
  }

  return normalized;
}

/**
 * Create a standardized success response
 */
export function createSuccessResponse(data: any, internalEventId?: string): StandardResponse {
  return {
    status: 'success',
    internal_event_id: internalEventId,
    data,
    payload_version: '1.0',
  };
}

/**
 * Create a standardized error response
 */
export function createErrorResponse(message: string, code?: string, details?: any): StandardResponse {
  return {
    status: 'error',
    error: {
      message,
      code,
      details,
    },
  };
}


