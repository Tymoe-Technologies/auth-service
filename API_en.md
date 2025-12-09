# API Endpoint Design Document

# Auth Service v2.2.0 - Part 1: User Management Module

## Design Principles

1. **RESTful Style**: Use standard HTTP methods and status codes.
2. **Unified Response Format**: Consistent structure for success and error responses.
3. **Security First**: All sensitive operations require authentication and authorization.
4. **Idempotency**: GET/PUT/DELETE operations remain idempotent.
5. **Backward Compatibility**: API versioning ensures smooth upgrades.

## Basic Information

- **Base URL**: `https://tymoe.com`
- **API Prefix**: `/api/auth-service/v1`
- **Authentication**: Bearer Token (JWT)
- **Content-Type**: `application/json`

---

## 1️⃣ User Management Module (`/api/auth-service/v1/identity`)

### 1.1 User Registration

**Endpoint**: `POST /api/auth-service/v1/identity/register`

**Request Body**:

```json
{
  "email": "user@example.com",
  "password": "Password123!",
  "name": "John Doe",
  "phone": "+16729650830"
}
```

**Field Description**:

- `email` (Required, string): Email address.
- `password` (Required, string): Password, at least 8 characters, including uppercase, lowercase letters, and numbers.
- `name` (Optional, string): Name, 2-50 characters.
- `phone` (Optional, string): Phone number, international format (e.g., +16729650830, +8613800138000).

**Processing Logic**:

1. Validate `email` format (RFC 5322 standard).
2. Validate `password` strength (at least 8 characters, including uppercase, lowercase letters, and numbers).
3. Validate `phone` format (using Google libphonenumber, automatic country code recognition).
4. Validate `name` format (2-50 characters, allowing letters, Chinese characters, spaces, and hyphens).
5. Check if `email` already exists:
   - If exists and `emailVerifiedAt` is null → Delete old record and related `email_verifications`, continue registration.
   - If exists and `emailVerifiedAt` is not null → Return 409 error.
6. Hash password using bcrypt (salt rounds = 10).
7. Create `User` record (Organization is not created; user creates it later in the console).
8. Generate a 6-digit numeric verification code.
9. Hash verification code using bcrypt (salt rounds = 10).
10. Create `email_verifications` record:
    - purpose = 'signup'
    - expiresAt = 30 minutes later
    - attempts = 0
    - resendCount = 0
11. Send verification email (containing the 6-digit code).
12. Record in `audit_logs` (action='user_register').
13. Return `email` (do not return `userId` to avoid information leakage).

**Success Response (201)**:

```json
{
  "success": true,
  "message": "Please check your email for verification.",
  "data": {
    "email": "user@example.com"
  }
}
```

**Error Response**:

```json
// 400 - Invalid email format
{
  "error": "invalid_email_format",
  "detail": "Please provide a valid email address"
}

// 400 - Weak password
{
  "error": "weak_password",
  "detail": "Password must be at least 8 characters with uppercase, lowercase, and numbers"
}

// 400 - Invalid phone format
{
  "error": "invalid_phone_format",
  "detail": "Please provide a valid phone number in international format (e.g., +16729650830)"
}

// 400 - Invalid name format
{
  "error": "invalid_name_format",
  "detail": "Name must be 2-50 characters, letters, Chinese characters, spaces, and hyphens only"
}

// 409 - Email already registered
{
  "error": "email_already_registered",
  "detail": "This email is already registered and verified. Please try to log in."
}

// 429 - Too many requests
{
  "error": "too_many_requests",
  "detail": "Too many registration attempts. Please try again later."
}
```

---

### 1.2 Email Verification

**Endpoint**: `POST /api/auth-service/v1/identity/verification`

**Request Body**:

```json
{
  "email": "user@example.com",
  "code": "123456"
}
```

**Field Description**:

- `email` (Required, string): User email.
- `code` (Required, string): 6-digit numeric verification code.

**Design Note**:

- **No userId needed**: The verification record can be uniquely identified by the email + code combination.
- **Security**: Use bcrypt to compare the verification code hash to prevent brute force attacks.
- **User Experience**: Users only need to enter their email and the received code, without needing to remember a userId.

**Processing Logic**:

1. Validate `email` format.
2. Validate `code` format (must be 6 digits).
3. Query `email_verifications` table:
   - Condition: `userId` corresponding to email, purpose='signup', consumedAt IS NULL, expiresAt > NOW().
   - Sort by createdAt DESC, take the latest one.
4. If no record found → Return 404 error "verification_not_found".
5. If code expired → Return 400 error "code_expired".
6. Check `attempts` count:
   - If attempts >= 10 → Return 429 error "too_many_attempts".
7. Use `bcrypt.compare()` to compare `code` and `verificationCodeHash`.
8. If code does not match:
   - attempts += 1
   - Save record
   - Return 400 error "invalid_code"
9. If code matches:
   - Update `email_verifications.consumedAt` = NOW()
   - Update `users.emailVerifiedAt` = NOW()
   - Record in `audit_logs` (action='email_verified')
   - Return success

**Success Response (200)**:

```json
{
  "success": true,
  "message": "Email verified successfully. You can now log in.",
  "data": {
    "email": "user@example.com",
    "emailVerified": true
  }
}
```

**Error Response**:

```json
// 400 - Invalid code format
{
  "error": "invalid_code_format",
  "detail": "Verification code must be 6 digits"
}

// 400 - Invalid code
{
  "error": "invalid_code",
  "detail": "Invalid verification code."
}

// 400 - Code expired
{
  "error": "code_expired",
  "detail": "Verification code has expired. Please request a new one."
}

// 404 - Verification not found
{
  "error": "verification_not_found",
  "detail": "No pending verification found for this email. Please register again or request a new code."
}

// 429 - Too many attempts
{
  "error": "too_many_attempts",
  "detail": "Too many failed attempts. Please request a new verification code."
}
```

---

### 1.3 Resend Verification Code

**Endpoint**: `POST /api/auth-service/v1/identity/resend`

**Request Body**:

```json
{
  "email": "user@example.com",
  "purpose": "signup"
}
```

**Field Description**:

- `email` (Required, string): User email.
- `purpose` (Required, string): Verification purpose, Enum: "signup" | "password_reset" | "email_change".

**Design Note**:

- **Why POST**: Although it is "resending", it creates a new verification code record, which is a resource creation operation.
- **Anti-abuse Mechanism**:
  - Limit resend frequency (only once per 60 seconds for the same email).
  - Limit resend count (max 5 resends per verification session).
  - Redis rate limiting.

**Processing Logic**:

1. Validate `email` format.
2. Validate `purpose` enum value.
3. Query corresponding `User` record:
   - If purpose='signup' and emailVerifiedAt is not null → Return 400 "already_verified".
   - If user not found → Return 404 "user_not_found".
4. Check Redis rate limit:
   - Key: `resend:${email}:${purpose}`
   - If exists → Return 429 "too_soon".
   - Set 60 seconds expiration.
5. Query latest `email_verifications` record (unconsumed).
6. Check `resendCount`:
   - If >= 5 → Return 429 "resend_limit_exceeded".
7. Mark old verification code as expired (set expiresAt = NOW()).
8. Generate new 6-digit verification code.
9. Create new `email_verifications` record:
   - resendCount = old record's resendCount + 1
   - expiresAt = 30 minutes later
10. Send verification email.
11. Record in `audit_logs`.
12. Return success.

**Success Response (200)**:

```json
{
  "success": true,
  "message": "Verification code has been sent. Please check your email.",
  "data": {
    "email": "user@example.com",
    "expiresIn": 1800
  }
}
```

**Error Response**:

```json
// 400 - Email already verified
{
  "error": "already_verified",
  "detail": "This email is already verified. You can log in directly."
}

// 404 - User not found
{
  "error": "user_not_found",
  "detail": "No account found with this email address."
}

// 429 - Too soon
{
  "error": "too_soon",
  "detail": "Please wait 60 seconds before requesting another verification code."
}

// 429 - Resend limit exceeded
{
  "error": "resend_limit_exceeded",
  "detail": "Maximum resend limit reached. Please try registering again."
}
```

---

### 1.4 User Login

**Endpoint**: `POST /api/auth-service/v1/identity/login`

**Request Body**:

```json
{
  "email": "user@example.com",
  "password": "Password123!"
}
```

**Field Description**:

- `email` (Required, string): User email.
- `password` (Required, string): Password.

**Processing Logic**:

1. Validate `email` format.
2. Query `User` record (by email).
3. If user does not exist → Return 401 "invalid_credentials" (do not reveal if user exists).
4. Check account status:
   - If `emailVerifiedAt` is null → Return 401 "account_not_verified".
   - If `lockedUntil` is not null and > NOW() → Return 423 "account_locked".
5. Use `bcrypt.compare()` to verify password.
6. If password incorrect:
   - loginFailureCount += 1
   - lastLoginFailureAt = NOW()
   - If loginFailureCount >= LOGIN_LOCK_THRESHOLD (default 10):
     - lockedUntil = NOW() + LOGIN_LOCK_MINUTES (default 30 minutes)
     - lockReason = 'max_failures'
   - Save `User` record.
   - Record in `login_attempts` (success=false, ipAddress, userAgent, organizationId=null).
   - Return 401 "invalid_credentials".
7. If password correct:
   - Reset loginFailureCount = 0, lastLoginFailureAt = null, lockedUntil = null, lockReason = null.
   - Save `User` record.
   - Record in `login_attempts` (success=true, ipAddress, userAgent).
   - Query all organizations for this user:
     - Condition: userId = current user.
     - Sort by createdAt ASC.
   - Record in `audit_logs` (action='user_login').
   - Return user info and filtered organization list.

**Success Response (200)**:

```json
{
  "success": true,
  "user": {
    "email": "user@example.com",
    "name": "John Doe",
    "phone": "+16729650830",
    "emailVerified": true,
    "createdAt": "2025-01-15T08:30:00.000Z"
  },
  "organizations": [
    {
      "id": "org-uuid-1",
      "orgName": "My Beauty Salon Main",
      "orgType": "MAIN",
      "productType": "beauty-salon",
      "status": "ACTIVE"
    },
    {
      "id": "org-uuid-2",
      "orgName": "My Beauty Salon Branch",
      "orgType": "BRANCH",
      "productType": "beauty-salon",
      "parentOrgId": "org-uuid-1",
      "status": "ACTIVE"
    }
  ]
}
```

**Note**:

- After successful login, the frontend should call `/oauth/token` endpoint to get `access_token` and `refresh_token`.
- Token is not returned directly in the login interface to maintain OAuth2 standard flow.

**Error Response**:

```json
// 401 - Account not verified
{
  "error": "account_not_verified",
  "detail": "Please verify your email address before logging in."
}

// 401 - Invalid credentials
{
  "error": "invalid_credentials",
  "detail": "Email or password is incorrect."
}

// 423 - Account locked
{
  "error": "account_locked",
  "detail": "Account is locked due to too many failed login attempts. Please try again in 30 minutes or contact support.",
  "lockedUntil": "2025-01-15T09:30:00.000Z"
}
```

---

### 1.5 Get OAuth Token

**Endpoint:** `POST /oauth/token`

**Request Headers:**

```
X-Device-ID: device-uuid  // Required only for POS login
X-Session-Token: Kx7v...  // Required only for POS login
```

This endpoint supports three login scenarios, automatically identified by fields in the request body:

#### Scenario 1: User Backend Login

**Request Headers**:

```
(No X-Device-ID required)
```

**Request Body** (application/x-www-form-urlencoded):

```
grant_type=password
username=user@example.com     // Supports passing email in username or email field
password=Password123!
client_id=tymoe-web           // Required
```

**Processing Logic**:

1. Validate `grant_type=password`.
2. Validate `client_id` exists.
3. Validate user credentials (email + password).
4. Check if email is verified.
5. Query all organization IDs for this user.
6. Generate **access_token** (JWT, RS256 signature):

```json
{
  "sub": "user-uuid-123",
  "userType": "USER",
  "email": "user@example.com",
  "organizations": [
    {
      "id": "org-main-uuid-456",
      "orgName": "Victoria Main Store",
      "orgType": "MAIN",
      "productType": "hair-salon",
      "parentOrgId": null,
      "role": "USER",
      "status": "ACTIVE"
    },
    {
      "id": "org-branch-uuid-789",
      "orgName": "Vancouver Direct Branch",
      "orgType": "BRANCH",
      "productType": "hair-salon",
      "parentOrgId": "org-main-uuid-456", // Linked to main store
      "role": "USER",
      "status": "ACTIVE"
    },
    {
      "id": "org-franchise-uuid-101",
      "orgName": "Burnaby Franchise",
      "orgType": "FRANCHISE",
      "productType": "hair-salon",
      "parentOrgId": "org-main-uuid-456", // Linked to main store
      "role": "USER",
      "status": "ACTIVE"
    }
  ],

  "iat": 1728692400,
  "exp": 1728696000, // Expires in 60 minutes (example timestamp)
  "jti": "unique-token-id-xyz"
}
```

7. Generate **refresh_token** and store in database (valid for 30 days, Uber style).

**Success Response (200)**:

```json
{
  "access_token": "eyJhbGciOiJSUzI1NiIs...",
  "refresh_token": "def502004a8b7e2c...",
  "token_type": "Bearer",
  "expires_in": 3600
}
```

---

#### Scenario 2: Account Backend Login

**Request Headers**:

```http
(No X-Device-ID required)
```

**Request Body** (application/x-www-form-urlencoded):

```
grant_type=password
username=manager001           // Account's real username (not email, cannot contain @ symbol)
password=Password123!
client_id=tymoe-web
```

**Processing Logic**:

1. Validate `grant_type=password`.
2. Validate `client_id` exists.
3. Validate Account credentials (username does not contain @ symbol).
4. Check account type (only OWNER/MANAGER allowed for backend login).
5. Check if account is locked.
6. Generate **access_token**:

```json
{
  "sub": "account-uuid",
  "userType": "ACCOUNT",
  "accountType": "MANAGER",
  "username": "manager001",
  "employeeNumber": "EMP001",
  "organizations": {
    "id": "org-franchise-uuid-101",
    "orgName": "Burnaby Franchise",
    "orgType": "FRANCHISE",
    "productType": "cafe",
    "parentOrgId": "org-main-uuid-456", // Linked to main store
    "role": "MANAGER", // Recommended: Current user's role in the organization
    "status": "ACTIVE"
  },
  "iat": 1728692400,
  "exp": 1728696000, // Expires in 60 minutes (example timestamp)
  "jti": "unique-token-id-xyz"
}
```

**Permission Description**:

- **OWNER**: Can log in to backend.
- **MANAGER**: Can log in to backend.
- **STAFF**: Not allowed to log in to backend.

7. Generate **refresh_token** (valid for 30 days).

**Success Response (200)**:

```json
{
  "access_token": "eyJhbGciOiJSUzI1NiIs...",
  "refresh_token": "def502004a8b7e2c...",
  "token_type": "Bearer",
  "expires_in": 3600
}
```

### Scenario 3: Account POS Login (Owner/Manager/Staff)

**Request Headers**:

```http
X-Device-ID: device-uuid
X-Session-Token: Kx7vZ9mW3Qp5RtY2jN8hU6fL1cV4bS0aO-iPqE3wXyD
```

**Request Body (application/x-www-form-urlencoded):**

```
grant_type=password
pin_code=1234
```

**Identification Method:** Presence of `pin_code` field + `X-Device-ID` + `X-Session-Token` in headers.

**Processing Logic:**

1. Validate `grant_type=password`.
2. Extract `X-Device-ID` and `X-Session-Token` from headers.
3. If `X-Device-ID` or `X-Session-Token` is missing → Return 400 "missing_device_credentials".
4. Query Device:
   - Validate device exists and status = 'ACTIVE'.
   - If not exists or status incorrect → Return 403 "device_not_authorized".
5. Query DeviceSession:
   - Calculate SHA-256 hash of sessionToken.
   - Query `device_sessions` table to verify sessionTokenHash match.
   - If mismatch or session not exists → Return 403 "invalid_session".
6. Query Account belonging to the device's organization (via `pin_code`):
   - Use bcrypt to verify pinCode.
   - If PIN incorrect → Return 401 "invalid_credentials".
7. Validate organization status = 'ACTIVE'.
8. Update `DeviceSession.lastActiveAt` = NOW().
9. Record in `login_attempts` and `audit_logs`.
10. Generate `access_token` (valid for 4.5 hours, no refresh_token).

**Generated access_token (JWT):**

```json
{
  "sub": "account-uuid",
  "userType": "ACCOUNT",
  "accountType": "STAFF",
  "employeeNumber": "EMP002",
  "organizationId": "org-uuid",
  "productType": "cafe", // productType in organization table
  "deviceId": "device-uuid", // POS specific
  "iat": 1640991600,
  "exp": 1641007800, // 4.5 hours (16200 seconds)
  "jti": "unique-token-id"
}
```

**No refresh_token generated** (POS login is a one-time Token).

**Success Response (200)**:

```json
{
  "access_token": "eyJhbGciOiJSUzI1NiIs...",
  "token_type": "Bearer",
  "expires_in": 16200
}
```

---

**Success Response:**

User / Account Backend Login (200):

```json
{
  "access_token": "eyJhbGciOiJSUzI1NiIs...",
  "refresh_token": "def502004a8b7e2c...",
  "token_type": "Bearer",
  "expires_in": 3600
}
```

Account POS Login (200):

```json
{
  "access_token": "eyJhbGciOiJSUzI1NiIs...",
  "token_type": "Bearer",
  "expires_in": 16200
}
```

---

**Notes**:

1. **User vs Account Distinction**:

   - User: `username` field contains `@` symbol (email format).
   - Account: `username` field does not contain `@` symbol (real username).

2. **Refresh Token Mechanism**:

   - User/Account Backend Login: 30 days fixed (Uber style).
   - Account POS Login: No `refresh_token` (`access_token` 4.5 hours).

3. **Unified Response Format**:
   - User/Account Backend Login returns 4 fields: `access_token`, `refresh_token`, `token_type`, `expires_in`.
   - Account POS Login returns 3 fields: `access_token`, `token_type`, `expires_in`.

---

### 1.6 Refresh Token

**Endpoint:** `POST /oauth/token`

**Request Body** (application/x-www-form-urlencoded):

```
grant_type=refresh_token
refresh_token=550e8400-e29b-41d4-a716-446655440000
client_id=tymoe-web
```

**Processing Logic**:

1. Validate `grant_type=refresh_token`.
2. Validate `client_id` exists.
3. Query `refresh_tokens` table (by `id = refresh_token`).
4. Check token status:
   - Not exists → Return 401 `invalid_grant`.
   - `status != 'ACTIVE'` → Return 401 `token_revoked`.
   - `expiresAt < NOW()` → Return 401 `token_expired`.
5. If token valid:
   - Update `lastSeenAt = NOW()`.
   - Distinguish login type by `subjectUserId` or `subjectAccountId`.
   - **User Login**: Query latest organization list (may have added organizations).
   - **Account Login**: Use bound `organizationId` directly.
   - Generate new `access_token` (containing latest info).
   - **Reuse original `refresh_token`** (Uber style, no rotation).

**User/Account Login Response Example**:

```json
{
  "access_token": "eyJhbGci...", // New JWT
  "refresh_token": "550e8400-e29b-41d4-a716-446655440000", // Original, unchanged
  "token_type": "Bearer",
  "expires_in": 3600
}
```

**New Access Token Payload** (User):

```json
{
  "sub": "user-uuid-123",
  "userType": "USER",
  "email": "user@example.com",
  "organizations": [
    // May increase or decrease
    {
      "id": "org-main-uuid-456",
      "orgName": "Victoria Main Store",
      "orgType": "MAIN",
      "productType": "hair-salon",
      "parentOrgId": null,
      "role": "USER",
      "status": "ACTIVE"
    },
    {
      "id": "org-branch-uuid-789",
      "orgName": "Vancouver Direct Branch",
      "orgType": "BRANCH",
      "productType": "hair-salon",
      "parentOrgId": "org-main-uuid-456", // Linked to main store
      "role": "USER",
      "status": "ACTIVE"
    },
    {
      "id": "org-franchise-uuid-101",
      "orgName": "Burnaby Franchise",
      "orgType": "FRANCHISE",
      "productType": "hair-salon",
      "parentOrgId": "org-main-uuid-456", // Linked to main store
      "role": "USER",
      "status": "ACTIVE"
    },
    {
      "id": "org-franchise-uuid-997",
      "orgName": "Coquitlam Franchise",
      "orgType": "FRANCHISE",
      "productType": "hair-salon",
      "parentOrgId": "org-main-uuid-456", // Linked to main store
      "role": "USER",
      "status": "ACTIVE"
    }
  ],
  "iat": 1728692400,
  "exp": 1728696000, // New expiration time
  "jti": "new-unique-id" // New JTI
}
```

**User Login Response Example**:

```json
{
  "access_token": "eyJhbGci...", // New JWT
  "refresh_token": "uuid-format-token", // Original, unchanged
  "token_type": "Bearer",
  "expires_in": 3600
}
```

**New Access Token Payload** (Account):

```json
{
  "sub": "account-uuid",
  "userType": "ACCOUNT",
  "accountType": "MANAGER",
  "username": "manager001",
  "employeeNumber": "EMP001",
  // Unchanged
  "organizations": {
    "id": "org-franchise-uuid-101",
    "orgName": "Burnaby Franchise",
    "orgType": "FRANCHISE",
    "productType": "cafe",
    "parentOrgId": "org-main-uuid-456", // Linked to main store
    "role": "MANAGER", // Recommended: Current user's role in the organization
    "status": "ACTIVE"
  },
  "iat": 1640995200,
  "exp": 1640998800, // Expires in 60 minutes (example timestamp)
  "jti": "new-unique-id"
}
```

**Account Login Response Example**:

```json
{
  "access_token": "eyJhbGci...", // New JWT
  "refresh_token": "uuid-format-token", // Original, unchanged
  "token_type": "Bearer",
  "expires_in": 3600
}
```

**Note:** POS login cannot call this interface (no refresh_token).

---

**Design Note**:

1. **Uber Style (User/Account Backend Login)**:

   - Refresh Token **fixed for 30 days**.
   - Each refresh only generates a new Access Token.
   - Simplifies frontend logic, no need to update RT every time.

2. **Benefits of Refreshing**:

   - User: Get the latest organization list.
   - Account: Keep token active.
   - New JTI facilitates token revocation management.

3. **Security Measures**:

   - Update `lastSeenAt` on every refresh (detect abnormal frequency).
   - Force re-login after 30 days.
   - Revoke RT and blacklist AT's JTI on logout.

4. **Account POS Login Exception**:
   - **No refresh_token**.
   - Access Token valid for 4.5 hours.
   - Must re-login (swipe card) after expiration.

---

### 1.7 User Logout

**Endpoint**: `POST /api/auth-service/v1/identity/logout`

**Request Headers**:

```http
Authorization: Bearer <access_token>
```

**Request Body**:

```json
{
  "refresh_token": "def502004a8b7e2c..."
}
```

**Field Description**:

- `refresh_token` (Required, string): Must be provided to revoke the refresh token and its family.

**Processing Logic**:

1. Extract `userId` and `jti` from Bearer token.
2. Validate `refresh_token`:
   - Query `refresh_tokens` table (by id = refresh_token).
   - If found and `subjectUserId` matches:
     - Revoke the token: status = 'REVOKED', revokedAt = NOW(), revokeReason = 'user_logout'.
     - Revoke all tokens in the same family (by familyId, status='ACTIVE').
3. Add `access_token`'s `jti` to Redis blacklist:
   - Key: `token:blacklist:${jti}`
   - Value: "1"
   - TTL: Remaining validity of access_token (exp - now).
4. Record in `audit_logs` (action='user_logout').
5. Return success.

**Success Response (200)**:

```json
{
  "success": true,
  "message": "Logged out successfully"
}
```

**Note**:

- `refresh_token` is required to ensure complete revocation of user login status.
- Business services must check Redis blacklist when validating `access_token` to prevent usage of logged-out tokens.

---

### 1.8 Forgot Password

**Endpoint**: `POST /api/auth-service/v1/identity/forgot-password`

**Request Body**:

```json
{
  "email": "user@example.com"
}
```

**Processing Logic**:

1. Validate `email` format.
2. Query `User` record.
3. If user does not exist → **Still return success** (security measure, do not reveal if user exists).
4. If user exists:
   - Check Redis rate limit (only once per minute for the same email).
   - If limit exceeded → Return 429.
   - Generate 6-digit numeric verification code.
   - Hash verification code using bcrypt.
   - Mark old `password_reset` record as expired (set expiresAt = NOW()).
   - Create new `email_verifications` record:
     - purpose = 'password_reset'
     - expiresAt = 10 minutes later (shorter than registration code for security).
   - Send password reset email.
   - Record in `audit_logs`.
5. Return success.

**Success Response (200)**:

```json
{
  "success": true,
  "message": "If the system works well, you will receive a password reset code shortly."
}
```

**Error Response**:

```json
// 429 - Too many requests
{
  "error": "too_many_requests",
  "detail": "Please wait 60 seconds before requesting another password reset code."
}
```

---

### 1.9 Reset Password

**Endpoint**: `POST /api/auth-service/v1/identity/reset-password`

**Request Body**:

```json
{
  "email": "user@example.com",
  "code": "123456",
  "password": "NewPassword123!"
}
```

**Processing Logic**:

1. Validate `email` format.
2. Validate `code` format (6 digits).
3. Validate `password` strength.
4. Query `email_verifications`:
   - Condition: purpose='password_reset', `userId` corresponding to email, consumedAt IS NULL, expiresAt > NOW().
5. Verification code validation logic same as 1.2:
   - If not found → 404 "verification_not_found".
   - If expired → 400 "code_expired".
   - If attempts >= 10 → 429 "too_many_attempts".
   - If code incorrect → attempts++, return 400 "invalid_code".
6. If code correct:
   - Hash new password using bcrypt.
   - Update `users.passwordHash`.
   - Mark verification code as used: consumedAt = NOW().
   - Revoke all refresh_tokens for this user (security measure):
     - Update `refresh_tokens`: status = 'REVOKED', revokedAt = NOW(), revokeReason = 'password_reset'.
   - Record in `audit_logs` (action='password_reset').
   - Return success.

**Success Response (200)**:

```json
{
  "success": true,
  "message": "Password has been reset successfully. Please log in with your new password."
}
```

**Error Response**: Same as 1.2 verification code errors.

---

### 1.10 Change Password (Logged In)

**Endpoint**: `POST /api/auth-service/v1/identity/change-password`

**Request Headers**:

```http
Authorization: Bearer <access_token>
```

**Request Body**:

```json
{
  "currentPassword": "OldPassword123!",
  "newPassword": "NewPassword123!"
}
```

**Processing Logic**:

1. Extract `userId` from token.
2. Query `User` record.
3. Use `bcrypt.compare()` to verify `currentPassword`.
4. If current password incorrect → Return 401 "invalid_current_password".
5. Validate `newPassword` strength.
6. Check if new and old passwords are the same → Return 400 "same_password".
7. Hash new password using bcrypt.
8. Update `users.passwordHash`.
9. Revoke all refresh_tokens for this user (except the current one):
   - Find corresponding refresh_token familyId from current access_token's jti.
   - Revoke all refresh_tokens of other familyIds.
10. Record in `audit_logs` (action='password_change').
11. Return success.

**Success Response (200)**:

```json
{
  "success": true,
  "message": "Password changed successfully"
}
```

**Error Response**:

```json
// 400 - Same password
{
  "error": "same_password",
  "detail": "New password must be different from the current password"
}

// 401 - Invalid current password
{
  "error": "invalid_current_password",
  "detail": "Current password is incorrect"
}
```

---

### 1.11 Get Current User Profile

**Endpoint**: `GET /api/auth-service/v1/identity/profile`

**Request Headers**:

```http
Authorization: Bearer <access_token>
```

**Processing Logic**:

1. Extract `userId` from token.
2. Query `User` record (exclude sensitive fields like passwordHash, loginFailureCount).
3. Return user info.

**Success Response (200)**:

```json
{
  "success": true,
  "data": {
    "email": "user@example.com",
    "name": "John Doe",
    "phone": "+16729650830",
    "emailVerified": true,
    "createdAt": "2025-01-15T08:30:00.000Z",
    "updatedAt": "2025-01-15T08:30:00.000Z"
  }
}
```

---

### 1.12 Update User Profile

**Endpoint**: `PATCH /api/auth-service/v1/identity/profile`

**Request Headers**:

```http
Authorization: Bearer <access_token>
```

**Request Body**:

```json
{
  "name": "Jane Doe",
  "phone": "+8613900139000"
}
```

**Field Description**:

- `name` (Optional, string): Name.
- `phone` (Optional, string): Phone number.

**Note**: Email cannot be changed via this interface; use the dedicated email change interface.

**Processing Logic**:

1. Extract `userId` from token.
2. Validate provided field formats:
   - name: 2-50 characters.
   - phone: Validate using libphonenumber.
3. Update `User` record (only update provided fields).
4. Record in `audit_logs` (action='profile_update', record updated fields in detail).
5. Return updated info.

**Success Response (200)**:

```json
{
  "success": true,
  "message": "Profile updated successfully",
  "data": {
    "email": "user@example.com",
    "name": "Jane Doe",
    "phone": "+8613900139000",
    "emailVerified": true,
    "createdAt": "2025-01-15T08:30:00.000Z",
    "updatedAt": "2025-01-16T10:30:00.000Z"
  }
}
```

---

### 1.13 Change Email (Step 1: Request Verification Code)

**Endpoint**: `POST /api/auth-service/v1/identity/change-email`

**Request Headers**:

```http
Authorization: Bearer <access_token>
```

**Request Body**:

```json
{
  "newEmail": "newemail@example.com",
  "password": "Password123!"
}
```

**Processing Logic**:

1. Extract `userId` from token.
2. Query `User` record.
3. Use `bcrypt.compare()` to verify `password` (security measure).
4. If password incorrect → Return 401 "invalid_password".
5. Validate `newEmail` format.
6. Check if `newEmail` is already used by another user:
   - Query `users` table (by email = newEmail, emailVerifiedAt IS NOT NULL).
   - If exists → Return 409 "email_already_used".
7. Check Redis rate limit (only once per 5 minutes for the same userId).
8. Generate 6-digit verification code.
9. Hash verification code using bcrypt.
10. Create `email_verifications` record:
    - purpose = 'email_change'
    - userId = current user
    - sentTo = newEmail (Important! Send to new email)
    - expiresAt = 30 minutes later
    - Store JSON in `detail` field: `{ "oldEmail": "old@example.com", "newEmail": "new@example.com" }`
11. Send verification email to new email address.
12. Record in `audit_logs` (action='email_change_requested').
13. Return success.

**Success Response (200)**:

```json
{
  "success": true,
  "message": "Verification code has been sent to your new email address.",
  "data": {
    "newEmail": "newemail@example.com",
    "expiresIn": 1800
  }
}
```

**Error Response**:

```json
// 401 - Invalid password
{
  "error": "invalid_password",
  "detail": "Password is incorrect"
}

// 409 - Email already used
{
  "error": "email_already_used",
  "detail": "This email address is already registered"
}

// 429 - Too many requests
{
  "error": "too_many_requests",
  "detail": "Please wait 5 minutes before requesting another email change"
}
```

---

### 1.14 Change Email (Step 2: Confirm Verification Code)

**Endpoint**: `POST /api/auth-service/v1/identity/verification-email-change`

**Request Headers**:

```http
Authorization: Bearer <access_token>
```

**Request Body**:

```json
{
  "code": "123456"
}
```

**Processing Logic**:

1. Extract `userId` from token.
2. Query `email_verifications`:
   - Condition: userId, purpose='email_change', consumedAt IS NULL, expiresAt > NOW().
3. Verification code validation logic same as 1.2.
4. If code correct:
   - Extract `newEmail` from `detail` field.
   - Check again if `newEmail` is already used by another user (prevent race condition).
   - If used → Return 409 "email_already_used".
   - Update `users.email` = newEmail.
   - Update `users.updatedAt` = NOW().
   - Mark verification code as used: consumedAt = NOW().
   - Revoke all refresh_tokens for this user (security measure, email change requires re-login):
     - status = 'REVOKED', revokedAt = NOW(), revokeReason = 'email_changed'.
   - Add current `access_token`'s `jti` to Redis blacklist (immediate invalidation).
   - Record in `audit_logs` (action='email_changed', record oldEmail and newEmail in detail).
   - Return success.

**Success Response (200)**:

```json
{
  "success": true,
  "message": "Email address has been changed successfully. Please log in again with your new email.",
  "data": {
    "newEmail": "newemail@example.com"
  }
}
```

**Error Response**: Same as 1.2 verification code errors.

---

### Key Design Points

1. **Registration Flow**: Only create User account during registration, do not create organization.
2. **OAuth2 Standard**: Login interface does not return token directly, need to call `/oauth/token`.
3. **Token Design**:
   - Access token: Expires in 60 minutes, contains userId, productType, organizationIds, orgType, etc.
   - Refresh token: Expires in 90 days, supports family management and rotation.
4. **Logout Security**: Revoke refresh_token family + add access_token jti to Redis blacklist.
5. **Verification Code Mechanism**:
   - 6-digit numeric code.
   - bcrypt hash storage.
   - Max 10 attempts.
   - Max 5 resends.
   - Expires in 30 minutes (password reset 10 minutes).
6. **Account Security**:
   - Lock for 30 minutes after 10 failed login attempts.
   - All passwords use bcrypt (salt rounds = 10).
   - Rate limiting implemented via Redis.
7. **Audit Logs**: All important operations recorded in `audit_logs`.

### Database Table Dependencies

- users
- email_verifications
- login_attempts
- refresh_tokens
- audit_logs

### Redis Keys

- `resend:${email}:${purpose}` - Resend limit (60 seconds)
- `token:blacklist:${jti}` - Token blacklist (TTL = remaining token time)
- Other rate limiting keys (login, register, password reset, etc.)

---

# Auth Service v2.2.0 - Part 2: Organization Management Module

## 2️⃣ Organization Management Module (`/api/auth-service/v1/organizations`)

### Business Rules Description

**Organization Ownership**:

- The `userId` of all organizations (Main, Branch, Franchise) is the Owner (Boss).
- User (Boss) owns all organizations but does not directly manage store operations.
- Store operations are managed via Account (designed in Part 3).

**Organization Types**:

- **MAIN (Main Store)**: The boss's first store, parentOrgId = null.
- **BRANCH (Branch Store)**: Branch store, parentOrgId = Main Store ID.
- **FRANCHISE (Franchise Store)**: Franchise store, parentOrgId = Main Store ID.

**Organization Type Differences**:

- Main and Branch: Can only assign MANAGER, STAFF accounts.
- Franchise: Can assign OWNER (Franchisee), MANAGER, STAFF accounts.
- The difference is mainly reflected in Account permissions; at the organization level, they are distinguished only by orgType.

**Data Isolation**:

- Business data of different stores is isolated by orgId.

---

### 2.1 Create Organization

**Endpoint**: `POST /api/auth-service/v1/organizations`

**Request Headers**:

`Authorization: Bearer <access_token>`

**Request Body**:

```json
{
  "orgName": "My Beauty Salon Main",
  "orgType": "MAIN",
  "parentOrgId": null,
  "productType": "restaurant",
  "description": "Chinese Restaurant",
  "location": "123 Main St, Vancouver, BC, V6B 1A1",
  "phone": "+16041234567",
  "email": "store@example.com"
}
```

**Field Description**:

- `orgName` (Required, string): Organization name, 2-100 characters.
- `orgType` (Required, enum): Organization type, "MAIN" | "BRANCH" | "FRANCHISE".
- `parentOrgId` (Conditionally Required, UUID): Parent Organization ID.
  - MAIN: Must be null.
  - BRANCH/FRANCHISE: Required, must be a MAIN organization owned by yourself.
- `productType` (Required, enum): Store type, "beauty_salon" | "hair_salon" | "spa" | "restaurant" | "fast_food" | "cafe" | "beverage" | "home_studio" | "fitness" | "yoga_studio" | "retail" | "chinese_restautant" | "clinic" | "liquor_store" | "other".
- `description` (Optional, text): Description.
- `location` (Optional, string): Store address.
- `phone` (Optional, string): Store phone, international format.
- `email` (Optional, string): Store email.

**Processing Logic**:

1. Extract `userId` from access_token.
2. Validate `orgName` format (2-100 characters).
3. Validate `phone` format (using libphonenumber).
4. Validate `email` format.
5. Validate `parentOrgId` based on `orgType`:
   - If orgType = 'MAIN':
     - parentOrgId must be null.
     - User can own multiple MAIN organizations of different brands (e.g., owner of both 7-Eleven and Miniso).
   - If orgType = 'BRANCH' or 'FRANCHISE':
     - parentOrgId is required.
     - Query parent organization, validate:
       - Exists and userId = current user.
       - orgType = 'MAIN'.
       - productType = 'productType'.
       - status = 'ACTIVE'.
     - If validation fails → Return 400 "invalid_parent_org".
6. Create `Organization` record:
   - userId = Current User ID (Boss).
   - status = 'ACTIVE'.
7. Record in `audit_logs` (action='org_created').
8. Return created organization info.

**Success Response (201)**:

```json
{
  "success": true,
  "message": "Organization created successfully",
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "orgName": "My Beauty Salon Main",
    "orgType": "MAIN",
    "productType": "restaurant",
    "parentOrgId": null,
    "description": "Chinese Restaurant",
    "location": "123 Main St, Vancouver, BC, V6B 1A1",
    "phone": "+16041234567",
    "email": "store@example.com",
    "status": "ACTIVE",
    "createdAt": "2025-01-16T10:00:00.000Z",
    "updatedAt": "2025-01-16T10:00:00.000Z"
  }
}
```

**Error Response**:

```json
// 400 - Invalid parent organization
{
  "error": "invalid_parent_org",
  "detail": "Parent organization must be a MAIN organization that you own with matching product type"
}
```

---

### 2.2 Get All User Organizations

**Endpoint**: `GET /api/auth-service/v1/organizations`

**Request Headers**:

`Authorization: Bearer <access_token>`

**Query Parameters**:

- `orgType` (Optional, enum): Filter by organization type, "MAIN" | "BRANCH" | "FRANCHISE".
- `status` (Optional, enum): Filter by status, "ACTIVE" | "SUSPENDED" | "DELETED".
  - Default returns only ACTIVE.

**Processing Logic**:

1. Extract `userId` and `productType` from access_token.
2. Query `organizations` table:
   - Condition: userId = current user.
   - If orgType specified → AND orgType = ?.
   - If status specified → AND status = ?.
   - If status not specified → Default return only ACTIVE.
3. Sort by orgType (MAIN first), createdAt ASC.
4. For each organization, if it has parentOrgId, attach parent organization name.
5. Return list.

**Success Response (200)**:

```json
{
  "success": true,
  "data": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440001",
      "orgName": "My Beauty Salon Main",
      "orgType": "MAIN",
      "productType": "beauty-salon",
      "parentOrgId": null,
      "description": "Professional Beauty Services",
      "location": "123 Main St, Vancouver, BC",
      "phone": "+16041234567",
      "email": "main@example.com",
      "status": "ACTIVE",
      "createdAt": "2025-01-01T10:00:00.000Z"
    },
    {
      "id": "550e8400-e29b-41d4-a716-446655440002",
      "orgName": "Downtown Branch",
      "orgType": "BRANCH",
      "productType": "beauty-salon",
      "parentOrgId": "550e8400-e29b-41d4-a716-446655440001",
      "parentOrgName": "My Beauty Salon Main",
      "location": "456 Downtown St, Vancouver, BC",
      "status": "ACTIVE",
      "createdAt": "2025-01-10T10:00:00.000Z"
    },
    {
      "id": "550e8400-e29b-41d4-a716-446655440003",
      "orgName": "East Side Franchise",
      "orgType": "FRANCHISE",
      "productType": "beauty-salon",
      "parentOrgId": "550e8400-e29b-41d4-a716-446655440001",
      "parentOrgName": "My Beauty Salon Main",
      "location": "789 East St, Vancouver, BC",
      "status": "ACTIVE",
      "createdAt": "2025-01-15T10:00:00.000Z"
    }
  ],
  "total": 3
}
```

---

### 2.3 Get Single Organization Details

**Endpoint**: `GET /api/auth-service/v1/organizations/:orgId`

**Request Headers**:

`Authorization: Bearer <access_token>`

**Processing Logic**:

1. Extract `userId` and `organizationIds` from access_token.
2. Query `organizations` table (by id = orgId).
3. If not exists → Return 404 "org_not_found".
4. Check permissions:
   - If userId != org.userId → Return 403 "access_denied".
5. If has parentOrgId, query parent organization info (id and orgName).
6. Count child organizations:
   - branchCount: orgType=BRANCH and status=ACTIVE.
   - franchiseCount: orgType=FRANCHISE and status=ACTIVE.
7. Return detailed info.

**Success Response (200)**:

```json
{
  "success": true,
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440001",
    "orgName": "My Beauty Salon Main",
    "orgType": "MAIN",
    "productType": "beauty_salon",
    "parentOrgId": null,
    "description": "Professional Beauty Services",
    "location": "123 Main St, Vancouver, BC, V6B 1A1",
    "phone": "+16041234567",
    "email": "main@example.com",
    "status": "ACTIVE",
    "createdAt": "2025-01-01T10:00:00.000Z",
    "updatedAt": "2025-01-01T10:00:00.000Z",
    "statistics": {
      "branchCount": 2,
      "franchiseCount": 1
    }
  }
}
```

**Branch/Franchise Response Example**:

```json
{
  "success": true,
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440002",
    "orgName": "Downtown Branch",
    "orgType": "BRANCH",
    "productType": "beauty_salon",
    "parentOrgId": "550e8400-e29b-41d4-a716-446655440001",
    "parentOrgName": "My Beauty Salon Main",
    "description": "Downtown Flagship Store",
    "location": "456 Downtown St, Vancouver, BC",
    "phone": "+16042345678",
    "email": "downtown@example.com",
    "status": "ACTIVE",
    "createdAt": "2025-01-10T10:00:00.000Z",
    "updatedAt": "2025-01-10T10:00:00.000Z"
  }
}
```

**Error Response**:

```json
// 403 - Access denied
{
  "error": "access_denied",
  "detail": "You don't have permission to access this organization"
}

// 404 - Organization not found
{
  "error": "org_not_found",
  "detail": "Organization not found"
}
```

---

### 2.4 Update Organization Info

**Endpoint**: `PUT /api/auth-service/v1/organizations/:orgId`

**Request Headers**:

`Authorization: Bearer <access_token>`

**Request Body**:

```json
{
  "orgName": "My Beauty Salon Main (Updated)",
  "description": "Professional Beauty Services - 10 Years",
  "location": "New Address",
  "phone": "+16047654321",
  "email": "newemail@example.com",
  "productType": "beauty-salon"
}
```

**Field Description**:

- `orgName` (Optional, string): Organization name.
- `description` (Optional, text): Description.
- `location` (Optional, string): Address.
- `phone` (Optional, string): Phone.
- `email` (Optional, string): Email.
- `productType` (Optional, enum): Store type.

**Note**: Cannot modify orgType, parentOrgId, userId, status.

**Processing Logic**:

1. Extract `userId` from access_token.
2. Query `organizations` table (by id = orgId).
3. If not exists → Return 404.
4. Check permissions: userId != org.userId → Return 403.
5. Validate provided field formats.
6. Update `Organization` record (only update provided fields).
7. updatedAt = NOW().
8. Record in `audit_logs` (action='org_updated', record updated fields in detail).
9. Return updated info.

**Success Response (200)**:

```json
{
  "success": true,
  "message": "Organization updated successfully",
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440001",
    "orgName": "My Beauty Salon Main (Updated)",
    "orgType": "MAIN",
    "productType": "beauty_salon",
    "description": "Professional Beauty Services - 10 Years",
    "location": "New Address",
    "phone": "+16047654321",
    "email": "newemail@example.com",
    "status": "ACTIVE",
    "createdAt": "2025-01-01T10:00:00.000Z",
    "updatedAt": "2025-01-16T15:00:00.000Z"
  }
}
```

---

### 2.5 Delete Organization (Soft Delete)

**Endpoint**: `DELETE /api/auth-service/v1/organizations/:orgId`

**Request Headers**:

`Authorization: Bearer <access_token>`

**Processing Logic**:

1. Extract `userId` from access_token.
2. Query `organizations` table (by id = orgId).
3. If not exists → Return 404.
4. Check permissions: userId != org.userId → Return 403.
5. Check if there are active child organizations:
   - Query `organizations` (parentOrgId = orgId, status = 'ACTIVE').
   - If exists → Return 400 "has_active_children".
6. Check if there are active accounts:
   - Query `accounts` table (orgId = orgId, status = 'ACTIVE').
   - If exists → Return 400 "has_active_accounts".
7. Soft delete:
   - status = 'DELETED'.
   - updatedAt = NOW().
8. Record in `audit_logs` (action='org_deleted').
9. Return success.

**Success Response (200)**:

```json
{
  "success": true,
  "message": "Organization deleted successfully"
}
```

**Error Response**:

```json
// 400 - Has active children
{
  "error": "has_active_children",
  "detail": "Cannot delete organization with active branches or franchises. Please delete them first."
}

// 400 - Has active accounts
{
  "error": "has_active_accounts",
  "detail": "Cannot delete organization with active accounts. Please delete all accounts first."
}
```

---

# Auth Service v2.2.0 - Part 3: Account Management Module

## 3️⃣ Account Management Module (/api/auth-service/v1/accounts)

---

## 📋 Business Rules Description

### Account Types

**OWNER (Franchisee)**

- Has management permissions for the franchise store.
- Only applicable to FRANCHISE type organizations.

**MANAGER (Manager)**

- Manages daily operations of the organization.
- Applicable to all types of organizations.

**STAFF (Staff)**

- Executes specific business operations.
- Applicable to all types of organizations.

---

### Creation Permissions

**User (Boss) Creation Permissions:**

- For Main/Branch (MAIN/BRANCH): Can only create MANAGER.
- For Franchise (FRANCHISE): Can only create OWNER, and each franchise is limited to 1 OWNER.
- Must be the owner of the organization (org.userId = current User).
- Can view account information of all organizations owned (Read-only).

**Franchise OWNER Creation Permissions:**

- Can only create MANAGER and STAFF for their own franchise store.
- (If the franchise store subscribes to business-service, can manage all future implemented business-services for their franchise store. Scope to be defined later as business-service is not yet developed.)

**MANAGER Creation Permissions:**

- Can only create STAFF for their own organization.
- (If the franchise store subscribes to business-service, can manage all future implemented business-services for their franchise store. Scope to be defined later as business-service is not yet developed.)

**STAFF:**

- No creation permissions.

---

### Login Methods

**Backend Login (Owner / Manager):**

- Authentication: username + password.
- Token Type:
  - access_token valid for 60 minutes.
  - refresh_token valid for 30 days (Fixed, Uber style).

**POS Login (Owner / Manager / Staff):**

- Authentication: employeeNumber + pinCode + Device Binding.
- Token Type:
  - access_token valid for 4.5 hours (16200 seconds).
  - No refresh_token, must re-login after expiration.

---

### Account Field Description

**Fields for All Roles:**

- `employeeNumber`: Employee ID, unique within organization. (Stored as string in DB because some owners prefer numbers, others names, even Chinese names. Must support UTF-8, allowing names or numbers).
- `pinCode`: 4-digit numeric PIN, used for POS login.

**Fields Only for OWNER and MANAGER:**

- `username`: Username, globally unique, used for backend login.
- `password`: Password, used for backend login.

**STAFF Characteristics:**

- No `username` and `password`.
- Can only login via POS.

**Storage Rules:**

- `password` and `pinCode` are stored using bcrypt Hash.
- PIN code is shown in plain text once upon creation/reset, then cannot be viewed, only reset.

---

### Token Management

**Backend Login Token:**

- access_token: 60 minutes validity.
- refresh_token: 30 days fixed.
- Refresh Mechanism: Uber style, reuse refresh_token, only refresh access_token.

**POS Login Token:**

- access_token: 4.5 hours validity (16200 seconds).
- No refresh_token.
- Must re-login after expiration.

---

## 🔐 3.1 Account Backend Login (Owner/Manager)

**Endpoint:** `POST /api/auth-service/v1/accounts/login`

**Request Body:**

```json
{
  "username": "manager001",
  "password": "Password123!"
}
```

**Field Description:**

- `username` (Required, string): Account username, cannot contain @ symbol.
- `password` (Required, string): Password.

**Processing Logic:**

1. Validate `username` and `password` format.
2. Query `accounts` table (by username, status != 'DELETED').
3. If not exists → Return 401 "invalid_credentials".
4. Check account type: If accountType = 'STAFF' → Return 400 "staff_no_backend_access".
5. Check account status: If status != 'ACTIVE' → Return 401 "account_suspended".
6. Use `bcrypt.compare()` to verify password, if incorrect → Return 401 "invalid_credentials".
7. Query associated organization, validate productType and status.
8. Update `accounts.lastLoginAt` = NOW().
9. Record in `login_attempts` and `audit_logs`.
10. Return account and organization info.

**Success Response (200):**

```json
{
  "success": true,
  "account": {
    "id": "account-uuid",
    "username": "manager001",
    "employeeNumber": "EMP001",
    "accountType": "MANAGER",
    "status": "ACTIVE",
    "lastLoginAt": "2025-01-16T10:00:00.000Z"
  },
  "organization": {
    "id": "org-uuid",
    "orgName": "Downtown Branch",
    "orgType": "BRANCH",
    "productType": "beauty_salon",
    "status": "ACTIVE"
  }
}
```

**Note:** After successful login, frontend automatically calls `/oauth/token` to get access_token and refresh_token.

**Error Response:**

- 400 staff_no_backend_access: "Staff accounts cannot access the backend system. Please use POS login."
- 401 invalid_credentials: "Username or password is incorrect"
- 401 account_suspended: "This account has been suspended. Please contact your administrator."
- 403 org_inactive_or_mismatch: "Organization is inactive or does not match the product type"

---

## 📱 3.2 Account POS Login (Owner/Manager/STAFF)

**Endpoint:** `POST /api/auth-service/v1/accounts/login-pos`

**Request Headers:**

```
X-Device-ID: device-uuid  // Required
X-Session-Token: Kx7vZ9mW3Qp5RtY2jN8hU6fL1cV4bS0aO-iPqE3wXyD  // Required
```

**Request Body:**

```json
{
  "pinCode": "1234"
}
```

**Field Description:**

- `pinCode` (Required, string): 4-digit numeric PIN code.
- `deviceId` obtained from header `X-Device-ID`.
- `sessionToken` obtained from header `X-Session-Token`.

**Processing Logic:**

1. Get `X-Device-ID` and `X-Session-Token` from headers.
2. If missing `X-Device-ID` or `X-Session-Token` → Return 400 "missing_device_credentials".
3. Validate `pinCode` format.
4. Query Device:
   - Validate device exists and status = 'ACTIVE'.
   - If not exists or status incorrect → Return 403 "device_not_authorized".
5. Query DeviceSession:
   - Calculate SHA-256 hash of sessionToken.
   - Query `device_sessions` table to verify sessionTokenHash match.
   - If mismatch or session not exists → Return 403 "invalid_session".
6. Get `device.orgId`.
7. Query account corresponding to `pinCode` under that organization.
8. Use `bcrypt.compare()` to verify `pinCode`.
9. Validate organization status.
10. Update `DeviceSession.lastActiveAt` and `accounts.lastLoginAt`.
11. Record in `login_attempts` and `audit_logs`.
12. Return account, organization, and device info.

**Success Response (200):**

```json
{
  "success": true,
  "account": {
    "id": "account-uuid",
    "employeeNumber": "EMP001",
    "accountType": "STAFF",
    "status": "ACTIVE",
    "lastLoginAt": "2025-01-16T10:00:00.000Z"
  },
  "organization": {
    "id": "org-uuid",
    "orgName": "Downtown Branch",
    "orgType": "BRANCH",
    "productType": "beverage",
    "status": "ACTIVE"
  },
  "device": {
    "id": "device-uuid",
    "deviceName": "POS-001",
    "deviceType": "POS"
  }
}
```

**Note:** After successful login, frontend automatically calls `/oauth/token` to get 4.5 hours valid access_token (no refresh_token).

**Error Response:**

- 400 missing_device_credentials: "Missing X-Device-ID or X-Session-Token header"
- 401 invalid_credentials: "PIN code is incorrect"
- 403 device_not_authorized: "This device is not authorized for your organization or is inactive"
- 403 invalid_session: "Session token is invalid or expired. Please reactivate the device."
- 404 device_not_found: "Device not found"

---

## 🔑 3.3 Get OAuth Token (Unified Endpoint)

Refer to 1.5

---

## 🔄 3.4 Refresh Token (Backend Login Only)

Refer to 1.6

---

## 🚪 3.5 Account Logout

**Endpoint:** `POST /api/auth-service/v1/accounts/logout`

**Request Headers:**

`Authorization: Bearer <access_token>`

**Request Body:**

For Backend Logout:

```json
{
  "refresh_token": "def502004a8b7e2c..."
}
```

For POS Logout:

```json
{}
```

**Processing Logic:**

1. Extract `accountId`, `jti`, `deviceId` (if any) from Bearer token.
2. Determine login type: If payload has `deviceId` → POS Login.
3. If Backend Login: Revoke `refresh_token` (status='REVOKED').
4. If POS Login: Update `devices.lastActiveAt`.
5. Add `access_token`'s `jti` to Redis blacklist.
6. Record in `audit_logs`.

**Success Response (200):**

```json
{
  "success": true,
  "message": "Logged out successfully"
}
```

---

## ➕ 3.6 Create Account

**Endpoint:** `POST /api/auth-service/v1/accounts`

**Request Headers:**

`Authorization: Bearer <access_token>`

**Request Body:**

Create OWNER or MANAGER:

```json
{
  "orgId": "org-uuid",
  "accountType": "MANAGER",
  "username": "manager001",
  "password": "Password123!",
  "employeeNumber": "EMP001",
  "pinCode": "1234"
}
```

Create STAFF:

```json
{
  "orgId": "org-uuid",
  "accountType": "STAFF",
  "employeeNumber": "EMP002",
  "pinCode": "5678"
}
```

**Field Description:**

- `orgId` (Required, UUID): Organization ID.
- `accountType` (Required, enum): "OWNER" | "MANAGER" | "STAFF".
- `username` (Conditionally Required, string): Required for OWNER/MANAGER, globally unique, 4-50 characters, cannot contain @ symbol.
- `password` (Conditionally Required, string): Required for OWNER/MANAGER, at least 8 characters, including uppercase, lowercase, and numbers.
- `employeeNumber` (Required, string): Employee ID, unique within organization.
- `pinCode` (Required, string): 4-digit number, check uniqueness within org when creating, cannot duplicate.

**Permission Rules:**

- User: Can create MANAGER/STAFF for Main/Branch, can only create OWNER (limit 1) for Franchise.
- OWNER: Can only create MANAGER and STAFF.
- MANAGER: Can only create STAFF.
- STAFF: No permissions.

**Success Response (201):**

```json
{
  "success": true,
  "message": "Account created successfully",
  "data": {
    "id": "account-uuid",
    "orgId": "org-uuid",
    "accountType": "MANAGER",
    "username": "manager001",
    "employeeNumber": "EMP001",
    "pinCode": "1234",
    "status": "ACTIVE",
    "createdAt": "2025-01-16T10:00:00.000Z"
  },
  "warning": "Please save the PIN code. It will not be displayed again after this response."
}
```

**Error Response:**

- 403 can_not_create_owner: "You can not create OWNER accounts for MAIN and BRANCH organizations".
- 403 can_only_create_owner: "You can only create OWNER account for FRANCHISE organizations"
- 403 can_only_create_staff: "Managers can only create STAFF accounts"
- 409 owner_already_exists: "This franchise organization already has an OWNER account"
- 409 employee_number_exists: "This employee number already exists in this organization"
- 409 username_already_exists: "This username is already taken"
- 409 pinCode_already_exists: "This pin is already taken"

---

## 📋 3.7 Get All Accounts of Organization

**Endpoint:** `GET /api/auth-service/v1/accounts`

**Request Headers:**

`Authorization: Bearer <access_token>`

**Query Parameters:**

- `orgId` (Conditionally Required, UUID): Organization ID.
  - **User token**: Must provide (because User may own multiple organizations).
  - **Account token** (OWNER/MANAGER): Optional, automatically uses `organizationId` from token if not provided.
- `accountType` (Optional, enum): "OWNER" | "MANAGER" | "STAFF".
- `status` (Optional, enum): "ACTIVE" | "SUSPENDED" | "DELETED", default returns only ACTIVE.

**Permission Rules (Distinguished by Organization Type):**

**User (Boss) Permissions:**

- **MAIN/BRANCH Organization**: Can view all MANAGER and STAFF (because they are employees directly hired by him).
  - ✅ Can view: MANAGER, STAFF
  - ❌ Not exist: OWNER (MAIN/BRANCH does not allow OWNER)
- **FRANCHISE Organization**: Can only view OWNER (because only OWNER is the franchisee created by him).
  - ✅ Can view: OWNER
  - ❌ Cannot view: MANAGER, STAFF (These are OWNER's employees, not User's employees)

**OWNER (Franchisee Boss) Permissions:**

- Can view all MANAGER and STAFF of the same organization (his employees).
  - ✅ Can view: MANAGER, STAFF
  - ❌ Cannot view: Other OWNER (Multiple OWNERS do not exist)

**MANAGER (Manager) Permissions:**

- Can view other MANAGER and all STAFF of the same organization (colleagues and subordinates).
  - ✅ Can view: Other MANAGER, STAFF
  - ❌ Cannot view: OWNER (Superior Boss)

**STAFF (Staff) Permissions:**

- ❌ No query permissions.

**Scenario Examples:**

**Scenario 1: User queries MAIN organization (7-Eleven HQ Direct Store)**

```http
GET /api/auth-service/v1/accounts?orgId=main-org-uuid
Authorization: Bearer <user-token>
```

Returns: All MANAGER and STAFF of that store (User's employees).

**Scenario 2: User queries FRANCHISE organization (East Side Franchise)**

```http
GET /api/auth-service/v1/accounts?orgId=franchise-org-uuid
Authorization: Bearer <user-token>
```

Returns: Only the OWNER of that franchise (Franchisee created by User).
Does not return: MANAGER and STAFF of that franchise (These are OWNER's employees).

**Scenario 3: OWNER queries their own franchise store**

```http
GET /api/auth-service/v1/accounts
Authorization: Bearer <owner-token>
```

Returns: All MANAGER and STAFF of that franchise (OWNER's employees).

**Scenario 4: MANAGER queries employees of same organization**

```http
GET /api/auth-service/v1/accounts
Authorization: Bearer <manager-token>
```

Returns: Other MANAGER and all STAFF of that organization (colleagues and subordinates).
Does not return: OWNER (Superior Boss).

**Success Response (200):**

```json
{
  "success": true,
  "data": [
    {
      "id": "account-uuid-1",
      "orgId": "org-uuid",
      "accountType": "OWNER",
      "username": "franchisee001",
      "employeeNumber": "EMP000",
      "status": "ACTIVE",
      "lastLoginAt": "2025-01-16T09:00:00.000Z",
      "createdAt": "2025-01-15T10:00:00.000Z"
    }
  ],
  "total": 3
}
```

---

## 🔍 3.8 Get Single Account Details

**Endpoint:** `GET /api/auth-service/v1/accounts/:accountId`

**Request Headers:**

`Authorization: Bearer <access_token>`

**Permission Rules:**

- User: Can only view OWNER of their own franchise stores, and MANAGER and STAFF of their own main and branch stores.
- OWNER: Can view everyone in the same organization.
- MANAGER: Can only view STAFF in the same organization.
- STAFF: No permissions.

**Success Response (200):**

```json
{
  "success": true,
  "data": {
    "id": "account-uuid",
    "orgId": "org-uuid",
    "orgName": "East Side Franchise",
    "accountType": "MANAGER",
    "username": "manager001",
    "employeeNumber": "EMP001",
    "status": "ACTIVE",
    "lastLoginAt": "2025-01-16T08:30:00.000Z",
    "createdAt": "2025-01-15T10:05:00.000Z",
    "updatedAt": "2025-01-16T08:30:00.000Z",
    "createdBy": "user-uuid"
  }
}
```

---

## ✏️ 3.9 Update Account Info

**Endpoint:** `PATCH /api/auth-service/v1/accounts/:accountId`

**Request Headers:**

`Authorization: Bearer <access_token>`

**Request Body:**

```json
{
  "username": "manager001-new",
  "status": "SUSPENDED"
}
```

**Modifiable Fields:**

- `username` (Optional, string): Only OWNER/MANAGER.
- `status` (Optional, enum): "ACTIVE" | "SUSPENDED".

**Non-modifiable:**

- accountType, orgId, employeeNumber, password, pinCode.

**Permission Rules:**

- User: Can modify all except MANAGER and STAFF of FRANCHISE.
- OWNER: Can modify MANAGER and STAFF of same organization (cannot modify self).
- MANAGER: Can only modify STAFF of same organization (cannot modify self).

**Success Response (200):**

```json
{
  "success": true,
  "message": "Account updated successfully",
  "data": {
    "id": "account-uuid",
    "username": "manager001-new",
    "status": "SUSPENDED",
    "updatedAt": "2025-01-16T15:00:00.000Z"
  }
}
```

---

## 🗑️ 3.10 Delete Account (Soft Delete)

**Endpoint:** `DELETE /api/auth-service/v1/accounts/:accountId`

**Request Headers:**

`Authorization: Bearer <access_token>`

**Delete Rules:**

- User deletes OWNER: Cascade delete all MANAGER and STAFF of that organization.
- OWNER deletes MANAGER: No cascade, STAFF retained.
- MANAGER deletes STAFF: Direct delete.
- Cannot delete self.

**Permission Rules:**

- User: Can delete OWNER created by self, and all MANAGER and STAFF of MAIN or BRANCH.
- OWNER: Can delete MANAGER and STAFF of same organization.
- MANAGER: Can only delete STAFF of same organization.

**Success Response (200):**

```json
{
  "success": true,
  "message": "Account deleted successfully"
}
```

When cascade deleting:

```json
{
  "success": true,
  "message": "Account and all subordinates deleted successfully",
  "deletedCount": 5
}
```

**Error Response:**

- 400 cannot_delete_self: "You cannot delete your own account"
- 403 insufficient_permissions: "You don't have permission to delete this account"

---

## 🔒 3.11 Change Own Password

**Endpoint:** `POST /api/auth-service/v1/accounts/change-password`

**Request Headers:**

`Authorization: Bearer <access_token>`

**Request Body:**

```json
{
  "currentPassword": "OldPassword123!",
  "newPassword": "NewPassword456!"
}
```

**Permission Rules:**

- **Only ACCOUNT type tokens can use this endpoint** (USER token cannot use).
- Only applicable to OWNER and MANAGER (accounts with username/password).
- STAFF has no password, calling returns 400.

**Processing Logic:**

1. Validate token must be ACCOUNT type.
2. Validate current password is correct.
3. Validate new password strength (at least 8 chars).
4. Update password.
5. Revoke all refresh_tokens of this account (force re-login).

**Success Response (200):**

```json
{
  "success": true,
  "message": "Password changed successfully. Please log in again with your new password."
}
```

---

## 🔑 3.12 Reset Account Password (Admin Operation)

**Endpoint:** `POST /api/auth-service/v1/accounts/:accountId/reset-password`

**Request Headers:**

`Authorization: Bearer <access_token>`

**Request Body:**

```json
{
  "newPassword": "NewPassword123!"
}
```

**Permission Rules (Based on Organization Type):**

**USER Token:**

- **MAIN/BRANCH Organization**: Can only reset password for MANAGER (STAFF has no password).
- **FRANCHISE Organization**: No permission to reset password for anyone (OWNER/MANAGER/STAFF belong to OWNER, not USER).

**ACCOUNT Token:**

- **OWNER**: Can only reset password for MANAGER of same organization.
- **MANAGER**: No permission to reset password for anyone.
- **STAFF**: No permission.

**Restrictions:**

- STAFF has no password, calling returns 400.
- Resetting password will revoke all refresh_tokens of the target account, forcing target account to re-login.

**Success Response (200):**

```json
{
  "success": true,
  "message": "Password has been reset successfully. The account must log in again."
}
```

---

## 📌 3.13 Reset Account PIN Code

**Endpoint:** `POST /api/auth-service/v1/accounts/:accountId/reset-pin`

**Request Headers:**

`Authorization: Bearer <access_token>`

**Request Body:**

```json
{
  "newPinCode": "5678"
}
```

**Permission Rules (Based on Organization Type):**

**USER Token:**

- **MAIN/BRANCH Organization**: Can reset PIN for MANAGER and STAFF.
- **FRANCHISE Organization**: Can only reset PIN for OWNER (MANAGER/STAFF belong to OWNER, not USER).

**ACCOUNT Token:**

- **OWNER**: Can reset PIN for everyone in organization (including self, MANAGER, STAFF).
- **MANAGER**: Can only reset PIN for STAFF and self.
  - Cannot reset for other MANAGER (Peer).
  - Cannot reset for OWNER (Superior).
- **STAFF**: No permission.

**Success Response (200):**

```json
{
  "success": true,
  "message": "PIN code has been reset successfully",
  "newPinCode": "5678",
  "warning": "Please save this PIN code. It will not be displayed again."
}
```

**Note:**

- `newPinCode` is displayed only once in this response, please save it safely.
- PIN code must be 4 digits.

---

## 🔐 Database Constraints

**employeeNumber Uniqueness (Within Organization, Only ACTIVE):**

```sql
CREATE UNIQUE INDEX idx_accounts_org_employee_active
ON accounts (org_id, employee_number)
WHERE status = 'ACTIVE';
```

**username Uniqueness (Global, Only ACTIVE):**

```sql
CREATE UNIQUE INDEX idx_accounts_username_active
ON accounts (username)
WHERE status = 'ACTIVE' AND username IS NOT NULL;
```

This allows `employeeNumber` and `username` to be reused after soft deletion.

---

# Auth Service v2.2.0 - Part 4: Device Management Module (Final)

## 4️⃣ Device Management Module (`/api/auth-service/v1/devices`)

---

## 📋 Business Rules Description

### Device Types (deviceType)

**POS (Point of Sale)**

- Point of sale terminal.
- Used for processing transactions, cashier operations, etc.
- Used by employees, requires POS login.

**KIOSK**

- Self-service terminal.
- Used for customer self-ordering, inquiries, etc.
- Used by customers, no login required.

**TABLET**

- Tablet device.
- Used for mobile cashier, ordering, etc.
- Used by employees, requires POS login.

---

### Device Status (status)

**PENDING (Pending Activation)**

- Device just created, has `deviceId` and `activationCode`.
- Waiting to input this pair of codes on the physical machine for activation.
- Cannot be used for POS login or business operations.

**ACTIVE (Activated)**

- Device has been activated on the physical machine.
- Can be used normally, employees can POS login (POS/TABLET).
- Customers can use self-service (KIOSK).
- Valid for 1 year.

**DELETED (Deleted)**

- Soft deleted status.
- Device record retained but unusable.
- Irreversible.

---

### Activation Code Mechanism

**Activation Code Features:**

- Globally unique.
- Used in pair with `deviceId`.
- Must input `deviceId` + `activationCode` simultaneously to activate the device.
- Does not expire after activation (unless manually updated).
- No expiration time.

**Activation Flow:**

1. User creates device in backend (select `deviceType`, fill `orgId`).
2. System generates a pair of `deviceId` and `activationCode`.
3. User informs on-site staff of this pair of codes.
4. On-site staff inputs `deviceId` + `activationCode` + `deviceName` on the physical machine.
5. System verifies if the pairing is correct.
6. Device status becomes ACTIVE, records activation time and expiry (1 year).

**Scenarios for Updating Activation Code:**

- User wants to replace the physical machine for a device.
- Needs to provide `deviceId` + `orgId` + `deviceType` + original `activationCode`.
- Prerequisite: Device status must be ACTIVE.
- System generates new `activationCode`.
- Original machine becomes invalid, waiting for new machine to activate with new code.

---

### Device Lifecycle Management

**Validity Rules:**

- Set `expiresAt` = NOW() + 1 year upon activation.
- Device status is fully managed manually by user or administrator.

**Active Time Update:**

- **POS/TABLET**: Automatically updates `lastActiveAt` when employee logs in via POS.
- **KIOSK**: Updates `lastActiveAt` during business operations (handled by business module, not auth-service).

---

### Creation Permissions

**User (Boss):**

- Can create devices for any organization they own.
- Automatically generates unique `deviceId` and `activationCode` upon creation.

**Account (OWNER/MANAGER/STAFF):**

- No creation permissions.
- Only User can create devices.

---

### View Permissions

**User:**

- Can view devices of all organizations they own.

**Account (OWNER/MANAGER):**

- Can only view devices of their own organization.

**Account (STAFF):**

- No backend access permissions.

---

### Modify/Delete Permissions

**User:**

- Can modify devices of all organizations they own.
- Can delete devices (soft delete).
- Can update activation code.

**Account (OWNER/MANAGER):**

- Can only modify device name (`deviceName`).
- Cannot delete devices.
- Cannot update activation code.

**Account (STAFF):**

- No backend access permissions.

---

## ➕ 4.1 Create Device (Generate Activation Code)

**Endpoint:** `POST /api/auth-service/v1/devices`

**Request Headers:**

`Authorization: Bearer <access_token>`

**Request Body:**

```json
{
  "orgId": "org-uuid",
  "deviceType": "POS",
  "deviceName": "POS-001"
}
```

**Field Description:**

- `orgId` (Required, UUID): Organization ID.
- `deviceType` (Required, enum): "POS" | "KIOSK" | "TABLET".
- `deviceName` (Required, string): Only user can name the machine when creating.

---

### Processing Logic

1. Extract `userType`, `userId` from access_token. Only user token allowed, account token not allowed.
2. If userType != 'USER' → Return 403 "only_user_can_create_device".
3. Query organization, validate org.userId = current User ID.
4. Validate `deviceName` uniqueness within that org.
5. Validate org.status = 'ACTIVE'.
6. Generate unique `activationCode` (9 uppercase alphanumeric characters).
7. Generate unique `deviceId` (9 lowercase alphanumeric characters).
8. Create device record:
   - id (UUID) = deviceId
   - orgId
   - deviceType
   - deviceName = “POS-001”
   - activationCode
   - status = 'PENDING'
   - createdAt = NOW()
   - updatedAt = NOW()
9. Record in `audit_logs`.
10. Return `deviceId` and `activationCode`.

---

### Success Response (201)

```json
{
  "success": true,
  "message": "Device created successfully",
  "data": {
    "deviceId": "device-uuid",
    "orgId": "org-uuid",
    "orgName": "Downtown Branch",
    "deviceType": "POS",
    "deviceName": "POS-001",
    "activationCode": "ABC123XYZ",
    "status": "PENDING",
    "createdAt": "2025-01-16T10:00:00.000Z"
  },
  "warning": "Please save the deviceId and activationCode. Both are required to activate the device on-site."
}
```

**Note:** `deviceId` and `activationCode` must be used together to activate the device.

---

### Error Response

**403 - Insufficient Permissions**

```json
{
  "error": "only_user_can_create_device",
  "detail": "Only User (owner) can create devices"
}
```

**404 - Organization Not Found**

```json
{
  "error": "org_not_found",
  "detail": "Organization not found"
}
```

**403 - Access Denied**

```json
{
  "error": "access_denied",
  "detail": "You don't have permission to create devices for this organization"
}
```

**403 - Device Name Repeated**

```json
{
  "error": "deviceName_repeated",
  "detail": "The device name is occupied."
}
```

---

## 🔓 4.2 Activate Device

**Endpoint:** `POST /api/auth-service/v1/devices/activate`

**Request Headers:**

No authentication required.

**Request Body:**

```json
{
  "deviceId": "device-uuid",
  "activationCode": "ABC123XYZ"
}
```

**Field Description:**

- `deviceId` (Required, UUID): Device ID.
- `activationCode` (Required, string): 9-digit activation code.

**Note:** This endpoint does not require Authorization because the device is not yet activated. The activation interface supports idempotent operations and can be activated repeatedly using the same `deviceId` + `activationCode`.

---

### Processing Logic

1. Validate `deviceId` and `activationCode` format.
2. Query Device:
   ```sql
   SELECT * FROM devices
   WHERE id = deviceId
     AND activation_code = activationCode
   ```
3. If not exists → Return 404 "invalid_device_or_code".
4. If activationCode does not match → Return 404 "invalid_device_or_code".
5. Query organization, validate org.status = 'ACTIVE'.
6. Generate sessionToken:
   - Use `crypto.randomBytes(32)` to generate 256-bit random number.
   - Convert to base64url format (43 characters).
   - Calculate SHA-256 hash for database storage.
7. Query or Create DeviceSession:
   - If deviceId already has session → Overwrite old sessionTokenHash (Idempotent activation).
   - If no session → Create new session.
8. Update device status:
   - status = 'ACTIVE'
   - activatedAt = NOW()
   - updatedAt = NOW()
9. Record in `audit_logs`.
10. Return device info and sessionToken (Plain text, only once).

---

### Success Response (200)

```json
{
  "success": true,
  "message": "Device activated successfully",
  "data": {
    "deviceId": "device-uuid",
    "sessionToken": "Kx7vZ9mW3Qp5RtY2jN8hU6fL1cV4bS0aO-iPqE3wXyD",
    "device": {
      "id": "device-uuid",
      "orgId": "org-uuid",
      "orgName": "Downtown Branch",
      "deviceType": "POS",
      "deviceName": "Cashier-001",
      "status": "ACTIVE",
      "activatedAt": "2025-01-16T10:30:00.000Z"
    }
  },
  "warning": "Please save deviceId and sessionToken to localStorage and IndexedDB. The sessionToken will not be shown again."
}
```

---

### Error Response

**404 - Invalid Device ID or Code**

```json
{
  "error": "invalid_device_or_code",
  "detail": "Invalid deviceId or activationCode, or device already activated"
}
```

**400 - Device Already Activated**

```json
{
  "error": "device_already_activated",
  "detail": "This device has already been activated"
}
```

**403 - Organization Inactive**

```json
{
  "error": "org_inactive",
  "detail": "The organization is inactive. Please contact support."
}
```

---

## 🔄 4.3 Update Activation Code

**Endpoint:** `POST /api/auth-service/v1/devices/:deviceId/update-activation-code`

**Request Headers:**

`Authorization: Bearer <access_token>`

**Request Body:**

```json
{
  "orgId": "org-uuid",
  "deviceType": "POS",
  "newDeviceName": "POS-001",
  "currentActivationCode": "ABC123XYZ"
}
```

**Field Description:**

- `orgId` (Required, UUID): Organization ID.
- `deviceType` (Required, enum): "POS" | "KIOSK" | "TABLET".
- `newDeviceName` (Optional, string): "If not filled, keep previous name. If filled, check if new name is repeated. If repeated -> error. If not repeated, usable. e.g. POS-001"
- `currentActivationCode` (Required, string): Current activation code.

---

### Processing Logic

1. Extract `userType`, `userId` from access_token.
2. If userType != 'USER' → Return 403 "only_user_can_update_code".
3. Query Device (by id = deviceId).
4. If not exists → Return 404 "device_not_found".
5. Validate device info:
   - device.orgId = request body orgId
   - device.deviceType = request body deviceType
   - device.activationCode = request body currentActivationCode
   - If mismatch → Return 400 "device_info_mismatch"
   - Check if new name is filled, if not, keep previous name.
   - If new name filled, check duplication. If duplicated -> error. If not -> usable.
6. Validate device status:
   - If status != 'ACTIVE' → Return 400 "device_not_active".
7. Query organization, validate org.userId = current User ID.
8. Generate new activationCode.
9. Update device:
   - status = 'PENDING' (Back to pending activation)
   - activationCode = New activation code
   - deviceName = "newDeviceName"
   - activatedAt = NULL
   - lastActiveAt = NULL
   - deviceFingerprint = NULL
   - updatedAt = NOW()
10. Record in `audit_logs`.
11. Return new activationCode.

---

### Success Response (200)

```json
{
  "success": true,
  "message": "Activation code updated successfully. The previous device is now deactivated.",
  "data": {
    "deviceId": "device-uuid",
    "orgId": "org-uuid",
    "deviceType": "POS",
    "deviceName": "POS-001",
    "newActivationCode": "XYZ789ABC",
    "status": "PENDING"
  },
  "warning": "Please save the new activation code. The device must be activated again with this new code."
}
```

---

### Error Response

**403 - Insufficient Permissions**

```json
{
  "error": "only_user_can_update_code",
  "detail": "Only User (owner) can update activation code"
}
```

**404 - Device Not Found**

```json
{
  "error": "device_not_found",
  "detail": "Device not found"
}
```

**400 - Device Info Mismatch**

```json
{
  "error": "device_info_mismatch",
  "detail": "Device orgId, deviceType, or activationCode does not match"
}
```

**400 - Device Not Active**

```json
{
  "error": "device_not_active",
  "detail": "Only ACTIVE devices can have their activation code updated"
}
```

**409 - New Name Repeated**

```json
{
  "error": "device_name_repeated",
  "detail": "Device name is occupied."
}
```

---

## 📋 4.4 Get All Devices of Organization

**Endpoint:** `GET /api/auth-service/v1/devices`

**Request Headers:**

`Authorization: Bearer <access_token>`

**Query Parameters:**

- `orgId` (Required, UUID): Organization ID.
- `deviceType` (Optional, enum): "POS" | "KIOSK" | "TABLET".
- `status` (Optional, enum): "PENDING" | "ACTIVE" | "DELETED".
  - Default returns PENDING, ACTIVE (Excludes DELETED).

---

### Processing Logic

1. Extract `userType`, `userId` or `accountId` from access_token.
2. Query Organization (by id = orgId).
3. If not exists → Return 404 "org_not_found".
4. Permission Check:
   - If userType = 'USER':
     - Validate org.userId = current User ID.
   - If userType = 'ACCOUNT':
     - Query current Account, validate account.orgId = orgId.
     - If accountType = 'STAFF' → Return 403 "staff_no_backend_access".
5. Query Device List:
   - Condition: orgId = orgId.
   - Optional Filter: deviceType, status.
   - Default exclude DELETED status.
   - Sort: status (ACTIVE first), createdAt DESC.
6. Return list (Do not return activationCode).

---

### Success Response (200)

```json
{
  "success": true,
  "data": [
    {
      "id": "device-uuid-1",
      "orgId": "org-uuid",
      "deviceType": "POS",
      "deviceName": "Cashier-001",
      "status": "ACTIVE",
      "activatedAt": "2025-01-15T10:00:00.000Z",
      "lastActiveAt": "2025-01-16T09:30:00.000Z",
      "createdAt": "2025-01-15T09:00:00.000Z"
    },
    {
      "id": "device-uuid-2",
      "orgId": "org-uuid",
      "deviceType": "KIOSK",
      "deviceName": null,
      "status": "PENDING",
      "activatedAt": null,
      "lastActiveAt": null,
      "createdAt": "2025-01-16T08:00:00.000Z"
    },
    {
      "id": "device-uuid-3",
      "orgId": "org-uuid",
      "deviceType": "TABLET",
      "deviceName": "Mobile-POS-001",
      "status": "ACTIVE",
      "activatedAt": "2024-12-01T10:00:00.000Z",
      "lastActiveAt": "2024-12-15T15:00:00.000Z",
      "createdAt": "2024-12-01T09:00:00.000Z"
    }
  ],
  "total": 3
}
```

---

## 🔍 4.5 Get Single Device Details

**Endpoint:** `GET /api/auth-service/v1/devices/:deviceId`

**Request Headers:**

`Authorization: Bearer <access_token>`

---

### Processing Logic

1. Extract `userType`, `userId` or `accountId` from access_token.
2. Query Device (by id = deviceId, status != 'DELETED').
3. If not exists → Return 404 "device_not_found".
4. Query associated organization.
5. Permission Check:
   - If userType = 'USER':
     - Validate org.userId = current User ID.
   - If userType = 'ACCOUNT':
     - Query current Account, validate account.orgId = device.orgId.
     - If accountType = 'STAFF' → Return 403 "staff_no_backend_access".
6. Return detailed info (Do not return activationCode).

---

### Success Response (200)

```json
{
  "success": true,
  "data": {
    "id": "device-uuid",
    "orgId": "org-uuid",
    "orgName": "Downtown Branch",
    "deviceType": "POS",
    "deviceName": "Cashier-001",
    "status": "ACTIVE",
    "activatedAt": "2025-01-15T10:00:00.000Z",
    "lastActiveAt": "2025-01-16T09:30:00.000Z",
    "deviceFingerprint": {
      "userAgent": "Mozilla/5.0 ...",
      "screen": "1024x768",
      "timezone": "America/Vancouver"
    },
    "createdAt": "2025-01-15T09:00:00.000Z",
    "updatedAt": "2025-01-16T09:30:00.000Z"
  }
}
```

---

## ✏️ 4.6 Update Device Info

**Endpoint:** `PATCH /api/auth-service/v1/devices/:deviceId`

**Request Headers:**

`Authorization: Bearer <access_token>`

**Request Body:**

```json
{
  "deviceName": "Cashier-001-NewName"
}
```

**Field Description:**

- `deviceName` (Optional, string): Device name, 1-100 characters.

**Non-modifiable Fields:**

- deviceType
- orgId
- activationCode (Use dedicated update activation code endpoint)
- status (Managed by system)

---

### Processing Logic

1. Extract `userType`, `userId` or `accountId` from access_token.
2. Query Device (by id = deviceId, status != 'DELETED').
3. If not exists → Return 404 "device_not_found".
4. Query associated organization.
5. Permission Check:
   - If userType = 'USER':
     - Validate org.userId = current User ID.
   - If userType = 'ACCOUNT':
     - Query current Account, validate account.orgId = device.orgId.
     - If accountType = 'STAFF' → Return 403 "staff_no_backend_access".
6. Validate `deviceName` not empty.
7. Update Device:
   - deviceName
   - updatedAt = NOW()
8. Record in `audit_logs`.
9. Return updated info.

---

### Success Response (200)

```json
{
  "success": true,
  "message": "Device updated successfully",
  "data": {
    "id": "device-uuid",
    "deviceName": "Cashier-001-NewName",
    "updatedAt": "2025-01-16T15:00:00.000Z"
  }
}
```

---

## 🗑️ 4.7 Delete Device (Soft Delete)

**Endpoint:** `DELETE /api/auth-service/v1/devices/:deviceId`

**Request Headers:**

`Authorization: Bearer <access_token>`

---

### Processing Logic

1. Extract `userType`, `userId` from access_token.
2. If userType != 'USER' → Return 403 "only_user_can_delete_device".
3. Query Device (by id = deviceId, status != 'DELETED').
4. If not exists → Return 404 "device_not_found".
5. Query associated organization, validate org.userId = current User ID.
6. Soft Delete Device:
   - status = 'DELETED'
   - updatedAt = NOW()
7. Record in `audit_logs`.
8. Return success.

---

### Success Response (200)

```json
{
  "success": true,
  "message": "Device deleted successfully"
}
```

---

### Error Response

**403 - Insufficient Permissions**

```json
{
  "error": "only_user_can_delete_device",
  "detail": "Only User (owner) can delete devices"
}
```

**404 - Device Not Found**

```json
{
  "error": "device_not_found",
  "detail": "Device not found"
}
```

---

## 🔍 4.8 Query Device Session Status

**Endpoint:** `GET /api/auth-service/v1/devices/:deviceId/session`

**Request Headers:**

`Authorization: Bearer <access_token>`

**Purpose:**

- User/Manager/Owner queries if device has active session.
- Check device activation status.
- View session last active time.

---

### Processing Logic

1. Extract `userType`, `userId` or `accountId` from access_token.
2. Query Device (by id = deviceId).
3. If not exists → Return 404 "device_not_found".
4. Query associated organization.
5. Permission Check:
   - If userType = 'USER':
     - Validate org.userId = current User ID.
   - If userType = 'ACCOUNT':
     - Query current Account, validate account.orgId = device.orgId.
     - If accountType = 'STAFF' → Return 403 "staff_no_backend_access".
6. Query DeviceSession (by deviceId).
7. Return session status info (Do not return sessionToken).

---

### Success Response (200)

**Active Session:**

```json
{
  "success": true,
  "data": {
    "deviceId": "device-uuid",
    "sessionStatus": "ACTIVE",
    "activatedAt": "2025-01-15T10:00:00.000Z",
    "lastActiveAt": "2025-01-16T09:30:00.000Z",
    "sessionExists": true
  }
}
```

**No Session (Not Activated):**

```json
{
  "success": true,
  "data": {
    "deviceId": "device-uuid",
    "sessionStatus": null,
    "sessionExists": false,
    "message": "Device has not been activated yet"
  }
}
```

---

### Error Response

**403 - Insufficient Permissions**

```json
{
  "error": "access_denied",
  "detail": "You don't have permission to view this device's session"
}
```

**403 - STAFF No Backend Access**

```json
{
  "error": "staff_no_backend_access",
  "detail": "Staff accounts cannot access the backend system"
}
```

**404 - Device Not Found**

```json
{
  "error": "device_not_found",
  "detail": "Device not found"
}
```

---

# Auth Service v2.2.0 - Part 5: OAuth Standard Endpoints

## 5️⃣ OAuth Standard Endpoints (`/oauth`, `/jwks.json`, `/userinfo`)

---

## 📋 Overview

This module provides standardized OAuth endpoints, mainly used for:

1. Token validation between microservices.
2. Getting current user/account info.
3. Blacklist query for internal services.

**Note:**

- This system is not a complete OAuth2/OIDC implementation.
- Does not support third-party app authorization.
- Mainly used for internal microservice architecture.

---

## 🔑 5.1 Get JWT Public Key

**Endpoint:** `GET /jwks.json`

**Purpose:**

- Other microservices get public key to verify JWT signature.
- Compliant with JWKS (JSON Web Key Set) standard.

**Request Headers:** No authentication required.

---

### Processing Logic

1. Read auth-service's RSA public key.
2. Convert to JWKS format.
3. Return public key info.

---

### Success Response (200)

```json
{
  "keys": [
    {
      "kty": "RSA",
      "use": "sig",
      "kid": "auth-service-key-2025",
      "alg": "RS256",
      "n": "0vx7agoebGcQSuuPiLJXZptN9nndrQmbXEps2aiAFbWhM78LhWx4cbbfAAtV...",
      "e": "AQAB"
    }
  ]
}
```

**Field Description:**

- `kty`: Key Type, fixed "RSA".
- `use`: Public Key Use, fixed "sig" (signature).
- `kid`: Key ID, key identifier.
- `alg`: Algorithm, fixed "RS256".
- `n`: RSA public key modulus (Base64 URL encoded).
- `e`: RSA public key exponent (Base64 URL encoded).

---

### Usage Example

**Other Microservices Verify JWT:**

```javascript
// business-service gets public key on startup
const jwks = await fetch("https://auth-service/jwks.json").then((r) =>
  r.json()
);
const publicKey = convertJWKSToPublicKey(jwks.keys[0]);

// Verify JWT
function verifyToken(token) {
  try {
    const payload = jwt.verify(token, publicKey, {
      algorithms: ["RS256"],
    });
    return payload;
  } catch (error) {
    throw new Error("Invalid token");
  }
}
```

---

## 👤 5.2 Get Current User Info

**Endpoint:** `GET /userinfo`

**Purpose:**

- Get detailed info of current token's user/account.
- Frontend does not need to know userId or accountId.
- Directly use token to query "Who am I".

**Request Headers:**

`Authorization: Bearer <access_token>`

---

### Processing Logic

1. Extract JWT from Bearer token.
2. Verify JWT signature.
3. Check if `jti` is in blacklist.
4. Extract `userType` from payload.
5. Query corresponding info based on `userType`:
   - If userType = 'USER': Query `users` table.
   - If userType = 'ACCOUNT': Query `accounts` table.
6. Return detailed info.

---

### Success Response (200)

**User Response:**

```json
{
  "success": true,
  "userType": "USER",
  "data": {
    "email": "user@example.com",
    "firstName": "John",
    "lastName": "Doe",
    "phone": "+1234567890",
    "status": "ACTIVE",
    "emailVerified": true,
    "createdAt": "2025-01-10T10:00:00.000Z",
    "organizations": [
      {
        "id": "org-uuid-1",
        "orgName": "Main Store",
        "orgType": "MAIN",
        "productType": "beauty_salon"
      },
      {
        "id": "org-uuid-2",
        "orgName": "East Branch",
        "orgType": "BRANCH",
        "productType": "beauty_salon"
      }
    ]
  }
}
```

**Account Response:**

```json
{
  "success": true,
  "userType": "ACCOUNT",
  "data": {
    "username": "manager001",
    "employeeNumber": "EMP001",
    "accountType": "MANAGER",
    "status": "ACTIVE",
    "lastLoginAt": "2025-01-16T09:30:00.000Z",
    "createdAt": "2025-01-15T10:00:00.000Z",
    "organization": {
      "id": "org-uuid",
      "orgName": "East Branch",
      "orgType": "BRANCH",
      "productType": "beauty_salon"
    }
  }
}
```

**Note:**

- Do not return sensitive info (passwordHash, pinCodeHash, etc.).
- User returns all associated organizations.
- Account only returns the single organization it belongs to.

---

### Error Response

**401 - Invalid Token**

```json
{
  "error": "invalid_token",
  "detail": "Token is invalid or expired"
}
```

**401 - Token Revoked**

```json
{
  "error": "token_revoked",
  "detail": "Token has been revoked"
}
```

**404 - User Not Found**

```json
{
  "error": "user_not_found",
  "detail": "User or account not found"
}
```

---

## 🔍 5.3 Check Token Blacklist (Internal Service Use)

**Endpoint:** `POST /api/auth-service/v1/internal/token/check-blacklist`

**Purpose:**

- Other microservices verify if token has been revoked.
- Internal service calls only.

**Request Headers:**

`X-Internal-Service-Key: <shared-secret-key>`

**Request Body:**

```json
{
  "jti": "token-uuid"
}
```

**Field Description:**

- `jti` (Required, string): JWT unique identifier (extracted from token payload).

---

### Processing Logic

1. Validate `X-Internal-Service-Key` (Prevent external calls).
2. If validation fails → Return 403 "invalid_service_key".
3. Extract `jti` from request body.
4. Query Redis:
   ```
   EXISTS token:blacklist:{jti}
   ```
5. Return whether in blacklist.

---

### Success Response (200)

**Token in Blacklist:**

```json
{
  "success": true,
  "blacklisted": true,
  "reason": "user_logout"
}
```

**Token Not in Blacklist:**

```json
{
  "success": true,
  "blacklisted": false
}
```

---

### Error Response

**403 - Invalid Service Key**

```json
{
  "error": "invalid_service_key",
  "detail": "Invalid internal service key"
}
```

**400 - Missing jti**

```json
{
  "error": "missing_jti",
  "detail": "jti is required"
}
```

---

### Usage Example

**Other Microservices Call:**

```javascript
// business-service token verification flow
async function verifyToken(token) {
  // 1. Verify JWT signature (using public key)
  const payload = jwt.verify(token, publicKey);

  // 2. Check blacklist (call auth-service)
  const blacklistResult = await fetch(
    "https://auth-service/api/auth-service/v1/internal/token/check-blacklist",
    {
      method: "POST",
      headers: {
        "X-Internal-Service-Key": process.env.INTERNAL_SERVICE_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ jti: payload.jti }),
    }
  ).then((r) => r.json());

  if (blacklistResult.blacklisted) {
    throw new Error("Token revoked");
  }

  return payload;
}
```

---

## 📊 Endpoint Summary

**Public Endpoints:**

- 5.1 GET /jwks.json - Get JWT Public Key

**Authentication Required:**

- 5.2 GET /userinfo - Get Current User Info

**Internal Service Only:**

- 5.3 POST /api/auth-service/v1/internal/token/check-blacklist - Check single token

**Implemented in Other Modules:**

- POST /oauth/token (Part 1, 3)
- Logout Interface (Part 1, 3)

---

## 🏗️ Microservice Integration Architecture

```
┌──────────────────────────────────────────────────────┐
│                    Frontend                          │
│  - Call auth-service login, get token                │
│  - Call other services with token                    │
└────────────────┬─────────────────────────────────────┘
                 │
        ┌────────┼────────┐
        │        │        │
        ▼        ▼        ▼
┌──────────┐ ┌──────────┐ ┌──────────┐
│  Auth    │ │Business  │ │Subscrip- │
│ Service  │ │ Service  │ │  tion    │
└────┬─────┘ └────┬─────┘ └──────────┘
     │            │
     │ 1. GET /jwks.json
     │◄───────────┤
     │ Return PubKey│
     │            │
     │ 2. POST /internal/token/check-blacklist
     │◄───────────┤
     │ Check Blacklist│
     │            │
┌────▼─────┐      │
│  Redis   │      │
│ (Blacklist)│      │
└──────────┘      │
                  │
                  ▼
            Verify Pass, Execute Business Logic
```

---

## 🔒 Security Notes

### 1. Internal Service Key Management

**X-Internal-Service-Key:**

- Key shared by all internal services.
- Stored in environment variables, not hardcoded.
- Rotate regularly (e.g., quarterly).
- Only known to trusted internal services.

**Recommended Config:**

```bash
# .env
INTERNAL_SERVICE_KEY=sk_internal_a1b2c3d4e5f6g7h8i9j0
```

### 2. JWKS Public Key Security

**Public Key can be public, but prevent tampering:**

- Use HTTPS.
- Other services fetch once on startup, cache public key.
- Refresh regularly (e.g., hourly).
- If JWT verification fails, re-fetch public key and retry.

### 3. Blacklist Consistency

**Redis Blacklist Features:**

- Key Format: `token:blacklist:{jti}`
- Value: "revoked"
- TTL: Remaining validity of token

**Consistency Guarantee:**

- Write to Redis immediately upon logout.
- Other services cache "not in blacklist" result for 10 seconds.
- Max 10 seconds delay, acceptable.

---

## 📈 Performance Optimization Suggestions

### 1. Public Key Caching

**Other services should:**

```javascript
// Fetch public key on startup
let publicKey = null;
let lastFetch = 0;

async function getPublicKey() {
  // Use cache within 1 hour
  if (publicKey && Date.now() - lastFetch < 3600000) {
    return publicKey;
  }

  // Re-fetch
  const jwks = await fetch("https://auth-service/jwks.json").then((r) =>
    r.json()
  );
  publicKey = convertJWKS(jwks.keys[0]);
  lastFetch = Date.now();

  return publicKey;
}
```

### 2. Blacklist Caching

**business-service implementation:**

```javascript
const blacklistCache = new Map();

async function checkBlacklist(jti) {
  // Check cache (valid for 10s)
  const cached = blacklistCache.get(jti);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.blacklisted;
  }

  // Call auth-service
  const result = await authService.checkBlacklist(jti);

  // Only cache "not in blacklist" result
  if (!result.blacklisted) {
    blacklistCache.set(jti, {
      blacklisted: false,
      expiresAt: Date.now() + 10000, // 10s
    });
  }

  return result.blacklisted;
}
```

---

## 🔄 Token Validation Complete Flow

**Standard Validation Flow for Other Microservices:**

```javascript
async function authenticateRequest(req, res, next) {
  try {
    // 1. Extract token
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) return res.status(401).json({ error: "no_token" });

    // 2. Verify JWT signature (using public key, local verification)
    const publicKey = await getPublicKey();
    const payload = jwt.verify(token, publicKey, { algorithms: ["RS256"] });

    // 3. Check blacklist (call auth-service, with cache)
    const blacklisted = await checkBlacklistWithCache(payload.jti);
    if (blacklisted) {
      return res.status(401).json({ error: "token_revoked" });
    }

    // 4. Verification passed, attach payload to request
    req.user = payload;
    next();
  } catch (error) {
    return res.status(401).json({ error: "invalid_token" });
  }
}

// Usage
app.use("/api/business-service", authenticateRequest);
```

---

## 💡 Coordination with Subscription Check

**Complete Request Validation Flow:**

```javascript
async function handleBusinessRequest(req, res) {
  // 1. Verify token (flow above) // req.user already contains JWT payload

  // 2. Check subscription status (cache 30 mins)
  const subscription = await getSubscriptionWithCache(
    req.user.organizationId,
    30 * 60 * 1000
  );

  if (subscription.status !== "active") {
    return res.status(403).json({ error: "subscription_expired" });
  }

  // 3. Execute business logic // ...
}
```

---

# Auth Service v2.2.0 - Part 6: Admin Management Endpoints

## 6️⃣ Admin Management Endpoints (`/api/auth-service/v1/admin`)

---

## 📋 Overview

This module provides system administrator dedicated endpoints for:

1. System monitoring and health checks.
2. Viewing system statistics.
3. Audit log query.
4. Emergency operations (Force logout, unlock accounts, etc.).
5. System maintenance (Key rotation, cache clearing, etc.).

**Access Control:**

- All Admin endpoints require a special Admin API Key.
- Each administrator has an independent API Key.
- All operations are recorded in audit logs.

---

## 🔐 Admin Authentication Mechanism

### Request Header Requirement

All Admin endpoints must carry:

`X-Admin-Key: admin_{name}_sk_{random_string}`

### Admin API Key Configuration

**Environment Variable Config:**

```bash
# .env
ADMIN_API_KEYS=admin_alice_sk_a1b2c3d4e5f6,admin_bob_sk_x9y8z7w6v5u4
```

**Config Format:**

```javascript
const adminKeys = {
  admin_alice_sk_a1b2c3d4e5f6: {
    name: "Alice",
    role: "super_admin",
    email: "alice@example.com",
  },
  admin_bob_sk_x9y8z7w6v5u4: {
    name: "Bob",
    role: "admin",
    email: "bob@example.com",
  },
};
```

### Validation Logic

```javascript
function requireAdmin(req, res, next) {
  const apiKey = req.headers["x-admin-key"];

  if (!adminKeys[apiKey]) {
    return res.status(403).json({
      error: "invalid_admin_key",
      detail: "Invalid or missing admin API key",
    });
  }

  // Record admin info
  req.admin = adminKeys[apiKey];
  next();
}
```

### Error Response

**403 - Invalid Admin Key**

```json
{
  "error": "invalid_admin_key",
  "detail": "Invalid or missing admin API key"
}
```

---

## 🏥 6.1 System Health Check

**Endpoint:** `GET /api/auth-service/v1/admin/health`

**Purpose:**

- Check if auth-service and its dependencies are running normally.
- Used for system monitoring (e.g., Kubernetes liveness/readiness probes).

---

### Processing Logic

1. Check database connection (PostgreSQL).
2. Check Redis connection.
3. Check system load (optional).
4. Return health status.

---

### Success Response (200)

**All Services Normal:**

```json
{
  "status": "healthy",
  "timestamp": "2025-01-16T10:00:00.000Z",
  "uptime": 86400,
  "checks": {
    "database": {
      "status": "ok",
      "responseTime": 5
    },
    "redis": {
      "status": "ok",
      "responseTime": 2
    },
    "memory": {
      "status": "ok",
      "used": "512MB",
      "total": "2GB"
    }
  }
}
```

**Partial Service Abnormal:**

```json
{
  "status": "degraded",
  "timestamp": "2025-01-16T10:00:00.000Z",
  "uptime": 86400,
  "checks": {
    "database": {
      "status": "ok",
      "responseTime": 5
    },
    "redis": {
      "status": "error",
      "error": "Connection timeout"
    },
    "memory": {
      "status": "warning",
      "used": "1.8GB",
      "total": "2GB"
    }
  }
}
```

---

## 📊 6.2 System Statistics

**Endpoint:** `GET /api/auth-service/v1/admin/stats`

**Purpose:**

- View overall system usage.
- Returns only count statistics, no specific data.

**Request Headers:**

`X-Admin-Key: admin_{name}_sk_{random}`

---

### Processing Logic

1. Validate Admin API Key.
2. Count various entities.
3. Group statistics by status/type.
4. Return statistics result.

---

### Success Response (200)

```json
{
  "success": true,
  "timestamp": "2025-01-16T10:00:00.000Z",
  "stats": {
    "users": {
      "total": 150,
      "byStatus": {
        "ACTIVE": 145,
        "SUSPENDED": 3,
        "DELETED": 2
      },
      "newThisMonth": 12
    },
    "organizations": {
      "total": 300,
      "byType": {
        "MAIN": 50,
        "BRANCH": 100,
        "FRANCHISE": 150
      },
      "byStatus": {
        "ACTIVE": 290,
        "INACTIVE": 10
      },
      "byProductType": {
        "beauty_salon": 180,
        "home_studio": 120,
        "fast_food": 5000
      }
    },
    "accounts": {
      "total": 1500,
      "byType": {
        "OWNER": 150,
        "MANAGER": 350,
        "STAFF": 1000
      },
      "byStatus": {
        "ACTIVE": 1450,
        "SUSPENDED": 30,
        "DELETED": 20
      }
    },
    "devices": {
      "total": 800,
      "byType": {
        "POS": 500,
        "KIOSK": 200,
        "TABLET": 100
      },
      "byStatus": {
        "PENDING": 50,
        "ACTIVE": 740,
        "DELETED": 10
      }
    },
    "tokens": {
      "activeRefreshTokens": 250,
      "blacklistedTokens": 180
    }
  }
}
```

---

## ⚙️ 6.3 System Configuration Info

**Endpoint:** `GET /api/auth-service/v1/admin/config`

**Purpose:**

- View current system configuration parameters.
- Does not include sensitive info (keys, passwords, etc.).

**Request Headers:**

`X-Admin-Key: admin_{name}_sk_{random}`

---

### Success Response (200)

```json
{
  "success": true,
  "config": {
    "tokenExpiry": {
      "userAccessToken": 3600,
      "userRefreshToken": 2592000,
      "accountAccessToken": 3600,
      "accountRefreshToken": 2592000,
      "posAccessToken": 16200
    },
    "cacheSettings": {
      "subscriptionCacheTTL": 1800,
      "blacklistCacheTTL": 10,
      "publicKeyCacheTTL": 3600
    },
    "deviceSettings": {
      "activationCodeLength": 9,
      "deviceValidityPeriod": 31536000,
      "dormantCheckInterval": "monthly",
      "dormantThreshold": 2592000,
      "dormantGracePeriod": 2592000
    },
    "securitySettings": {
      "maxLoginAttempts": 5,
      "lockoutDuration": 1800,
      "passwordMinLength": 8,
      "pinCodeLength": 4
    },
    "systemInfo": {
      "version": "2.0.0",
      "environment": "production",
      "nodeVersion": "v18.17.0"
    }
  }
}
```

---

## 📜 6.4 Query Audit Logs

**Endpoint:** `GET /api/auth-service/v1/admin/audit-logs`

**Purpose:**

- Query system operation records.
- Track who did what.
- Security audit and troubleshooting.

**Request Headers:**

`X-Admin-Key: admin_{name}_sk_{random}`

**Query Parameters:**

```
?actorUserId=xxx          # Operator (User ID)
&actorAccountId=xxx       # Operator (Account ID)
&actorAdmin=Alice         # Operator (Admin Name)
&action=create_org        # Operation Type
&targetUserId=xxx         # Target Object (User)
&targetAccountId=xxx      # Target Object (Account)
&targetOrgId=xxx          # Target Object (Organization)
&targetDeviceId=xxx       # Target Object (Device)
&startDate=2025-01-01     # Start Date (ISO 8601)
&endDate=2025-01-31       # End Date (ISO 8601)
&limit=100                # Return Count (Default 50, Max 1000)
&offset=0                 # Pagination Offset (Default 0)
```

---

### Processing Logic

1. Validate Admin API Key.
2. Build query conditions (support multi-condition combination).
3. Query `audit_logs` table.
4. Sort by time descending.
5. Return paginated results.

---

### Success Response (200)

```json
{
  "success": true,
  "data": [
    {
      "id": "log-uuid-1",
      "action": "user_login",
      "actorUserId": "user-uuid",
      "actorAccountId": null,
      "actorAdmin": null,
      "targetUserId": "user-uuid",
      "targetAccountId": null,
      "targetOrgId": null,
      "targetDeviceId": null,
      "detail": {
        "ip": "192.168.1.100",
        "userAgent": "Mozilla/5.0..."
      },
      "createdAt": "2025-01-16T10:30:00.000Z"
    },
    {
      "id": "log-uuid-2",
      "action": "admin_force_logout",
      "actorUserId": null,
      "actorAccountId": null,
      "actorAdmin": "Alice",
      "targetUserId": "user-uuid-2",
      "targetAccountId": null,
      "targetOrgId": null,
      "targetDeviceId": null,
      "detail": {
        "reason": "Security incident"
      },
      "createdAt": "2025-01-16T09:15:00.000Z"
    },
    {
      "id": "log-uuid-3",
      "action": "device_activated",
      "actorUserId": null,
      "actorAccountId": null,
      "actorAdmin": null,
      "targetUserId": null,
      "targetAccountId": null,
      "targetOrgId": "org-uuid",
      "targetDeviceId": "device-uuid",
      "detail": {
        "deviceType": "POS",
        "deviceName": "Cashier-001"
      },
      "createdAt": "2025-01-16T08:00:00.000Z"
    }
  ],
  "pagination": {
    "total": 1523,
    "limit": 100,
    "offset": 0,
    "hasMore": true
  }
}
```

---

## 🚪 6.5 Force Logout User

**Endpoint:** `POST /api/auth-service/v1/admin/users/:userId/force-logout`

**Purpose:**

- Administrator forces a User to logout.
- Revoke all refresh_tokens.
- Add all access_tokens to blacklist.

**Request Headers:**

`X-Admin-Key: admin_{name}_sk_{random}`

**Request Body:**

```json
{
  "reason": "Security incident - account compromised"
}
```

**Field Description:**

- `reason` (Optional, string): Reason for force logout.

---

### Processing Logic

1. Validate Admin API Key.
2. Query User (by userId).
3. If not exists → Return 404.
4. Query all active refresh_tokens for this User.
5. Revoke all refresh_tokens:
   ```sql
   UPDATE refresh_tokens
   SET status = 'REVOKED',
       revoked_at = NOW(),
       revoke_reason = 'admin_force_logout'
   WHERE subject_user_id = userId
     AND status = 'ACTIVE'
   ```
6. Add all refresh_tokens' associated access_token jti to blacklist.
7. Record in `audit_logs` (actorAdmin = Admin Name).
8. Return success.

---

### Success Response (200)

```json
{
  "success": true,
  "message": "User force logged out successfully",
  "data": {
    "userId": "user-uuid",
    "revokedTokens": 3,
    "reason": "Security incident - account compromised"
  }
}
```

---

## 🚪 6.6 Force Logout Account

**Endpoint:** `POST /api/auth-service/v1/admin/accounts/:accountId/force-logout`

**Purpose:**

- Administrator forces an Account to logout.
- Revoke all refresh_tokens.
- Add all access_tokens to blacklist.

**Request Headers:**

`X-Admin-Key: admin_{name}_sk_{random}`

**Request Body:**

```json
{
  "reason": "Employee terminated"
}
```

---

### Processing Logic

Same as 6.5, but target is Account.

---

### Success Response (200)

```json
{
  "success": true,
  "message": "Account force logged out successfully",
  "data": {
    "accountId": "account-uuid",
    "revokedTokens": 2,
    "reason": "Employee terminated"
  }
}
```

---

## 🔓 6.7 Unlock User Account

**Endpoint:** `POST /api/auth-service/v1/admin/users/:userId/unlock`

**Purpose:**

- Unlock User account locked due to too many failed login attempts.

**Request Headers:**

`X-Admin-Key: admin_{name}_sk_{random}`

**Request Body:**

```json
{
  "reason": "User verified identity via phone"
}
```

---

### Processing Logic

1. Validate Admin API Key.
2. Query User (by userId).
3. If not exists → Return 404.
4. Check if account is locked:
   - If lockedUntil = NULL → Return 400 "account_not_locked".
5. Unlock account:
   ```sql
   UPDATE users
   SET locked_until = NULL,
       login_failure_count = 0,
       lock_reason = NULL,
       updated_at = NOW()
   WHERE id = userId
   ```
6. Record in `audit_logs`.
7. Return success.

---

### Success Response (200)

```json
{
  "success": true,
  "message": "User account unlocked successfully",
  "data": {
    "userId": "user-uuid",
    "email": "user@example.com",
    "unlockedBy": "Alice",
    "reason": "User verified identity via phone"
  }
}
```

---

### Error Response

**400 - Account Not Locked**

```json
{
  "error": "account_not_locked",
  "detail": "This account is not locked"
}
```

---

## 🗑️ 6.8 Clear Cache

**Endpoint:** `POST /api/auth-service/v1/admin/cache/clear`

**Purpose:**

- Manually clear various caches.
- Ensure data consistency in emergencies.

**Request Headers:**

`X-Admin-Key: admin_{name}_sk_{random}`

**Request Body:**

```json
{
  "cacheType": "all",
  "reason": "Data inconsistency detected"
}
```

**Field Description:**

- `cacheType` (Required, enum):
  - "all": Clear all caches.
  - "subscription": Clear subscription status cache.
  - "blacklist": Clear blacklist cache.
  - "publicKey": Clear public key cache.
- `reason` (Optional, string): Reason for clearing.

---

### Processing Logic

1. Validate Admin API Key.
2. Clear corresponding cache based on `cacheType`:
   - subscription: Clear business-service subscription cache (needs notification).
   - blacklist: Clear blacklist cache in Redis (or clear business-service local cache).
   - publicKey: Clear public key cache of other services (needs notification).
   - all: Clear all.
3. Record in `audit_logs`.
4. Return clearing result.

---

### Success Response (200)

```json
{
  "success": true,
  "message": "Cache cleared successfully",
  "data": {
    "cacheType": "all",
    "clearedItems": {
      "subscription": 150,
      "blacklist": 80,
      "publicKey": 1
    },
    "clearedBy": "Alice",
    "reason": "Data inconsistency detected"
  }
}
```

---

## 📊 6.9 View Active Tokens

**Endpoint:** `GET /api/auth-service/v1/admin/tokens/active`

**Purpose:**

- View how many active refresh_tokens currently exist.
- Group statistics by user/account/organization.

**Request Headers:**

`X-Admin-Key: admin_{name}_sk_{random}`

**Query Parameters:**

```
?userId=xxx               # Filter by User
&accountId=xxx            # Filter by Account
&organizationId=xxx       # Filter by Organization
&limit=50                 # Return Count
&offset=0                 # Pagination Offset
```

---

### Success Response (200)

```json
{
  "success": true,
  "data": {
    "totalActiveTokens": 250,
    "byUserType": {
      "USER": 120,
      "ACCOUNT": 130
    },
    "tokens": [
      {
        "id": "refresh-token-uuid-1",
        "subjectUserId": "user-uuid",
        "subjectAccountId": null,
        "organizationId": null,
        "clientId": "tymoe-web",
        "createdAt": "2025-01-10T10:00:00.000Z",
        "expiresAt": "2025-02-09T10:00:00.000Z",
        "lastSeenAt": "2025-01-16T09:30:00.000Z"
      },
      {
        "id": "refresh-token-uuid-2",
        "subjectUserId": null,
        "subjectAccountId": "account-uuid",
        "organizationId": "org-uuid",
        "clientId": "tymoe-web",
        "createdAt": "2025-01-15T14:00:00.000Z",
        "expiresAt": "2025-02-14T14:00:00.000Z",
        "lastSeenAt": "2025-01-16T10:00:00.000Z"
      }
    ]
  },
  "pagination": {
    "total": 250,
    "limit": 50,
    "offset": 0
  }
}
```

---

## 🔒 Security Notes

### 1. Admin API Key Management

**Generation Rules:**

- Format: `admin_{name}_sk_{32_random_chars}`
- Example: `admin_alice_sk_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6`

**Storage:**

```bash
# .env file
ADMIN_API_KEYS=admin_alice_sk_abc...,admin_bob_sk_xyz...

# Do not commit to Git
# Add to .gitignore
```

**Rotation:**

- Recommended quarterly rotation.
- Immediate replacement upon admin resignation.
- Emergency rotation upon leakage.

### 2. Audit Logs

**All Admin operations must be recorded:**

```sql
INSERT INTO audit_logs (
  action,
  actor_admin,
  target_user_id,
  detail,
  created_at
) VALUES (
  'admin_force_logout',
  'Alice',
  'user-uuid',
  '{"reason": "Security incident"}',
  NOW()
)
```

### 3. IP Whitelist (Optional)

**Extra Security Measure:**

```javascript
const ADMIN_ALLOWED_IPS = ["192.168.1.100", "10.0.0.5"];

app.use("/api/auth-service/v1/admin", (req, res, next) => {
  if (!ADMIN_ALLOWED_IPS.includes(req.ip)) {
    return res.status(403).json({ error: "ip_not_allowed" });
  }
  next();
});
```

### 4. Operation Notification (Optional)

**Send notification for important operations:**

- Force logout user.
- Rotate keys.
- Clear cache.

Notification methods: Email, Slack, SMS, etc.

---

## 📝 Usage Examples

### Scenario 1: View System Health Status

```bash
curl -X GET https://api.example.com/api/auth-service/v1/admin/health \
  -H "X-Admin-Key: admin_alice_sk_abc123..."
```

### Scenario 2: View System Statistics

```bash
curl -X GET https://api.example.com/api/auth-service/v1/admin/stats \
  -H "X-Admin-Key: admin_alice_sk_abc123..."
```

### Scenario 3: Query Audit Logs

```bash
curl -X GET "https://api.example.com/api/auth-service/v1/admin/audit-logs?action=user_login&startDate=2025-01-01&limit=100" \
  -H "X-Admin-Key: admin_alice_sk_abc123..."
```

### Scenario 4: Force User Logout

```bash
curl -X POST https://api.example.com/api/auth-service/v1/admin/users/user-uuid/force-logout \
  -H "X-Admin-Key: admin_alice_sk_abc123..." \
  -H "Content-Type: application/json" \
  -d '{"reason": "Account compromised"}'
```

### Scenario 5: Manually Trigger Device Check

```bash
curl -X POST https://api.example.com/api/auth-service/v1/admin/devices/check-activity \
  -H "X-Admin-Key: admin_alice_sk_abc123..." \
  -H "Content-Type: application/json" \
  -d '{"dryRun": false}'
```

---

## ⚠️ Important Reminders

### About Family ID Mechanism

**This system does not use Family ID rotation mechanism:**

- User and Account backend login use Uber style (30 days fixed refresh_token).
- POS/KIOSK login only has access_token, no refresh_token.
- `refresh_tokens` table `familyId` field should be set to null or removed.

**Note for Code Implementation:**

- Remove familyId related logic in Part 1 (User Login).
- Remove familyId related logic in Part 3 (Account Login).
- Set familyId field to null when creating refresh_tokens table.

### Impact Scope of Admin Operations

**Impact of Force Logout:**

- Immediately revoke all refresh_tokens.
- Add related access_tokens to blacklist.
- User/Account needs to re-login.
- Other services will detect token invalidation after cache expiration (max 10 seconds).

**Impact of Key Rotation:**

- All services need to re-fetch public key (from /jwks.json).
- Tokens signed with old key remain valid for 60 minutes.
- Recommended to execute during off-peak hours.

**Impact of Cache Clearing:**

- May cause brief performance degradation (need to re-query).
- Ensure data consistency.
- Suitable for emergency fix when data inconsistency is found.

---

## ✅ Design Summary

**Capabilities provided by Part 6:**

1. System monitoring and health checks.
2. Statistics and configuration viewing.
3. Audit log query and tracking.
4. Emergency operations (force logout, unlock).
5. System maintenance (key rotation, cache clearing, device check).

**Security Mechanisms:**

- Admin API Key authentication.
- Independent key for each administrator.
- All operations recorded in audit logs.
- Traceable operators.

**Relationship with Other Modules:**

- Monitor running status of all modules.
- Can intervene in data of all modules.
- Provide emergency operation capabilities.

**Usage Scenarios:**

- Daily Monitoring: health, stats.
- Troubleshooting: audit-logs, tokens/active.
- Emergency Response: force-logout, unlock.
- Regular Maintenance: keys/rotate, cache/clear, devices/check-activity.

---

## 🚪 6.10 Force Logout Device

**Endpoint:** `POST /api/auth-service/v1/admin/devices/:deviceId/force-logout`

**Purpose:**

- Administrator forces a Device to logout.
- Change its status to DELETE.

**Request Headers:**

`X-Admin-Key: admin_{name}_sk_{random}`

**Request Body:**

```json
{
  "reason": "Security incident - user compromised"
}
```

**Field Description:**

- `reason` (Optional, string): Reason for force logout.

---

### Processing Logic

1. Validate Admin API Key.
2. Query Device (by deviceId).
3. If not exists → Return 404.
4. Modify its status: If !DELETE change to DELETE. If already DELETE, no change.
5. Record in `audit_logs` (actorAdmin = Admin Name).
6. Return success.

---

### Success Response (200)

```json
{
  "success": true,
  "message": "Device status change to DELETE successfully",
  "data": {
    "deviceId": "device-uuid",
    "status: "DELETE"
    "reason": "Security incident - account compromised"
  }
}
```

---

## 🔑 6.11 Rotate JWT Signing Key

**Endpoint:** `POST /api/auth-service/v1/admin/keys/rotate`

**Purpose:**

- Manually rotate JWT signing key (RSA key pair).
- Used for regular security maintenance or emergency rotation upon key leakage.
- Replaces command line scripts `rotate-key.ts` and `retire-keys.ts`.

**Request Headers:**

`X-Admin-Key: admin_{name}_sk_{random}`

**Request Body:**

```json
{
  "reason": "Quarterly security rotation"
}
```

**Field Description:**

- `reason` (Optional, string): Reason for key rotation.

---

### Processing Logic

1. Validate Admin API Key.
2. Call `keystore.rotateKey()` to generate new RSA key pair.
3. New key automatically marked as `ACTIVE` status.
4. Old key automatically marked as `GRACE` status (Retained for 1 hour).
5. After 1 hour, old key automatically becomes `RETIRED` status.
6. Update JWKS endpoint (`/jwks.json`) returning both new and old keys.
7. Record in `audit_logs` (actorAdmin = Admin Name).
8. Return kid of new and old keys.

---

### Success Response (200)

```json
{
  "success": true,
  "message": "JWT signing keys rotated successfully",
  "data": {
    "newKeyId": "auth-service-key-2025-01-16-abc123",
    "oldKeyId": "auth-service-key-2025-01-01-xyz789",
    "oldKeyRetentionPeriod": 3600,
    "rotatedBy": "Alice",
    "reason": "Quarterly security rotation"
  },
  "warning": "Old tokens will remain valid for 60 minutes. Please inform other services to refresh public keys from /jwks.json"
}
```

---

### Explanation

**Key Rotation Mechanism:**

1. **New Key Generation:**

   - Generate new 2048-bit RSA key pair.
   - kid format: `auth-service-key-{timestamp}-{random}`.
   - Status set to `ACTIVE`.

2. **Old Key Retention:**

   - Old key status changed from `ACTIVE` to `GRACE`.
   - Retained for 1 hour (consistent with access_token expiration).
   - Old tokens remain valid during this period.

3. **Automatic Cleanup:**
   - After 1 hour, old key automatically becomes `RETIRED`.
   - `RETIRED` keys no longer appear in JWKS endpoint.
   - But records retained in database for audit.

**Impact on Other Services:**

- All resource services (business-service, etc.) need to re-fetch public key from `/jwks.json`.
- JWKS cache TTL is 1 hour, automatically updates after cache expiration.
- Tokens signed with old key remain valid during grace period.
- Newly issued tokens immediately use new key.

**Usage Suggestions:**

- Regular rotation (recommended quarterly).
- Emergency rotation upon key leakage.
- Execute during off-peak hours.
- Notify other service teams in advance.

---

### Error Response

**500 - Key Generation Failed**

```json
{
  "error": "server_error",
  "detail": "Failed to generate new key pair"
}
```

---

# Auth Service v2.2.0 - Part 7: System Endpoints

## 7️⃣ System Endpoints

---

## 📋 Overview

This module provides public system endpoints requiring no authentication. Mainly used for:

1. Container orchestration platform (Kubernetes, Docker) health checks.
2. Load balancer liveness probes.

**Features:**

- No authentication required.
- Fast response.
- Minimal dependency checks.

---

## 🏥 7.1 Public Health Check

**Endpoint:** `GET /healthz`

**Purpose:**

- Container platform liveness probe.
- Load balancer checks if service is available.
- Simple and fast health status check.

**Request Headers:** No authentication required.

---

### Difference from Admin Health

**/healthz (Public Health Check):**

- Authentication: Not required.
- Return Content: Simple status ("OK" or "ERROR").
- Response Speed: Extremely fast (< 100ms).
- Purpose: Automated monitoring (Container platform, Load balancer).
- Dependency Check: Minimal (Only check service process).

**/admin/health (Admin Health Check):**

- Authentication: Requires Admin API Key.
- Return Content: Detailed component status (Database, Redis, Memory, etc.).
- Response Speed: Slower.
- Purpose: Manual troubleshooting.
- Dependency Check: Comprehensive check of all components.

---

### Processing Logic

**Basic Version (Recommended):**

1. Check if service process is running.
2. Simple database connection check (optional).
3. Return status.

**Do Not Check:**

- Redis connection (Avoid false positives due to dependency).
- Complex business logic.
- External service status.

**Principles:**

- Fast response (< 100ms).
- Minimal dependency checks.
- Avoid judging entire service as unhealthy due to single component failure.

---

### Success Response (200)

**Normal Status:**

```json
{
  "status": "ok",
  "timestamp": "2025-01-16T10:00:00.000Z"
}
```

---

### Error Response (503)

**Service Unavailable:**

```json
{
  "status": "error",
  "timestamp": "2025-01-16T10:00:00.000Z"
}
```

---

## 💡 Implementation Suggestions

### Basic Implementation

```javascript
app.get("/healthz", (req, res) => {
  // Only check if service process is running normally
  res.status(200).send("OK");
});
```

**Pros:**

- Extremely fast response.
- No false positives due to dependency failures.
- Suitable for container orchestration platforms.

---

### 🔧 Usage Scenarios

### Kubernetes Config

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: auth-service
spec:
  containers:
    - name: auth-service
      image: auth-service:latest
      livenessProbe:
        httpGet:
          path: /healthz
          port: 3000
        initialDelaySeconds: 30
        periodSeconds: 10
        timeoutSeconds: 5
        failureThreshold: 3
      readinessProbe:
        httpGet:
          path: /healthz
          port: 3000
        initialDelaySeconds: 5
        periodSeconds: 5
        timeoutSeconds: 3
        failureThreshold: 2
```

---

### Docker Compose Config

```yaml
version: "3.8"
services:
  auth-service:
    image: auth-service:latest
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/healthz"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
```

---

### Load Balancer Config

**Nginx:**

```nginx
upstream auth_service {
    server auth-service-1:3000 max_fails=3 fail_timeout=30s;
    server auth-service-2:3000 max_fails=3 fail_timeout=30s;

    # Health Check
    check interval=3000 rise=2 fall=3 timeout=1000 type=http;
    check_http_send "GET /healthz HTTP/1.0\r\n\r\n";
    check_http_expect_alive http_2xx;
}
```

**AWS ELB/ALB:**

```
Health Check Path: /healthz
Health Check Protocol: HTTP
Health Check Port: 3000
Healthy Threshold: 2
Unhealthy Threshold: 3
Timeout: 5 seconds
Interval: 30 seconds
```

---

## 📊 Endpoint Summary

**Public Endpoints:**

- 7.1 GET /healthz - Public Health Check

---

## 🔒 Security Notes

### 1. Information Leakage

**Avoid returning sensitive info:**

- Do not return version number (Avoid exposing known vulnerabilities).
- Do not return internal component details.
- Do not return error stack.

**Correct Practice:**

```javascript
// ✅ Good
res.status(200).send("OK");

// ❌ Bad
res.status(200).json({
  status: "ok",
  version: "2.0.0",
  database: "PostgreSQL 14.5",
  redis: "Redis 7.0.5",
  uptime: "15 days",
});
```

---

### 2. DDoS Protection

**Add simple rate limiting:**

Although health check endpoint is public, access frequency from single IP should be limited to prevent abuse.

```javascript
// Use express-rate-limit middleware
const rateLimit = require("express-rate-limit");

const healthzLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute window
  max: 5, // Max 5 requests per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many requests",
});

app.get("/healthz", healthzLimiter, (req, res) => {
  res.status(200).send("OK");
});
```

**Explanation:**

- Max 5 requests per minute per IP.
- Sufficient for container platforms and load balancers.
- Prevent malicious users from frequent requests consuming resources.

---

### 3. Logging

**Do not log every health check:**

```javascript
app.get("/healthz", (req, res) => {
  // ❌ Do not do this
  // logger.info('Health check request received');

  res.status(200).send("OK");
});
```

**Reason:**

- Health check frequency is high.
- Generates massive useless logs.
- Consumes storage space.

**Exception:** Only log failed health checks.

---

## 📝 Best Practices

### 1. Fast Response

Health check should complete within 100ms:

- No complex calculations.
- No massive data queries.
- No external service calls.

### 2. Idempotency

Multiple calls should not produce side effects:

- No data modification.
- No business logic triggering.
- No notifications sent.

### 3. Clear Health Criteria

**Service Health Definition:**

- Process running normally ✅
- Can accept requests ✅
- Database connectable (optional) ✅
- Can process basic business logic ❌ (Too complex)

### 4. Distinguish Liveness and Readiness

**Liveness (Liveness Probe):**

- Check if process is alive.
- Failure → Restart container.
- Use /healthz.

**Readiness (Readiness Probe):**

- Check if ready to accept traffic.
- Failure → Remove from load balancer.
- Can use same /healthz, or separate /readyz.

**If distinction needed, add /readyz:**

```javascript
app.get("/readyz", async (req, res) => {
  try {
    // Check Database, Redis, etc.
    await db.raw("SELECT 1");
    await redis.ping();

    res.status(200).send("READY");
  } catch (error) {
    res.status(503).send("NOT READY");
  }
});
```

---

## ✅ Design Summary

**Capabilities provided by Part 7:**

- Simple and fast health check.
- Used by container platforms and load balancers.
- No authentication, public access.

**Design Principles:**

- Simplicity first.
- Fast response.
- Minimal dependencies.
- No information leakage.

**Relationship with Other Modules:**

- Independent of all business modules.
- Does not depend on authentication system.
- Can respond immediately after service startup.

**Recommended Implementation:**

- Basic Version: Directly return "OK".
- Optional: Simple database ping.
- Avoid complex dependency checks.

---

## 🔄 Coordination with Admin Health

**Daily Monitoring:**

- Container platform uses /healthz (Automated).
- Administrator uses /admin/health (Manual troubleshooting).

**Troubleshooting Flow:**

```
1. /healthz returns error
   ↓
2. Container platform automatically restarts service
   ↓
3. If failure persists, administrator intervenes
   ↓
4. Access /admin/health to view detailed status
   ↓
5. Troubleshoot based on detailed info
```

```

```
