import { Request, Response } from 'express';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { prisma } from '../infra/prisma.js';
import { env } from '../config/env.js';
import { audit } from '../middleware/audit.js';
import { IdentityService } from '../services/identity.js';
import { revokeFamily, signAccessToken, issueRefreshFamily } from '../services/token.js';
import { createRateLimiter, isRedisConnected, getRedisClient } from '../infra/redis.js';
import { getMailer } from '../services/mailer.js';
import { Templates } from '../services/templates.js';

const identityService = new IdentityService();

export async function register(req: Request, res: Response) {
  const { email, password, name, phone } = req.body;

  try {
    // 验证必填字段
    if (!email || !password) {
      audit('register_invalid_request', { ip: req.ip, email: email || 'missing' });
      return res.status(400).json({
        error: 'missing_required_fields',
        detail: 'Email and password are required'
      });
    }

    // 验证 email 格式
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      audit('register_invalid_email', { ip: req.ip, email });
      return res.status(400).json({ 
        error: 'invalid_email_format',
        detail: 'Please provide a valid email address'
      });
    }

    // 验证密码强度
    const passwordValidation = identityService.validatePassword(password);
    if (!passwordValidation.valid) {
      audit('register_password_validation', { ip: req.ip, email, error: passwordValidation.error });
      return res.status(400).json({ 
        error: 'weak_password',
        detail: 'Password must be at least 8 characters with uppercase, lowercase, and numbers'
      });
    }

    // 验证 name 格式（如果提供）
    if (name && (name.length < 2 || name.length > 50)) {
      audit('register_invalid_name', { ip: req.ip, email });
      return res.status(400).json({ 
        error: 'invalid_name_format',
        detail: 'Name must be 2-50 characters, letters, Chinese characters, spaces, and hyphens only'
      });
    }

    // 验证 phone 格式（如果提供）
    if (phone && !/^\+\d{10,15}$/.test(phone)) {
      audit('register_invalid_phone', { ip: req.ip, email });
      return res.status(400).json({ 
        error: 'invalid_phone_format',
        detail: 'Please provide a valid phone number in international format (e.g., +16729650830)'
      });
    }

    const existingUser = await prisma.user.findUnique({
      where: { email }
    });

    if (existingUser) {
      if (existingUser.emailVerifiedAt) {
        // User exists and verified - reject registration
        audit('register_conflict', { ip: req.ip, email, verified: true });
        return res.status(409).json({ 
          error: 'email_already_registered',
          detail: 'This email is already registered and verified. Please try to log in.'
        });
      } else {
        // User exists but not verified - 删除旧记录和相关验证，继续注册
        await prisma.emailVerification.deleteMany({
          where: { userId: existingUser.id }
        });
        await prisma.user.delete({
          where: { id: existingUser.id }
        });
        
        audit('register_cleanup_unverified', { 
          ip: req.ip, 
          email, 
          userId: existingUser.id
        });
      }
    }

    // 创建新用户（不创建组织）
    const passwordHash = await bcrypt.hash(password, 10);
    const newUser = await prisma.user.create({
      data: {
        email,
        passwordHash,
        name: name || null,
        phone: phone || null,
      }
    });

    // 生成并发送验证码
    await identityService.issueEmailVerification(
      newUser.id,
      'signup',
      email
    );

    audit('user_register', {
      ip: req.ip,
      email,
      userId: newUser.id
    });

    return res.status(201).json({
      success: true,
      message: 'Please check your email for verification.',
      data: {
        email
      }
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'unknown_error';
    
    // Handle password validation errors
    const passwordErrors = [
      'password_required', 'password_too_short', 'password_too_long',
      'password_needs_uppercase', 'password_needs_lowercase', 
      'password_needs_digit', 'password_too_common'
    ];
    
    if (passwordErrors.includes(errorMessage)) {
      audit('register_password_validation', { ip: req.ip, email, error: errorMessage });
      return res.status(400).json({ error: errorMessage });
    }

    if (errorMessage === 'subdomain_taken') {
      audit('register_name_conflict', { ip: req.ip, email });
      return res.status(409).json({ error: 'subdomain_taken' });
    }

    audit('register_error', { ip: req.ip, email, error: errorMessage });
    return res.status(500).json({ error: 'server_error' });
  }
}

export async function verify(req: Request, res: Response) {
  const { email, code } = req.body;

  try {
    if (!email || !code) {
      audit('verify_invalid_request', { ip: req.ip, email: email || 'missing' });
      return res.status(400).json({ 
        error: 'invalid_request',
        detail: 'Email and code are required'
      });
    }

    // 验证 code 格式 (必须是6位数字)
    if (typeof code !== 'string' || !/^\d{6}$/.test(code)) {
      audit('verify_invalid_format', { ip: req.ip, email });
      return res.status(400).json({ 
        error: 'invalid_code_format',
        detail: 'Verification code must be 6 digits'
      });
    }

    const user = await identityService.consumeEmailVerification(email, code);

    audit('email_verified', { 
      ip: req.ip, 
      email, 
      userId: user.id 
    });

    return res.status(200).json({ 
      success: true,
      message: 'Email verified successfully. You can now log in.',
      data: {
        email: user.email,
        emailVerified: true
      }
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'unknown_error';
    
    const errorMap: Record<string, { status: number; error: string; detail: string }> = {
      'verification_not_found': { 
        status: 404, 
        error: 'verification_not_found',
        detail: 'No pending verification found for this email. Please register again or request a new code.'
      },
      'invalid_code': { 
        status: 400, 
        error: 'invalid_code',
        detail: 'Invalid verification code.'
      },
      'code_expired': { 
        status: 400, 
        error: 'code_expired',
        detail: 'Verification code has expired. Please request a new one.'
      },
      'too_many_attempts': { 
        status: 429, 
        error: 'too_many_attempts',
        detail: 'Too many failed attempts. Please request a new verification code.'
      }
    };

    const errorInfo = errorMap[errorMessage] || { 
      status: 500, 
      error: 'server_error',
      detail: 'An unexpected error occurred'
    };
    
    audit('verify_failed', { 
      ip: req.ip, 
      email, 
      reason: errorMessage 
    });

    return res.status(errorInfo.status).json({ 
      error: errorInfo.error,
      detail: errorInfo.detail
    });
  }
}

// 1.4 用户登录 (按文档要求：不直接返回token,只返回用户信息和组织列表)
export async function login(req: Request, res: Response) {
  const { email, password } = req.body;
  const ip = req.ip || 'unknown';
  const userAgent = req.get('User-Agent') || 'unknown';

  try {
    // 1. 验证 email 格式
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email)) {
      return res.status(400).json({
        error: 'invalid_email_format',
        detail: 'Please provide a valid email address'
      });
    }

    // 2. 查询 User 记录
    const user = await prisma.user.findUnique({
      where: { email }
    });

    // 4. 如果用户不存在,返回 401 (不泄露用户是否存在)
    if (!user) {
      await prisma.loginAttempt.create({
        data: {
          loginType: 'USER',
          loginIdentifier: email,
          userId: null,
          ipAddress: ip,
          userAgent,
          success: false,
          failureReason: 'user_not_found'
        } as any
      });
      audit('user_login_fail', { ip, email, reason: 'invalid_credentials' });
      return res.status(401).json({
        error: 'invalid_credentials',
        detail: 'Email or password is incorrect.'
      });
    }

    // 5. 检查账户状态：emailVerifiedAt
    if (!user.emailVerifiedAt) {
      await prisma.loginAttempt.create({
        data: {
          loginType: 'USER',
          loginIdentifier: email,
          userId: user.id,
          ipAddress: ip,
          userAgent,
          success: false,
          failureReason: 'account_not_verified'
        } as any
      });
      audit('user_login_fail', { ip, email, userId: user.id, reason: 'account_not_verified' });
      return res.status(401).json({
        error: 'account_not_verified',
        detail: 'Please verify your email address before logging in.'
      });
    }

    // 6. 检查账户状态：lockedUntil
    const now = new Date();
    if (user.lockedUntil && user.lockedUntil > now) {
      await prisma.loginAttempt.create({
        data: {
          loginType: 'USER',
          loginIdentifier: email,
          userId: user.id,
          ipAddress: ip,
          userAgent,
          success: false,
          failureReason: 'account_locked'
        } as any
      });
      audit('user_login_fail', { ip, email, userId: user.id, reason: 'account_locked' });
      return res.status(423).json({
        error: 'account_locked',
        detail: 'Account is locked due to too many failed login attempts. Please try again in 30 minutes or contact support.',
        lockedUntil: user.lockedUntil.toISOString()
      });
    }

    // 7. 使用 bcrypt.compare() 验证密码
    const isValidPassword = await bcrypt.compare(password, user.passwordHash);
    if (!isValidPassword) {
      // 8. 密码错误：loginFailureCount += 1
      const newFailureCount = (user.loginFailureCount || 0) + 1;
      const updateData: any = {
        loginFailureCount: newFailureCount,
        lastLoginFailureAt: now
      };

      // 如果 loginFailureCount >= 10，锁定账户
      if (newFailureCount >= 10) {
        const lockDurationMs = 30 * 60 * 1000; // 30分钟
        updateData.lockedUntil = new Date(now.getTime() + lockDurationMs);
        updateData.lockReason = 'max_failures';
        
        audit('user_locked', {
          ip,
          userId: user.id,
          email,
          reason: 'max_failures',
          failureCount: newFailureCount
        });
      }

      await prisma.user.update({
        where: { id: user.id },
        data: updateData
      });

      await prisma.loginAttempt.create({
        data: {
          loginType: 'USER',
          loginIdentifier: email,
          userId: user.id,
          ipAddress: ip,
          userAgent,
          success: false,
          failureReason: 'invalid_password'
        } as any
      });
      
      audit('user_login_fail', { ip, email, userId: user.id, reason: 'invalid_password' });
      return res.status(401).json({
        error: 'invalid_credentials',
        detail: 'Email or password is incorrect.'
      });
    }

    // 9. 密码正确：重置 loginFailureCount = 0, lastLoginFailureAt = null, lockedUntil = null, lockReason = null
    await prisma.user.update({
      where: { id: user.id },
      data: {
        loginFailureCount: 0,
        lastLoginFailureAt: null,
        lockedUntil: null,
        lockReason: null
      }
    });

    // 10. 记录成功的登录尝试
    await prisma.loginAttempt.create({
      data: {
        loginType: 'USER',
        loginIdentifier: email,
        userId: user.id,
        ipAddress: ip,
        userAgent,
        success: true,
        failureReason: null
      } as any
    });

    // 11. 查询该用户的所有 organizations
    const organizations = await prisma.organization.findMany({
      where: {
        userId: user.id,
        status: 'ACTIVE'
      },
      select: {
        id: true,
        orgName: true,
        orgType: true,
        status: true,
        parentOrgId: true,
        description: true,
        location: true,
        street: true,
        city: true,
        province: true,
        postalCode: true,
        country: true,
        latitude: true,
        longitude: true,
        phone: true,
        email: true,
        timezone: true,
        businessHours: true,
      },
      orderBy: { createdAt: 'asc' }
    });

    // 12. 记录审计日志
    audit('user_login', {
      ip,
      email,
      userId: user.id
    });

    // 13. 返回用户信息和筛选后的组织列表 (不返回token)
    return res.status(200).json({
      success: true,
      user: {
        email: user.email,
        name: user.name,
        phone: user.phone,
        emailVerified: true,
        createdAt: user.createdAt.toISOString()
      },
      organizations: organizations.map(org => ({
        id: org.id,
        orgName: org.orgName,
        orgType: org.orgType,
        status: org.status,
        ...(org.parentOrgId && { parentOrgId: org.parentOrgId }),
        ...(org.description && { description: org.description }),
        ...(org.location && { location: org.location }),
        street: org.street,
        city: org.city,
        province: org.province,
        postalCode: org.postalCode,
        country: org.country,
        latitude: org.latitude,
        longitude: org.longitude,
        ...(org.phone && { phone: org.phone }),
        ...(org.email && { email: org.email }),
        ...(org.timezone && { timezone: org.timezone }),
        ...(org.businessHours && { businessHours: org.businessHours }),
      }))
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'unknown_error';
    console.error('Login error:', error);
    audit('user_login_error', { ip, email, error: errorMessage });
    return res.status(500).json({ error: 'server_error' });
  }
}

// New endpoint to check if CAPTCHA is required for a user
// 1.3 重新发送验证码
export async function resend(req: Request, res: Response) {
  const { email, purpose } = req.body;
  const ip = req.ip || 'unknown';

  try {
    // 验证必填字段
    if (!email || !purpose) {
      return res.status(400).json({
        error: 'missing_required_fields',
        detail: 'Email and purpose are required'
      });
    }

    // 验证 email 格式
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        error: 'invalid_email_format',
        detail: 'Please provide a valid email address'
      });
    }

    // 验证 purpose 枚举值
    if (!['signup', 'password_reset', 'email_change'].includes(purpose)) {
      return res.status(400).json({
        error: 'invalid_purpose',
        detail: 'Purpose must be one of: signup, password_reset, email_change'
      });
    }

    // 查询用户
    const user = await prisma.user.findUnique({
      where: { email }
    });

    if (!user) {
      return res.status(404).json({
        error: 'user_not_found',
        detail: 'No account found with this email address.'
      });
    }

    // 如果是 signup 目的，检查是否已验证
    if (purpose === 'signup' && user.emailVerifiedAt) {
      return res.status(400).json({
        error: 'already_verified',
        detail: 'This email is already verified. You can log in directly.'
      });
    }

    // 调用 service 重新发送
    const result = await identityService.resendVerificationCode(user.id, email, purpose);

    audit('verification_resent', { ip, email, purpose });

    return res.status(200).json({
      success: true,
      message: 'Verification code has been sent. Please check your email.',
      data: {
        email,
        expiresIn: 1800
      }
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'unknown_error';
    
    if (errorMessage === 'too_soon') {
      return res.status(429).json({
        error: 'too_soon',
        detail: 'Please wait 60 seconds before requesting another verification code.'
      });
    }
    
    if (errorMessage === 'resend_limit_exceeded') {
      return res.status(429).json({
        error: 'resend_limit_exceeded',
        detail: 'Maximum resend limit reached. Please try registering again.'
      });
    }

    console.error('Resend verification code error:', error);
    audit('resend_error', { ip, email, error: errorMessage });
    return res.status(500).json({ error: 'server_error' });
  }
}

// 1.7 用户登出 (按文档要求：refresh_token必填,撤销家族,Redis黑名单)
export async function logout(req: Request, res: Response) {
  const { refresh_token } = req.body;
  const ip = req.ip || 'unknown';
  
  try {
    // 1. 从 Bearer token 中提取 userId 和 jti
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    
    // 从 req.claims 中获取（由 requireBearer 中间件注入）
    const claims = (req as any).claims;
    if (!claims || !claims.sub || !claims.jti) {
      return res.status(401).json({ error: 'invalid_token' });
    }
    
    const userId = claims.sub;
    const jti = claims.jti;

    // 2. 验证 refresh_token (必填)
    if (!refresh_token) {
      return res.status(400).json({
        error: 'missing_refresh_token',
        detail: 'refresh_token is required'
      });
    }

    // 3. 查询 refresh_token 记录
    const refreshTokenRecord = await prisma.refreshToken.findUnique({
      where: { id: refresh_token }
    });

    if (refreshTokenRecord && refreshTokenRecord.subjectUserId === userId) {
      // 4. 撤销该 token 及其家族
      if (refreshTokenRecord.familyId) {
        await revokeFamily(refreshTokenRecord.familyId, 'user_logout');
      } else {
        // 单独撤销这一个token
        await prisma.refreshToken.update({
          where: { id: refresh_token },
          data: {
            status: 'REVOKED',
            revokedAt: new Date(),
            revokeReason: 'user_logout'
          }
        });
      }
    }

    // 5. 将 access_token 的 jti 加入 Redis 黑名单
    // TTL = access_token 的剩余有效时间
    if (claims.exp) {
      const ttl = claims.exp - Math.floor(Date.now() / 1000);
      if (ttl > 0 && isRedisConnected()) {
        try {
          const redis = await getRedisClient();
          // 存储包含reason的JSON数据
          const blacklistData = JSON.stringify({
            reason: 'user_logout',
            revokedAt: new Date().toISOString(),
            userId
          });
          await redis.set(`token:blacklist:${jti}`, blacklistData, 'EX', ttl);
        } catch (redisError) {
          console.error('Redis blacklist error:', redisError);
        }
      }
    }

    // 6. 记录审计日志
    audit('user_logout', { ip, userId });

    // 7. 返回成功
    return res.status(200).json({
      success: true,
      message: 'Logged out successfully'
    });
  } catch (err) {
    const error = err as Error;
    audit('user_logout_error', { ip, error: (error && error.message) || String(err) });
    return res.status(500).json({ error: 'server_error' });
  }
}

// 1.8 忘记密码 (按文档要求：10分钟过期,Redis速率限制,即使用户不存在也返回成功)
export async function forgotPassword(req: Request, res: Response) {
  const { email } = req.body;
  const ip = req.ip || 'unknown';

  try {
    // 1. 验证 email 格式
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email)) {
      return res.status(400).json({
        error: 'invalid_email_format',
        detail: 'Please provide a valid email address'
      });
    }

    // 2. 查询 User 记录
    const user = await prisma.user.findUnique({
      where: { email }
    });

    // 3. 如果用户不存在，仍然返回成功 (安全考虑,不泄露用户是否存在)
    if (!user) {
      audit('forgot_password_user_not_found', { ip, email });
      return res.status(200).json({
        success: true,
        message: 'If the system works well, you will receive a password reset code shortly.'
      });
    }

    // 4. 如果用户存在：检查 Redis 速率限制 (同一邮箱 60 秒内只能请求一次)
    // TODO: 需要在 redisRate.ts 中实现速率限制检查
    // 暂时跳过,后续完善

    // 5. 标记旧的 password_reset 记录为过期
    await prisma.emailVerification.updateMany({
      where: {
        userId: user.id,
        purpose: 'password_reset',
        consumedAt: null
      },
      data: {
        expiresAt: new Date()
      }
    });

    // 6. 生成 6 位数字验证码,使用 bcrypt 哈希
    // 7. 创建新的 email_verifications 记录 (expiresAt = 10 分钟后)
    await identityService.issueEmailVerification(user.id, 'password_reset', email);

    // 8. 记录审计日志
    audit('forgot_password', { ip, email, userId: user.id });

    // 9. 返回成功
    return res.status(200).json({
      success: true,
      message: 'If the system works well, you will receive a password reset code shortly.'
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'unknown_error';
    
    if (errorMessage === 'too_many_requests') {
      return res.status(429).json({
        error: 'too_many_requests',
        detail: 'Please wait 60 seconds before requesting another password reset code.'
      });
    }

    console.error('Forgot password error:', error);
    audit('forgot_password_error', { ip, email, error: errorMessage });
    return res.status(500).json({ error: 'server_error' });
  }
}

// 1.9 重置密码 (按文档要求：email+code+password,撤销所有refresh_token)
export async function resetPassword(req: Request, res: Response) {
  const { email, code, password } = req.body;
  const ip = req.ip || 'unknown';

  try {
    // 1. 验证 email 格式
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email)) {
      return res.status(400).json({
        error: 'invalid_email_format',
        detail: 'Please provide a valid email address'
      });
    }

    // 2. 验证 code 格式 (6位数字)
    if (!code || !/^\d{6}$/.test(code)) {
      return res.status(400).json({
        error: 'invalid_code_format',
        detail: 'Verification code must be 6 digits'
      });
    }

    // 3. 验证 password 强度
    const passwordValidation = identityService.validatePassword(password);
    if (!passwordValidation.valid) {
      return res.status(400).json({
        error: 'weak_password',
        detail: 'Password must be at least 8 characters with uppercase, lowercase, and numbers'
      });
    }

    // 4. 通过 email 查找用户
    const user = await prisma.user.findUnique({
      where: { email }
    });

    if (!user) {
      return res.status(404).json({
        error: 'verification_not_found',
        detail: 'No pending verification found for this email.'
      });
    }

    // 5. 查询 email_verifications (purpose='password_reset', 未消费, 未过期)
    const verification = await prisma.emailVerification.findFirst({
      where: {
        userId: user.id,
        purpose: 'password_reset',
        consumedAt: null,
        expiresAt: { gt: new Date() }
      },
      orderBy: { createdAt: 'desc' }
    });

    if (!verification) {
      return res.status(404).json({
        error: 'verification_not_found',
        detail: 'No pending verification found for this email.'
      });
    }

    // 6. 检查过期
    if (verification.expiresAt < new Date()) {
      return res.status(400).json({
        error: 'code_expired',
        detail: 'Verification code has expired. Please request a new one.'
      });
    }

    // 7. 检查尝试次数
    if (verification.attempts >= 10) {
      return res.status(429).json({
        error: 'too_many_attempts',
        detail: 'Too many failed attempts. Please request a new verification code.'
      });
    }

    // 8. 使用 bcrypt 比对验证码
    const isValid = await bcrypt.compare(code, verification.verificationCodeHash);
    if (!isValid) {
      // attempts++
      await prisma.emailVerification.update({
        where: { id: verification.id },
        data: { attempts: verification.attempts + 1 }
      });
      return res.status(400).json({
        error: 'invalid_code',
        detail: 'Invalid verification code.'
      });
    }

    // 9. 验证码正确：使用 bcrypt 哈希新密码
    const passwordHash = await bcrypt.hash(password, 10);

    // 10. 更新 users.passwordHash
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash }
    });

    // 11. 标记验证码为已使用
    await prisma.emailVerification.update({
      where: { id: verification.id },
      data: { consumedAt: new Date() }
    });

    // 12. 撤销该用户的所有 refresh_tokens (安全考虑)
    await prisma.refreshToken.updateMany({
      where: {
        subjectUserId: user.id,
        status: 'ACTIVE'
      },
      data: {
        status: 'REVOKED',
        revokedAt: new Date(),
        revokeReason: 'password_reset'
      }
    });

    // 13. 记录审计日志
    audit('password_reset', { ip, email, userId: user.id });

    // 14. 返回成功
    return res.status(200).json({
      success: true,
      message: 'Password has been reset successfully. Please log in with your new password.'
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'unknown_error';
    console.error('Reset password error:', error);
    audit('password_reset_error', { ip, email, error: errorMessage });
    return res.status(500).json({ error: 'server_error' });
  }
}

// 1.11 获取当前用户信息 (按文档要求：GET /identity/profile)
export async function getProfile(req: Request, res: Response) {
  const ip = req.ip || 'unknown';
  
  try {
    // 1. 从 token 中提取 userId
    const userId = (req as any).claims?.sub;
    if (!userId) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    // 2. 查询 User 记录 (排除敏感字段)
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        email: true,
        name: true,
        phone: true,
        emailVerifiedAt: true,
        createdAt: true,
        updatedAt: true
      }
    });

    if (!user) {
      return res.status(404).json({ error: 'user_not_found' });
    }

    // 3. 返回用户信息
    return res.status(200).json({
      success: true,
      data: {
        email: user.email,
        name: user.name,
        phone: user.phone,
        emailVerified: !!user.emailVerifiedAt,
        createdAt: user.createdAt.toISOString(),
        updatedAt: user.updatedAt.toISOString()
      }
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'unknown_error';
    console.error('Get profile error:', error);
    audit('profile_fetch_error', { ip, userId: (req as any).claims?.sub, error: errorMessage });
    return res.status(500).json({ error: 'server_error' });
  }
}

// 1.12 更新用户信息 (按文档要求：PATCH /identity/profile)
export async function updateProfile(req: Request, res: Response) {
  const { name, phone } = req.body;
  const ip = req.ip || 'unknown';
  
  try {
    // 1. 从 token 中提取 userId
    const userId = (req as any).claims?.sub;
    if (!userId) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    // 2. 验证提供的字段格式
    const updateData: any = {};
    
    if (name !== undefined) {
      // name: 2-50字符
      if (name.length < 2 || name.length > 50) {
        return res.status(400).json({
          error: 'invalid_name_format',
          detail: 'Name must be 2-50 characters'
        });
      }
      updateData.name = name;
    }
    
    if (phone !== undefined) {
      // phone: 使用 libphonenumber 验证 (简化版,国际格式)
      if (phone && !/^\+\d{10,15}$/.test(phone)) {
        return res.status(400).json({
          error: 'invalid_phone_format',
          detail: 'Please provide a valid phone number in international format (e.g., +16729650830)'
        });
      }
      updateData.phone = phone;
    }

    // 3. 更新 User 记录 (只更新提供的字段)
    updateData.updatedAt = new Date();
    
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: {
        email: true,
        name: true,
        phone: true,
        emailVerifiedAt: true,
        createdAt: true,
        updatedAt: true
      }
    });

    // 4. 记录到 audit_logs
    audit('profile_update', { 
      ip, 
      userId,
      detail: { updatedFields: Object.keys(updateData).filter(k => k !== 'updatedAt') }
    });

    // 5. 返回更新后的信息
    return res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      data: {
        email: updatedUser.email,
        name: updatedUser.name,
        phone: updatedUser.phone,
        emailVerified: !!updatedUser.emailVerifiedAt,
        createdAt: updatedUser.createdAt.toISOString(),
        updatedAt: updatedUser.updatedAt.toISOString()
      }
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'unknown_error';
    console.error('Update profile error:', error);
    audit('profile_update_error', { ip, userId: (req as any).claims?.sub, error: errorMessage });
    return res.status(500).json({ error: 'server_error' });
  }
}

// 获取当前登录者的 POS 头像配置（ACCOUNT 员工 / USER 加盟店 owner 都支持）
// 头像本质是 dicebear 参数化配置（{seed, style, params}），存一串 JSON 即可跨设备同步
export async function getMyAvatar(req: Request, res: Response) {
  const ip = req.ip || 'unknown';
  try {
    const claims = (req as any).claims;
    const id = claims?.sub as string | undefined;
    const userType = claims?.userType as string | undefined;
    if (!id) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    let avatarConfig: string | null = null;
    if (userType === 'ACCOUNT') {
      const acc = await prisma.account.findUnique({ where: { id }, select: { avatarConfig: true } });
      if (!acc) return res.status(404).json({ error: 'account_not_found' });
      avatarConfig = acc.avatarConfig;
    } else if (userType === 'USER') {
      const user = await prisma.user.findUnique({ where: { id }, select: { avatarConfig: true } });
      if (!user) return res.status(404).json({ error: 'user_not_found' });
      avatarConfig = user.avatarConfig;
    } else {
      return res.status(400).json({ error: 'unsupported_user_type' });
    }

    return res.status(200).json({ success: true, data: { avatarConfig } });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'unknown_error';
    console.error('Get avatar error:', error);
    audit('avatar_fetch_error', { ip, userId: (req as any).claims?.sub, error: errorMessage });
    return res.status(500).json({ error: 'server_error' });
  }
}

// 更新当前登录者的 POS 头像配置。传 null 表示清除（回退默认头像）
export async function updateMyAvatar(req: Request, res: Response) {
  const ip = req.ip || 'unknown';
  const { avatarConfig } = req.body ?? {};
  try {
    const claims = (req as any).claims;
    const id = claims?.sub as string | undefined;
    const userType = claims?.userType as string | undefined;
    if (!id) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    // 只接受字符串(dicebear 配置 JSON)或 null(清除)；限制长度，防止把 base64 大图塞进来
    if (avatarConfig !== null && typeof avatarConfig !== 'string') {
      return res.status(400).json({ error: 'invalid_avatar_config', detail: 'avatarConfig must be a string or null' });
    }
    if (typeof avatarConfig === 'string' && avatarConfig.length > 8000) {
      return res.status(400).json({ error: 'avatar_config_too_large', detail: 'avatarConfig must be <= 8000 chars (store dicebear config, not base64)' });
    }

    if (userType === 'ACCOUNT') {
      await prisma.account.update({ where: { id }, data: { avatarConfig, updatedAt: new Date() } });
    } else if (userType === 'USER') {
      await prisma.user.update({ where: { id }, data: { avatarConfig, updatedAt: new Date() } });
    } else {
      return res.status(400).json({ error: 'unsupported_user_type' });
    }

    audit('avatar_update', { ip, userId: id, detail: { cleared: avatarConfig === null } });
    return res.status(200).json({ success: true, message: 'Avatar updated successfully', data: { avatarConfig } });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'unknown_error';
    console.error('Update avatar error:', error);
    audit('avatar_update_error', { ip, userId: (req as any).claims?.sub, error: errorMessage });
    return res.status(500).json({ error: 'server_error' });
  }
}

// 重置自己的 PIN 码（USER 用，登录 POS 用的那个 PIN——主店老板或加盟店 owner 都是 User 身份）
// 不需要验证旧 PIN：这是管理员在 Portal 里给自己生成新 PIN 的操作，跟 changePassword 不同，
// 这里没有"当前 PIN"需要确认的语义，直接生成替换即可
export async function resetPin(req: Request, res: Response) {
  const ip = req.ip || 'unknown';
  try {
    const claims = (req as any).claims;
    if (claims?.userType !== 'USER' || !claims?.sub) {
      return res.status(403).json({ error: 'user_only', detail: 'Only User (owner) accounts can reset their own PIN here' });
    }
    const userId = claims.sub as string;

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res.status(404).json({ error: 'user_not_found' });
    }

    // 这个 PIN 是登录 POS 用的，同一个人名下所有门店共用一个 PIN；
    // PIN 由后端随机生成（不再从请求体接收明文），生成时要跟自己名下任意一家门店里
    // 在职的 Account 员工 PIN 做碰撞检查，避免 POS 登录先匹配到那个员工
    const ownedOrgs = await prisma.organization.findMany({
      where: { userId, status: 'ACTIVE' },
      select: { id: true },
    });
    const accountsInOwnedOrgs = ownedOrgs.length > 0
      ? await prisma.account.findMany({
          where: { orgId: { in: ownedOrgs.map(o => o.id) }, status: 'ACTIVE' },
          select: { pinCodeHash: true },
        })
      : [];

    let newPinCode = '';
    for (let attempt = 0; attempt < 20; attempt++) {
      const candidate = crypto.randomInt(0, 10000).toString().padStart(4, '0');
      let collides = false;
      for (const acc of accountsInOwnedOrgs) {
        if (await bcrypt.compare(candidate, acc.pinCodeHash)) { collides = true; break; }
      }
      if (!collides) { newPinCode = candidate; break; }
    }
    if (!newPinCode) {
      return res.status(409).json({ error: 'pinCode_generation_failed', detail: 'Could not generate a unique PIN, please try again' });
    }

    const pinCodeHash = await bcrypt.hash(newPinCode, env.passwordHashRounds);
    await prisma.user.update({ where: { id: userId }, data: { pinCodeHash, pinLookup: null } });

    audit('user_pin_reset', { ip, userId });

    const mailer = getMailer();
    const { subject, html } = Templates.accountPinReset({
      brand: 'Tymoe',
      recipientName: user.name || 'there',
      value: newPinCode,
    });
    await mailer.send(user.email, subject, html);

    return res.status(200).json({
      success: true,
      message: `PIN code has been reset and emailed to ${user.email}`
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'unknown_error';
    console.error('Reset PIN error:', error);
    audit('user_pin_reset_error', { ip, userId: (req as any).claims?.sub, error: errorMessage });
    return res.status(500).json({ error: 'server_error' });
  }
}

export async function changePassword(req: Request, res: Response) {
  const { currentPassword, newPassword } = req.body;
  const ip = req.ip || 'unknown';
  
  try {
    // 1. 从 token 中提取 userId
    const userId = (req as any).claims?.sub;
    if (!userId) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    // 2. 查询 User 记录
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user) {
      return res.status(404).json({ error: 'user_not_found' });
    }

    // 3. 使用 bcrypt.compare() 验证 currentPassword
    const isValid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isValid) {
      return res.status(401).json({
        error: 'invalid_current_password',
        detail: 'Current password is incorrect'
      });
    }

    // 4. 验证 newPassword 强度
    const passwordValidation = identityService.validatePassword(newPassword);
    if (!passwordValidation.valid) {
      return res.status(400).json({
        error: 'weak_password',
        detail: 'Password must be at least 8 characters with uppercase, lowercase, and numbers'
      });
    }

    // 5. 检查新旧密码是否相同
    const isSamePassword = await bcrypt.compare(newPassword, user.passwordHash);
    if (isSamePassword) {
      return res.status(400).json({
        error: 'same_password',
        detail: 'New password must be different from the current password'
      });
    }

    // 6. 使用 bcrypt 哈希新密码
    const passwordHash = await bcrypt.hash(newPassword, 10);

    // 7. 更新 users.passwordHash
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash }
    });

    // 8. 撤销该用户的所有 refresh_tokens (除了当前使用的)
    // TODO: 这里简化实现,撤销所有refresh_tokens
    await prisma.refreshToken.updateMany({
      where: {
        subjectUserId: userId,
        status: 'ACTIVE'
      },
      data: {
        status: 'REVOKED',
        revokedAt: new Date(),
        revokeReason: 'password_change'
      }
    });

    // 9. 记录审计日志
    audit('password_change', { ip, userId });

    // 10. 返回成功
    return res.status(200).json({
      success: true,
      message: 'Password changed successfully'
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'unknown_error';
    console.error('Change password error:', error);
    audit('password_change_error', { ip, userId: (req as any).claims?.sub, error: errorMessage });
    return res.status(500).json({ error: 'server_error' });
  }
}

// 1.13 修改邮箱 (第1步: 请求验证码) (按文档要求)
export async function changeEmail(req: Request, res: Response) {
  const { newEmail, password } = req.body;
  const ip = req.ip || 'unknown';
  
  try {
    // 1. 从 token 中提取 userId
    const userId = (req as any).claims?.sub;
    if (!userId) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    // 2. 查询 User 记录
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user) {
      return res.status(404).json({ error: 'user_not_found' });
    }

    // 3. 使用 bcrypt.compare() 验证 password (安全措施)
    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      return res.status(401).json({
        error: 'invalid_password',
        detail: 'Password is incorrect'
      });
    }

    // 4. 验证 newEmail 格式
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(newEmail)) {
      return res.status(400).json({
        error: 'invalid_email_format',
        detail: 'Please provide a valid email address'
      });
    }

    // 5. 检查 newEmail 是否已被其他用户使用
    const existingUser = await prisma.user.findUnique({
      where: { email: newEmail }
    });

    if (existingUser && existingUser.emailVerifiedAt) {
      return res.status(409).json({
        error: 'email_already_used',
        detail: 'This email address is already registered'
      });
    }

    // 6. 检查 Redis 速率限制 (TODO: 同一 userId 5 分钟内只能请求一次)
    // 暂时跳过

    // 7. 生成 6 位验证码
    const code = (Math.floor(Math.random() * 900000) + 100000).toString();
    const verificationCodeHash = await bcrypt.hash(code, 10);

    // 8. 创建 email_verifications 记录
    await prisma.emailVerification.create({
      data: {
        userId,
        verificationCodeHash,
        purpose: 'email_change',
        sentTo: newEmail, // 重要!发送到新邮箱
        expiresAt: new Date(Date.now() + 30 * 60 * 1000), // 30分钟
        consumedAt: null,
        attempts: 0
      }
    });

    // 9. 发送验证邮件到新邮箱
    const mailer = getMailer();
    const { subject, html } = Templates.changeEmail({
      brand: 'Tymoe',
      email: newEmail,
      selector: '',
      token: code,
      minutes: 30
    });
    await mailer.send(newEmail, subject, html);

    // 10. 记录审计日志
    audit('email_change_requested', { ip, userId, oldEmail: user.email, newEmail });

    // 11. 返回成功
    return res.status(200).json({
      success: true,
      message: 'Verification code has been sent to your new email address.',
      data: {
        newEmail,
        expiresIn: 1800
      }
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'unknown_error';
    
    if (errorMessage === 'too_many_requests') {
      return res.status(429).json({
        error: 'too_many_requests',
        detail: 'Please wait 5 minutes before requesting another email change'
      });
    }

    console.error('Change email error:', error);
    audit('email_change_error', { ip, userId: (req as any).claims?.sub, error: errorMessage });
    return res.status(500).json({ error: 'server_error' });
  }
}

// 1.14 修改邮箱 (第2步: 确认验证码) (按文档要求)
export async function verifyEmailChange(req: Request, res: Response) {
  const { code } = req.body;
  const ip = req.ip || 'unknown';
  
  try {
    // 1. 从 token 中提取 userId
    const userId = (req as any).claims?.sub;
    const jti = (req as any).claims?.jti;
    if (!userId) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    // 2. 查询 email_verifications
    const verification = await prisma.emailVerification.findFirst({
      where: {
        userId,
        purpose: 'email_change',
        consumedAt: null,
        expiresAt: { gt: new Date() }
      },
      orderBy: { createdAt: 'desc' }
    });

    if (!verification) {
      return res.status(404).json({
        error: 'verification_not_found',
        detail: 'No pending verification found'
      });
    }

    // 3. 验证码校验逻辑同 1.2
    if (verification.expiresAt < new Date()) {
      return res.status(400).json({
        error: 'code_expired',
        detail: 'Verification code has expired. Please request a new one.'
      });
    }

    if (verification.attempts >= 10) {
      return res.status(429).json({
        error: 'too_many_attempts',
        detail: 'Too many failed attempts. Please request a new verification code.'
      });
    }

    const isValid = await bcrypt.compare(code, verification.verificationCodeHash);
    if (!isValid) {
      await prisma.emailVerification.update({
        where: { id: verification.id },
        data: { attempts: verification.attempts + 1 }
      });
      return res.status(400).json({
        error: 'invalid_code',
        detail: 'Invalid verification code.'
      });
    }

    // 4. 如果验证码正确：从 sentTo 提取 newEmail
    const newEmail = verification.sentTo;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    const oldEmail = user?.email;

    // 5. 再次检查 newEmail 是否已被其他用户使用 (防止竞态条件)
    const existingUser = await prisma.user.findFirst({
      where: {
        email: newEmail,
        id: { not: userId },
        emailVerifiedAt: { not: null }
      }
    });

    if (existingUser) {
      return res.status(409).json({
        error: 'email_already_used',
        detail: 'This email address is already registered'
      });
    }

    // 6. 更新 users.email = newEmail
    await prisma.user.update({
      where: { id: userId },
      data: {
        email: newEmail,
        updatedAt: new Date()
      }
    });

    // 7. 标记验证码为已使用
    await prisma.emailVerification.update({
      where: { id: verification.id },
      data: { consumedAt: new Date() }
    });

    // 8. 撤销该用户的所有 refresh_tokens (安全考虑,邮箱变更需要重新登录)
    await prisma.refreshToken.updateMany({
      where: {
        subjectUserId: userId,
        status: 'ACTIVE'
      },
      data: {
        status: 'REVOKED',
        revokedAt: new Date(),
        revokeReason: 'email_changed'
      }
    });

    // 9. 将当前 access_token 的 jti 加入 Redis 黑名单 (立即失效)
    if (jti && isRedisConnected()) {
      try {
        const redis = await getRedisClient();
        const exp = (req as any).claims?.exp;
        if (exp) {
          const ttl = exp - Math.floor(Date.now() / 1000);
          if (ttl > 0) {
            await redis.set(`token:blacklist:${jti}`, '1', 'EX', ttl);
          }
        }
      } catch (redisError) {
        console.error('Redis blacklist error:', redisError);
      }
    }

    // 10. 记录审计日志
    audit('email_changed', { ip, userId, detail: { oldEmail, newEmail } });

    // 11. 返回成功
    return res.status(200).json({
      success: true,
      message: 'Email address has been changed successfully. Please log in again with your new email.',
      data: {
        newEmail
      }
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'unknown_error';
    console.error('Verify email change error:', error);
    audit('email_change_verification_error', { ip, userId: (req as any).claims?.sub, error: errorMessage });
    return res.status(500).json({ error: 'server_error' });
  }
}

/**
 * Gateway ForwardAuth 验证端点
 * 只验证 JWT 签名和黑名单（由 requireBearer 完成），不查用户表
 * 将 claims 通过 response headers 传递给 Traefik，Traefik 再转发给后端服务
 */
export function verifyToken(req: Request, res: Response) {
  const claims = (req as any).claims || {};
  const { sub, email, userType, jti } = claims;

  // 将用户信息注入 response headers，Traefik 会将这些 headers 转发给后端
  res.set('X-User-Id', sub || '');
  res.set('X-User-Email', email || '');
  res.set('X-User-Type', userType || '');
  if (jti) res.set('X-Token-Jti', jti);

  return res.status(200).json({ ok: true });
}