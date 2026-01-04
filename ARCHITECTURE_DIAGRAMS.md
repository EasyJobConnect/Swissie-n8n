# 📊 Webhook Forwarding Architecture Diagrams

## 1. High-Level Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                     EXTERNAL WEBHOOK PROVIDER                   │
│                     (e.g., Stripe, GitHub)                      │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             │ Signs payload with THEIR HMAC_SECRET
                             │ Header: X-Signature: sha256=abc123
                             │ Header: X-Timestamp: 1735660800
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    YOUR WEBHOOK GATEWAY                          │
│                  POST /webhook/entry                             │
├─────────────────────────────────────────────────────────────────┤
│  ✓ bodyParser.raw()                                             │
│    Preserves raw body bytes                                     │
│                                                                  │
│  ✓ middleware/signature.ts                                      │
│    1. Extract X-Signature, X-Timestamp                          │
│    2. Compute HMAC_SHA256(YOUR_HMAC_SECRET, path + body)        │
│    3. Timing-safe compare                                       │
│    4. Check timestamp ±60 seconds                               │
│    5. Check for replays (MongoDB dedup)                         │
│                                                                  │
│  ✓ middleware/validatePayload.ts                                │
│    Normalize & validate structure                               │
│                                                                  │
│  ✓ middleware/dedup.ts                                          │
│    Deduplicate by idempotency key                               │
│                                                                  │
│  ✓ controllers/webhookController.ts                             │
│    Call forwardToDestination()                                  │
│                                                                  │
│  ✓ services/microBackendForwarder.ts                            │
│    1. adaptPayloadForMicroBackend()                             │
│       Add: source, event_type, correlation_id                  │
│    2. generateMicroBackendSignature()                           │
│       timestamp = now                                           │
│       message = `${timestamp}.${JSON.stringify(payload)}`       │
│       signature = HMAC_SHA256(THEIR_SECRET, message)            │
│    3. Include headers:                                          │
│       X-Signature (NEW)                                         │
│       X-Timestamp (NEW)                                         │
│       X-Device-ID: webhook-gateway                              │
│       Authorization: Bearer jwt                                 │
│    4. forwardWithRetry() (max 3 attempts)                       │
│       Retry on: 5xx, 429                                        │
│       Don't retry: 4xx                                          │
│       Exponential backoff: 2^n * 1000ms                         │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         │ Signs with YOUR MICRO_BACKEND_HMAC_SECRET
                         │ Header: X-Signature: def789... (NEW HMAC)
                         │ Header: X-Timestamp: 1735660801 (NEW)
                         │ Header: X-Device-ID: webhook-gateway
                         │ Header: Authorization: Bearer jwt
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                  SWISSIE MICRO-BACKEND                           │
│               POST /api/v1/flow/create                           │
├─────────────────────────────────────────────────────────────────┤
│  ✓ middleware/verifyHmacSignature() (their version)             │
│    1. Extract X-Signature, X-Timestamp (NEW ones)               │
│    2. Compute HMAC_SHA256(THEIR_HMAC_SECRET, message)           │
│    3. Timing-safe compare                                       │
│    4. Check timestamp                                           │
│    5. Verify JWT                                                │
│                                                                  │
│  ✓ controllers/flowController.ts                                │
│    1. Extract adapted payload                                   │
│    2. Create workflow                                           │
│    3. Return { flow_id, status: 'created' }                     │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Signature Verification Flow

```
STEP 1: INBOUND (External → Your Gateway)
┌──────────────────────────────────────────┐
│ External Provider                         │
│ secret = "their_secret_32_chars"         │
│ payload = { ... }                         │
│ path = "/webhook/entry"                   │
└──────────────┬───────────────────────────┘
               │
               │ signature = HMAC_SHA256(
               │   their_secret,
               │   path + "\n" + body
               │ )
               │
┌──────────────▼───────────────────────────┐
│ Your Gateway receives:                    │
│ X-Signature: sha256=abc123...             │
│ X-Timestamp: 1735660800                   │
│ Body: raw bytes                           │
└──────────────┬───────────────────────────┘
               │
               │ Verify:
               │ YOUR_SECRET = "your_secret_32_chars"
               │ computed = HMAC_SHA256(
               │   YOUR_SECRET,
               │   "/webhook/entry\n" + body
               │ )
               │ if computed == received ✓
               │
               ▼
        ✅ ACCEPTED (continue to step 2)
        or
        ❌ REJECTED (return 401)


STEP 2: OUTBOUND (Your Gateway → Micro-Backend)
┌──────────────────────────────────────────┐
│ Your Gateway                              │
│ secret = "micro_backend_secret_32_chars" │
│ payload = { adapted ... }                 │
│ timestamp = now                           │
└──────────────┬───────────────────────────┘
               │
               │ signature = HMAC_SHA256(
               │   micro_backend_secret,
               │   `${timestamp}.${JSON.stringify(payload)}`
               │ )
               │
┌──────────────▼───────────────────────────┐
│ Micro-Backend receives:                   │
│ X-Signature: def789...                    │
│ X-Timestamp: 1735660801                   │
│ Body: raw bytes                           │
└──────────────┬───────────────────────────┘
               │
               │ Verify (their code):
               │ THEIR_SECRET = "micro_backend_secret_32_chars"
               │ timestamp = headers['X-Timestamp']
               │ message = `${timestamp}.${JSON.stringify(body)}`
               │ computed = HMAC_SHA256(THEIR_SECRET, message)
               │ if computed == received ✓
               │
               ▼
        ✅ VERIFIED (create workflow)
        or
        ❌ REJECTED (return 401)
```

---

## 3. Payload Transformation

```
┌─────────────────────────────────────────────────────────┐
│ INBOUND WEBHOOK (from external provider)                │
├─────────────────────────────────────────────────────────┤
│ {                                                        │
│   "type": "user.created",                               │
│   "id": "evt_123456",                                   │
│   "timestamp": "2025-12-31T12:00:00Z",                  │
│   "data": {                                             │
│     "user_id": "usr_789",                               │
│     "email": "john@example.com",                        │
│     "name": "John Doe"                                  │
│   }                                                     │
│ }                                                       │
└────────────────────┬────────────────────────────────────┘
                     │
                     │ adaptPayloadForMicroBackend()
                     │
┌────────────────────▼────────────────────────────────────┐
│ ADAPTED PAYLOAD (for micro-backend)                     │
├─────────────────────────────────────────────────────────┤
│ {                                                       │
│   "source": "webhook-gateway",                          │
│   "event_type": "user.created",                         │
│   "external_id": "evt_123456",                          │
│   "payload": {                                          │
│     "type": "user.created",                             │
│     "id": "evt_123456",                                 │
│     "timestamp": "2025-12-31T12:00:00Z",                │
│     "data": {                                           │
│       "user_id": "usr_789",                             │
│       "email": "john@example.com",                      │
│       "name": "John Doe"                                │
│     }                                                   │
│   },                                                    │
│   "occurred_at": "2025-12-31T12:00:00Z",                │
│   "correlation_id": "corr_abc123",                      │
│   "internal_event_id": "evt_gateway_xyz789"             │
│ }                                                       │
└─────────────────────────────────────────────────────────┘
```

---

## 4. Request Headers Comparison

```
┌─────────────────────────────────┬─────────────────────────────────┐
│ INBOUND REQUEST                 │ OUTBOUND REQUEST                │
│ (External → Your Gateway)       │ (Your Gateway → Micro-Backend)  │
├─────────────────────────────────┼─────────────────────────────────┤
│ POST /webhook/entry             │ POST /api/v1/flow/create        │
├─────────────────────────────────┼─────────────────────────────────┤
│ X-Signature:                    │ X-Signature:                    │
│   sha256=abc123...              │   def789...                     │
│   ↑ Their HMAC                  │   ↑ YOUR HMAC (RE-SIGNED)       │
│   ↑ Different secret            │   ↑ Different secret            │
│                                 │                                 │
│ X-Timestamp: 1735660800         │ X-Timestamp: 1735660801         │
│   ↑ Their timestamp             │   ↑ YOUR NEW timestamp          │
│                                 │                                 │
│ Content-Type:                   │ Content-Type:                   │
│   application/json              │   application/json              │
│                                 │                                 │
│ (no other headers)              │ X-Device-ID: webhook-gateway    │
│                                 │   ↑ Identifies your gateway     │
│                                 │                                 │
│                                 │ Authorization:                  │
│                                 │   Bearer <jwt_token>            │
│                                 │   ↑ Service-to-service JWT      │
│                                 │                                 │
│                                 │ X-Correlation-Id: corr_abc123   │
│                                 │   ↑ For request tracing         │
└─────────────────────────────────┴─────────────────────────────────┘
```

---

## 5. Retry Strategy

```
Request to Micro-Backend
│
├─ Attempt 1 (immediate)
│  │
│  ├─ 2xx/3xx → SUCCESS ✓
│  │
│  ├─ 4xx → FAIL (don't retry) ✗
│  │
│  └─ 5xx/timeout → CONTINUE ↓
│
├─ Wait 2 seconds + jitter (250-500ms)
│
├─ Attempt 2
│  │
│  ├─ 2xx/3xx → SUCCESS ✓
│  │
│  ├─ 4xx → FAIL (don't retry) ✗
│  │
│  └─ 5xx/timeout → CONTINUE ↓
│
├─ Wait 4 seconds + jitter (250-500ms)
│
├─ Attempt 3
│  │
│  ├─ 2xx/3xx → SUCCESS ✓
│  │
│  └─ Anything else → FAIL ✗
│
└─ Log error, mark as failed
```

---

## 6. HMAC Signature Calculation

```
INBOUND (External Provider → You)
═════════════════════════════════

secret = "their_secret_at_least_32_chars_!!!"
body = Buffer.from('{"type":"user.created","id":"evt_123"}')
path = "/webhook/entry"

message = Buffer.concat([
  Buffer.from(path + "\n"),
  body
])

signature = crypto
  .createHmac('sha256', secret)
  .update(message)
  .digest('hex')

Result: "abc123def456..." (64 hex chars)
Header: X-Signature: sha256=abc123def456...


OUTBOUND (You → Micro-Backend)
═══════════════════════════════

secret = "micro_backend_secret_at_least_32_chars!!!"
payload = {
  "source": "webhook-gateway",
  "event_type": "user.created",
  ...
}
timestamp = "1735660801" (unix seconds as string)

message = `${timestamp}.${JSON.stringify(payload)}`

signature = crypto
  .createHmac('sha256', secret)
  .update(message)
  .digest('hex')

Result: "def789ghi012..." (64 hex chars)
Header: X-Signature: def789ghi012...
Header: X-Timestamp: 1735660801

NOTE: No "sha256=" prefix in outbound!
      Outbound just sends hex directly
```

---

## 7. Two-Secret System

```
┌──────────────────────────────────────────────────────────┐
│                    SECRET MANAGEMENT                      │
├──────────────────────────────────────────────────────────┤
│                                                           │
│ Secret 1: YOUR_HMAC_SECRET                               │
│ ─────────────────────────────                            │
│ Purpose: Verify inbound webhooks                         │
│ Set by: You (shared with webhook providers)              │
│ Location: env.HMAC_SECRET                                │
│ Length: Min 32 characters                                │
│ Example: "abc123def456...xyz789...===" (base64 or hex)  │
│                                                           │
│ ┌─────────────────────────────────────┐                 │
│ │ Used in:                            │                 │
│ │ - Inbound signature verification    │                 │
│ │ - Only at /webhook/entry endpoint   │                 │
│ └─────────────────────────────────────┘                 │
│                                                           │
│ ═════════════════════════════════════════════════════    │
│                                                           │
│ Secret 2: MICRO_BACKEND_HMAC_SECRET                      │
│ ───────────────────────────────────                      │
│ Purpose: Sign outbound requests to micro-backend         │
│ Set by: You (copied from micro-backend's config)         │
│ Location: env.MICRO_BACKEND_HMAC_SECRET                  │
│ Length: Min 32 characters                                │
│ Must Match: micro-backend's HMAC_SIGNATURE_SECRET        │
│ Example: "def789ghi012...xyz789...===" (different!)     │
│                                                           │
│ ┌─────────────────────────────────────┐                 │
│ │ Used in:                            │                 │
│ │ - Outbound signature generation     │                 │
│ │ - Forward to /api/v1/flow/create    │                 │
│ └─────────────────────────────────────┘                 │
│                                                           │
│ ═════════════════════════════════════════════════════    │
│                                                           │
│ Secret 3: MICRO_BACKEND_JWT                              │
│ ──────────────────────────────                           │
│ Purpose: Authenticate as backend service                 │
│ Set by: You (generate or get from micro-backend admin)  │
│ Location: env.MICRO_BACKEND_JWT                          │
│ Length: Min 32 characters                                │
│ Type: JWT token (different from HMAC secrets)            │
│                                                           │
│ ┌─────────────────────────────────────┐                 │
│ │ Used in:                            │                 │
│ │ - Authorization: Bearer <jwt>       │                 │
│ │ - In outbound request headers       │                 │
│ └─────────────────────────────────────┘                 │
│                                                           │
└──────────────────────────────────────────────────────────┘

⚠️  CRITICAL:
    - None of these should be in version control
    - Each is independent (don't reuse)
    - HMAC secrets must be exactly 32+ chars
    - JWT can be any format (usually base64)
```

---

## 8. Configuration Flow

```
Start Gateway
│
├─ Load .env file
│  │
│  ├─ HMAC_SECRET=...              (inbound verification)
│  ├─ MICRO_BACKEND_URL=...         (where to forward)
│  ├─ MICRO_BACKEND_HMAC_SECRET=... (outbound signing)
│  ├─ MICRO_BACKEND_JWT=...         (authentication)
│  ├─ MICRO_BACKEND_DEVICE_ID=...   (identification)
│  └─ FORWARD_TO_MICRO_BACKEND_ONLY=true (feature flag)
│
├─ Validate with Zod schema
│  │
│  ├─ Check secrets ≥ 32 chars
│  ├─ Check URLs are valid
│  └─ Log any misconfigurations
│
├─ Initialize middleware
│  │
│  ├─ signature middleware (uses HMAC_SECRET)
│  └─ webhook controller
│
├─ Initialize services
│  │
│  ├─ microBackendForwarder
│  │  ├─ Uses MICRO_BACKEND_URL
│  │  ├─ Uses MICRO_BACKEND_HMAC_SECRET
│  │  ├─ Uses MICRO_BACKEND_JWT
│  │  └─ Uses MICRO_BACKEND_DEVICE_ID
│  │
│  └─ eventRouter (backward compatible)
│     ├─ Uses FORWARD_TO_MICRO_BACKEND_ONLY flag
│     └─ Falls back to N8N if false
│
└─ Start Express server
   │
   └─ Listen for webhooks
      │
      └─ For each POST /webhook/entry:
         ├─ Verify inbound HMAC (HMAC_SECRET)
         ├─ Normalize payload
         ├─ Call forwardToDestination()
         └─ Response: 200 OK (always)
```

---

## 9. Error Handling

```
Request arrives
│
├─ Signature verification
│  │
│  ├─ Missing X-Signature?
│  │  └─ 401: Missing signature
│  │
│  ├─ Invalid signature?
│  │  └─ 401: Invalid signature
│  │
│  ├─ Timestamp too old/new?
│  │  └─ 401: Signature timestamp out of window
│  │
│  ├─ Replay detected?
│  │  └─ 401: Replay detected
│  │
│  └─ ✓ Signature valid?
│     └─ Continue
│
├─ Payload validation
│  │
│  ├─ Invalid JSON?
│  │  └─ 400: Bad payload
│  │
│  └─ ✓ Valid?
│     └─ Continue
│
├─ Forward to micro-backend
│  │
│  ├─ MICRO_BACKEND_URL not set?
│  │  └─ 200 OK (skip, don't fail)
│  │
│  ├─ Network error?
│  │  ├─ Retry (exponential backoff)
│  │  └─ After 3 attempts → log error
│  │
│  ├─ 4xx from micro-backend?
│  │  └─ Don't retry, log error
│  │
│  ├─ 5xx from micro-backend?
│  │  └─ Retry (up to 3 times)
│  │
│  └─ 2xx/3xx from micro-backend?
│     └─ Success, log result
│
└─ Always return 200 OK
   (async processing, webhook provider doesn't retry)
```

---

## 10. Complete Request Timeline

```
Time  │ Component              │ Action
──────┼────────────────────────┼──────────────────────────────
 0ms  │ External Provider      │ Generate HMAC with their secret
      │                        │ Sign payload
      │                        │ POST /webhook/entry
      │
 10ms │ Your Gateway (Network) │ Receive request
      │                        │
 15ms │ bodyParser.raw()       │ Preserve raw bytes for HMAC
      │                        │
 20ms │ signature.ts           │ Extract X-Signature, X-Timestamp
      │ (middleware)           │ Compute HMAC with YOUR secret
      │                        │ Timing-safe compare
      │                        │ Check timestamp (now ± 60s)
      │                        │
 35ms │ mongo (signature_      │ Check replay (insert dedup key)
      │  replays table)        │
      │                        │
 50ms │ validatePayload.ts     │ Validate & normalize payload
      │                        │
 70ms │ dedup.ts               │ Check idempotency key (optional)
      │                        │
 90ms │ webhookController.ts   │ Generate internal_event_id
      │                        │
100ms │ microBackendForwarder. │ adaptPayloadForMicroBackend()
      │ ts                     │ Add metadata, context
      │                        │
115ms │ microBackendForwarder. │ generateMicroBackendSignature()
      │ ts                     │ Compute HMAC with MICRO secret
      │                        │
130ms │ http.post()            │ HTTP POST to micro-backend
      │                        │ Include all 5 headers
      │                        │ Send adapted payload
      │
150ms │ Micro-Backend          │ (Network transit)
      │ (Network)              │
      │
165ms │ Micro-Backend          │ Receive request
      │                        │
170ms │ Micro-Backend          │ Verify X-Signature
      │ (signature.ts)         │ Verify X-Timestamp
      │                        │ Verify JWT
      │
185ms │ Micro-Backend          │ Create workflow
      │ (flowController.ts)    │ Save to database
      │
200ms │ Your Gateway           │ Receive 201 response
      │ (http client)          │
      │
215ms │ webhookController.ts   │ Send 200 OK to external provider
      │                        │ (async forward completed)
      │
220ms │ External Provider      │ Receive 200 OK
      │                        │ Mark as delivered
      │
      │ (Meanwhile in DB)      │
      │                        │
225ms │ Your Gateway logs      │ Log: "Forward successful"
      │                        │
235ms │ Micro-Backend logs     │ Log: "Workflow created"
```

---

This completes the architecture visualization! Use these diagrams to understand the flow.
