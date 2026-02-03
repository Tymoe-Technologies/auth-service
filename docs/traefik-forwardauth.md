# Traefik ForwardAuth Integration

This document describes the Traefik ForwardAuth endpoint implementation for the auth-service.

## Overview

The `gateway-check` endpoint is designed to work with Traefik's ForwardAuth middleware. It verifies JWT tokens and returns custom headers that Traefik forwards to downstream microservices.

## Endpoint

```
GET /api/auth-service/v1/auth/gateway-check
```

### Authentication

Required: Bearer token in Authorization header

```
Authorization: Bearer <access_token>
```

### Response

#### Success (200 OK)

No response body. Custom headers are set for Traefik to forward:

**Standard Headers (always present):**
- `X-User-Id`: Subject ID from token (user ID or account ID)
- `X-User-Type`: Either `USER` or `ACCOUNT`
- `X-User-Role`: Role from organization (e.g., `USER`, `OWNER`, `MANAGER`, `STAFF`)
- `X-Org-Id`: Primary organization ID
- `X-Org-Name`: Primary organization name
- `X-Product-Type`: Product type of the organization

**USER-specific Headers:**
- `X-User-Email`: User's email address
- `X-All-Org-Ids`: Comma-separated list of all organization IDs
- `X-All-Org-Names`: Comma-separated list of all organization names
- `X-All-Product-Types`: Comma-separated list of all product types

**ACCOUNT-specific Headers:**
- `X-Username`: Account username
- `X-Employee-Number`: Employee number (if available)
- `X-Account-Type`: Account type (OWNER, MANAGER, or STAFF)

**Optional Headers:**
- `X-Device-Id`: Device ID (for POS tokens)

#### Error (401 Unauthorized)

Token is invalid, expired, or missing.

```json
{
  "error": "invalid_token",
  "detail": "..."
}
```

## Traefik Configuration Example

### docker-compose.yml

```yaml
services:
  traefik:
    image: traefik:v2.10
    command:
      - "--api.insecure=true"
      - "--providers.docker=true"
      - "--providers.docker.exposedbydefault=false"
      - "--entrypoints.web.address=:80"
    ports:
      - "80:80"
      - "8080:8080"
    volumes:
      - "/var/run/docker.sock:/var/run/docker.sock:ro"

  auth-service:
    image: your-auth-service:latest
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.auth.rule=Host(`auth.example.com`)"
      - "traefik.http.services.auth.loadbalancer.server.port=3000"

  subscription-service:
    image: your-subscription-service:latest
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.subscription.rule=Host(`api.example.com`) && PathPrefix(`/subscription`)"
      - "traefik.http.services.subscription.loadbalancer.server.port=8080"
      # ForwardAuth configuration
      - "traefik.http.routers.subscription.middlewares=auth-check"
      - "traefik.http.middlewares.auth-check.forwardauth.address=http://auth-service:3000/api/auth-service/v1/auth/gateway-check"
      - "traefik.http.middlewares.auth-check.forwardauth.authResponseHeaders=X-User-Id,X-User-Type,X-User-Role,X-Org-Id,X-Org-Name,X-Product-Type,X-All-Org-Ids,X-Username,X-Account-Type,X-Device-Id"
```

### traefik.yml (File Configuration)

```yaml
http:
  middlewares:
    auth-check:
      forwardAuth:
        address: "http://auth-service:3000/api/auth-service/v1/auth/gateway-check"
        authResponseHeaders:
          - "X-User-Id"
          - "X-User-Type"
          - "X-User-Role"
          - "X-Org-Id"
          - "X-Org-Name"
          - "X-Product-Type"
          - "X-All-Org-Ids"
          - "X-All-Org-Names"
          - "X-All-Product-Types"
          - "X-User-Email"
          - "X-Username"
          - "X-Account-Type"
          - "X-Employee-Number"
          - "X-Device-Id"
        trustForwardHeader: true

  routers:
    subscription-service:
      rule: "Host(`api.example.com`) && PathPrefix(`/subscription`)"
      service: subscription-service
      middlewares:
        - auth-check

  services:
    subscription-service:
      loadBalancer:
        servers:
          - url: "http://subscription-service:8080"
```

## How Downstream Services Use the Headers

In your downstream microservices, you can extract the authenticated user information from the headers:

### Go Example

```go
func handler(w http.ResponseWriter, r *http.Request) {
    userID := r.Header.Get("X-User-Id")
    userType := r.Header.Get("X-User-Type")
    role := r.Header.Get("X-User-Role")
    orgID := r.Header.Get("X-Org-Id")

    if userType == "USER" {
        allOrgIDs := strings.Split(r.Header.Get("X-All-Org-Ids"), ",")
        // Handle multi-org access
    }

    // Your business logic here
}
```

### Node.js/Express Example

```javascript
app.get('/subscription', (req, res) => {
  const userId = req.headers['x-user-id'];
  const userType = req.headers['x-user-type'];
  const role = req.headers['x-user-role'];
  const orgId = req.headers['x-org-id'];

  if (userType === 'USER') {
    const allOrgIds = req.headers['x-all-org-ids']?.split(',') || [];
    // Handle multi-org access
  }

  // Your business logic here
});
```

### Python/Flask Example

```python
from flask import request

@app.route('/subscription')
def subscription():
    user_id = request.headers.get('X-User-Id')
    user_type = request.headers.get('X-User-Type')
    role = request.headers.get('X-User-Role')
    org_id = request.headers.get('X-Org-Id')

    if user_type == 'USER':
        all_org_ids = request.headers.get('X-All-Org-Ids', '').split(',')
        # Handle multi-org access

    # Your business logic here
```

## Security Considerations

1. **Internal Network Only**: The gateway-check endpoint should only be accessible from within your internal network (Traefik container network). Do not expose it publicly.

2. **Rate Limiting**: Apply rate limiting at the Traefik level to prevent abuse:

```yaml
- "traefik.http.middlewares.rate-limit.ratelimit.average=100"
- "traefik.http.middlewares.rate-limit.ratelimit.burst=50"
- "traefik.http.routers.subscription.middlewares=rate-limit,auth-check"
```

3. **Trust Headers**: Downstream services should TRUST the headers since they come from Traefik after successful authentication. Do not re-verify the token in downstream services.

4. **HTTPS**: Use HTTPS in production for all external traffic.

## Testing

### Manual Test with curl

```bash
# 1. Get an access token first
ACCESS_TOKEN=$(curl -X POST http://localhost:3000/oauth/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=password&username=user@example.com&password=password&client_id=your-client-id" \
  | jq -r '.access_token')

# 2. Test the gateway-check endpoint
curl -v http://localhost:3000/api/auth-service/v1/auth/gateway-check \
  -H "Authorization: Bearer $ACCESS_TOKEN"

# Expected output: HTTP 200 OK with headers
```

### Integration Test

Create a test script to verify the integration:

```bash
#!/bin/bash

# Test gateway-check endpoint
response=$(curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  http://localhost:3000/api/auth-service/v1/auth/gateway-check)

http_code=$(echo "$response" | tail -n1)

if [ "$http_code" = "200" ]; then
    echo "✅ Gateway check passed"
else
    echo "❌ Gateway check failed with status $http_code"
    exit 1
fi
```

## Migration Notes

- No existing routes are modified
- The endpoint is additive only
- Existing authentication flows remain unchanged
- Can be deployed alongside existing auth mechanisms

## Performance Considerations

- The endpoint reuses existing JWT verification middleware (`requireBearer`)
- No additional database queries (claims are already verified)
- Minimal overhead: ~1-2ms per request
- Suitable for high-throughput scenarios

## Monitoring

Monitor the following metrics:
- Request rate to `/auth/gateway-check`
- 401 error rate (invalid tokens)
- Response time (should be < 5ms)
- Redis availability (for blacklist checks)
