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
- `X-User-Type`: `USER`, `ACCOUNT`, or `CONSUMER`
- `X-User-Role`: Role from organization (e.g., `USER`, `OWNER`, `MANAGER`, `STAFF`)
- `X-Org-Id`: Primary organization ID
- `X-Org-Name`: Primary organization name

**USER-specific Headers:**
- `X-User-Email`: User's email address
- `X-All-Org-Ids`: Comma-separated list of all organization IDs
- `X-All-Org-Names`: Comma-separated list of all organization names

**ACCOUNT-specific Headers:**
- `X-Username`: Account username
- `X-Employee-Number`: Employee number (if available)
- `X-Account-Type`: Account type (OWNER, MANAGER, or STAFF)

**CONSUMER-specific Headers:**
- `X-User-Phone`: Consumer's phone number

**Optional Headers:**
- `X-Device-Id`: Device ID (for POS tokens)

> `X-Product-Type` is intentionally **not** emitted. `productType` was removed from
> the top-level USER token payload (see CLAUDE.md, 2025-10-11 entry) — it now lives
> per-organization inside `organizations[].productType` / `organization.productType`
> and downstream services should look it up from there rather than a gateway header.

#### Error (401 Unauthorized)

Token is invalid, expired, or missing.

```json
{
  "error": "invalid_token",
  "detail": "..."
}
```

## Traefik configuration reference

```yaml
labels:
  - "traefik.http.middlewares.auth-check.forwardauth.address=http://auth-service:3000/api/auth-service/v1/auth/gateway-check"
  - "traefik.http.middlewares.auth-check.forwardauth.trustForwardHeader=true"
  - "traefik.http.middlewares.auth-check.forwardauth.authResponseHeaders=X-User-Id,X-User-Type,X-User-Role,X-Org-Id,X-Org-Name,X-All-Org-Ids,X-All-Org-Names,X-User-Email,X-Username,X-Employee-Number,X-Account-Type,X-User-Phone,X-Device-Id"
```
