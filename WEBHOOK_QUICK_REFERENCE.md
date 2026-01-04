# 🚀 Webhook Forwarding Quick Reference

## One-Line Summary

**Verify inbound webhooks → Discard their HMAC → Generate NEW HMAC → Forward to micro-backend ONLY**

---

## Configuration

Add to `.env`:

```bash
MICRO_BACKEND_URL=http://micro-backend:3000
MICRO_BACKEND_HMAC_SECRET=<32+ chars, must match micro-backend>
MICRO_BACKEND_JWT=<32+ chars bearer token>
MICRO_BACKEND_DEVICE_ID=webhook-gateway
FORWARD_TO_MICRO_BACKEND_ONLY=true
```

---

## Code Flow

```
1. External Webhook Provider
   └─ Signs with their HMAC_SECRET
   
2. Your Gateway (/webhook/entry)
   ├─ Middleware: verifyHmacSignature()
   │  ├─ Extract: X-Signature, X-Timestamp
   │  ├─ Compute: HMAC_SHA256(YOUR_HMAC_SECRET, path + body)
   │  ├─ Compare (timing-safe): received == computed ✓
   │  └─ Check: timestamp within ±60 seconds ✓
   │
   ├─ Middleware: validateAndNormalizePayload()
   │  └─ Normalize webhook payload
   │
   ├─ Handler: handleWebhookEntry()
   │  └─ Call: forwardToDestination()
   │
   └─ Service: microBackendForwarder.ts
      ├─ adaptPayloadForMicroBackend()
      │  └─ Add source, event_type, correlation_id, etc.
      │
      ├─ generateMicroBackendSignature()
      │  ├─ timestamp = now
      │  ├─ message = `${timestamp}.${JSON.stringify(payload)}`
      │  ├─ signature = HMAC_SHA256(MICRO_BACKEND_SECRET, message)
      │  └─ return { signature, timestamp }
      │
      └─ POST /api/v1/flow/create
         ├─ Headers:
         │  ├─ X-Signature: <new signature>
         │  ├─ X-Timestamp: <new timestamp>
         │  ├─ X-Device-ID: webhook-gateway
         │  ├─ Authorization: Bearer <jwt>
         │  └─ X-Correlation-Id: <id>
         │
         └─ Body: adaptedPayload

3. Micro-Backend (/api/v1/flow/create)
   ├─ Middleware: verifyHmacSignature() (their version)
   │  ├─ Extract: X-Signature, X-Timestamp
   │  ├─ Compute: HMAC_SHA256(THEIR_HMAC_SECRET, message)
   │  ├─ Compare: received == computed ✓
   │  └─ Extract: Authorization Bearer token
   │
   └─ Create workflow / process event
```

---

## Headers Cheat Sheet

### Inbound (External → Your Gateway)

```
POST /webhook/entry
X-Signature: sha256=abc123def456...      ← External provider's HMAC
X-Timestamp: 1735660800                  ← Their timestamp
Content-Type: application/json
Body: raw JSON
```

**Your gateway verifies this signature.**

### Outbound (Your Gateway → Micro-Backend)

```
POST /api/v1/flow/create
X-Signature: def789ghi012...             ← YOUR NEW HMAC (re-signed)
X-Timestamp: 1735660801                  ← YOUR NEW timestamp
X-Device-ID: webhook-gateway
Authorization: Bearer your_jwt_token
X-Correlation-Id: corr_abc123
Content-Type: application/json
Body: adapted JSON
```

**Micro-backend verifies YOUR signature.**

---

## HMAC Signature Comparison

### Inbound (What You Verify)

```typescript
// Client sends this
signature = HMAC_SHA256(EXTERNAL_SECRET, path + body)

// You verify with:
computed = HMAC_SHA256(YOUR_HMAC_SECRET, '/webhook/entry\n' + body)
if (signature !== computed) reject();
```

### Outbound (What You Send)

```typescript
// You generate this
timestamp = Math.floor(Date.now() / 1000).toString()
message = `${timestamp}.${JSON.stringify(adaptedPayload)}`
signature = HMAC_SHA256(MICRO_BACKEND_SECRET, message)

// Micro-backend verifies with:
computed = HMAC_SHA256(THEIR_HMAC_SECRET, message)
if (signature !== computed) reject();
```

---

## Payload Adaptation

### Before (Inbound)

```json
{
  "type": "user.created",
  "id": "evt_123",
  "data": { "user_id": "456" }
}
```

### After (Outbound)

```json
{
  "source": "webhook-gateway",
  "event_type": "user.created",
  "external_id": "evt_123",
  "payload": {
    "type": "user.created",
    "id": "evt_123",
    "data": { "user_id": "456" }
  },
  "occurred_at": "2025-12-31T12:00:00.000Z",
  "correlation_id": "corr_abc123",
  "internal_event_id": "evt_gateway_xyz789"
}
```

**Why?** Micro-backend expects a structured format.

---

## Files Modified/Created

```
src/config/env.ts                           ← Added MICRO_BACKEND_* vars
src/services/microBackendForwarder.ts       ← NEW: Forwarding logic
src/controllers/webhookController.ts        ← Updated: Use new forwarder
env.example                                 ← Updated: Example config
tests/microBackendForwarder.test.ts         ← NEW: Unit tests
WEBHOOK_FORWARDING_GUIDE.md                 ← NEW: Full documentation
```

---

## Testing

```bash
# Run tests
npm test -- tests/microBackendForwarder.test.ts tests/verifySignature.test.ts

# Test inbound verification (should fail with invalid signature)
curl -X POST http://localhost:3000/webhook/entry \
  -H "X-Signature: sha256=invalid" \
  -H "X-Timestamp: $(date +%s)" \
  -d '{"type":"test"}'
# Expected: 401

# Check logs
tail -f logs/app.log | grep micro-backend
```

---

## Troubleshooting

| Issue | Check |
|-------|-------|
| 401 from micro-backend | HMAC secret matches? Timestamp recent? |
| Missing headers | All 5 headers included? |
| Gateway doesn't forward | FORWARD_TO_MICRO_BACKEND_ONLY=true? |
| Inbound rejected | Signature verification working? Timestamp valid? |
| Logs empty | LOG_LEVEL=info set? |

---

## Security Checklist

- [ ] Inbound HMAC verification enabled
- [ ] `MICRO_BACKEND_HMAC_SECRET` stored in `.env` (not git)
- [ ] `MICRO_BACKEND_JWT` stored in `.env` (not git)
- [ ] `FORWARD_TO_MICRO_BACKEND_ONLY=true`
- [ ] Signature tests passing
- [ ] Forwarding tests passing
- [ ] Logs configured
- [ ] Error alerting set up
- [ ] Rate limits tuned
- [ ] Database backups enabled

---

## Key Rules

1. ✅ **Verify inbound ONLY** - Check signature at `/webhook/entry`
2. ✅ **Discard inbound HMAC** - Don't forward external signature
3. ✅ **Re-sign outbound** - Generate new HMAC for micro-backend
4. ✅ **Match format exactly** - `${timestamp}.${JSON.stringify(payload)}`
5. ✅ **Include all headers** - Don't miss X-Signature, X-Timestamp, etc.
6. ✅ **Retry 5xx only** - Don't retry 4xx errors
7. ✅ **Log everything** - Audit trail for debugging
8. ✅ **Use timing-safe comparison** - Prevents timing attacks
