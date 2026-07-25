// src/controllers/consumer.ts
import { Request, Response } from 'express';
import { prisma } from '../infra/prisma.js';
import { consumerService } from '../services/consumer.js';
import { audit } from '../middleware/audit.js';
import { signAccessToken, issueRefreshFamily, rotateRefreshToken } from '../services/token.js';
import { enrollMemberAsync } from '../services/memberEnroll.js';

/**
 * 发送验证码
 * POST /api/auth-service/v1/consumer/send-code
 * Body: { orgId, phone }
 * 响应会告知前端使用了哪种方式（sms / email）及脱敏目标
 */
export async function sendCode(req: Request, res: Response) {
  try {
    const { orgId, phone } = req.body || {};
    if (!orgId || !phone) {
      return res.status(400).json({ error: 'invalid_request', detail: 'orgId and phone are required' });
    }

    const result = await consumerService.sendCode(orgId, phone);

    return res.json({
      success: true,
      method: result.method,
      maskedTarget: result.maskedTarget,
      expiresAt: result.expiresAt,
      dailyRemaining: result.dailyRemaining,
      ...(result.code ? { code: result.code } : {}),
    });
  } catch (err: any) {
    const code = err.message;
    const statusMap: Record<string, number> = {
      invalid_phone_format: 400,
      organization_not_found_or_inactive: 404,
      consumer_suspended: 403,
      sms_daily_limit_exceeded: 429,
      sms_code_too_frequent: 429,
      email_code_too_frequent: 429,
      email_send_failed: 500,
    };

    return res.status(statusMap[code] || 500).json({ error: code, detail: getErrorDetail(code) });
  }
}

/**
 * 顾客登录
 * POST /api/auth-service/v1/consumer/login
 * Body: { orgId, phone, code, method?: 'sms' | 'email', name?, email? }
 *
 * - 首次登录（SMS）：需要携带 name + email
 * - 后续登录（email code）：无需额外字段
 */
export async function login(req: Request, res: Response) {
  try {
    const { orgId, phone, code, method, name, email } = req.body || {};

    if (!orgId || !phone || !code) {
      return res.status(400).json({ error: 'invalid_request', detail: 'orgId, phone, and code are required' });
    }

    let result: { consumer: any; organization: any; isFirstLogin: boolean };

    if (method === 'email') {
      result = await consumerService.loginWithEmailCode(orgId, phone, code);
    } else {
      // 默认 SMS（首次登录）
      result = await consumerService.loginWithSmsCode(orgId, phone, code, { name, email });
    }

    // 记录登录
    await prisma.loginAttempt.create({
      data: {
        loginType: 'CONSUMER',
        consumerId: result.consumer.id,
        loginIdentifier: phone,
        organizationId: orgId,
        ipAddress: req.ip || 'unknown',
        userAgent: req.get('user-agent') || null,
        success: true,
      },
    });

    await prisma.consumer.update({
      where: { id: result.consumer.id },
      data: { lastLoginIp: req.ip || null },
    });

    const accessToken = await signAccessToken({
      sub: result.consumer.id,
      userType: 'CONSUMER',
      phone: result.consumer.phone,
      organizationId: orgId,
      aud: 'tymoe-web',
    });

    const { refreshId } = await issueRefreshFamily({
      consumerId: result.consumer.id,
      clientId: 'tymoe-web',
      organizationId: orgId,
    });

    // 异步通知 member service 懒注册
    enrollMemberAsync(result.consumer.id, result.consumer.phone, orgId, {
      name: result.consumer.name,
      email: result.consumer.email,
    }).catch(() => {});

    return res.json({
      access_token: accessToken,
      refresh_token: refreshId,
      token_type: 'Bearer',
      consumer: result.consumer,
      organization: result.organization,
      isFirstLogin: result.isFirstLogin,
    });
  } catch (err: any) {
    const code = err.message;

    if (code !== 'invalid_request') {
      const { orgId, phone } = req.body || {};
      await prisma.loginAttempt.create({
        data: {
          loginType: 'CONSUMER',
          loginIdentifier: phone || 'unknown',
          organizationId: orgId || null,
          ipAddress: req.ip || 'unknown',
          userAgent: req.get('user-agent') || null,
          success: false,
          failureReason: code,
        },
      }).catch(() => {});
    }

    const statusMap: Record<string, number> = {
      consumer_not_found: 401,
      consumer_suspended: 403,
      consumer_locked: 423,
      no_sms_code_issued: 400,
      sms_code_expired: 401,
      invalid_sms_code: 401,
      no_email_code_issued: 400,
      email_code_expired: 401,
      invalid_email_code: 401,
      name_and_email_required: 400,
      email_already_registered: 409,
      organization_inactive: 403,
    };

    return res.status(statusMap[code] || 500).json({ error: code, detail: getErrorDetail(code) });
  }
}

/**
 * 获取当前顾客资料
 * GET /api/auth-service/v1/consumer/profile
 */
export async function getProfile(req: Request, res: Response) {
  try {
    const claims = (req as any).claims;
    if (!claims || claims.userType !== 'CONSUMER') {
      return res.status(403).json({ error: 'forbidden', detail: 'Consumer authentication required' });
    }

    const profile = await consumerService.getProfile(claims.sub);
    return res.json(profile);
  } catch (err: any) {
    if (err.message === 'consumer_not_found') {
      return res.status(404).json({ error: 'consumer_not_found' });
    }
    return res.status(500).json({ error: 'server_error' });
  }
}

/**
 * 更新顾客资料
 * PATCH /api/auth-service/v1/consumer/profile
 * Body: { name?, email? }
 */
export async function updateProfile(req: Request, res: Response) {
  try {
    const claims = (req as any).claims;
    if (!claims || claims.userType !== 'CONSUMER') {
      return res.status(403).json({ error: 'forbidden', detail: 'Consumer authentication required' });
    }

    const { name, email } = req.body || {};
    if (!name && !email) {
      return res.status(400).json({ error: 'invalid_request', detail: 'At least one field (name or email) is required' });
    }

    const updated = await consumerService.updateProfile(claims.sub, { name, email });
    return res.json(updated);
  } catch (err: any) {
    if (err.message === 'email_already_registered') {
      return res.status(409).json({ error: 'email_already_registered', detail: getErrorDetail('email_already_registered') });
    }
    return res.status(500).json({ error: 'server_error' });
  }
}

/**
 * 设置密码
 * POST /api/auth-service/v1/consumer/set-password
 * Body: { password }
 */
export async function setPassword(req: Request, res: Response) {
  try {
    const claims = (req as any).claims;
    if (!claims || claims.userType !== 'CONSUMER') {
      return res.status(403).json({ error: 'forbidden', detail: 'Consumer authentication required' });
    }

    const { password } = req.body || {};
    if (!password) {
      return res.status(400).json({ error: 'invalid_request', detail: 'password is required' });
    }

    await consumerService.setPassword(claims.sub, password);
    return res.json({ success: true });
  } catch (err: any) {
    if (err.message === 'password_too_short') {
      return res.status(400).json({ error: 'password_too_short', detail: 'Password must be at least 6 characters' });
    }
    return res.status(500).json({ error: 'server_error' });
  }
}

/**
 * 刷新 Access Token
 * POST /api/auth-service/v1/consumer/refresh
 * Body: { refresh_token }
 */
export async function refresh(req: Request, res: Response) {
  try {
    const { refresh_token } = req.body || {};
    if (!refresh_token) {
      return res.status(400).json({ error: 'invalid_request', detail: 'refresh_token is required' });
    }

    const rotated = await rotateRefreshToken(refresh_token);

    if (!rotated.subject.consumerId) {
      return res.status(401).json({ error: 'invalid_refresh_token' });
    }

    const consumer = await prisma.consumer.findUnique({
      where: { id: rotated.subject.consumerId },
      select: { id: true, phone: true, status: true, orgId: true },
    });

    if (!consumer || consumer.status !== 'ACTIVE') {
      return res.status(401).json({ error: 'invalid_refresh_token' });
    }

    const accessToken = await signAccessToken({
      sub: consumer.id,
      userType: 'CONSUMER',
      phone: consumer.phone,
      organizationId: consumer.orgId,
      aud: 'tymoe-web',
    });

    audit('consumer_token_refresh', { consumerId: consumer.id, refreshTokenId: refresh_token });

    return res.json({
      access_token: accessToken,
      refresh_token: rotated.refreshId,
      token_type: 'Bearer',
      expires_in: 1800,
    });
  } catch (err: any) {
    if (['expired', 'inactive', 'not_found'].includes(err?.code)) {
      return res.status(401).json({ error: 'invalid_refresh_token' });
    }
    return res.status(500).json({ error: 'server_error' });
  }
}

const MAX_SAVED_ADDRESSES = 5;

/**
 * 获取已保存配送地址列表
 * GET /api/auth-service/v1/consumer/addresses
 */
export async function listAddresses(req: Request, res: Response) {
  try {
    const claims = (req as any).claims;
    if (!claims || claims.userType !== 'CONSUMER') {
      return res.status(403).json({ error: 'forbidden' });
    }
    const addresses = await prisma.savedAddress.findMany({
      where: { consumerId: claims.sub },
      orderBy: { createdAt: 'desc' },
    });
    return res.json({ success: true, data: addresses });
  } catch {
    return res.status(500).json({ error: 'server_error' });
  }
}

/**
 * 保存配送地址
 * POST /api/auth-service/v1/consumer/addresses
 * Body: { fullAddress, street, city, province, postalCode, lat, lng, unit?, buzzer?, deliveryNotes?, label? }
 */
export async function createAddress(req: Request, res: Response) {
  try {
    const claims = (req as any).claims;
    if (!claims || claims.userType !== 'CONSUMER') {
      return res.status(403).json({ error: 'forbidden' });
    }

    const { fullAddress, street, city, province, postalCode, lat, lng, unit, buzzer, deliveryNotes, label } = req.body || {};
    if (!fullAddress || !street || !city || !province || !postalCode || lat == null || lng == null) {
      return res.status(400).json({ error: 'invalid_request', detail: 'Missing required address fields' });
    }

    // 相同 fullAddress 去重（更新 unit/buzzer/notes）
    const existing = await prisma.savedAddress.findFirst({
      where: { consumerId: claims.sub, fullAddress },
    });
    if (existing) {
      const updated = await prisma.savedAddress.update({
        where: { id: existing.id },
        data: { unit: unit || null, buzzer: buzzer || null, deliveryNotes: deliveryNotes || null, label: label || null },
      });
      return res.json({ success: true, data: updated });
    }

    // 超过上限时删除最旧的
    const count = await prisma.savedAddress.count({ where: { consumerId: claims.sub } });
    if (count >= MAX_SAVED_ADDRESSES) {
      const oldest = await prisma.savedAddress.findFirst({
        where: { consumerId: claims.sub },
        orderBy: { createdAt: 'asc' },
      });
      if (oldest) await prisma.savedAddress.delete({ where: { id: oldest.id } });
    }

    const address = await prisma.savedAddress.create({
      data: { consumerId: claims.sub, fullAddress, street, city, province, postalCode, lat, lng, unit: unit || null, buzzer: buzzer || null, deliveryNotes: deliveryNotes || null, label: label || null },
    });
    return res.status(201).json({ success: true, data: address });
  } catch {
    return res.status(500).json({ error: 'server_error' });
  }
}

/**
 * 删除已保存地址
 * DELETE /api/auth-service/v1/consumer/addresses/:id
 */
export async function deleteAddress(req: Request, res: Response) {
  try {
    const claims = (req as any).claims;
    if (!claims || claims.userType !== 'CONSUMER') {
      return res.status(403).json({ error: 'forbidden' });
    }
    const { id } = req.params;
    const existing = await prisma.savedAddress.findFirst({ where: { id, consumerId: claims.sub } });
    if (!existing) return res.status(404).json({ error: 'not_found' });
    await prisma.savedAddress.delete({ where: { id } });
    return res.json({ success: true });
  } catch {
    return res.status(500).json({ error: 'server_error' });
  }
}

function getErrorDetail(code: string): string {
  const details: Record<string, string> = {
    invalid_phone_format: 'Phone number must be in international format (e.g. +16041234567)',
    organization_not_found_or_inactive: 'Organization not found or inactive',
    consumer_suspended: 'This account has been suspended',
    consumer_locked: 'Account is temporarily locked due to too many failed attempts',
    sms_daily_limit_exceeded: 'Daily SMS verification code limit reached',
    sms_code_too_frequent: 'Please wait at least 60 seconds before requesting a new code',
    email_code_too_frequent: 'Please wait at least 60 seconds before requesting a new code',
    email_send_failed: 'Failed to send verification email, please try again',
    consumer_not_found: 'No account found with this phone number',
    no_sms_code_issued: 'No SMS verification code has been sent. Please request one first',
    sms_code_expired: 'Verification code has expired. Please request a new one',
    invalid_sms_code: 'Invalid verification code',
    no_email_code_issued: 'No email verification code has been sent. Please request one first',
    email_code_expired: 'Email verification code has expired. Please request a new one',
    invalid_email_code: 'Invalid email verification code',
    name_and_email_required: 'Name and email are required for first-time login',
    email_already_registered: 'This email is already registered in this organization',
    organization_inactive: 'Organization is not active',
  };
  return details[code] || 'An unexpected error occurred';
}
