# Auth Service v2.2.0

> **Enterprise-grade Identity Authentication & Authorization Service** - Multi-tenant Identity Management Center based on OAuth2/OpenID Connect

## 📋 Table of Contents

- [System Overview](#system-overview)
- [Core Features](#core-features)
- [Quick Start](#quick-start)
- [API Endpoints Overview](#api-endpoints-overview)
- [Database Architecture](#database-architecture)
- [Authentication & Authorization](#authentication--authorization)
- [Configuration Guide](#configuration-guide)
- [Deployment Guide](#deployment-guide)
- [Development Guide](#development-guide)
- [Troubleshooting](#troubleshooting)

## 🎯 System Overview

Auth Service is an enterprise-grade identity authentication and authorization service that provides unified identity management and access control for all business services in the ecosystem (Beauty SaaS, Catering SaaS, etc.).

### Version Information

- **Current Version**: v2.2.0
- **Service Address**: https://tymoe.com
- **API Base Path**: `/api/auth-service/v1`
- **Protocol Standards**: OAuth 2.0 + OpenID Connect 1.0

### Technology Stack

- **Runtime**: Node.js 23.1.0 + TypeScript
- **Framework**: Express.js
- **Database**: PostgreSQL + Prisma ORM
- **Cache**: Redis
- **Authentication**: JWT (RS256) + OAuth2/OIDC
- **Email**: NodeMailer (SMTP)
- **Monitoring**: Prometheus Metrics
- **Security**: Helmet, CORS, Rate Limiting, CAPTCHA

### System Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      Frontend Layer                      │
│   (Beauty SaaS)  (Catering SaaS)  (Admin)  (Mobile App)  │
└────────────────────┬────────────────────────────────────┘
                     │
                     ↓
┌─────────────────────────────────────────────────────────┐
│               Auth Service (8080)                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐  │
│  │ Identity │  │   OAuth  │  │  Orgs    │  │  Admin  │  │
│  │   API    │  │   API    │  │   API    │  │   API   │  │
│  └──────────┘  └──────────┘  └──────────┘  └─────────┘  │
└────────────────────┬────────────────────────────────────┘
                     │
        ┌────────────┼────────────┐
        ↓            ↓            ↓
┌──────────┐  ┌──────────┐  ┌──────────┐
│PostgreSQL│  │  Redis   │  │   SMTP   │
│  (Data)  │  │ (Cache)  │  │ (Email)  │
└──────────┘  └──────────┘  └──────────┘
```

## 🚀 Core Features

### 1. User Identity Management (Identity API)

- ✅ User registration and email verification
- ✅ User login (supports CAPTCHA, account lockout protection)
- ✅ Password reset
- ✅ Token refresh and revocation
- ✅ User profile query and update

### 2. Multi-tenant Organization Management (Organizations API)

- ✅ Organization CRUD (supports MAIN, BRANCH, FRANCHISE types)
- ✅ Account management (OWNER, MANAGER, STAFF roles)
- ✅ Device management (POS, KIOSK, TABLET types)
- ✅ Support for 15 product types (beauty_salon, hair_salon, spa, restaurant, fast_food, cafe, beverage, home_studio, fitness, yoga_studio, retail, chinese_restaurant, clinic, liquor_store, other)
- ✅ Organization tree structure management

### 3. OAuth2/OIDC Standard Protocol

- ✅ Authorization Code Flow (PKCE)
- ✅ Client Credentials Flow
- ✅ Token issuance and verification
- ✅ Token introspection
- ✅ Token revocation
- ✅ JWKS public key publishing
- ✅ UserInfo endpoint

### 4. Device Authentication (Device Authentication)

- ✅ Device registration and activation
- ✅ Device key management
- ✅ Device token issuance
- ✅ Device status management

### 5. Admin API (Admin API)

- ✅ System health check
- ✅ System statistics and configuration query
- ✅ Audit log query
- ✅ Force logout (User/Account/Device)
- ✅ Unlock user account
- ✅ Cache clearing
- ✅ Active token query
- ✅ **JWT key rotation** (new in 6.11)

### 6. Security Protection

- ✅ Redis rate limiting (login, registration, password reset)
- ✅ Login failure lockout mechanism
- ✅ Google reCAPTCHA v2 support
- ✅ CSRF protection
- ✅ CORS configuration
- ✅ Helmet security headers
- ✅ JWT blacklist mechanism

## 🎮 Quick Start

### Local Development Setup

```bash
# 1. Install dependencies
npm install

# 2. Configure environment variables (copy .env.example and modify)
cp .env.example .env

# 3. Database migration
npx prisma migrate deploy

# 4. Start Redis (if not running locally)
docker run -d -p 6379:6379 redis:alpine

# 5. Start the service
npm run dev          # Development mode (with hot reload)
# Or
npm run build && npm start  # Production mode
```

### Quick API Testing

```bash
# 1. User registration (no longer requires X-Product-Type header)
curl -X POST http://localhost:8080/api/auth-service/v1/identity/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "Test123!",
    "name": "Test User",
    "phone": "+8613800138000"
  }'

# 2. Email verification
curl -X POST http://localhost:8080/api/auth-service/v1/identity/verification \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "code": "123456"
  }'

# 3. User login (returns all organizations, no productType filtering)
curl -X POST http://localhost:8080/api/auth-service/v1/identity/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "Test123!"
  }'

# 3.5. Create organization (productType specified in request body)
curl -X POST http://localhost:8080/api/auth-service/v1/organizations \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "orgName": "My Beauty Salon",
    "orgType": "MAIN",
    "productType": "beauty_salon",
    "description": "Professional beauty service",
    "location": "123 Main St",
    "phone": "+8613800138000"
  }'

# 4. Get user information using Access Token
curl -X GET http://localhost:8080/api/auth-service/v1/identity/me \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"

# 5. Admin API - System health check
curl -X GET http://localhost:8080/api/auth-service/v1/admin/health \
  -H "X-Admin-Key: admin_ryan_sk_Z678YTHUJ"
```

## 📡 API Endpoints Overview

For complete API documentation, see [API Endpoint Design Document.md](./API端点设计文档.md)

### Part 1: User Identity Management (Identity API) - 14 Endpoints

| Endpoint | Method | Path                                  | Description                                      |
| -------- | ------ | ------------------------------------- | ------------------------------------------------ |
| 1.1      | POST   | `/identity/register`                  | User registration                                |
| 1.2      | POST   | `/identity/verification`              | Email verification                               |
| 1.3      | POST   | `/identity/resend`                    | Resend verification code                         |
| 1.4      | POST   | `/identity/login`                     | User login                                       |
| 1.5      | POST   | `/oauth/token`                        | Get OAuth Token                                  |
| 1.6      | POST   | `/oauth/token`                        | Refresh Token                                    |
| 1.7      | POST   | `/identity/logout`                    | User logout                                      |
| 1.8      | POST   | `/identity/forgot-password`           | Forgot password                                  |
| 1.9      | POST   | `/identity/reset-password`            | Reset password                                   |
| 1.10     | POST   | `/identity/change-password`           | Change password (logged in)                      |
| 1.11     | GET    | `/identity/profile`                   | Get current user info                            |
| 1.12     | PATCH  | `/identity/profile`                   | Update user info                                 |
| 1.13     | POST   | `/identity/change-email`              | Change email (Step 1: request verification code) |
| 1.14     | POST   | `/identity/verification-email-change` | Change email (Step 2: confirm verification code) |

### Part 2: Organization Management (Organizations API) - 5 Endpoints

| Endpoint | Method | Path                    | Description                       |
| -------- | ------ | ----------------------- | --------------------------------- |
| 2.1      | POST   | `/organizations`        | Create organization               |
| 2.2      | GET    | `/organizations`        | Get all user organizations        |
| 2.3      | GET    | `/organizations/:id`    | Get organization details          |
| 2.4      | PUT    | `/organizations/:orgId` | Update organization info          |
| 2.5      | DELETE | `/organizations/:id`    | Delete organization (soft delete) |

### Part 3: Account Management (Account API) - 13 Endpoints

| Endpoint | Method | Path                                  | Description                             |
| -------- | ------ | ------------------------------------- | --------------------------------------- |
| 3.1      | POST   | `/accounts/login`                     | Account backend login (Owner/Manager)   |
| 3.2      | POST   | `/accounts/pos-login`                 | Account POS login (Owner/Manager/STAFF) |
| 3.3      | POST   | `/oauth/token`                        | Get OAuth Token (unified endpoint) \*   |
| 3.4      | POST   | `/oauth/token`                        | Refresh Token (backend login) \*        |
| 3.5      | POST   | `/accounts/logout`                    | Account logout                          |
| 3.6      | POST   | `/accounts`                           | Create Account                          |
| 3.7      | GET    | `/accounts`                           | Get all organization accounts           |
| 3.8      | GET    | `/accounts/:accountId`                | Get account details                     |
| 3.9      | PATCH  | `/accounts/:accountId`                | Update account info                     |
| 3.10     | DELETE | `/accounts/:accountId`                | Delete account (soft delete)            |
| 3.11     | POST   | `/accounts/change-password`           | Change own password                     |
| 3.12     | POST   | `/accounts/:accountId/reset-password` | Reset account password (admin)          |
| 3.13     | POST   | `/accounts/:accountId/reset-pin`      | Reset account PIN code                  |

> **Note**: 3.3 and 3.4 are the same endpoints as 1.5 and 1.6 in Part 1

### Part 4: Device Management (Device API) - 7 Endpoints

| Endpoint | Method | Path                                        | Description                              |
| -------- | ------ | ------------------------------------------- | ---------------------------------------- |
| 4.1      | POST   | `/devices`                                  | Create device (generate activation code) |
| 4.2      | POST   | `/devices/activate`                         | Activate device                          |
| 4.3      | POST   | `/devices/:deviceId/update-activation-code` | Update device activation code            |
| 4.4      | GET    | `/devices`                                  | Get all organization devices             |
| 4.5      | GET    | `/devices/:deviceId`                        | Get device details                       |
| 4.6      | PATCH  | `/devices/:deviceId`                        | Update device info                       |
| 4.7      | DELETE | `/devices/:deviceId`                        | Delete device (soft delete)              |

### Part 5: OAuth/OIDC Standard Endpoints - 3 Endpoints

| Endpoint | Method | Path                              | Description                              |
| -------- | ------ | --------------------------------- | ---------------------------------------- |
| 5.1      | GET    | `/jwks.json`                      | Get JWT public key (JWKS)                |
| 5.2      | GET    | `/userinfo`                       | Get user info                            |
| 5.3      | POST   | `/internal/token/check-blacklist` | Check token blacklist (internal service) |

### Part 6: Admin API (Admin API) - 11 Endpoints

| Endpoint | Method | Path                                      | Description             | Auth        |
| -------- | ------ | ----------------------------------------- | ----------------------- | ----------- |
| 6.1      | GET    | `/admin/health`                           | System health check     | X-Admin-Key |
| 6.2      | GET    | `/admin/stats`                            | System statistics       | X-Admin-Key |
| 6.3      | GET    | `/admin/config`                           | System config info      | X-Admin-Key |
| 6.4      | GET    | `/admin/audit-logs`                       | Query audit logs        | X-Admin-Key |
| 6.5      | POST   | `/admin/users/:userId/force-logout`       | Force logout User       | X-Admin-Key |
| 6.6      | POST   | `/admin/accounts/:accountId/force-logout` | Force logout Account    | X-Admin-Key |
| 6.7      | POST   | `/admin/users/:userId/unlock`             | Unlock user account     | X-Admin-Key |
| 6.8      | POST   | `/admin/cache/clear`                      | Clear cache             | X-Admin-Key |
| 6.9      | GET    | `/admin/tokens/active`                    | View active tokens      | X-Admin-Key |
| 6.10     | POST   | `/admin/devices/:deviceId/force-logout`   | Force logout Device     | X-Admin-Key |
| 6.11     | POST   | `/admin/keys/rotate`                      | Rotate JWT signing keys | X-Admin-Key |

### Part 7: System Endpoints - 1 Endpoint

| Endpoint | Method | Path       | Description         |
| -------- | ------ | ---------- | ------------------- |
| 7.1      | GET    | `/healthz` | System health check |

**Total**: 54 API endpoints (52 unique endpoints)

## 🗄️ Database Architecture

### Core Data Models

```prisma
// User Table - Platform users
model User {
  id                  String    @id @default(uuid())
  email               String    @unique
  passwordHash        String
  name                String?
  phone               String?
  productType         ProductType @default(beauty)

  emailVerifiedAt     DateTime?
  loginFailureCount   Int       @default(0)
  lastLoginFailureAt  DateTime?
  lockedUntil         DateTime?

  createdAt           DateTime  @default(now())
  updatedAt           DateTime  @updatedAt

  // Relations
  ownedOrganizations  Organization[] @relation("OrganizationOwner")
}

// Organization Table - Restaurants/Shops
model Organization {
  id              String              @id @default(uuid())
  name            String
  ownerId         String
  productType     ProductType         @default(beauty)
  organizationType OrganizationType   @default(MAIN)
  parentId        String?

  location        String?
  phone           String?
  email           String?
  businessHours   Json?

  status          OrganizationStatus  @default(ACTIVE)
  createdAt       DateTime            @default(now())
  updatedAt       DateTime            @updatedAt

  // Relations
  owner           User                @relation("OrganizationOwner")
  parent          Organization?       @relation("OrgHierarchy")
  children        Organization[]      @relation("OrgHierarchy")
  accounts        Account[]
  devices         Device[]
}

// Account Table - Employee accounts within organization
model Account {
  id              String          @id @default(cuid())
  accountName     String
  passwordHash    String
  displayName     String?
  email           String?
  phone           String?

  organizationId  String
  accountType     AccountType     @default(STAFF)
  permissions     String[]

  status          AccountStatus   @default(ACTIVE)
  createdAt       DateTime        @default(now())
  updatedAt       DateTime        @updatedAt

  // Relations
  organization    Organization    @relation(fields: [organizationId])
}

// Device Table - POS terminals/tablets etc.
model Device {
  id              String          @id @default(cuid())
  deviceName      String
  deviceType      DeviceType
  serialNumber    String?         @unique
  secretHash      String

  organizationId  String
  status          DeviceStatus    @default(PENDING)

  lastAuthAt      DateTime?
  createdAt       DateTime        @default(now())
  updatedAt       DateTime        @updatedAt

  // Relations
  organization    Organization    @relation(fields: [organizationId])
}

// RefreshToken Table
model RefreshToken {
  id                  String              @id
  familyId            String

  subjectUserId       String?
  subjectAccountId    String?
  subjectDeviceId     String?

  organizationId      String?
  clientId            String

  status              RefreshTokenStatus  @default(ACTIVE)
  createdAt           DateTime            @default(now())
  expiresAt           DateTime
  lastSeenAt          DateTime            @default(now())
}

// JWT Key Table
model Key {
  kid             String      @id
  type            String      // 'RSA'
  status          KeyStatus
  privatePem      String      // Encrypted storage
  publicJwk       Json

  createdAt       DateTime    @default(now())
  activatedAt     DateTime?
  retiredAt       DateTime?
}

// Audit Log
model AuditLog {
  id              String      @id @default(uuid())
  at              DateTime    @default(now())
  ip              String?
  userAgent       String?

  actorUserId     String?
  actorAccountId  String?
  actorDeviceId   String?
  actorAdmin      String?     // Admin name

  action          String
  subject         String?
  detail          Json?
}
```

### Database Enum Types

```prisma
enum ProductType {
  beauty_salon        // Beauty salon
  hair_salon          // Hair salon
  spa                 // Spa
  restaurant          // Restaurant
  fast_food           // Fast food
  cafe                // Cafe
  beverage            // Beverage shop
  home_studio         // Home studio
  fitness             // Gym
  yoga_studio         // Yoga studio
  retail              // Retail
  chinese_restaurant  // Chinese restaurant
  clinic              // Clinic
  liquor_store        // Liquor store
  other               // Other
}

enum OrganizationType {
  MAIN      // Main branch
  BRANCH    // Branch
  FRANCHISE // Franchise
}

enum OrganizationStatus {
  ACTIVE
  SUSPENDED
  DELETED
}

enum AccountType {
  OWNER     // Owner
  MANAGER   // Manager
  STAFF     // Staff
}

enum AccountStatus {
  ACTIVE
  SUSPENDED
  DELETED
}

enum DeviceType {
  POS       // Point of Sale
  KIOSK     // Self-service kiosk
  TABLET    // Tablet
}

enum DeviceStatus {
  PENDING   // Pending activation
  ACTIVE    // Activated
  DELETED   // Deleted
}

enum RefreshTokenStatus {
  ACTIVE
  ROTATED
  REVOKED
}

enum KeyStatus {
  ACTIVE    // Currently active key
  GRACE     // Grace period (valid for 1 hour)
  RETIRED   // Retired
}
```

## 🔐 Authentication & Authorization

### 1. User Authentication Flow

**For**: Platform users (who own organizations)

```
1. User registration -> POST /identity/register
2. Email verification -> POST /identity/verify
3. User login -> POST /identity/login
   Returns: {
     "accessToken": "eyJhbGc...",
     "refreshToken": "rt_...",
     "tokenType": "Bearer",
     "expiresIn": 3600
   }
4. Use Access Token -> Authorization: Bearer eyJhbGc...
```

**Access Token Claims**:

```json
{
  "sub": "user:uuid",
  "iss": "http://localhost:8080",
  "aud": ["tymoe-service"],
  "exp": 1234567890,
  "iat": 1234564290,
  "organizationId": "org-uuid",
  "productType": "beauty",
  "type": "user"
}
```

### 2. Account Authentication Flow

**For**: Employee accounts within organization (OWNER/MANAGER/STAFF)

```
1. Account login -> POST /accounts/login
   Body: {
     "accountName": "manager001",
     "password": "password",
     "organizationId": "org-uuid"
   }
2. Returns Token (same format as User)
3. Use Token -> Authorization: Bearer eyJhbGc...
```

**Access Token Claims**:

```json
{
  "sub": "account:cuid",
  "accountType": "MANAGER",
  "organizationId": "org-uuid",
  "permissions": ["read:sales", "write:orders"],
  "productType": "beauty",
  "type": "account"
}
```

### 3. Device Authentication Flow

**For**: POS terminals, KIOSK, TABLET etc.

```
1. Register device -> POST /devices/register
2. Activate device -> POST /devices/activate (requires activation code)
3. Device authentication -> POST /devices/auth
   Body: {
     "deviceId": "device-cuid",
     "deviceSecret": "secret-hash"
   }
4. Returns short-lived JWT Token (5 minutes)
```

**Device Token Claims**:

```json
{
  "sub": "device:cuid",
  "deviceType": "POS",
  "organizationId": "org-uuid",
  "productType": "beauty",
  "type": "device",
  "exp": 1234564590 // Expires in 5 minutes
}
```

### 4. Admin API Authentication

**For**: System administrator operations

```bash
# Authenticate using X-Admin-Key header
curl -X GET http://localhost:8080/api/auth-service/v1/admin/health \
  -H "X-Admin-Key: admin_ryan_sk_Z678YTHUJ"
```

**Admin Key Format**: `admin_{name}_sk_{random}`

Configured in `.env`:

```
ADMIN_API_KEYS=admin_ryan_sk_Z678YTHUJ,admin_meng_sk_O0S8HBLAY
```

### 5. OAuth2 Client Credentials Flow

**For**: Service-to-service backend calls

```bash
# Get Client Token
curl -X POST http://localhost:8080/oauth/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -u "client-id:client-secret" \
  -d "grant_type=client_credentials&scope=read:users"
```

### 6. Token Refresh

```bash
curl -X POST http://localhost:8080/api/auth-service/v1/tokens/refresh \
  -H "Content-Type: application/json" \
  -d '{
    "refreshToken": "rt_xxx"
  }'
```

### 7. Token Revocation

```bash
# Method 1: Using business API
curl -X POST http://localhost:8080/api/auth-service/v1/tokens/revoke \
  -H "Authorization: Bearer access_token" \
  -H "Content-Type: application/json" \
  -d '{"refreshToken": "rt_xxx"}'

# Method 2: Using OAuth2 standard endpoint
curl -X POST http://localhost:8080/oauth/revoke \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "token=rt_xxx&token_type_hint=refresh_token"

# Method 3: Admin force logout
curl -X POST http://localhost:8080/api/auth-service/v1/admin/users/{userId}/force-logout \
  -H "X-Admin-Key: admin_ryan_sk_Z678YTHUJ" \
  -d '{"reason": "Security breach"}'
```

## ⚙️ Configuration Guide

### Environment Variables Configuration

Create `.env` file (reference `.env.example`):

```bash
# ==================== Basic Configuration ====================
NODE_ENV=development
PORT=8080

# ==================== Database Configuration ====================
DATABASE_URL=postgresql://user:password@host:5432/auth-service

# ==================== Redis Configuration ====================
REDIS_URL=redis://localhost:6379
REDIS_PASSWORD=
REDIS_DB=0
REDIS_NAMESPACE=authsvc_dev

# ==================== OAuth2/OIDC Configuration ====================
ISSUER_URL=http://localhost:8080
ACCESS_TOKEN_TTL_SECONDS=3600        # 1 hour
REFRESH_TOKEN_TTL_SECONDS=2592000    # 30 days

# ==================== Security Configuration ====================
SESSION_SECRET=your-session-secret-here
KEYSTORE_ENC_KEY=base64:your-keystore-encryption-key

# ==================== CORS Configuration ====================
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:3001
COOKIE_SAMESITE=lax

# ==================== Rate Limiting Configuration ====================
RATE_MAX_LOGIN_PER_HR=50
RATE_MAX_REGISTER_PER_HR=30
RATE_MAX_RESET_PER_HR=20

# ==================== Email Configuration ====================
MAIL_TRANSPORT=SMTP
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=noreply@example.com
SMTP_PASS=your-smtp-password
MAIL_FROM=Tymoe Auth <noreply@example.com>

# ==================== Verification Code Configuration ====================
VERIFY_CODE_TTL_MIN=10
RESET_CODE_TTL_MIN=10

# ==================== Login Security Configuration ====================
LOGIN_CAPTCHA_THRESHOLD=3    # Require CAPTCHA after 3 failures
LOGIN_LOCK_THRESHOLD=10      # Lock account after 10 failures
LOGIN_LOCK_MINUTES=30        # Lock for 30 minutes

# ==================== CAPTCHA Configuration ====================
CAPTCHA_ENABLED=true
CAPTCHA_SITE_KEY=your-recaptcha-site-key
CAPTCHA_SECRET_KEY=your-recaptcha-secret-key

# ==================== Device Authentication Configuration ====================
DEVICE_SECRET_LENGTH=32
DEVICE_JWT_TTL_SEC=300       # Device token expires in 5 minutes

# ==================== Internal Service Configuration ====================
INTROSPECT_CLIENT_ID=internal-gateway
INTROSPECT_CLIENT_SECRET=your-client-secret
INTERNAL_SERVICE_KEY=your-internal-service-key

# ==================== Admin API Configuration ====================
ADMIN_API_KEYS=admin_alice_sk_ABC123,admin_bob_sk_XYZ789

# ==================== Multi-tenant Configuration ====================
DEFAULT_TENANT_ID=tenant-dev
ALLOWED_AUDIENCES=tymoe-service,tymoe-web

# ==================== Monitoring Configuration ====================
METRICS_TOKEN=your-metrics-token

# ==================== Audit Configuration ====================
AUDIT_TO_FILE=true
AUDIT_FILE_PATH=./logs/audit.log
```

### JWT Key Management

#### Key Initialization

RSA key pair is automatically generated on first service startup and stored in database:

```
🔐 Initializing JWT signing keys...
✅ JWT signing keys ready
```

#### Key Rotation (New in v2.1.1)

**Rotate keys via Admin API** (recommended):

```bash
curl -X POST http://localhost:8080/api/auth-service/v1/admin/keys/rotate \
  -H "X-Admin-Key: admin_ryan_sk_Z678YTHUJ" \
  -H "Content-Type: application/json" \
  -d '{
    "reason": "Quarterly security rotation"
  }'
```

**Response Example**:

```json
{
  "success": true,
  "message": "JWT signing keys rotated successfully",
  "data": {
    "newKeyId": "kid-1760076965719",
    "oldKeyId": "kid-1759898889493",
    "oldKeyRetentionPeriod": 3600,
    "rotatedBy": "Ryan",
    "reason": "Quarterly security rotation"
  },
  "warning": "Old tokens will remain valid for 60 minutes. Please inform other services to refresh public keys from /jwks.json"
}
```

**Key Lifecycle**:

- **ACTIVE**: Currently active key used for issuing new tokens
- **GRACE**: Grace period (1 hour), old keys can still verify tokens
- **RETIRED**: Retired, no longer used

⚠️ **Important**: After key rotation, other services should refresh public keys from `/jwks.json`.

## 🚢 Deployment Guide

### Docker Deployment (Recommended)

```bash
# 1. Build image
docker build -t tymoe-auth-service:2.1.2 .

# 2. Run container
docker run -d \
  --name auth-service \
  -p 8080:8080 \
  --env-file .env \
  tymoe-auth-service:2.1.2

# 3. View logs
docker logs -f auth-service
```

### Docker Compose Deployment

```yaml
version: "3.8"

services:
  auth-service:
    build: .
    ports:
      - "8080:8080"
    environment:
      - NODE_ENV=production
      - DATABASE_URL=postgresql://user:pass@postgres:5432/authdb
      - REDIS_URL=redis://redis:6379
    depends_on:
      - postgres
      - redis
    restart: unless-stopped

  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_USER: user
      POSTGRES_PASSWORD: pass
      POSTGRES_DB: authdb
    volumes:
      - postgres_data:/var/lib/postgresql/data
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    restart: unless-stopped

volumes:
  postgres_data:
```

Start:

```bash
docker-compose up -d
```

### Production Environment Checklist

- [ ] Configure correct `DATABASE_URL`
- [ ] Configure strong random `SESSION_SECRET` and `KEYSTORE_ENC_KEY`
- [ ] Set correct `ISSUER_URL` (production domain)
- [ ] Configure SMTP email service
- [ ] Enable CAPTCHA (`CAPTCHA_ENABLED=true`)
- [ ] Set `ALLOWED_ORIGINS` to actual frontend domains
- [ ] Configure Admin API Keys (strong random)
- [ ] Enable Redis persistence
- [ ] Configure PostgreSQL backups
- [ ] Set up Nginx reverse proxy (HTTPS)
- [ ] Configure log collection (ELK/Loki)
- [ ] Enable Prometheus Metrics monitoring
- [ ] Rotate JWT keys regularly (recommended quarterly)

## 🛠️ Development Guide

### Project Structure

```
auth-service-deploy/
├── src/
│   ├── config/              # Configuration files
│   │   ├── env.ts           # Environment variables
│   │   └── env.validate.ts  # Environment validation
│   ├── controllers/         # Controllers
│   │   ├── identity.ts      # User identity management
│   │   ├── oidc.ts          # OAuth2/OIDC
│   │   ├── organizations.ts # Organization management
│   │   ├── account.ts       # Account login
│   │   ├── device.ts        # Device management
│   │   └── admin.ts         # Admin API
│   ├── services/            # Business logic
│   │   ├── user.ts          # User service
│   │   ├── organization.ts  # Organization service
│   │   ├── token.ts         # Token service
│   │   ├── clientAuth.ts    # Client authentication
│   │   └── userSecurity.ts  # User security
│   ├── middleware/          # Middleware
│   │   ├── authenticate.ts  # JWT authentication
│   │   ├── adminAuth.ts     # Admin authentication
│   │   ├── redisRate.ts     # Rate limiting
│   │   ├── permission.ts    # Permission check
│   │   └── productType.ts   # Product type validation
│   ├── infra/              # Infrastructure
│   │   ├── db.ts           # Prisma client
│   │   ├── redis.ts        # Redis client
│   │   ├── keystore.ts     # JWT key storage
│   │   ├── mail.ts         # Email service
│   │   └── audit.ts        # Audit logging
│   ├── routes/             # Routes
│   │   ├── identity.ts
│   │   ├── oidc.ts
│   │   ├── organizations.ts
│   │   ├── accounts.ts
│   │   ├── devices.ts
│   │   └── admin.ts
│   └── index.ts            # Entry point
├── prisma/
│   ├── schema.prisma       # Database schema
│   └── migrations/         # Database migrations
├── .env                    # Environment variables
├── tsconfig.json           # TypeScript configuration
├── package.json
└── README.md
```

### Adding New API Endpoints

1. **Create controller function in `src/controllers/`**:

```typescript
// src/controllers/myFeature.ts
import { Request, Response } from "express";

export async function myEndpoint(req: Request, res: Response) {
  try {
    // Business logic
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: "internal_error" });
  }
}
```

2. **Create route in `src/routes/`**:

```typescript
// src/routes/myFeature.ts
import { Router } from "express";
import { myEndpoint } from "../controllers/myFeature.js";
import { authenticate } from "../middleware/authenticate.js";

const router = Router();
router.get("/my-endpoint", authenticate, myEndpoint);
export default router;
```

3. **Register route in `src/index.ts`**:

```typescript
import myFeatureRoutes from "./routes/myFeature.js";
app.use("/api/auth-service/v1/my-feature", myFeatureRoutes);
```

### Database Migration

```bash
# 1. Modify prisma/schema.prisma

# 2. Create migration
npx prisma migrate dev --name add_new_field

# 3. Apply migration (production)
npx prisma migrate deploy

# 4. Generate Prisma Client
npx prisma generate
```

### Running Tests

```bash
# Run all tests
npm test

# Run specific test file
npm test -- identity.test.ts

# Generate test coverage report
npm run test:coverage
```

## 🐛 Troubleshooting

### Common Issues

#### 1. Service Failed to Start

**Issue**: `Error: connect ECONNREFUSED 127.0.0.1:5432`

**Solution**: Check if PostgreSQL is running and DATABASE_URL is correct

```bash
# Check PostgreSQL
psql $DATABASE_URL -c "SELECT 1"

# Check Redis
redis-cli ping
```

#### 2. JWT Verification Failed

**Issue**: `{ "error": "invalid_token" }`

**Solution**:

- Check if token is expired
- Verify `ISSUER_URL` is correct
- Ensure other services use latest public keys from `/jwks.json`

```bash
# View JWKS
curl http://localhost:8080/jwks.json

# Check token content (use jwt.io)
```

#### 3. Email Send Failed

**Issue**: `Error: Invalid login: 535 Authentication failed`

**Solution**: Check SMTP configuration

```bash
# Test SMTP connection
npm run test:smtp
```

#### 4. Redis Connection Timeout

**Issue**: `Error: Redis connection timeout`

**Solution**:

- Verify `REDIS_URL` is correct
- Check if Redis is running
- Adjust `REDIS_CONNECT_TIMEOUT` and `REDIS_COMMAND_TIMEOUT`

```bash
# Test Redis connection
redis-cli -u $REDIS_URL ping
```

#### 5. Rate Limit Exceeded

**Issue**: `{ "error": "rate_limit_exceeded" }`

**Solution**:

- Check rate limiting keys in Redis
- Adjust rate limiting config in `.env`
- Or use Admin API to clear cache

```bash
# Clear rate limiting cache
curl -X POST http://localhost:8080/api/auth-service/v1/admin/cache/clear \
  -H "X-Admin-Key: admin_ryan_sk_Z678YTHUJ" \
  -d '{"cacheType":"all"}'
```

#### 6. Account Locked

**Issue**: `{ "error": "account_locked" }`

**Solution**: Use Admin API to unlock

```bash
curl -X POST http://localhost:8080/api/auth-service/v1/admin/users/{userId}/unlock \
  -H "X-Admin-Key: admin_ryan_sk_Z678YTHUJ" \
  -d '{"reason":"User requested unlock"}'
```

### Viewing Logs

```bash
# View application logs
tail -f logs/app.log

# View audit logs
tail -f logs/audit.log

# Using Docker
docker logs -f auth-service

# Using journalctl (systemd)
journalctl -u auth-service -f
```

### Health Check

```bash
# System health check
curl http://localhost:8080/api/auth-service/v1/admin/health \
  -H "X-Admin-Key: admin_ryan_sk_Z678YTHUJ"

# System statistics
curl http://localhost:8080/api/auth-service/v1/admin/stats \
  -H "X-Admin-Key: admin_ryan_sk_Z678YTHUJ"

# Prometheus Metrics
curl http://localhost:8080/metrics \
  -H "Authorization: Bearer your-metrics-token"
```

## 📚 Related Documentation

- [API Endpoint Design Document.md](./API端点设计文档.md) - Complete API documentation (54 endpoints, 52 unique)
- [OAuth 2.0 RFC 6749](https://tools.ietf.org/html/rfc6749)
- [OpenID Connect Core 1.0](https://openid.net/specs/openid-connect-core-1_0.html)
- [Prisma Documentation](https://www.prisma.io/docs)

## 📝 Changelog

### v2.2.0 (2025-10-12)

**Breaking Changes**:

- ✅ **Removed X-Product-Type header validation** - Frontend no longer needs to send X-Product-Type header
- ✅ **Extended ProductType enum** - Expanded from 2 values to 15 detailed types
- ✅ **Removed productType from Account table** - Now retrieved from associated Organization
- ✅ **Optimized organization query logic** - No longer filters by productType, returns all organizations

**New ProductType values**:

- `beauty_salon`, `hair_salon`, `spa`
- `restaurant`, `fast_food`, `cafe`, `beverage`
- `home_studio`, `fitness`, `yoga_studio`
- `retail`, `chinese_restaurant`, `clinic`
- `liquor_store`, `other`

**Database Changes**:

- ✅ Removed `productType` field from Account table
- ✅ Extended ProductType enum to 15 values
- ✅ Database migration applied successfully

**API Changes**:

- ✅ **POST /organizations** - `productType` now passed in request body (not header)
- ✅ **GET /organizations** - Returns all organizations, no productType filtering
- ✅ **POST /identity/login** - Returns all user organizations, no productType filtering
- ✅ **All Account endpoints** - Get productType from `account.organization.productType`

**Code Improvements**:

- ✅ Removed `src/middleware/productType.ts` middleware
- ✅ Fixed hardcoded enum values in `src/controllers/admin.ts`
- ✅ Updated type definitions in `src/services/organization.ts`
- ✅ Optimized stats queries for dynamic productType

**Test Validation**:

- ✅ TypeScript compilation passed
- ✅ Service started successfully, all dependencies working
- ✅ Health check endpoint `/healthz` responding normally

**Impact**:

- ⚠️ **Breaking change**: Frontend must remove all X-Product-Type headers
- ⚠️ **API behavior change**: Login and organization queries now return all organizations
- ⚠️ **Database change**: Migration required to update ProductType enum

**Migration Guide**:

1. Remove all `X-Product-Type` headers from frontend
2. Pass `productType` in request body when creating organizations
3. Update Account logic to get productType from `account.organization.productType`
4. Route based on `organization.productType` after login

---

### v2.1.1 (2025-10-10)

**New Features**:

- ✅ Added **6.11 JWT Key Rotation API** (`POST /admin/keys/rotate`)
- ✅ Support for API-based key rotation without CLI scripts
- ✅ Removed old `scripts/rotate-key.ts` and `scripts/retire-keys.ts`

**Improvements**:

- ✅ Enhanced audit logging for Admin API
- ✅ Improved key lifecycle management (ACTIVE -> GRACE -> RETIRED)
- ✅ Enhanced system configuration query endpoint (6.3)

**Bug Fixes**:

- ✅ Fixed device force logout status update logic
- ✅ Fixed cache clearing error handling

### v2.1.0

**New Features**:

- ✅ Account Management API (Account Login)
- ✅ Device Management API (Device Management)
- ✅ Organization tree structure support
- ✅ Product type isolation (beauty/fb)

### v2.0.0

**Major Update**:

- ✅ Full OAuth2/OIDC support
- ✅ Multi-organization architecture (MAIN/BRANCH/FRANCHISE)
- ✅ Admin API
- ✅ Audit logging system

## 📞 Support & Feedback

For questions or suggestions, please contact the development team:

- **Email**: dev@tymoe.com (not exist rn)
- **Slack**: #auth-service
- **Documentation**: https://docs.tymoe.com/auth-service (not exist rn)

---

**License**: Ryan DIY
**Copyright**: © 2025 Tymoe Technologies (not exist rn)
