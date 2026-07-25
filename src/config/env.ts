// src/config/env.ts
import './env.validate.js'; // Trigger validation at import time

export const env = {
  // 基础配置
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? '8080'),
  
  // OAuth2/OIDC 配置
  issuerUrl: process.env.ISSUER_URL ?? 'http://localhost:8080/',
  // 对外公开的服务地址，用于邮件链接（如局域网 IP）。未配置时回退到 issuerUrl
  publicUrl: process.env.PUBLIC_URL ?? '',
  // 商家后台 Portal 地址，用于拼接加盟邀请链接。未配置时回退到 publicUrl
  portalUrl: process.env.PORTAL_URL ?? process.env.PUBLIC_URL ?? '',
  
  // Token 配置
  accessTtlSec: Number(process.env.ACCESS_TOKEN_TTL_SECONDS ?? '1800'),    // 30分钟
  refreshTtlSec: Number(process.env.REFRESH_TOKEN_TTL_SECONDS ?? '2592000'), // 30天
  
  // 受众配置
  defaultAudPrefix: process.env.DEFAULT_AUD_PREFIX ?? 'tymoe-service',
  
  // 安全配置
  sessionSecret: process.env.SESSION_SECRET ?? 'dev-session-secret-key',
  keystoreEncKey: process.env.KEYSTORE_ENC_KEY ?? '',
  
  // CORS 配置
  allowedOrigins: process.env.ALLOWED_ORIGINS ?? 'http://localhost:3000',
  cookieSameSite: process.env.COOKIE_SAMESITE ?? 'lax',
  
  // 速率限制
  rateLoginPerMin: Number(process.env.RATE_LOGIN_PER_MIN ?? '5'),
  rateTokenPerMin: Number(process.env.RATE_TOKEN_PER_MIN ?? '25'),
  
  // 监控配置
  metricsToken: process.env.METRICS_TOKEN ?? 'dev-metrics-token',
  
  // 审计配置
  auditToFile: process.env.AUDIT_TO_FILE !== 'false',
  auditFilePath: process.env.AUDIT_FILE_PATH ?? './audit.log',
  
  // JWKS 缓存配置
  jwksMaxAgeSec: Number(process.env.JWKS_MAX_AGE_SEC ?? '3600'),
  
  // 身份验证配置
  passwordHashRounds: parseInt(process.env.PASSWORD_HASH_ROUNDS ?? '10', 10),
  // PIN 快速查找的 pepper（服务端密钥，不进库）。用于把 O(n) bcrypt 降为 O(1) 索引查找。
  // 未配置时降级为逐个 bcrypt 比对（仍可用，只是慢）。
  pinLookupPepper: process.env.PIN_LOOKUP_PEPPER ?? '',
  
  // 邮件配置
  mailTransport: process.env.MAIL_TRANSPORT ?? 'CONSOLE',
  smtpHost: process.env.SMTP_HOST ?? 'smtp.example.com',
  smtpPort: Number(process.env.SMTP_PORT ?? '587'),
  smtpSecure: process.env.SMTP_SECURE === 'true',
  smtpUser: process.env.SMTP_USER ?? '',
  smtpPass: process.env.SMTP_PASS ?? '',
  mailFrom: process.env.MAIL_FROM ?? 'Tymoe Auth <no-reply@tymoe.com>',
  
  // 验证码配置
  signupCodeTtlSec: Number(process.env.SIGNUP_CODE_TTL_SEC ?? '900'),
  resetCodeTtlSec: Number(process.env.RESET_CODE_TTL_SEC ?? '900'),
  codeAttemptMax: Number(process.env.CODE_ATTEMPT_MAX ?? '5'),
  verificationCodeReuseWindowSec: Number(process.env.VERIFICATION_CODE_REUSE_WINDOW_SEC ?? '600'), // 10分钟
  
  // 登录安全配置
  loginCaptchaThreshold: Number(process.env.LOGIN_CAPTCHA_THRESHOLD ?? '3'),
  loginLockThreshold: Number(process.env.LOGIN_LOCK_THRESHOLD ?? '10'),
  loginLockMinutes: Number(process.env.LOGIN_LOCK_MINUTES ?? '30'),
  
  // Redis 配置
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  redisPassword: process.env.REDIS_PASSWORD ?? '',
  redisDb: Number(process.env.REDIS_DB ?? '0'),
  redisNamespace: process.env.REDIS_NAMESPACE ?? 'authsvc',
  redisConnectTimeout: Number(process.env.REDIS_CONNECT_TIMEOUT ?? '5000'),
  redisCommandTimeout: Number(process.env.REDIS_COMMAND_TIMEOUT ?? '3000'),
  redisMaxRetries: Number(process.env.REDIS_MAX_RETRIES ?? '3'),
  
  // 设备认证配置
  deviceSecretLength: Number(process.env.DEVICE_SECRET_LENGTH ?? '32'),
  
  // CAPTCHA 配置
  captchaEnabled: process.env.CAPTCHA_ENABLED === 'true',
  captchaSiteKey: process.env.CAPTCHA_SITE_KEY ?? '',
  captchaSecretKey: process.env.CAPTCHA_SECRET_KEY ?? '',
  captchaVerifyUrl: process.env.CAPTCHA_VERIFY_URL ?? 'https://www.google.com/recaptcha/api/siteverify',
  
  // Client 认证配置（用于内部服务调用）
  introspectClientId: process.env.INTROSPECT_CLIENT_ID ?? 'gateway',
  introspectClientSecret: process.env.INTROSPECT_CLIENT_SECRET ?? 'gateway-secret',
  internalServiceKey: process.env.INTERNAL_SERVICE_KEY ?? 'dev-internal-service-key',
  
  // Subscription Service 配置
  subscriptionServiceUrl: process.env.SUBSCRIPTION_SERVICE_URL ?? 'http://localhost:8088/api/subscription-service/v1',

  // Admin API Keys 配置
  adminApiKeys: process.env.ADMIN_API_KEYS ?? '',

  // Legacy support for backward compatibility
  loginMaxFailures: Number(process.env.LOGIN_MAX_FAILURES ?? process.env.LOGIN_LOCK_THRESHOLD ?? '10'),
  loginLockoutDurationSec: Number(process.env.LOGIN_LOCKOUT_DURATION_SEC ?? '1800'),
  smtpAuthUser: process.env.SMTP_AUTH_USER ?? process.env.SMTP_USER ?? '',
  smtpAuthPass: process.env.SMTP_AUTH_PASS ?? process.env.SMTP_PASS ?? '',
  mailReplyTo: process.env.MAIL_REPLY_TO ?? 'support@tymoe.com',
  jtiCacheTtlSec: Number(process.env.JTI_CACHE_TTL_SEC ?? '3600'),
  rateWindowSec: Number(process.env.RATE_WINDOW_SEC ?? '3600'),
  rateMaxRegister: Number(process.env.RATE_MAX_REGISTER_PER_HR ?? '10'),
  rateMaxReset: Number(process.env.RATE_MAX_RESET_PER_HR ?? '10'),
  rateMaxLogin: Number(process.env.RATE_MAX_LOGIN_PER_HR ?? '10'),
  
  // JWT Token验证
  allowedAudiences: process.env.ALLOWED_AUDIENCES ?? 'tymoe-web,tymoe-service',

  // Google Geocoding（保存门店地址时把地址转经纬度；务必用服务端专用 key，勿复用前端浏览器 key）
  googleGeocodingApiKey: process.env.GOOGLE_GEOCODING_API_KEY ?? '',
} as const;