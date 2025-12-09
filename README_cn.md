# 认证服务 (Auth Service) v2.2.0

> **企业级身份认证与授权服务** - 基于 OAuth2/OpenID Connect 的多租户身份管理中心

## 📋 目录

- [系统概览](#系统概览)
- [核心功能](#核心功能)
- [快速开始](#快速开始)
- [API 端点概览](#api-端点概览)
- [数据库架构](#数据库架构)
- [认证与授权](#认证与授权)
- [配置指南](#配置指南)
- [部署指南](#部署指南)
- [开发指南](#开发指南)
- [故障排除](#故障排除)

## 🎯 系统概览

Auth Service 是一个企业级身份认证与授权服务，为生态系统中的所有业务服务（美容 SaaS、餐饮 SaaS 等）提供统一的身份管理和访问控制。

### 版本信息

- **当前版本**: v2.2.0
- **服务地址**: https://tymoe.com
- **API 基础路径**: `/api/auth-service/v1`
- **协议标准**: OAuth 2.0 + OpenID Connect 1.0

### 技术栈

- **运行时**: Node.js 23.1.0 + TypeScript
- **框架**: Express.js
- **数据库**: PostgreSQL + Prisma ORM
- **缓存**: Redis
- **认证**: JWT (RS256) + OAuth2/OIDC
- **邮件**: NodeMailer (SMTP)
- **监控**: Prometheus Metrics
- **安全**: Helmet, CORS, Rate Limiting, CAPTCHA

### 系统架构

```
┌─────────────────────────────────────────────────────────┐
│                        前端层                            │
│   (美容 SaaS)    (餐饮 SaaS)    (管理后台)    (移动 App)  │
└────────────────────┬────────────────────────────────────┘
                     │
                     ↓
┌─────────────────────────────────────────────────────────┐
│               认证服务 (Auth Service) (8080)             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐  │
│  │ 身份 API  │  │ OAuth API│  │ 组织 API  │  │ 管理 API │  │
│  └──────────┘  └──────────┘  └──────────┘  └─────────┘  │
└────────────────────┬────────────────────────────────────┘
                     │
        ┌────────────┼────────────┐
        ↓            ↓            ↓
┌──────────┐  ┌──────────┐  ┌──────────┐
│PostgreSQL│  │  Redis   │  │   SMTP   │
│  (数据)   │  │  (缓存)  │  │  (邮件)  │
62: └──────────┘  └──────────┘  └──────────┘
```

## 🚀 核心功能

### 1. 用户身份管理 (Identity API)

- ✅ 用户注册和邮箱验证
- ✅ 用户登录（支持验证码、账户锁定保护）
- ✅ 密码重置
- ✅ 令牌刷新和撤销
- ✅ 用户资料查询和更新

### 2. 多租户组织管理 (Organizations API)

- ✅ 组织 CRUD（支持 MAIN 总店, BRANCH 分店, FRANCHISE 加盟店类型）
- ✅ 账户管理（OWNER 拥有者, MANAGER 经理, STAFF 员工角色）
- ✅ 设备管理（POS, KIOSK, TABLET 类型）
- ✅ 支持 15 种产品类型 (beauty_salon, hair_salon, spa, restaurant, fast_food, cafe, beverage, home_studio, fitness, yoga_studio, retail, chinese_restaurant, clinic, liquor_store, other)
- ✅ 组织树结构管理

### 3. OAuth2/OIDC 标准协议

- ✅ 授权码模式 (Authorization Code Flow with PKCE)
- ✅ 客户端凭证模式 (Client Credentials Flow)
- ✅ 令牌颁发和验证
- ✅ 令牌内省 (Introspection)
- ✅ 令牌撤销 (Revocation)
- ✅ JWKS 公钥发布
- ✅ UserInfo 端点

### 4. 设备认证 (Device Authentication)

- ✅ 设备注册和激活
- ✅ 设备密钥管理
- ✅ 设备令牌颁发
- ✅ 设备状态管理

### 5. 管理 API (Admin API)

- ✅ 系统健康检查
- ✅ 系统统计和配置查询
- ✅ 审计日志查询
- ✅ 强制登出 (用户/账户/设备)
- ✅ 解锁用户账户
- ✅ 缓存清理
- ✅ 活跃令牌查询
- ✅ **JWT 密钥轮换** (v6.11 新增)

### 6. 安全防护

- ✅ Redis 速率限制 (登录, 注册, 密码重置)
- ✅ 登录失败锁定机制
- ✅ Google reCAPTCHA v2 支持
- ✅ CSRF 防护
- ✅ CORS 配置
- ✅ Helmet 安全头
- ✅ JWT 黑名单机制

## 🎮 快速开始

### 本地开发设置

```bash
# 1. 安装依赖
npm install

# 2. 配置环境变量 (复制 .env.example 并修改)
cp .env.example .env

# 3. 数据库迁移
npx prisma migrate deploy

# 4. 启动 Redis (如果本地未运行)
docker run -d -p 6379:6379 redis:alpine

# 5. 启动服务
npm run dev          # 开发模式 (带热重载)
# 或
npm run build && npm start  # 生产模式
```

### API 快速测试

```bash
# 1. 用户注册 (不再需要 X-Product-Type 头)
curl -X POST http://localhost:8080/api/auth-service/v1/identity/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "Test123!",
    "name": "Test User",
    "phone": "+8613800138000"
  }'

# 2. 邮箱验证
curl -X POST http://localhost:8080/api/auth-service/v1/identity/verification \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "code": "123456"
  }'

# 3. 用户登录 (返回所有组织，无 productType 过滤)
curl -X POST http://localhost:8080/api/auth-service/v1/identity/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "Test123!"
  }'

# 3.5. 创建组织 (productType 在请求体中指定)
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

# 4. 使用 Access Token 获取用户信息
curl -X GET http://localhost:8080/api/auth-service/v1/identity/me \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"

# 5. 管理 API - 系统健康检查
curl -X GET http://localhost:8080/api/auth-service/v1/admin/health \
  -H "X-Admin-Key: admin_ryan_sk_Z678YTHUJ"
```

## 📡 API 端点概览

完整 API 文档请参阅 [API Endpoint Design Document.md](./API端点设计文档.md)

### 第一部分: 用户身份管理 (Identity API) - 14 个端点

| 端点 | 方法  | 路径                                  | 描述                          |
| ---- | ----- | ------------------------------------- | ----------------------------- |
| 1.1  | POST  | `/identity/register`                  | 用户注册                      |
| 1.2  | POST  | `/identity/verification`              | 邮箱验证                      |
| 1.3  | POST  | `/identity/resend`                    | 重发验证码                    |
| 1.4  | POST  | `/identity/login`                     | 用户登录                      |
| 1.5  | POST  | `/oauth/token`                        | 获取 OAuth 令牌               |
| 1.6  | POST  | `/oauth/token`                        | 刷新令牌                      |
| 1.7  | POST  | `/identity/logout`                    | 用户登出                      |
| 1.8  | POST  | `/identity/forgot-password`           | 忘记密码                      |
| 1.9  | POST  | `/identity/reset-password`            | 重置密码                      |
| 1.10 | POST  | `/identity/change-password`           | 修改密码 (已登录)             |
| 1.11 | GET   | `/identity/profile`                   | 获取当前用户信息              |
| 1.12 | PATCH | `/identity/profile`                   | 更新用户信息                  |
| 1.13 | POST  | `/identity/change-email`              | 修改邮箱 (步骤 1: 请求验证码) |
| 1.14 | POST  | `/identity/verification-email-change` | 修改邮箱 (步骤 2: 确认验证码) |

### 第二部分: 组织管理 (Organizations API) - 5 个端点

| 端点 | 方法   | 路径                    | 描述              |
| ---- | ------ | ----------------------- | ----------------- |
| 2.1  | POST   | `/organizations`        | 创建组织          |
| 2.2  | GET    | `/organizations`        | 获取所有用户组织  |
| 2.3  | GET    | `/organizations/:id`    | 获取组织详情      |
| 2.4  | PUT    | `/organizations/:orgId` | 更新组织信息      |
| 2.5  | DELETE | `/organizations/:id`    | 删除组织 (软删除) |

### 第三部分: 账户管理 (Account API) - 13 个端点

| 端点 | 方法   | 路径                                  | 描述                                |
| ---- | ------ | ------------------------------------- | ----------------------------------- |
| 3.1  | POST   | `/accounts/login`                     | 账户后台登录 (Owner/Manager)        |
| 3.2  | POST   | `/accounts/pos-login`                 | 账户 POS 登录 (Owner/Manager/STAFF) |
| 3.3  | POST   | `/oauth/token`                        | 获取 OAuth 令牌 (统一端点) \*       |
| 3.4  | POST   | `/oauth/token`                        | 刷新令牌 (后台登录) \*              |
| 3.5  | POST   | `/accounts/logout`                    | 账户登出                            |
| 3.6  | POST   | `/accounts`                           | 创建账户                            |
| 3.7  | GET    | `/accounts`                           | 获取所有组织账户                    |
| 3.8  | GET    | `/accounts/:accountId`                | 获取账户详情                        |
| 3.9  | PATCH  | `/accounts/:accountId`                | 更新账户信息                        |
| 3.10 | DELETE | `/accounts/:accountId`                | 删除账户 (软删除)                   |
| 3.11 | POST   | `/accounts/change-password`           | 修改自己的密码                      |
| 3.12 | POST   | `/accounts/:accountId/reset-password` | 重置账户密码 (管理员)               |
| 3.13 | POST   | `/accounts/:accountId/reset-pin`      | 重置账户 PIN 码                     |

> **注意**: 3.3 和 3.4 与第一部分的 1.5 和 1.6 是相同的端点

### 第四部分: 设备管理 (Device API) - 7 个端点

| 端点 | 方法   | 路径                                        | 描述                  |
| ---- | ------ | ------------------------------------------- | --------------------- |
| 4.1  | POST   | `/devices`                                  | 创建设备 (生成激活码) |
| 4.2  | POST   | `/devices/activate`                         | 激活设备              |
| 4.3  | POST   | `/devices/:deviceId/update-activation-code` | 更新设备激活码        |
| 4.4  | GET    | `/devices`                                  | 获取所有组织设备      |
| 4.5  | GET    | `/devices/:deviceId`                        | 获取设备详情          |
| 4.6  | PATCH  | `/devices/:deviceId`                        | 更新设备信息          |
| 4.7  | DELETE | `/devices/:deviceId`                        | 删除设备 (软删除)     |

### 第五部分: OAuth/OIDC 标准端点 - 3 个端点

| 端点 | 方法 | 路径                              | 描述                      |
| ---- | ---- | --------------------------------- | ------------------------- |
| 5.1  | GET  | `/jwks.json`                      | 获取 JWT 公钥 (JWKS)      |
| 5.2  | GET  | `/userinfo`                       | 获取用户信息              |
| 5.3  | POST | `/internal/token/check-blacklist` | 检查令牌黑名单 (内部服务) |

### 第六部分: 管理 API (Admin API) - 11 个端点

| 端点 | 方法 | 路径                                      | 描述              | 认证        |
| ---- | ---- | ----------------------------------------- | ----------------- | ----------- |
| 6.1  | GET  | `/admin/health`                           | 系统健康检查      | X-Admin-Key |
| 6.2  | GET  | `/admin/stats`                            | 系统统计          | X-Admin-Key |
| 6.3  | GET  | `/admin/config`                           | 系统配置信息      | X-Admin-Key |
| 6.4  | GET  | `/admin/audit-logs`                       | 查询审计日志      | X-Admin-Key |
| 6.5  | POST | `/admin/users/:userId/force-logout`       | 强制登出用户      | X-Admin-Key |
| 6.6  | POST | `/admin/accounts/:accountId/force-logout` | 强制登出账户      | X-Admin-Key |
| 6.7  | POST | `/admin/users/:userId/unlock`             | 解锁用户账户      | X-Admin-Key |
| 6.8  | POST | `/admin/cache/clear`                      | 清理缓存          | X-Admin-Key |
| 6.9  | GET  | `/admin/tokens/active`                    | 查看活跃令牌      | X-Admin-Key |
| 6.10 | POST | `/admin/devices/:deviceId/force-logout`   | 强制登出设备      | X-Admin-Key |
| 6.11 | POST | `/admin/keys/rotate`                      | 轮换 JWT 签名密钥 | X-Admin-Key |

### 第七部分: 系统端点 - 1 个端点

| 端点 | 方法 | 路径       | 描述         |
| ---- | ---- | ---------- | ------------ |
| 7.1  | GET  | `/healthz` | 系统健康检查 |

**总计**: 54 个 API 端点 (52 个唯一端点)

## 🗄️ 数据库架构

### 核心数据模型

```prisma
// User Table - 平台用户
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

  // 关系
  ownedOrganizations  Organization[] @relation("OrganizationOwner")
}

// Organization Table - 餐厅/店铺
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

  // 关系
  owner           User                @relation("OrganizationOwner")
  parent          Organization?       @relation("OrgHierarchy")
  children        Organization[]      @relation("OrgHierarchy")
  accounts        Account[]
  devices         Device[]
}

// Account Table - 组织内的员工账户
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

  // 关系
  organization    Organization    @relation(fields: [organizationId])
}

// Device Table - POS 终端/平板等
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

  // 关系
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
  privatePem      String      // 加密存储
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
  actorAdmin      String?     // 管理员名称

  action          String
  subject         String?
  detail          Json?
}
```

### 数据库枚举类型

```prisma
enum ProductType {
  beauty_salon        // 美容院
  hair_salon          // 理发店
  spa                 // 水疗中心
  restaurant          // 餐厅
  fast_food           // 快餐
  cafe                // 咖啡厅
  beverage            // 饮品店
  home_studio         // 家庭工作室
  fitness             // 健身房
  yoga_studio         // 瑜伽馆
  retail              // 零售
  chinese_restaurant  // 中餐厅
  clinic              // 诊所
  liquor_store        // 酒类商店
  other               // 其他
}

enum OrganizationType {
  MAIN      // 总店
  BRANCH    // 分店
  FRANCHISE // 加盟店
}

enum OrganizationStatus {
  ACTIVE
  SUSPENDED
  DELETED
}

enum AccountType {
  OWNER     // 拥有者
  MANAGER   // 经理
  STAFF     // 员工
}

enum AccountStatus {
  ACTIVE
  SUSPENDED
  DELETED
}

enum DeviceType {
  POS       // 销售终端
  KIOSK     // 自助服务机
  TABLET    // 平板
}

enum DeviceStatus {
  PENDING   // 待激活
  ACTIVE    // 已激活
  DELETED   // 已删除
}

enum RefreshTokenStatus {
  ACTIVE
  ROTATED
  REVOKED
}

enum KeyStatus {
  ACTIVE    // 当前活跃密钥
  GRACE     // 宽限期 (有效 1 小时)
  RETIRED   // 已退役
}
```

## 🔐 认证与授权

### 1. 用户认证流程

**适用对象**: 平台用户（拥有组织的人）

```
1. 用户注册 -> POST /identity/register
2. 邮箱验证 -> POST /identity/verify
3. 用户登录 -> POST /identity/login
   返回: {
     "accessToken": "eyJhbGc...",
     "refreshToken": "rt_...",
     "tokenType": "Bearer",
     "expiresIn": 3600
   }
4. 使用 Access Token -> Authorization: Bearer eyJhbGc...
```

**Access Token 声明 (Claims)**:

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

### 2. 账户认证流程

**适用对象**: 组织内的员工账户 (OWNER/MANAGER/STAFF)

```
1. 账户登录 -> POST /accounts/login
   Body: {
     "accountName": "manager001",
     "password": "password",
     "organizationId": "org-uuid"
   }
2. 返回令牌 (格式与用户相同)
3. 使用令牌 -> Authorization: Bearer eyJhbGc...
```

**Access Token 声明 (Claims)**:

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

### 3. 设备认证流程

**适用对象**: POS 终端, KIOSK, TABLET 等

```
1. 注册设备 -> POST /devices/register
2. 激活设备 -> POST /devices/activate (需要激活码)
3. 设备认证 -> POST /devices/auth
   Body: {
     "deviceId": "device-cuid",
     "deviceSecret": "secret-hash"
   }
4. 返回短效 JWT 令牌 (5 分钟)
```

**设备令牌声明 (Claims)**:

```json
{
  "sub": "device:cuid",
  "deviceType": "POS",
  "organizationId": "org-uuid",
  "productType": "beauty",
  "type": "device",
  "exp": 1234564590 // 5 分钟后过期
}
```

### 4. 管理 API 认证

**适用对象**: 系统管理员操作

```bash
# 使用 X-Admin-Key 头进行认证
curl -X GET http://localhost:8080/api/auth-service/v1/admin/health \
  -H "X-Admin-Key: admin_ryan_sk_Z678YTHUJ"
```

**Admin Key 格式**: `admin_{name}_sk_{random}`

在 `.env` 中配置:

```
ADMIN_API_KEYS=admin_ryan_sk_Z678YTHUJ,admin_meng_sk_O0S8HBLAY
```

### 5. OAuth2 客户端凭证流程

**适用对象**: 服务间后端调用

```bash
# 获取客户端令牌
curl -X POST http://localhost:8080/oauth/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -u "client-id:client-secret" \
  -d "grant_type=client_credentials&scope=read:users"
```

### 6. 令牌刷新

```bash
curl -X POST http://localhost:8080/api/auth-service/v1/tokens/refresh \
  -H "Content-Type: application/json" \
  -d '{
    "refreshToken": "rt_xxx"
  }'
```

### 7. 令牌撤销

```bash
# 方法 1: 使用业务 API
curl -X POST http://localhost:8080/api/auth-service/v1/tokens/revoke \
  -H "Authorization: Bearer access_token" \
  -H "Content-Type: application/json" \
  -d '{"refreshToken": "rt_xxx"}'

# 方法 2: 使用 OAuth2 标准端点
curl -X POST http://localhost:8080/oauth/revoke \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "token=rt_xxx&token_type_hint=refresh_token"

# 方法 3: 管理员强制登出
curl -X POST http://localhost:8080/api/auth-service/v1/admin/users/{userId}/force-logout \
  -H "X-Admin-Key: admin_ryan_sk_Z678YTHUJ" \
  -d '{"reason": "Security breach"}'
```

## ⚙️ 配置指南

### 环境变量配置

创建 `.env` 文件 (参考 `.env.example`):

```bash
# ==================== 基础配置 ====================
NODE_ENV=development
PORT=8080

# ==================== 数据库配置 ====================
DATABASE_URL=postgresql://user:password@host:5432/auth-service

# ==================== Redis 配置 ====================
REDIS_URL=redis://localhost:6379
REDIS_PASSWORD=
REDIS_DB=0
REDIS_NAMESPACE=authsvc_dev

# ==================== OAuth2/OIDC 配置 ====================
ISSUER_URL=http://localhost:8080
ACCESS_TOKEN_TTL_SECONDS=3600        # 1 小时
REFRESH_TOKEN_TTL_SECONDS=2592000    # 30 天

# ==================== 安全配置 ====================
SESSION_SECRET=your-session-secret-here
KEYSTORE_ENC_KEY=base64:your-keystore-encryption-key

# ==================== CORS 配置 ====================
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:3001
COOKIE_SAMESITE=lax

# ==================== 速率限制配置 ====================
RATE_MAX_LOGIN_PER_HR=50
RATE_MAX_REGISTER_PER_HR=30
RATE_MAX_RESET_PER_HR=20

# ==================== 邮件配置 ====================
MAIL_TRANSPORT=SMTP
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=noreply@example.com
SMTP_PASS=your-smtp-password
MAIL_FROM=Tymoe Auth <noreply@example.com>

# ==================== 验证码配置 ====================
VERIFY_CODE_TTL_MIN=10
RESET_CODE_TTL_MIN=10

# ==================== 登录安全配置 ====================
LOGIN_CAPTCHA_THRESHOLD=3    # 3 次失败后需要验证码
LOGIN_LOCK_THRESHOLD=10      # 10 次失败后锁定账户
LOGIN_LOCK_MINUTES=30        # 锁定 30 分钟

# ==================== CAPTCHA 配置 ====================
CAPTCHA_ENABLED=true
CAPTCHA_SITE_KEY=your-recaptcha-site-key
CAPTCHA_SECRET_KEY=your-recaptcha-secret-key

# ==================== 设备认证配置 ====================
DEVICE_SECRET_LENGTH=32
DEVICE_JWT_TTL_SEC=300       # 设备令牌 5 分钟过期

# ==================== 内部服务配置 ====================
INTROSPECT_CLIENT_ID=internal-gateway
INTROSPECT_CLIENT_SECRET=your-client-secret
INTERNAL_SERVICE_KEY=your-internal-service-key

# ==================== 管理 API 配置 ====================
ADMIN_API_KEYS=admin_alice_sk_ABC123,admin_bob_sk_XYZ789

# ==================== 多租户配置 ====================
DEFAULT_TENANT_ID=tenant-dev
ALLOWED_AUDIENCES=tymoe-service,tymoe-web

# ==================== 监控配置 ====================
METRICS_TOKEN=your-metrics-token

# ==================== 审计配置 ====================
AUDIT_TO_FILE=true
AUDIT_FILE_PATH=./logs/audit.log
```

### JWT 密钥管理

#### 密钥初始化

RSA 密钥对在服务首次启动时自动生成并存储在数据库中：

```
🔐 Initializing JWT signing keys...
✅ JWT signing keys ready
```

#### 密钥轮换 (v2.1.1 新增)

**通过管理 API 轮换密钥** (推荐):

```bash
curl -X POST http://localhost:8080/api/auth-service/v1/admin/keys/rotate \
  -H "X-Admin-Key: admin_ryan_sk_Z678YTHUJ" \
  -H "Content-Type: application/json" \
  -d '{
    "reason": "Quarterly security rotation"
  }'
```

**响应示例**:

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

**密钥生命周期**:

- **ACTIVE**: 当前活跃密钥，用于签发新令牌
- **GRACE**: 宽限期 (1 小时)，旧密钥仍可验证令牌
- **RETIRED**: 已退役，不再使用

⚠️ **重要**: 密钥轮换后，其他服务应从 `/jwks.json` 刷新公钥。

## 🚢 部署指南

### Docker 部署 (推荐)

```bash
# 1. 构建镜像
docker build -t tymoe-auth-service:2.1.2 .

# 2. 运行容器
docker run -d \
  --name auth-service \
  -p 8080:8080 \
  --env-file .env \
  tymoe-auth-service:2.1.2

# 3. 查看日志
docker logs -f auth-service
```

### Docker Compose 部署

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

启动:

```bash
docker-compose up -d
```

### 生产环境检查清单

- [ ] 配置正确的 `DATABASE_URL`
- [ ] 配置强随机的 `SESSION_SECRET` 和 `KEYSTORE_ENC_KEY`
- [ ] 设置正确的 `ISSUER_URL` (生产域名)
- [ ] 配置 SMTP 邮件服务
- [ ] 启用验证码 (`CAPTCHA_ENABLED=true`)
- [ ] 设置 `ALLOWED_ORIGINS` 为实际前端域名
- [ ] 配置 Admin API Keys (强随机)
- [ ] 启用 Redis 持久化
- [ ] 配置 PostgreSQL 备份
- [ ] 设置 Nginx 反向代理 (HTTPS)
- [ ] 配置日志收集 (ELK/Loki)
- [ ] 启用 Prometheus Metrics 监控
- [ ] 定期轮换 JWT 密钥 (建议每季度)

## 🛠️ 开发指南

### 项目结构

```
auth-service-deploy/
├── src/
│   ├── config/              # 配置文件
│   │   ├── env.ts           # 环境变量
│   │   └── env.validate.ts  # 环境验证
│   ├── controllers/         # 控制器
│   │   ├── identity.ts      # 用户身份管理
│   │   ├── oidc.ts          # OAuth2/OIDC
│   │   ├── organizations.ts # 组织管理
│   │   ├── account.ts       # 账户登录
│   │   ├── device.ts        # 设备管理
│   │   └── admin.ts         # 管理 API
│   ├── services/            # 业务逻辑
│   │   ├── user.ts          # 用户服务
│   │   ├── organization.ts  # 组织服务
│   │   ├── token.ts         # 令牌服务
│   │   ├── clientAuth.ts    # 客户端认证
│   │   └── userSecurity.ts  # 用户安全
│   ├── middleware/          # 中间件
│   │   ├── authenticate.ts  # JWT 认证
│   │   ├── adminAuth.ts     # 管理员认证
│   │   ├── redisRate.ts     # 速率限制
│   │   ├── permission.ts    # 权限检查
│   │   └── productType.ts   # 产品类型验证
│   ├── infra/              # 基础设施
│   │   ├── db.ts           # Prisma 客户端
│   │   ├── redis.ts        # Redis 客户端
│   │   ├── keystore.ts     # JWT 密钥存储
│   │   ├── mail.ts         # 邮件服务
│   │   └── audit.ts        # 审计日志
│   ├── routes/             # 路由
│   │   ├── identity.ts
│   │   ├── oidc.ts
│   │   ├── organizations.ts
│   │   ├── accounts.ts
│   │   ├── devices.ts
│   │   └── admin.ts
│   └── index.ts            # 入口点
├── prisma/
│   ├── schema.prisma       # 数据库模式
│   └── migrations/         # 数据库迁移
├── .env                    # 环境变量
├── tsconfig.json           # TypeScript 配置
├── package.json
└── README.md
```

### 添加新 API 端点

1. **在 `src/controllers/` 中创建控制器函数**:

```typescript
// src/controllers/myFeature.ts
import { Request, Response } from "express";

export async function myEndpoint(req: Request, res: Response) {
  try {
    // 业务逻辑
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: "internal_error" });
  }
}
```

2. **在 `src/routes/` 中创建路由**:

```typescript
// src/routes/myFeature.ts
import { Router } from "express";
import { myEndpoint } from "../controllers/myFeature.js";
import { authenticate } from "../middleware/authenticate.js";

const router = Router();
router.get("/my-endpoint", authenticate, myEndpoint);
export default router;
```

3. **在 `src/index.ts` 中注册路由**:

```typescript
import myFeatureRoutes from "./routes/myFeature.js";
app.use("/api/auth-service/v1/my-feature", myFeatureRoutes);
```

### 数据库迁移

```bash
# 1. 修改 prisma/schema.prisma

# 2. 创建迁移
npx prisma migrate dev --name add_new_field

# 3. 应用迁移 (生产环境)
npx prisma migrate deploy

# 4. 生成 Prisma 客户端
npx prisma generate
```

### 运行测试

```bash
# 运行所有测试
npm test

# 运行特定测试文件
npm test -- identity.test.ts

# 生成测试覆盖率报告
npm run test:coverage
```

## 🐛 故障排除

### 常见问题

#### 1. 服务启动失败

**问题**: `Error: connect ECONNREFUSED 127.0.0.1:5432`

**解决方案**: 检查 PostgreSQL 是否运行且 DATABASE_URL 是否正确

```bash
# 检查 PostgreSQL
psql $DATABASE_URL -c "SELECT 1"

# 检查 Redis
redis-cli ping
```

#### 2. JWT 验证失败

**问题**: `{ "error": "invalid_token" }`

**解决方案**:

- 检查令牌是否过期
- 验证 `ISSUER_URL` 是否正确
- 确保其他服务使用 `/jwks.json` 中的最新公钥

```bash
# 查看 JWKS
curl http://localhost:8080/jwks.json

# 检查令牌内容 (使用 jwt.io)
```

#### 3. 邮件发送失败

**问题**: `Error: Invalid login: 535 Authentication failed`

**解决方案**: 检查 SMTP 配置

```bash
# 测试 SMTP 连接
npm run test:smtp
```

#### 4. Redis 连接超时

**问题**: `Error: Redis connection timeout`

**解决方案**:

- 验证 `REDIS_URL` 是否正确
- 检查 Redis 是否运行
- 调整 `REDIS_CONNECT_TIMEOUT` 和 `REDIS_COMMAND_TIMEOUT`

```bash
# 测试 Redis 连接
redis-cli -u $REDIS_URL ping
```

#### 5. 超出速率限制

**问题**: `{ "error": "rate_limit_exceeded" }`

**解决方案**:

- 检查 Redis 中的速率限制键
- 调整 `.env` 中的速率限制配置
- 或使用 Admin API 清理缓存

```bash
# 清理速率限制缓存
curl -X POST http://localhost:8080/api/auth-service/v1/admin/cache/clear \
  -H "X-Admin-Key: admin_ryan_sk_Z678YTHUJ" \
  -d '{"cacheType":"all"}'
```

#### 6. 账户锁定

**问题**: `{ "error": "account_locked" }`

**解决方案**: 使用 Admin API 解锁

```bash
curl -X POST http://localhost:8080/api/auth-service/v1/admin/users/{userId}/unlock \
  -H "X-Admin-Key: admin_ryan_sk_Z678YTHUJ" \
  -d '{"reason":"User requested unlock"}'
```

### 查看日志

```bash
# 查看应用日志
tail -f logs/app.log

# 查看审计日志
tail -f logs/audit.log

# 使用 Docker
docker logs -f auth-service

# 使用 journalctl (systemd)
journalctl -u auth-service -f
```

### 健康检查

```bash
# 系统健康检查
curl http://localhost:8080/api/auth-service/v1/admin/health \
  -H "X-Admin-Key: admin_ryan_sk_Z678YTHUJ"

# 系统统计
curl http://localhost:8080/api/auth-service/v1/admin/stats \
  -H "X-Admin-Key: admin_ryan_sk_Z678YTHUJ"

# Prometheus Metrics
curl http://localhost:8080/metrics \
  -H "Authorization: Bearer your-metrics-token"
```

## 📚 相关文档

- [API Endpoint Design Document.md](./API端点设计文档.md) - 完整 API 文档 (54 个端点, 52 个唯一)
- [OAuth 2.0 RFC 6749](https://tools.ietf.org/html/rfc6749)
- [OpenID Connect Core 1.0](https://openid.net/specs/openid-connect-core-1_0.html)
- [Prisma 文档](https://www.prisma.io/docs)

## 📝 更新日志

### v2.2.0 (2025-10-12)

**破坏性变更**:

- ✅ **移除 X-Product-Type 头验证** - 前端不再需要发送 X-Product-Type 头
- ✅ **扩展 ProductType 枚举** - 从 2 个值扩展到 15 个详细类型
- ✅ **从 Account 表移除 productType** - 现在从关联的 Organization 获取
- ✅ **优化组织查询逻辑** - 不再按 productType 过滤，返回所有组织

**新 ProductType 值**:

- `beauty_salon`, `hair_salon`, `spa`
- `restaurant`, `fast_food`, `cafe`, `beverage`
- `home_studio`, `fitness`, `yoga_studio`
- `retail`, `chinese_restaurant`, `clinic`
- `liquor_store`, `other`

**数据库变更**:

- ✅ 从 Account 表移除 `productType` 字段
- ✅ 扩展 ProductType 枚举到 15 个值
- ✅ 数据库迁移应用成功

**API 变更**:

- ✅ **POST /organizations** - `productType` 现在在请求体中传递 (不是头)
- ✅ **GET /organizations** - 返回所有组织，无 productType 过滤
- ✅ **POST /identity/login** - 返回所有用户组织，无 productType 过滤
- ✅ **所有 Account 端点** - 从 `account.organization.productType` 获取 productType

**代码改进**:

- ✅ 移除 `src/middleware/productType.ts` 中间件
- ✅ 修复 `src/controllers/admin.ts` 中的硬编码枚举值
- ✅ 更新 `src/services/organization.ts` 中的类型定义
- ✅ 优化动态 productType 的统计查询

**测试验证**:

- ✅ TypeScript 编译通过
- ✅ 服务启动成功，所有依赖工作正常
- ✅ 健康检查端点 `/healthz` 响应正常

**影响**:

- ⚠️ **破坏性变更**: 前端必须移除所有 X-Product-Type 头
- ⚠️ **API 行为变更**: 登录和组织查询现在返回所有组织
- ⚠️ **数据库变更**: 需要迁移以更新 ProductType 枚举

**迁移指南**:

1. 从前端移除所有 `X-Product-Type` 头
2. 创建组织时在请求体中传递 `productType`
3. 更新 Account 逻辑以从 `account.organization.productType` 获取 productType
4. 登录后基于 `organization.productType` 进行路由

---

### v2.1.1 (2025-10-10)

**新功能**:

- ✅ 添加 **6.11 JWT 密钥轮换 API** (`POST /admin/keys/rotate`)
- ✅ 支持基于 API 的密钥轮换，无需 CLI 脚本
- ✅ 移除旧的 `scripts/rotate-key.ts` 和 `scripts/retire-keys.ts`

**改进**:

- ✅ 增强管理 API 的审计日志
- ✅ 改进密钥生命周期管理 (ACTIVE -> GRACE -> RETIRED)
- ✅ 增强系统配置查询端点 (6.3)

**Bug 修复**:

- ✅ 修复设备强制登出状态更新逻辑
- ✅ 修复缓存清理错误处理

### v2.1.0

**新功能**:

- ✅ 账户管理 API (Account Login)
- ✅ 设备管理 API (Device Management)
- ✅ 组织树结构支持
- ✅ 产品类型隔离 (beauty/fb)

### v2.0.0

**主要更新**:

- ✅ 完整 OAuth2/OIDC 支持
- ✅ 多组织架构 (MAIN/BRANCH/FRANCHISE)
- ✅ 管理 API
- ✅ 审计日志系统

## 📞 支持与反馈

如有问题或建议，请联系开发团队：

- **邮箱**: dev@tymoe.com (目前不存在)
- **Slack**: #auth-service
- **文档**: https://docs.tymoe.com/auth-service (目前不存在)

---

**许可证**: Ryan DIY
**版权**: © 2025 Tymoe Technologies (目前不存在)
