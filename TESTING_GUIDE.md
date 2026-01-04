# Testing Guide

## Prerequisites

```bash
# 1. Start MongoDB
docker run -d -p 27017:27017 --name mongo mongo:7

# 2. Create .env from template
cp env.example .env

# 3. Generate secrets
echo "HMAC_SECRET=$(openssl rand -hex 32)" >> .env
echo "JWT_SECRET=$(openssl rand -hex 32)" >> .env
# (Optional) Enable idempotency middleware to test header-based caching
# echo "ENABLE_IDEMPOTENCY_MW=true" >> .env

# 4. Start backend
npm run dev
# Server running at http://localhost:3000
```

---

## Test 1: Health Check (Unauthenticated)

```bash
curl -X GET http://localhost:3000/health
```

**Expected Response:**
```json
{
  "status": "healthy",
  "timestamp": "2024-11-17T23:45:00.000Z",
  "uptime": 123.45,
  "checks": {
    "database": "connected"
  }
}
```

---

## Test 2: Webhook Entry (External System)

### Generate HMAC Signature

```bash
# In Node.js REPL or script:
const crypto = require('crypto');
const secret = 'your_hmac_secret_from_env';
const payload = JSON.stringify({
  source: "partner_api",
  user_id: "user_12345",
  action: "subscription_created",
  amount: 99.99,
  email: "user@example.com"
});
const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex');
console.log('sha256=' + signature);
```

### Send Signed Request

```bash
HMAC_SECRET="your_hmac_secret_from_env"
PAYLOAD='{"source":"partner_api","user_id":"user_12345","action":"subscription_created","amount":99.99,"email":"user@example.com"}'
SIGNATURE=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "$HMAC_SECRET" | awk '{print $2}')

curl -X POST http://localhost:3000/webhook/entry \
  -H "Content-Type: application/json" \
  -H "X-Signature: sha256=$SIGNATURE" \
  -H "X-Timestamp: $(date -u +%s)" \
  -d "$PAYLOAD"
```

**Expected Response:**
```json
{
  "status": "accepted",
  "internal_event_id": "abc123..."
}
```

### Test Failure Cases

```bash
# Missing signature → 401
curl -X POST http://localhost:3000/webhook/entry \
  -H "Content-Type: application/json" \
  -d '{"source":"test"}'

# Invalid signature → 401
curl -X POST http://localhost:3000/webhook/entry \
  -H "Content-Type: application/json" \
  -H "X-Signature: sha256=invalid" \
  -H "X-Timestamp: $(date -u +%s)" \
  -d '{"source":"test"}'

# Missing required field → 400
PAYLOAD='{"source":"test"}'
SIGNATURE=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "$HMAC_SECRET" | awk '{print $2}')
curl -X POST http://localhost:3000/webhook/entry \
  -H "Content-Type: application/json" \
  -H "X-Signature: sha256=$SIGNATURE" \
  -H "X-Timestamp: $(date -u +%s)" \
  -d "$PAYLOAD"
```

---

## Test 3: Verify Entitlement (Internal, High-Risk Actions)

```bash
JWT_TOKEN="your_n8n_token_from_env"

curl -X POST http://localhost:3000/verify/entitlement \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "X-Correlation-Id: test-123" \
  -d '{
    "internal_event_id": "evt_abc123",
    "user_id": "user_12345",
    "action": "credit_account",
    "amount": 100.00
  }'
```

**Expected Response:**
```json
{
  "allowed": true,
  "audit_id": "aud_xyz789"
}
```

**Verify Audit Log:**
```bash
# Connect to MongoDB
mongosh mongodb://localhost:27017/n8n_backend

# Query audit logs
db.audit_logs.find({ internal_event_id: "evt_abc123" }).pretty()
```

---

## Test 4: OTP Generate & Verify

### Generate OTP

```bash
JWT_TOKEN="your_n8n_token_from_env"

curl -X POST http://localhost:3000/otp/generate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -d '{
    "subject_type": "user_login",
    "subject_id": "user_12345",
    "channel": "sms"
  }'
```

**Expected Response:**
```json
{
  "otp_id": "otp_abc123...",
  "expiresAt": "2024-11-17T23:55:00.000Z"
}
```

**Note:** The actual OTP code would be sent via `/services/messaging/send`. For testing, query MongoDB:

```javascript
// In mongosh:
db.otps.findOne({ otp_id: "otp_abc123..." })
// Hash is stored, not the raw code
```

### Verify OTP

```bash
curl -X POST http://localhost:3000/otp/verify \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -d '{
    "otp_id": "otp_abc123...",
    "code": "123456"
  }'
```

**Expected Response (Valid):**
```json
{
  "valid": true
}
```

**Expected Response (Invalid):**
```json
{
  "valid": false,
  "attemptsRemaining": 2
}
```

---

## Test 5: Messaging Service

### Send SMS

```bash
JWT_TOKEN="your_n8n_token_from_env"

curl -X POST http://localhost:3000/services/messaging/send \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -d '{
    "channel": "sms",
    "to": "+61411111111",
    "template_id": "otp_verification",
    "params": {
      "code": "123456",
      "expiryMinutes": 10
    },
    "fallback": {
      "channel": "email",
      "to": "user@example.com"
    }
  }'
```

**Expected Response:**
```json
{
  "message_id": "msg_abc123",
  "channel_used": "sms",
  "provider_message_id": "SM1234567890"
}
```

### Send Email

```bash
curl -X POST http://localhost:3000/services/messaging/send \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -d '{
    "channel": "email",
    "to": "user@example.com",
    "template_id": "welcome_email",
    "params": {
      "firstName": "John",
      "activationLink": "https://example.com/activate/xyz"
    }
  }'
```

### Send Slack Alert

```bash
curl -X POST http://localhost:3000/services/messaging/send \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -d '{
    "channel": "slack",
    "to": "#engineering-alerts",
    "template_id": "system_alert",
    "params": {
      "severity": "high",
      "message": "Database connection lost",
      "timestamp": "2024-11-17T23:45:00Z"
    }
  }'
```

---

## Test 6: Storage Upsert

### Create New Record

```bash
JWT_TOKEN="your_n8n_token_from_env"

curl -X POST http://localhost:3000/services/storage/upsert \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -d '{
    "collection": "users",
    "match": { "email": "john@example.com" },
    "update": {
      "$set": {
        "name": "John Doe",
        "status": "active",
        "createdAt": "2024-11-17T23:45:00Z"
      }
    },
    "options": { "upsert": true }
  }'
```

**Expected Response (New):**
```json
{
  "upserted_id": "507f1f77bcf86cd799439011",
  "matched_count": 0
}
```

**Expected Response (Updated):**
```json
{
  "matched_count": 1,
  "modified_count": 1
}
```

### Verify in MongoDB

```javascript
// In mongosh:
db.users.findOne({ email: "john@example.com" })
```

---

## Test 7: Admin Alerts

```bash
JWT_TOKEN="your_n8n_token_from_env"

curl -X POST http://localhost:3000/alert/admin \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -d '{
    "severity": "critical",
    "message": "Payment gateway timeout after 3 retries",
    "context": {
      "internal_event_id": "evt_abc123",
      "user_id": "user_12345",
      "amount": 99.99,
      "error": "ETIMEDOUT"
    }
  }'
```

**Expected Response:**
```json
{
  "alert_id": "alert_xyz789",
  "sent_to": ["slack", "email"]
}
```

**Verify:**
- Check Slack channel for alert message
- Check admin email inbox

---

## Test 8: Metrics (Prometheus)

```bash
curl -X GET http://localhost:3000/metrics
```

**Expected Response:**
```
# HELP http_requests_total Total HTTP requests
# TYPE http_requests_total counter
http_requests_total{method="POST",route="/webhook/entry",status="200"} 5

# HELP http_request_duration_seconds HTTP request latency
# TYPE http_request_duration_seconds histogram
http_request_duration_seconds_bucket{le="0.1"} 10
http_request_duration_seconds_bucket{le="0.5"} 15
http_request_duration_seconds_sum 2.5
http_request_duration_seconds_count 20

# HELP idempotency_hits_total Duplicate events detected
# TYPE idempotency_hits_total counter
idempotency_hits_total 2

# ... more metrics
```

---

## Test 9: Idempotency

```bash
# A) Deduplication (no header) — ensures single processing by internal_event_id
PAYLOAD='{"source":"test_idem","user_id":"user_99","action":"test"}'
SIGNATURE=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "$HMAC_SECRET" | awk '{print $2}')

curl -s -X POST http://localhost:3000/webhook/entry \
  -H "Content-Type: application/json" \
  -H "X-Signature: sha256=$SIGNATURE" \
  -H "X-Timestamp: $(date -u +%s)" \
  -d "$PAYLOAD" | tee /tmp/resp1.json

curl -s -X POST http://localhost:3000/webhook/entry \
  -H "Content-Type: application/json" \
  -H "X-Signature: sha256=$SIGNATURE" \
  -H "X-Timestamp: $(date -u +%s)" \
  -d "$PAYLOAD" | tee /tmp/resp2.json

# B) Idempotency header (requires ENABLE_IDEMPOTENCY_MW=true)
IDEMP_KEY="test-key-$(date +%s)"
curl -s -X POST http://localhost:3000/webhook/entry \
  -H "Content-Type: application/json" \
  -H "X-Signature: sha256=$SIGNATURE" \
  -H "X-Timestamp: $(date -u +%s)" \
  -H "X-Idempotency-Key: $IDEMP_KEY" \
  -d "$PAYLOAD" | tee /tmp/idem1.json

curl -s -D - -o /tmp/idem2_body.json -X POST http://localhost:3000/webhook/entry \
  -H "Content-Type: application/json" \
  -H "X-Signature: sha256=$SIGNATURE" \
  -H "X-Timestamp: $(date -u +%s)" \
  -H "X-Idempotency-Key: $IDEMP_KEY" \
  -d "$PAYLOAD"

# Expect: second request has header "Idempotency-Replayed: true" and same body/status
```

**Verify in MongoDB:**
```javascript
db.processed_events.find({ internal_event_id: /test_idem/ }).count()
// Should return 1, not 2
db.idempotency_keys.find().sort({createdAt:-1}).limit(1)
// Should show stored response if ENABLE_IDEMPOTENCY_MW=true
```

---

## Test 10: Rate Limiting

```bash
# Hammer endpoint from same IP
for i in {1..120}; do
  curl -s -o /dev/null -w "%{http_code}\n" \
    -X POST http://localhost:3000/webhook/entry \
    -H "Content-Type: application/json" \
    -H "X-Signature: sha256=fake" \
    -d '{"test":true}'
done
```

**Expected Results:**
- First 100 requests: `401` (invalid signature, but not rate limited)
- Requests 101-120: `429` (Too Many Requests)

---

## Test 11: CIDR Allowlist (Internal Auth)

### From Allowed IP

```bash
# Add your IP to INTERNAL_ALLOWLIST in .env
# Example: INTERNAL_ALLOWLIST=127.0.0.1/32,10.0.0.0/8

curl -X POST http://localhost:3000/verify/entitlement \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"internal_event_id":"test","user_id":"user1","action":"test"}'
# → 200 OK
```

### From Blocked IP

```bash
# Use VPN or different network NOT in allowlist
curl -X POST http://localhost:3000/verify/entitlement \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"internal_event_id":"test","user_id":"user1","action":"test"}'
# → 403 Forbidden
```

---

## Integration Test: End-to-End Flow

```bash
#!/bin/bash
set -e

HMAC_SECRET="your_secret"
JWT_TOKEN="your_token"
BASE_URL="http://localhost:3000"

echo "=== E2E Test: User Subscription Flow ==="

# 1. External webhook arrives
echo "[1/6] Sending webhook..."
PAYLOAD='{"source":"stripe","user_id":"user_999","action":"subscription_created","amount":99.99,"email":"newuser@example.com"}'
SIGNATURE=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "$HMAC_SECRET" | awk '{print $2}')

WEBHOOK_RESPONSE=$(curl -s -X POST $BASE_URL/webhook/entry \
  -H "Content-Type: application/json" \
  -H "X-Signature: sha256=$SIGNATURE" \
  -d "$PAYLOAD")

EVENT_ID=$(echo $WEBHOOK_RESPONSE | jq -r '.internal_event_id')
echo "✓ Event ID: $EVENT_ID"

# 2. n8n Workflow A validates and stores
echo "[2/6] Storing user data..."
curl -s -X POST $BASE_URL/services/storage/upsert \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "collection": "users",
    "match": { "user_id": "user_999" },
    "update": {
      "$set": {
        "email": "newuser@example.com",
        "subscription_status": "active",
        "amount": 99.99,
        "internal_event_id": "'$EVENT_ID'"
      }
    },
    "options": { "upsert": true }
  }' > /dev/null
echo "✓ User data stored"

# 3. n8n Workflow B checks entitlement for credit grant
echo "[3/6] Verifying entitlement..."
VERIFY_RESPONSE=$(curl -s -X POST $BASE_URL/verify/entitlement \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "internal_event_id": "'$EVENT_ID'",
    "user_id": "user_999",
    "action": "grant_premium_credits",
    "amount": 1000
  }')

ALLOWED=$(echo $VERIFY_RESPONSE | jq -r '.allowed')
if [ "$ALLOWED" != "true" ]; then
  echo "✗ Verification failed!"
  exit 1
fi
echo "✓ Entitlement verified"

# 4. n8n Workflow C sends welcome email
echo "[4/6] Generating welcome OTP..."
OTP_RESPONSE=$(curl -s -X POST $BASE_URL/otp/generate \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "subject_type": "email_verification",
    "subject_id": "user_999",
    "channel": "email"
  }')

OTP_ID=$(echo $OTP_RESPONSE | jq -r '.otp_id')
echo "✓ OTP ID: $OTP_ID"

echo "[5/6] Sending welcome email..."
curl -s -X POST $BASE_URL/services/messaging/send \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "channel": "email",
    "to": "newuser@example.com",
    "template_id": "welcome",
    "params": {
      "otp_id": "'$OTP_ID'",
      "amount": 99.99
    }
  }' > /dev/null
echo "✓ Email sent"

# 5. Alert admins
echo "[6/6] Sending admin summary..."
curl -s -X POST $BASE_URL/alert/admin \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "severity": "info",
    "message": "New subscription: user_999",
    "context": {
      "internal_event_id": "'$EVENT_ID'",
      "amount": 99.99
    }
  }' > /dev/null
echo "✓ Admin notified"

echo ""
echo "=== E2E Test Complete ==="
echo "Event ID: $EVENT_ID"
echo "Check MongoDB for audit logs and user record"
```

**Run:**
```bash
chmod +x e2e_test.sh
./e2e_test.sh
```

---

## Performance Test: Load Testing

```bash
# Install Apache Bench or use this simple script
#!/bin/bash

CONCURRENCY=10
REQUESTS=1000
HMAC_SECRET="your_secret"
PAYLOAD='{"source":"load_test","user_id":"user_load","action":"test"}'
SIGNATURE=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "$HMAC_SECRET" | awk '{print $2}')

# Create request file for ab
cat > request.txt <<EOF
POST /webhook/entry HTTP/1.1
Host: localhost:3000
Content-Type: application/json
X-Signature: sha256=$SIGNATURE
Content-Length: ${#PAYLOAD}

$PAYLOAD
EOF

# Run load test
ab -n $REQUESTS -c $CONCURRENCY -p request.txt -T application/json \
  http://localhost:3000/webhook/entry

# Check metrics
curl -s http://localhost:3000/metrics | grep http_requests_total
```

---

## Troubleshooting

### Issue: "HMAC verification failed"
```bash
# Verify HMAC_SECRET matches in .env and test script
# Check raw body is used (not parsed JSON)
# Ensure no whitespace in signature calculation
```

### Issue: "MongoDB connection failed"
```bash
# Check MongoDB is running
docker ps | grep mongo

# Test connection
mongosh mongodb://localhost:27017/n8n_backend
```

### Issue: "JWT token invalid"
```bash
# Check JWT_SECRET in .env matches N8N_TOKEN
# Ensure Authorization header format: "Bearer <token>"
# Check INTERNAL_ALLOWLIST includes your IP
```

### Issue: "Rate limit exceeded"
```bash
# Wait 1 minute for rate limit window to reset
# Or increase RATE_LIMIT_PER_MINUTE in .env
# Or clear rate limit store (restart server in dev mode)
```

### Issue: "OTP verification fails"
```bash
# OTPs expire in 10 minutes
# Max 3 attempts per OTP
# Generate new OTP if locked out
# Check MongoDB: db.otps.find({ otp_id: "..." })
```

---

## Monitoring During Tests

### Tail Logs
```bash
tail -f logs/combined-*.log
tail -f logs/error-*.log
```

### Watch Metrics
```bash
watch -n 2 'curl -s http://localhost:3000/metrics | grep -E "(http_requests_total|idempotency_hits|messaging_sent)"'
```

### Monitor MongoDB
```javascript
// In mongosh with watch
use n8n_backend
db.processed_events.watch()
db.audit_logs.watch()
```

---

## Next Steps

1. **Run all tests above** to verify backend functionality
2. **Create n8n workflows** using these endpoints
3. **Configure production .env** with real credentials
4. **Set up monitoring** (Prometheus + Grafana)
5. **Deploy to staging** and run E2E tests
6. **Security audit** before production launch

For production deployment guide, see `README.md` and `IMPLEMENTATION_STATUS.md`.

