# Node Backend Patch Notes

**Date:** December 5, 2025  
**Version:** 2.1.0

---

## Summary

This patch implements the Rokeeb n8n Node 5 Dec requirements, including production Dockerfile updates, PII masking, snake_case standardization, and comprehensive edge case testing.

---

## Patch List Implementation (December 5, 2025)

### P0 Critical Items ✅

| # | Item | Status | File(s) |
|---|------|--------|---------|
| 1 | Production Dockerfile (multi-stage, Alpine, `nodeuser`, curl healthcheck) | ✅ | `Dockerfile.prod` |
| 2 | PM2 ready signal + kill_timeout | ✅ | Already implemented |
| 3 | CORS default to `https://app.yourdomain.com` | ✅ | `src/server.ts` |
| 4 | Final indexes migration + capped `idempotency_keys` (2GB) | ✅ | `migrations/20251205000001-final-indexes.js` |
| 5 | DLQ routing on max retries | ✅ | Already implemented |
| 6 | Secret length validation (≥32 chars) | ✅ | Already implemented |

### P1 Important Items ✅

| # | Item | Status | File(s) |
|---|------|--------|---------|
| 7 | flowExecutor jitter (50-150ms) | ✅ | `src/workers/flowExecutor.ts` |
| 8 | Idempotency `_idempotent` flag in body | ✅ | Already implemented |
| 9 | HMAC circular reference → `"[CIRCULAR]"` | ✅ | `src/lib/hmac.ts` |
| 10 | Health Redis `aof_current_rewrite_time_sec` | ✅ | `src/controllers/healthController.ts` |
| 11 | PII masking (email/phone/token) | ✅ | `src/lib/logger.ts`, `src/services/audit.ts` |
| 12 | snake_case sweep (all timestamps) | ✅ | 12 files |
| 13 | Capped `idempotency_keys` (2GB) | ✅ | In migration |
| 14 | Queue concurrency clamping (1-50) with logging | ✅ | `src/config/env.ts` |
| 15 | Edge tests (DLQ, circular, truncation, replay) | ✅ | `tests/edge-cases.test.ts` |

---

## Breaking Changes (December 5, 2025)

### 1. **snake_case Timestamp Fields** (CRITICAL)

All database timestamp fields are now **snake_case**. This is a breaking change from the previous camelCase convention.

| Old Field (camelCase) | New Field (snake_case) |
|-----------------------|------------------------|
| `createdAt` | `created_at` |
| `updatedAt` | `updated_at` |
| `expiresAt` | `expires_at` |
| `startedAt` | `started_at` |
| `completedAt` | `completed_at` |
| `failedAt` | `failed_at` |
| `deliveredAt` | `delivered_at` |
| `lastRetryAt` | `last_retry_at` |
| `ocrStartedAt` | `ocr_started_at` |
| `ocrCompletedAt` | `ocr_completed_at` |
| `lastError` | `last_error` |
| `providerMessageId` | `provider_message_id` |

**Migration Required:** Existing data with camelCase fields will not be found by queries using snake_case fields. Run the cleanup job or manually update existing documents.

### 2. **CORS Default Origin**

When `CORS_ALLOWED_ORIGINS` is not set, the API now defaults to `https://app.yourdomain.com` instead of allowing all origins.

### 3. **Capped `idempotency_keys` Collection**

The `idempotency_keys` collection is now a capped collection (2GB max). This means:
- Old documents are automatically removed when the collection reaches 2GB
- Documents cannot be deleted individually (only the TTL index handles cleanup)
- The collection has a maximum of 10 million documents

---

## New Features

### PII Masking

All logs and audit records now automatically mask PII:

| Data Type | Example Input | Masked Output |
|-----------|---------------|---------------|
| Email | `user@example.com` | `u***@e***.com` |
| Phone | `+1234567890` | `+123***890` |
| Tokens | `tok_abc123xyz` | `tok_***` |
| Bearer | `Bearer eyJ...` | `Bearer ***` |

Fields named `password`, `secret`, or `token` are fully masked as `***`.

### Jitter on Flow Delays

Flow executor delay steps now add 50-150ms jitter to prevent thundering herd on retries:

```json
{
  "delayed_ms": 1087,
  "base_ms": 1000,
  "jitter_ms": 87
}
```

### Enhanced Health Check

Deep health mode (`/health?deep=true`) now includes Redis AOF status:

```json
{
  "redis_info": {
    "rdb_last_save_time": "1701792000",
    "aof_enabled": "1",
    "aof_current_rewrite_time_sec": "-1"
  }
}
```

---

## New Files

| File | Description |
|------|-------------|
| `migrations/20251205000001-final-indexes.js` | Final indexes + capped collection migration |
| `tests/edge-cases.test.ts` | 21 edge case tests |
| `templates/.gitkeep` | Templates directory placeholder |

---

## Files Modified (December 5, 2025)

```
Dockerfile.prod
src/server.ts
src/config/env.ts
src/lib/logger.ts
src/lib/hmac.ts
src/services/audit.ts
src/controllers/healthController.ts
src/controllers/userController.ts
src/workers/flowExecutor.ts
src/workers/messagingRetry.ts
src/workers/ocrProcessor.ts
src/workers/cleanupDaily.ts
src/queue/worker.ts
src/middleware/idempotency.ts
src/middleware/dedup.ts
src/middleware/signature.ts
src/middleware/auditRateLimit.ts
src/services/messaging.ts
src/services/payments.ts
src/services/otp.ts
src/db/indexes.ts
```

---

## Verification Commands

```bash
# Build succeeds
npm run build

# Tests pass
npm test -- tests/edge-cases.test.ts

# Verify snake_case sweep complete
grep -r "startedAt\|completedAt\|failedAt\|updatedAt\|createdAt" src/
# Should return 0 matches

# Docker build (production)
docker build -f Dockerfile.prod -t n8n-backend:prod .

# Run migrations
npm run migrate:up

# Verify capped collection
mongo --eval "db.idempotency_keys.isCapped()"
# Should return true
```

---

## Previous Versions

---

## Version 2.0.0 (December 4, 2025)

### Phase 1: Critical Security & Bug Fixes ✅

| Item | Status | File(s) |
|------|--------|---------|
| Fix HTTP validateStatus (200-300 only) | ✅ | `src/lib/http.ts` |
| Add future timestamp rejection | ✅ | `src/middleware/signature.ts` |
| Minimum secret length (32 chars) | ✅ | `src/config/env.ts` |
| JWT issuer check | ✅ | `src/middleware/internalAuth.ts` |
| Trust proxy setting | ✅ | `src/server.ts` |

### Phase 2: Signature & Idempotency Hardening ✅

| Item | Status | File(s) |
|------|--------|---------|
| Bind signature to endpoint path | ✅ | `src/middleware/signature.ts` |
| Raw body size limit (1MB) | ✅ | `src/api/webhook.ts` |
| IDEMPOTENCY_HASH_MISMATCH error code | ✅ | `src/middleware/idempotency.ts` |
| Add `_idempotent` replay flag | ✅ | `src/middleware/idempotency.ts` |
| Circular reference protection | ✅ | `src/lib/hmac.ts` |
| TTL enforcement in dedup insert | ✅ | `src/middleware/dedup.ts` |

### Phase 3: Worker & Queue Improvements ✅

| Item | Status | File(s) |
|------|--------|---------|
| Dead Letter Queues (DLQ) | ✅ | `src/queue/worker.ts` |
| Worker health tracking | ✅ | `src/queue/worker.ts` |
| Concurrency validation (1-50) | ✅ | `src/config/env.ts` |
| DLQ cleanup on shutdown | ✅ | `src/queue/worker.ts` |

### Phase 4: Messaging & OTP Improvements ✅

| Item | Status | File(s) |
|------|--------|---------|
| Retry jitter (50-150ms) | ✅ | `src/lib/http.ts`, `src/workers/messagingRetry.ts` |
| Correlation ID propagation | ✅ | `src/lib/http.ts`, `src/middleware/correlationId.ts` |

### Phase 5: N8N Integration Improvements ✅

| Item | Status | File(s) |
|------|--------|---------|
| Outbound signature headers | ✅ | `src/services/eventRouter.ts` |
| N8N retry policy (3 attempts + backoff) | ✅ | `src/services/eventRouter.ts` |

### Phase 6: Docker & PM2 Production Hardening ✅

| Item | Status | File(s) |
|------|--------|---------|
| Production Dockerfile | ✅ | `Dockerfile.prod` |
| PM2 gracefulShutdownTimeout | ✅ | `pm2.config.js` |
| PM2 scheduler process | ✅ | `pm2.config.js` |
| process.send('ready') for PM2 | ✅ | `src/server.ts` |
| Server graceful shutdown | ✅ | `src/server.ts` |

### Phase 7: Health System Enhancements ✅

| Item | Status | File(s) |
|------|--------|---------|
| Deep health mode (?deep=true) | ✅ | `src/controllers/healthController.ts` |
| Worker status in /health | ✅ | `src/controllers/healthController.ts` |
| Redis memory/persistence info | ✅ | `src/controllers/healthController.ts` |
| MongoDB stats in deep mode | ✅ | `src/controllers/healthController.ts` |

### Phase 8: Database & Index Improvements ✅

| Item | Status | File(s) |
|------|--------|---------|
| flow_executions indexes | ✅ | `src/db/indexes.ts`, `migrations/20241204000001-add-missing-indexes.js` |
| users.email unique sparse | ✅ | `src/db/indexes.ts`, `migrations/20241204000001-add-missing-indexes.js` |
| users.phone unique sparse | ✅ | `src/db/indexes.ts`, `migrations/20241204000001-add-missing-indexes.js` |
| audit_rate_limits TTL | ✅ | `src/db/indexes.ts` |

### Phase 9: Security Headers & CORS ✅

| Item | Status | File(s) |
|------|--------|---------|
| Helmet CSP configuration | ✅ | `src/server.ts` |
| HSTS headers | ✅ | `src/server.ts` |
| CORS origin restriction | ✅ | `src/server.ts` |
| CORS_ALLOWED_ORIGINS env var | ✅ | `src/config/env.ts`, `env.example` |

### Phase 10: Flow & Refund Worker Fixes ✅

| Item | Status | File(s) |
|------|--------|---------|
| Snake_case timestamps (started_at, etc.) | ✅ | `src/workers/flowExecutor.ts`, `src/workers/refundExecutor.ts` |
| Safe condition evaluator | ✅ | `src/workers/flowExecutor.ts` |
| Fix cleanupDaily field names | ✅ | `src/workers/cleanupDaily.ts` |

### Phase 11: Input Validation & Versioned Schemas ✅

| Item | Status | File(s) |
|------|--------|---------|
| payload_version field | ✅ | `src/schemas/payloads/basic.ts` |
| Response schema | ✅ | `src/schemas/payloads/basic.ts` |
| Helper functions | ✅ | `src/schemas/payloads/basic.ts` |

### Phase 12: Cleanup Jobs ✅

| Item | Status | Notes |
|------|--------|-------|
| TTL cleanups | ✅ | Already implemented in `cleanupDaily.ts` |

### Phase 13: IP Normalization ✅

| Item | Status | File(s) |
|------|--------|---------|
| IPv6 → IPv4 normalization | ✅ | `src/middleware/blockList.ts`, `src/middleware/signature.ts` |

---

## Breaking Changes

1. **Secret Length Requirements**: `HMAC_SECRET`, `JWT_SECRET`, and `N8N_TOKEN` now require minimum 32 characters
2. **Signature Binding**: Signatures now include the endpoint path - clients must update signature generation
3. **Timestamp Field Names**: Worker records now use snake_case (e.g., `started_at` instead of `startedAt`)
4. **JWT Issuer Required**: JWTs must include `iss: 'internal-backend'` claim

---

## New Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `CORS_ALLOWED_ORIGINS` | Comma-separated allowed origins | (all allowed) |

---

## New Files

- `Dockerfile.prod` - Production-optimized multi-stage Dockerfile
- `migrations/20241204000001-add-missing-indexes.js` - Missing database indexes

---

## Previous Patch Notes (November 28, 2025)

---

## Changes Implemented

### 1. Signature Middleware Security Enhancement
**File:** `src/middleware/signature.ts`

**Changes:**
- Switched from direct `process.env.HMAC_SECRET` to validated `env.HMAC_SECRET` for runtime validation and consistent error handling
- Strengthened replay attack protection by including a hash of the raw request body in the replay guard key
- Previous key format: `sha256(timestamp:signature)`
- New key format: `sha256(timestamp:signature:bodyHash)`

**Impact:** Eliminates replay attack collisions where different request bodies could potentially share the same replay key.

---

### 2. Queue Job ID Propagation
**File:** `src/queue/index.ts`

**Changes:**
- Updated `EnqueueResult` type to include `id?: string` field
- The `enqueue()` function now properly forwards `id` and `reason` from the processor result
- Controllers can now access the job ID for tracking and logging purposes

**Impact:** Enables better job tracking and debugging capabilities across the system.

---

### 3. Graceful Worker Shutdown
**File:** `src/workers/index.ts`

**Changes:**
- Added proper signal handlers for `SIGTERM` and `SIGINT`
- Implements graceful shutdown sequence:
  1. Stop all BullMQ workers
  2. Close MongoDB connection
  3. Exit cleanly
- Removed the infinite `setInterval` keepalive in favor of proper process management

**Impact:** Ensures clean shutdown in Docker/Kubernetes environments, preventing data corruption and connection leaks.

---

### 4. Persistent Redis Health Check Client
**File:** `src/controllers/healthController.ts`

**Changes:**
- Redis client is now reused across health check requests instead of connect/quit per request
- Only reconnects if the client status is not "ready"
- Client is only reset on connection errors

**Impact:** Reduces resource churn and prevents health check flapping under frequent polling scenarios.

---

### 5. Explicit Boolean Environment Defaults
**File:** `src/config/env.ts`

**Changes:**
- Added explicit `.default('false')` for all boolean environment flags:
  - `OTP_SEND_ON_GENERATE`
  - `ENABLE_WORKERS`
  - `ENABLE_IDEMPOTENCY_MW`
  - `ENABLE_REFUNDS`

**Impact:** Prevents undefined boolean values at runtime; ensures predictable behavior when environment variables are not explicitly set.

---

### 6. Date Field Naming Normalization
**Files Modified:**
- `src/controllers/userController.ts`
- `src/workers/ocrProcessor.ts`
- `src/workers/messagingRetry.ts`
- `src/workers/refundExecutor.ts`
- `src/workers/cleanupDaily.ts`

**Changes:**
All date fields standardized to camelCase to match MongoDB index definitions:

| Old Field | New Field |
|-----------|-----------|
| `created_at` | `createdAt` |
| `updated_at` | `updatedAt` |
| `delivered_at` | `deliveredAt` |
| `completed_at` | `completedAt` |
| `started_at` | `startedAt` |
| `failed_at` | `failedAt` |
| `refunded_at` | `refundedAt` |
| `ocr_started_at` | `ocrStartedAt` |
| `ocr_completed_at` | `ocrCompletedAt` |
| `last_retry_at` | `lastRetryAt` |
| `last_error` | `lastError` |

**Impact:** Ensures TTL indexes and query indexes work correctly; eliminates field naming inconsistencies.

---

### 7. Enhanced Idempotency Tests
**File:** `tests/idempotency.test.ts`

**Changes:**
- Added test for JSON response truncation detection (>16KB)
- Added test for text response truncation handling
- Added test for unique hash generation across different requests
- Improved test organization with shared constants

**Impact:** Better test coverage for edge cases in the idempotency middleware.

---

## Verification Completed

| Check | Status |
|-------|--------|
| No duplicate module exports | ✅ Verified |
| No linter errors | ✅ Verified |
| Date fields match index definitions | ✅ Verified |
| All boolean flags have defaults | ✅ Verified |

---

## Files Modified

```
src/middleware/signature.ts
src/queue/index.ts
src/workers/index.ts
src/controllers/healthController.ts
src/config/env.ts
src/controllers/userController.ts
src/workers/ocrProcessor.ts
src/workers/messagingRetry.ts
src/workers/refundExecutor.ts
src/workers/cleanupDaily.ts
tests/idempotency.test.ts
```

---

## Recommendations for Testing

1. **Signature Verification:** Test webhook endpoints with valid signatures to ensure replay detection works correctly
2. **Worker Shutdown:** Test `docker stop` or `kill -SIGTERM` to verify graceful shutdown
3. **Health Endpoint:** Call `/health` multiple times rapidly to verify Redis client persistence
4. **Queue Jobs:** Verify job IDs are returned in controller responses where applicable

---

## No Changes Made To

- `src/lib/hmac.ts` - No changes needed (already correct)
- `openapi.yaml` - Optional enhancement (not in scope)
- `Dockerfile` / `docker-compose.yml` - No changes required
- `src/queue/processor.ts` - Already correctly structured
- `src/queue/worker.ts` - Already has proper shutdown handlers



