# 🔐 Webhook → Micro-Backend Integration Guide

## Overview

This document describes how webhooks flow through your gateway and get forwarded to the **Swissie micro-backend**.

### Architecture

```
External Webhook Provider
       ↓ (their HMAC signature)
Webhook Gateway (/webhook/entry)
       ✔ Verify inbound HMAC
       ✔ Normalize payload
       ✔ Deduplicate (optional)
       ↓
Micro-Backend Forwarder
       ✔ Adapt payload to schema
       ✔ Generate NEW HMAC (re-sign)
       ↓
Swissie Micro-Backend (/api/v1/flow/create)
       ✔ Verify HMAC signature
       ✔ Create/process workflow
```

---

## 1. Inbound Webhook Verification (ONLY)

**Endpoint:** `POST /webhook/entry`  
**Middleware Stack:**
1. Raw body preservation (for HMAC verification)
2. Rate limiting
3. IP blocklist
4. **HMAC signature verification** ← YOUR signature
5. Deduplication
6. Payload normalization

### Inbound HMAC Requirements

**Headers:**
```
X-Signature: sha256=<hex>         (or just <hex>)
X-Timestamp: <unix seconds>
Content-Type: application/json
```

**Signature Computation (client → you):**
```typescript
const pathAndBody = Buffer.concat([
  Buffer.from('/webhook/entry\n'),
  rawBody
]);
const signature = HMAC_SHA256(YOUR_HMAC_SECRET, pathAndBody);
```

**Security Checks:**
- ✅ Timing-safe comparison
- ✅ Timestamp within ±60 seconds
- ✅ Replay attack detection
- ✅ Path binding to `/webhook/entry`

**Response:**
```json
{
  "status": "accepted",
  "internal_event_id": "evt_uuid_generated_by_gateway"
}
```

---

## 2. HMAC Verification (Inbound Only)

**Location:** `src/middleware/signature.ts`

Your gateway **ONLY verifies HMAC on `/webhook/entry`**.

**Does NOT verify on:**
- Outbound requests to micro-backend
- Outbound requests to n8n
- Any other routes

**Key Point:** You receive a signed webhook from an external provider, verify it's authentic, then:

1. ✅ Accept the payload
2. ✅ **DISCARD** the inbound HMAC signature
3. ✅ Generate a **NEW HMAC** for micro-backend (backend-to-backend)

---

## 3. Payload Forwarding to Micro-Backend (ONLY)

**Location:** `src/services/microBackendForwarder.ts`

### What Gets Forwarded

**INBOUND → OUTBOUND Transformation:**

**Received from webhook provider:**
```json
{
  "type": "user.created",
  "id": "evt_123",
  "data": {
    "user_id": "456",
    "email": "test@example.com"
  }
}
```

**Adapted for micro-backend:**
```json
{
  "source": "webhook-gateway",
  "event_type": "user.created",
  "external_id": "evt_123",
  "payload": {
    "type": "user.created",
    "id": "evt_123",
    "data": {
      "user_id": "456",
      "email": "test@example.com"
    }
  },
  "occurred_at": "2025-12-31T12:00:00.000Z",
  "correlation_id": "corr_abc123",
  "internal_event_id": "evt_gateway_xyz789"
}
```

### How to Forward (Client must do this)

**Step 1: Generate NEW HMAC**

```typescript
import crypto from 'crypto';

function signForMicroBackend(payload: any, secret: string) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const message = `${timestamp}.${JSON.stringify(payload)}`;

  const signature = crypto
    .createHmac('sha256', secret)
    .update(message)
    .digest('hex');

  return { signature, timestamp };
}
```

**Step 2: Send to Micro-Backend**

```typescript
const adaptedPayload = {
  source: 'webhook-gateway',
  event_type: 'user.created',
  external_id: 'evt_123',
  payload: inboundPayload,
  occurred_at: new Date().toISOString(),
  correlation_id: 'corr_abc123',
  internal_event_id: 'evt_gateway_xyz789'
};

const { signature, timestamp } = signForMicroBackend(
  adaptedPayload,
  process.env.MICRO_BACKEND_HMAC_SECRET
);

const response = await fetch(
  `${process.env.MICRO_BACKEND_URL}/api/v1/flow/create`,
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Signature': signature,
      'X-Timestamp': timestamp,
      'X-Device-ID': 'webhook-gateway',
      'Authorization': `Bearer ${process.env.MICRO_BACKEND_JWT}`,
      'X-Correlation-Id': 'corr_abc123'
    },
    body: JSON.stringify(adaptedPayload)
  }
);
```

---

## 4. Security: Two-Signature System

| Stage | Who Signs | Secret | Purpose |
|-------|-----------|--------|---------|
| **Inbound** | External provider | `HMAC_SECRET` | Verify webhook authenticity |
| **Outbound** | Your gateway | `MICRO_BACKEND_HMAC_SECRET` | Backend-to-backend auth |

### Why Two Signatures?

1. **Inbound signature** proves the webhook came from the expected provider
2. **Outbound signature** proves the forwarded call came from your gateway

These are **completely independent**. Forwarding the inbound HMAC would be a security error.

---

## 5. Configuration

### Environment Variables

```bash
# Micro-Backend Settings
MICRO_BACKEND_URL=http://micro-backend:3000
MICRO_BACKEND_HMAC_SECRET=<same as micro-backend HMAC_SIGNATURE_SECRET>
MICRO_BACKEND_JWT=<backend service JWT token, min 32 chars>
MICRO_BACKEND_DEVICE_ID=webhook-gateway

# Feature Flag
FORWARD_TO_MICRO_BACKEND_ONLY=true    # true = only micro-backend, false = n8n (legacy)
```

### In `.env`

```bash
# Swissie Micro-Backend forwarding
MICRO_BACKEND_URL=http://micro-backend:3000
MICRO_BACKEND_HMAC_SECRET=your_secret_at_least_32_characters_long
MICRO_BACKEND_JWT=your_jwt_token_at_least_32_characters_long
MICRO_BACKEND_DEVICE_ID=webhook-gateway
FORWARD_TO_MICRO_BACKEND_ONLY=true
```

---

## 6. Complete Request/Response Cycle

### Request Arrives at Gateway

```
POST /webhook/entry
Content-Type: application/json
X-Signature: sha256=abc123def456...
X-Timestamp: 1735660800

{
  "type": "user.created",
  "id": "evt_123",
  "data": { ... }
}
```

### Gateway Verifies (Inbound)

```typescript
// In src/middleware/signature.ts
const pathAndBody = Buffer.concat([
  Buffer.from('/webhook/entry\n'),
  rawBody
]);
const computed = HMAC_SHA256(HMAC_SECRET, pathAndBody);
timingSafeEqual(received, computed); // ✓ Must match
```

### Gateway Forwards (Outbound)

```typescript
// In src/services/microBackendForwarder.ts
const adaptedPayload = adaptPayloadForMicroBackend(payload, internalEventId);
const { signature, timestamp } = generateMicroBackendSignature(
  adaptedPayload,
  MICRO_BACKEND_HMAC_SECRET
);

POST /api/v1/flow/create
Content-Type: application/json
X-Signature: def789ghi012...          ← NEW signature
X-Timestamp: 1735660801
X-Device-ID: webhook-gateway
Authorization: Bearer jwt_token...

{ adaptedPayload }
```

### Micro-Backend Receives & Verifies

```typescript
// In Swissie micro-backend (you don't write this)
const timestamp = headers['X-Timestamp'];
const message = `${timestamp}.${JSON.stringify(body)}`;
const expectedSignature = HMAC_SHA256(HMAC_SIGNATURE_SECRET, message);
timingSafeEqual(headers['X-Signature'], expectedSignature); // ✓ Must match
```

### Gateway Returns to Caller

```json
{
  "status": "accepted",
  "internal_event_id": "evt_gateway_xyz789"
}
```

---

## 7. Retry Policy

**Failures that RETRY (exponential backoff):**
- 5xx server errors
- 429 rate limit errors
- Network timeouts

**Failures that DON'T RETRY:**
- 4xx client errors (400, 401, 403, 404, etc.)
- Configuration errors

**Retry Schedule:**
```
Attempt 1: Immediate
Attempt 2: 2^1 * 1000ms + jitter ≈ 2 seconds
Attempt 3: 2^2 * 1000ms + jitter ≈ 4 seconds
After 3 failures: Give up, log error
```

---

## 8. Monitoring & Logs

### Success Log
```
info: Forwarding to micro-backend: url=http://micro-backend:3000/api/v1/flow/create internalEventId=evt_xyz correlationId=corr_abc
info: Micro-backend forward successful: status=201 attempt=1
```

### Failure Logs
```
error: Micro-backend forward failed (non-retryable): status=401 attempt=1 error=Unauthorized
error: Failed to forward to micro-backend: 401 {"error":"Invalid JWT"}
```

### Audit Trail
All signature failures logged to MongoDB:
```json
{
  "action": "signature_failure",
  "reason": "invalid_signature",
  "ip": "203.0.113.45",
  "correlationId": "corr_abc",
  "timestamp": "2025-12-31T12:00:00Z"
}
```

---

## 9. Testing

### Unit Tests

```bash
npm test -- tests/microBackendForwarder.test.ts
```

**What's tested:**
- ✅ Correct HMAC signature format
- ✅ Required headers present
- ✅ Payload adaptation
- ✅ Retry policy
- ✅ Configuration handling

### Manual Testing

**1. Test inbound verification:**

```bash
curl -X POST http://localhost:3000/webhook/entry \
  -H "Content-Type: application/json" \
  -H "X-Signature: sha256=invalid_signature" \
  -H "X-Timestamp: $(date +%s)" \
  -d '{"type":"test"}'

# Expected: 401 Unauthorized
```

**2. Test with correct signature:**

```bash
# Use a client library to generate proper HMAC
# See README: "Generating Signature (Client-Side)"
```

**3. Verify logs:**

```bash
tail -f logs/app.log | grep micro-backend
```

---

## 10. Troubleshooting

### Problem: 401 Unauthorized from micro-backend

**Cause:** HMAC signature mismatch

**Solution:**
1. Verify `MICRO_BACKEND_HMAC_SECRET` matches micro-backend's `HMAC_SIGNATURE_SECRET`
2. Check timestamp isn't too old/new
3. Verify payload JSON formatting (whitespace matters!)

### Problem: Missing Headers

**Cause:** Headers not set correctly

**Solution:**
```typescript
// Must include ALL of:
'X-Signature': signature,
'X-Timestamp': timestamp,
'X-Device-ID': 'webhook-gateway',
'Authorization': `Bearer ${jwt}`
```

### Problem: "MICRO_BACKEND_URL not configured"

**Cause:** Missing environment variable

**Solution:**
```bash
# Add to .env
MICRO_BACKEND_URL=http://micro-backend:3000
FORWARD_TO_MICRO_BACKEND_ONLY=true
```

### Problem: Gateway returns 200 but micro-backend didn't process

**Cause:** Async forward failure

**Solution:**
```bash
# Check logs
grep "micro-backend" logs/app.log
# Check micro-backend received the request
curl http://micro-backend:3000/health/detailed
```

---

## 11. Production Checklist

- ✅ `MICRO_BACKEND_HMAC_SECRET` stored securely (not in git)
- ✅ `MICRO_BACKEND_JWT` stored securely (rotate periodically)
- ✅ `MICRO_BACKEND_URL` is internal (not public-facing)
- ✅ `FORWARD_TO_MICRO_BACKEND_ONLY=true` (don't forward to n8n)
- ✅ Inbound HMAC validation working (`signature.test.ts` passes)
- ✅ Outbound forwarding tested (manual curl or integration test)
- ✅ Logs configured (check `/logs/app.log`)
- ✅ Rate limits tuned for expected throughput
- ✅ Database connection tested
- ✅ Error alerting configured (Slack, email, etc.)

---

## 12. Key Takeaways

| Point | Explanation |
|-------|-------------|
| **Verify inbound ONLY** | HMAC check happens at `/webhook/entry` route |
| **Discard inbound HMAC** | Don't forward external provider's signature downstream |
| **Re-sign outbound** | Generate NEW HMAC for micro-backend calls |
| **Use correct format** | `${timestamp}.${JSON.stringify(payload)}` |
| **Include all headers** | X-Signature, X-Timestamp, X-Device-ID, Authorization |
| **Retry on 5xx only** | Don't retry 4xx errors |
| **Log everything** | Audit trail saved to MongoDB |
| **Test both directions** | Inbound AND outbound HMAC verification |

---

## Questions?

See code in:
- **Inbound verification:** `src/middleware/signature.ts`
- **Outbound forwarding:** `src/services/microBackendForwarder.ts`
- **Webhook handler:** `src/controllers/webhookController.ts`
- **Tests:** `tests/microBackendForwarder.test.ts`, `tests/verifySignature.test.ts`
