// src/controllers/account.ts
import { Request, Response } from 'express';
import { prisma } from '../infra/prisma.js';
import { accountService } from '../services/account.js';
import { audit } from '../middleware/audit.js';
import { signAccessToken, issueRefreshFamily } from '../services/token.js';
import { jtiCache, isRedisConnected } from '../infra/redis.js';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { env } from '../config/env.js';
import { resolveAccountPermissions } from '../services/permissionSet.js';
import { getMailer } from '../services/mailer.js';
import { Templates } from '../services/templates.js';

// 生成一个 12 位随机密码（大小写字母+数字+符号各至少一个，其余位随机），
// 用于重置密码时后端自己生成新密码，不再要求调用方传入明文
function generateRandomPassword(length = 12): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnpqrstuvwxyz';
  const digits = '23456789';
  const symbols = '!@#$%^&*';
  const all = upper + lower + digits + symbols;
  const pick = (charset: string) => charset[crypto.randomInt(0, charset.length)];
  const chars = [pick(upper), pick(lower), pick(digits), pick(symbols)];
  while (chars.length < length) chars.push(pick(all));
  // Fisher-Yates 打乱，避免固定位置总是"大写字母开头"这种可预测模式
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

export async function loginBackend(req: Request, res: Response) {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'invalid_request', error_description: 'username and password are required' });
    }

    // 验证 username 不能包含 @ 符号
    if (username.includes('@')) {
      return res.status(400).json({ error: 'invalid_username', error_description: 'Username cannot contain @ symbol' });
    }

    try {
      const account = await accountService.authenticateBackend(username, password);

      // 检查账户状态
      if (account.status !== 'ACTIVE') {
        return res.status(401).json({
          error: 'account_suspended',
          detail: 'This account has been suspended. Please contact your administrator.'
        });
      }

      // 检查组织状态
      if (account.organization.status !== 'ACTIVE') {
        return res.status(403).json({
          error: 'org_inactive',
          detail: 'Organization is inactive'
        });
      }

      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // ⭐ 新增：检查订阅状态（宽松策略）
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      try {
        const { getModuleQuotas } = await import('../services/subscriptionService.js');
        const quotaData = await getModuleQuotas(account.orgId);
        
        if (quotaData) {
          // subscription-service 可用，检查订阅状态
          if (quotaData.subscriptionStatus !== 'active' && quotaData.subscriptionStatus !== 'trialing') {
            console.log(`[Login] 订阅状态异常: ${account.orgId}, status: ${quotaData.subscriptionStatus}`);
            return res.status(403).json({
              error: 'subscription_required',
              detail: `Subscription is ${quotaData.subscriptionStatus}. Please renew your subscription.`,
              subscriptionStatus: quotaData.subscriptionStatus
            });
          }
        }
        // subscription-service 不可用时，允许登录（宽松策略）
      } catch (err) {
        // 订阅检查失败，允许登录（宽松策略）
        console.warn(`[Login] 订阅检查失败，允许登录: ${account.orgId}`, err);
      }

      // 成功：记录 login attempt
      await prisma.loginAttempt.create({
        data: {
          loginType: 'ACCOUNT',
          accountId: account.id,
          loginIdentifier: username,
          organizationId: account.orgId,
          ipAddress: req.ip || 'unknown',
          userAgent: req.get('user-agent') || null,
          success: true,
        },
      });

      audit('account_login_backend', {
        accountId: account.id,
        orgId: account.orgId,
        ip: req.ip,
      });

      // 返回登录信息（不包含 token，前端需要调用 /oauth/token）
      return res.json({
        success: true,
        account: {
          id: account.id,
          username: account.username,
          accountCode: account.accountCode,
          status: account.status,
          lastLoginAt: account.lastLoginAt,
        },
        organization: {
          id: account.organization.id,
          orgName: account.organization.orgName,
          orgType: account.organization.orgType,
          status: account.organization.status,
        },
      });
    } catch (e: any) {
      // 失败：记录 login attempt
      await prisma.loginAttempt.create({
        data: {
          loginType: 'ACCOUNT',
          accountId: null,
          loginIdentifier: username,
          organizationId: null,
          ipAddress: req.ip || 'unknown',
          userAgent: req.get('user-agent') || null,
          success: false,
          failureReason: e?.message || 'invalid_credentials',
        },
      });
      if (e?.message === 'account_locked') {
        return res.status(401).json({ error: 'account_locked', detail: 'Account is temporarily locked due to too many failed login attempts' });
      }
      return res.status(401).json({ error: 'invalid_credentials', detail: 'Username or password is incorrect' });
    }
  } catch (err: any) {
    return res.status(500).json({ error: 'server_error' });
  }
}

export async function loginPOS(req: Request, res: Response) {
  try {
    const deviceId = (req.headers['x-device-id'] || req.headers['X-Device-ID']) as string | undefined;
    const sessionToken = (req.headers['x-session-token'] || req.headers['X-Session-Token']) as string | undefined;

    if (!deviceId || !sessionToken) {
      return res.status(400).json({ 
        error: 'missing_device_credentials', 
        error_description: 'X-Device-ID and X-Session-Token headers are required' 
      });
    }

    const { pinCode } = req.body || {};
    if (!pinCode) {
      return res.status(400).json({ error: 'invalid_request', error_description: 'pinCode is required' });
    }

    try {
      const { account, device } = await accountService.authenticatePOS(pinCode, deviceId, sessionToken);

      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // ⭐ 新增：检查订阅状态（宽松策略）
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      try {
        const { getModuleQuotas } = await import('../services/subscriptionService.js');
        const quotaData = await getModuleQuotas(device.orgId);
        
        if (quotaData) {
          // subscription-service 可用，检查订阅状态
          if (quotaData.subscriptionStatus !== 'active' && quotaData.subscriptionStatus !== 'trialing') {
            console.log(`[POS Login] 订阅状态异常: ${device.orgId}, status: ${quotaData.subscriptionStatus}`);
            return res.status(403).json({
              error: 'subscription_required',
              detail: `Subscription is ${quotaData.subscriptionStatus}. Please renew your subscription.`,
              subscriptionStatus: quotaData.subscriptionStatus
            });
          }
        }
        // subscription-service 不可用时，允许登录（宽松策略）
      } catch (err) {
        // 订阅检查失败，允许登录（宽松策略）
        console.warn(`[POS Login] 订阅检查失败，允许登录: ${device.orgId}`, err);
      }

      // 成功：记录 login attempt
      await prisma.loginAttempt.create({
        data: {
          loginType: 'ACCOUNT',
          accountId: account.id,
          loginIdentifier: account.accountCode, // 使用accountCode作为标识
          organizationId: device.orgId,
          ipAddress: req.ip || 'unknown',
          userAgent: req.get('user-agent') || null,
          success: true,
        },
      });

      audit('account_login_pos', {
        accountId: account.id,
        orgId: account.orgId,
        deviceId,
        ip: req.ip,
      });

      // 返回登录信息（不包含 token，前端需要调用 /oauth/token）
      return res.json({
        success: true,
        account: {
          id: account.id,
          accountCode: account.accountCode,
          status: account.status,
          lastLoginAt: account.lastLoginAt,
        },
        organization: {
          id: device.organization.id,
          orgName: device.organization.orgName,
          orgType: device.organization.orgType,
          status: device.organization.status,
        },
        device: {
          id: device.id,
          deviceName: device.deviceName,
          deviceType: device.deviceType,
        },
      });
    } catch (e: any) {
      // 失败：记录 login attempt（无法知道具体用户，只记录设备信息）
      await prisma.loginAttempt.create({
        data: {
          loginType: 'ACCOUNT',
          accountId: null,
          loginIdentifier: 'PIN_LOGIN', // PIN登录失败无法确定具体用户
          organizationId: null,
          ipAddress: req.ip || 'unknown',
          userAgent: req.get('user-agent') || null,
          success: false,
          failureReason: e?.message || 'invalid_credentials',
        },
      });

      if (e?.message === 'invalid_session') {
        return res.status(403).json({ error: 'invalid_session', detail: 'Session token is invalid or expired. Please reactivate the device.' });
      }
      if (e?.message === 'account_locked') {
        return res.status(401).json({ error: 'account_locked', detail: 'Account is temporarily locked' });
      }
      if (e?.message === 'device_not_found') {
        return res.status(404).json({ error: 'device_not_found', detail: 'Device not found' });
      }
      if (e?.message === 'device_not_active') {
        return res.status(403).json({ error: 'device_not_authorized', detail: 'This device is not authorized for your organization or is inactive' });
      }
      return res.status(401).json({ error: 'invalid_credentials', detail: 'PIN code is incorrect' });
    }
  } catch (err: any) {
    return res.status(500).json({ error: 'server_error' });
  }
}

export async function logout(req: Request, res: Response) {
  try {
    const claims = (req as any).claims || {};
    const { refresh_token } = req.body || {};
    const jti = claims.jti;
    const deviceId = claims.deviceId;

    // 判断登录类型
    const isPOS = !!deviceId;

    // 后台登录：撤销 refresh_token
    if (!isPOS && refresh_token) {
      try {
        const old = await prisma.refreshToken.findUnique({ where: { id: refresh_token } });
        if (old) {
          await prisma.refreshToken.updateMany({
            where: { familyId: old.familyId },
            data: { status: 'REVOKED', revokedAt: new Date(), revokeReason: 'logout' },
          });
        }
      } catch (_e) {}
    }

    // POS 登录：不需要更新 lastActiveAt（已移至 DeviceSession）

    // 将 access_token 的 jti 加入 Redis 黑名单（如果 Redis 可用）
    if (jti && isRedisConnected()) {
      try {
        const exp = claims.exp as number;
        const now = Math.floor(Date.now() / 1000);
        const ttl = exp > now ? exp - now : 60; // 至少保留 60 秒
        await jtiCache.set(jti, 'revoked', ttl);
      } catch (_e) {}
    }

    audit('account_logout', {
      accountId: claims.sub,
      loginType: isPOS ? 'POS' : 'BACKEND',
      deviceId: deviceId || null,
      ip: req.ip
    });

    return res.json({ success: true, message: 'Logged out successfully' });
  } catch (_err) {
    return res.json({ success: true, message: 'Logged out successfully' });
  }
}

export async function me(req: Request, res: Response) {
  try {
    const claims = (req as any).claims || {};
    if (claims.userType !== 'ACCOUNT' || !claims.sub) {
      return res.status(401).json({ error: 'invalid_token' });
    }
    const account = await prisma.account.findUnique({
      where: { id: claims.sub as string },
      include: { organization: true },
    });
    if (!account) return res.status(404).json({ error: 'account_not_found' });

    return res.json({
      success: true,
      account: {
        id: account.id,
        username: account.username,
        accountCode: account.accountCode,
        status: account.status,
        lastLoginAt: account.lastLoginAt,
      },
      organization: {
        id: account.organization.id,
        orgName: account.organization.orgName,
        orgType: account.organization.orgType,
        status: account.organization.status,
      },
    });
  } catch (_e) {
    return res.status(500).json({ error: 'server_error' });
  }
}

// ====== Account CRUD ======

function getClaims(req: Request) {
  return (req as any).claims || {};
}

async function getCallerAccount(claims: any) {
  if (claims.userType !== 'ACCOUNT') return null;
  if (!claims.sub) return null;
  return await prisma.account.findUnique({ where: { id: claims.sub as string } });
}

function forbid(res: Response) {
  return res.status(403).json({ error: 'insufficient_permissions' });
}

// 创建账号（返回一次性PIN明文）
export async function createAccount(req: Request, res: Response) {
  try {
    const claims = getClaims(req);
    const { orgId, grantBackendLogin, username, password, accountCode, pinCode, name, email, phone, permissionSetId } = req.body || {};

    if (!orgId || !accountCode || !pinCode || !email) {
      return res.status(400).json({
        error: 'missing_required_fields',
        // email 必填：PIN 码只在创建这一刻明文出现一次，必须能发邮件通知到本人，
        // 不填邮箱这个 PIN 就没有任何渠道能让员工知道
        detail: 'orgId, accountCode, pinCode, and email are required'
      });
    }

    // 权限：USER 必须是组织 owner；ACCOUNT 需要 accounts.edit 权限位
    let callerPermissions: string[] | null = null; // null = USER，不受越权限制
    if (claims.userType === 'USER') {
      const org = await prisma.organization.findUnique({ where: { id: orgId } });
      if (!org || org.userId !== claims.sub) return forbid(res);
    } else if (claims.userType === 'ACCOUNT') {
      const caller = await getCallerAccount(claims);
      if (!caller || caller.orgId !== orgId) return forbid(res);
      callerPermissions = await resolveAccountPermissions(caller);
      if (!callerPermissions.includes('accounts.edit')) return forbid(res);
    } else {
      return forbid(res);
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // ⭐ 创建前检查配额（所有员工账号统一算一种坐席，不再区分 manager/staff 两档）
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const { STAFF_MODULE_KEY } = await import('../config/moduleMapping.js');
    const { checkModuleQuota } = await import('../services/subscriptionService.js');

    const skipCheck = process.env.SKIP_SUBSCRIPTION_CHECK === 'true';
    if (!skipCheck) {
      const moduleKey = STAFF_MODULE_KEY;

      // 调用 subscription-service 检查配额
      const quotaCheck = await checkModuleQuota(orgId, moduleKey);

      if (!quotaCheck.hasQuota || quotaCheck.subscriptionStatus === 'unknown') {
        // subscription-service 不可用或无订阅 - 严格策略：拒绝创建
        return res.status(503).json({
          error: 'subscription_service_unavailable',
          detail: 'Unable to verify subscription status. Please try again later.',
          subscriptionStatus: quotaCheck.subscriptionStatus
        });
      }

      if (quotaCheck.subscriptionStatus !== 'active' && quotaCheck.subscriptionStatus !== 'trialing') {
        return res.status(403).json({
          error: 'no_active_subscription',
          detail: `Subscription is ${quotaCheck.subscriptionStatus}. Please renew or upgrade your subscription.`,
          subscriptionStatus: quotaCheck.subscriptionStatus
        });
      }

      if (quotaCheck.purchasedCount === 0) {
        return res.status(403).json({
          error: 'module_not_subscribed',
          detail: 'Staff seats are not included in your current subscription. Please upgrade your plan.',
          module: moduleKey
        });
      }

      // 查询本地已使用数量（排除软删除的账号）
      const usedCount = await prisma.account.count({
        where: {
          orgId,
          status: { not: 'DELETED' }
        }
      });

      // 检查是否超额
      if (usedCount >= quotaCheck.purchasedCount) {
        return res.status(403).json({
          error: 'quota_exceeded',
          detail: `Staff seat limit reached (${usedCount}/${quotaCheck.purchasedCount}). Please upgrade your subscription to add more seats.`,
          quota: {
            module: moduleKey,
            used: usedCount,
            limit: quotaCheck.purchasedCount,
            remaining: 0
          }
        });
      }

      console.log(`[Quota Check] 账号配额检查通过: ${usedCount + 1}/${quotaCheck.purchasedCount}`);
    }

    // 权限集必须属于同一个 org，防止跨组织绑定
    if (permissionSetId) {
      const set = await prisma.permissionSet.findUnique({ where: { id: permissionSetId } });
      if (!set || set.orgId !== orgId) {
        return res.status(400).json({ error: 'invalid_permission_set', detail: 'permissionSetId does not belong to this organization' });
      }
      // ACCOUNT 调用者只能分配"自己权限的子集"的权限组，防止越权把别的员工权限配得比自己还高
      if (callerPermissions !== null) {
        const missing = set.permissions.filter(p => !callerPermissions!.includes(p));
        if (missing.length > 0) {
          return res.status(403).json({ error: 'privilege_escalation', detail: 'Cannot assign a permission set with permissions you do not have' });
        }
      }
    }

    // 权限和配额检查通过，继续创建账号
    const request = {
      orgId,
      grantBackendLogin: !!grantBackendLogin,
      username,
      password,
      accountCode,
      pinCode,
      name,
      email,
      phone,
      permissionSetId: permissionSetId || null,
      createdBy: claims.sub as string,
    };

    const { account, pinCode: plainPin } = await accountService.createAccount(request, claims.userType === 'USER' ? 'USER' : 'ACCOUNT');

    const org = await prisma.organization.findUnique({
      where: { id: account.orgId },
      select: { orgName: true }
    });

    // 发送凭证邮件（dev 环境输出到 console，生产环境配置 SMTP 后自动发送）
    if (account.email) {
      try {
        const { getMailer } = await import('../services/mailer.js');
        const mailer = getMailer();
        const subject = `【${org?.orgName || ''}】您的账号已创建`;
        const html = grantBackendLogin
          ? `<h2>您的账号凭证</h2>
             <p>组织：<strong>${org?.orgName || ''}</strong></p>
             <p>姓名：<strong>${account.name || ''}</strong></p>
             <p>登录名：<strong>${account.username}</strong></p>
             <p>密码：<strong>${password}</strong></p>
             <p>PIN码：<strong>${plainPin}</strong></p>
             <p>账号编码：<strong>${account.accountCode}</strong></p>
             <p style="color:red">请妥善保存以上凭证，密码和PIN码不会再次显示。</p>`
          : `<h2>您的账号凭证</h2>
             <p>组织：<strong>${org?.orgName || ''}</strong></p>
             <p>姓名：<strong>${account.name || ''}</strong></p>
             <p>PIN码：<strong>${plainPin}</strong></p>
             <p>账号编码：<strong>${account.accountCode}</strong></p>
             <p style="color:red">请妥善保存PIN码，不会再次显示。</p>`;
        await mailer.send(account.email, subject, html);
      } catch (mailErr) {
        console.warn('[createAccount] 邮件发送失败，不影响账号创建结果', mailErr);
      }
    }

    return res.status(201).json({
      success: true,
      message: 'Account created successfully',
      data: {
        id: account.id,
        orgId: account.orgId,
        username: account.username || undefined,
        accountCode: account.accountCode,
        pinCode: plainPin,
        status: account.status,
        createdAt: account.createdAt,
      },
      warning: 'Please save the PIN code. It will not be displayed again after this response.'
    });
  } catch (e: any) {
    const errorMap: Record<string, { status: number; detail: string }> = {
      username_already_exists: { status: 409, detail: 'This username is already taken' },
      employee_number_exists_in_org: { status: 409, detail: 'This employee number already exists in this organization' },
      pinCode_already_exists: { status: 409, detail: 'This pin is already taken' },
      organization_not_found_or_inactive: { status: 404, detail: 'Organization not found or inactive' },
      username_password_required: { status: 400, detail: 'Username and password are required when granting backend login' },
    };

    const error = errorMap[e?.message];
    if (error) {
      return res.status(error.status).json({ error: e.message, detail: error.detail });
    }

    return res.status(400).json({ error: 'invalid_request', detail: e?.message || 'Invalid request' });
  }
}

// 获取组织的账号列表
export async function listAccounts(req: Request, res: Response) {
  try {
    const claims = getClaims(req);
    let { orgId, accountType, status } = req.query as any;

    // 对于 ACCOUNT 类型的 token，如果没有提供 orgId，则使用 token 中的 organization.id
    if (!orgId && claims.userType === 'ACCOUNT') {
      orgId = claims.organization?.id;
    }

    // 对于 USER 类型的 token，必须提供 orgId（因为 User 可能有多个组织）
    if (!orgId) {
      return res.status(400).json({
        error: 'invalid_request',
        detail: 'orgId is required for User accounts'
      });
    }

    // 组织本身：所有者是登录这个组织的 User，员工都是 Account（不再区分类型）
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      include: { user: { select: { id: true, name: true, email: true } } },
    });
    if (!org) return forbid(res);
    const ownerUser = org.user;

    // 权限
    if (claims.userType === 'USER') {
      if (org.userId !== claims.sub) return forbid(res);
    } else if (claims.userType === 'ACCOUNT') {
      const caller = await getCallerAccount(claims);
      if (!caller || caller.orgId !== orgId) return forbid(res);
      const callerPermissions = await resolveAccountPermissions(caller);
      if (!callerPermissions.includes('accounts.view')) return forbid(res);
    } else {
      return forbid(res);
    }

    // 明确按 OWNER 过滤时，其实是想单独看主账户这一行，不查 Account 表
    const ownerOnly = accountType === 'OWNER';

    const where: any = { orgId };
    if (status && ['ACTIVE', 'SUSPENDED', 'DELETED'].includes(status)) {
      where.status = status;
    } else {
      // 默认只返回 ACTIVE
      where.status = 'ACTIVE';
    }

    const accounts = ownerOnly ? [] : await prisma.account.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        orgId: true,
        name: true,
        username: true,
        accountCode: true,
        email: true,
        phone: true,
        status: true,
        permissionSetId: true,
        lastLoginAt: true,
        createdAt: true,
      }
    });

    const accountRows = accounts.map(acc => ({ ...acc, isOwner: false }));

    // 主账户（组织的所有者 User）不是 Account 记录，这里拼一行合成数据展示出来，
    // 方便管理员在账号列表里直接看到"这家店归谁"，不用跳去别的页面查。isOwner 标记
    // 前端不要给它渲染编辑/删除/重置 PIN 等针对 Account 的操作按钮。
    const ownerRow = {
      id: ownerUser.id,
      orgId,
      name: ownerUser.name,
      username: undefined,
      accountCode: '-',
      email: ownerUser.email,
      phone: undefined,
      status: 'ACTIVE' as const,
      permissionSetId: null,
      lastLoginAt: undefined,
      createdAt: org.createdAt,
      isOwner: true,
    };

    // 主账户状态永远是 ACTIVE（它不是 Account，没有停用概念），只在筛选 ACTIVE（含默认）时才拼进去，
    // 避免筛"已停用"账号时把主账户也混进来；且沿用原有规则——员工登录时看不到主账户，
    // 只有所有者（USER）自己查看时才展示这一行
    const includeOwnerRow = claims.userType === 'USER' && (!status || status === 'ACTIVE');
    const data = ownerOnly
      ? (includeOwnerRow ? [ownerRow] : [])
      : (includeOwnerRow ? [ownerRow, ...accountRows] : accountRows);

    return res.json({
      success: true,
      data,
      total: data.length
    });
  } catch (_e) {
    return res.status(500).json({ error: 'server_error' });
  }
}

// 获取账号详情
export async function getAccount(req: Request, res: Response) {
  try {
    const claims = getClaims(req);
    const { accountId } = req.params as any;

    const acc = await prisma.account.findUnique({
      where: { id: accountId },
      include: { organization: { select: { orgName: true } } }
    });

    if (!acc) {
      return res.status(404).json({ error: 'account_not_found', detail: 'Account not found' });
    }

    // 权限验证
    if (claims.userType === 'USER') {
      const org = await prisma.organization.findUnique({ where: { id: acc.orgId } });
      if (!org || org.userId !== claims.sub) return forbid(res);
    } else if (claims.userType === 'ACCOUNT') {
      const caller = await getCallerAccount(claims);
      if (!caller || caller.orgId !== acc.orgId) return forbid(res);
      const callerPermissions = await resolveAccountPermissions(caller);
      if (!callerPermissions.includes('accounts.view')) return forbid(res);
    } else {
      return forbid(res);
    }

    return res.json({
      success: true,
      data: {
        id: acc.id,
        orgId: acc.orgId,
        orgName: acc.organization.orgName,
        username: acc.username || undefined,
        accountCode: acc.accountCode,
        status: acc.status,
        permissionSetId: acc.permissionSetId,
        lastLoginAt: acc.lastLoginAt,
        createdAt: acc.createdAt,
        updatedAt: acc.updatedAt,
        createdBy: acc.createdBy
      }
    });
  } catch (_e) {
    return res.status(500).json({ error: 'server_error' });
  }
}

// 更新账号（username/status/permissionSetId）
export async function updateAccount(req: Request, res: Response) {
  try {
    const claims = getClaims(req);
    const { accountId } = req.params as any;
    const { username, status, permissionSetId } = req.body || {};

    // 至少要提供一个字段
    if (username === undefined && status === undefined && permissionSetId === undefined) {
      return res.status(400).json({
        error: 'invalid_request',
        detail: 'At least one field (username, status, or permissionSetId) must be provided'
      });
    }

    const target = await prisma.account.findUnique({ where: { id: accountId } });
    if (!target) {
      return res.status(404).json({ error: 'account_not_found', detail: 'Account not found' });
    }

    // 权限验证：USER 必须是组织 owner；ACCOUNT 需要 accounts.edit 权限位，且不能改自己
    let callerPermissions: string[] | null = null; // null = USER，不受越权限制
    if (claims.userType === 'USER') {
      const org = await prisma.organization.findUnique({ where: { id: target.orgId } });
      if (!org || org.userId !== claims.sub) return forbid(res);
    } else if (claims.userType === 'ACCOUNT') {
      const caller = await getCallerAccount(claims);
      if (!caller || caller.orgId !== target.orgId) return forbid(res);

      if (caller.id === target.id) {
        return res.status(400).json({
          error: 'cannot_modify_self',
          detail: 'You cannot modify your own account'
        });
      }

      callerPermissions = await resolveAccountPermissions(caller);
      if (!callerPermissions.includes('accounts.edit')) return forbid(res);
    } else {
      return forbid(res);
    }

    // 构建更新数据
    const data: any = {};

    // 处理 username 修改（开通/取消后台登录）
    if (username !== undefined) {
      // 检查 username 唯一性（如果不为空）
      if (username && username.trim().length > 0) {
        const existing = await prisma.account.findFirst({
          where: {
            username: username.trim(),
            status: 'ACTIVE',
            id: { not: accountId }
          }
        });
        if (existing) {
          return res.status(409).json({
            error: 'username_already_exists',
            detail: 'This username is already taken'
          });
        }
        data.username = username.trim();
      } else {
        data.username = null;
      }
    }

    // 处理 status 修改
    if (status !== undefined) {
      if (!['ACTIVE', 'SUSPENDED'].includes(status)) {
        return res.status(400).json({
          error: 'invalid_status',
          detail: 'Status must be either ACTIVE or SUSPENDED'
        });
      }
      data.status = status;
    }

    // 处理权限集修改
    if (permissionSetId !== undefined) {
      if (permissionSetId) {
        const set = await prisma.permissionSet.findUnique({ where: { id: permissionSetId } });
        if (!set || set.orgId !== target.orgId) {
          return res.status(400).json({ error: 'invalid_permission_set', detail: 'permissionSetId does not belong to this organization' });
        }
        // ACCOUNT 调用者只能把别人的权限组改成"自己权限的子集"，防止越权升级
        if (callerPermissions !== null) {
          const missing = set.permissions.filter(p => !callerPermissions!.includes(p));
          if (missing.length > 0) {
            return res.status(403).json({ error: 'privilege_escalation', detail: 'Cannot assign a permission set with permissions you do not have' });
          }
        }
      }
      data.permissionSetId = permissionSetId || null;
    }

    // 如果没有实际要更新的字段
    if (Object.keys(data).length === 0) {
      return res.status(400).json({
        error: 'no_changes',
        detail: 'No valid changes to apply'
      });
    }

    // 执行更新
    const updated = await prisma.account.update({
      where: { id: accountId },
      data
    });

    audit('account_updated', {
      accountId,
      by: claims.sub,
      changes: Object.keys(data),
      updatedFields: data
    });

    return res.json({
      success: true,
      message: 'Account updated successfully',
      data: {
        id: updated.id,
        username: updated.username || undefined,
        status: updated.status,
        updatedAt: updated.updatedAt
      }
    });
  } catch (e: any) {
    if (e?.code === 'P2002') {
      return res.status(409).json({
        error: 'username_already_exists',
        detail: 'This username is already taken'
      });
    }
    return res.status(500).json({ error: 'server_error' });
  }
}

// 删除账号（软删除）
export async function deleteAccount(req: Request, res: Response) {
  try {
    const claims = getClaims(req);
    const { accountId } = req.params as any;
    const target = await prisma.account.findUnique({ where: { id: accountId } });

    if (!target) {
      return res.status(404).json({ error: 'account_not_found', detail: 'Account not found' });
    }

    // 不能删除自己
    if (claims.sub === target.id) {
      return res.status(400).json({
        error: 'cannot_delete_self',
        detail: 'You cannot delete your own account'
      });
    }

    if (claims.userType === 'USER') {
      const org = await prisma.organization.findUnique({ where: { id: target.orgId } });
      if (!org || org.userId !== claims.sub) return forbid(res);
    } else if (claims.userType === 'ACCOUNT') {
      const caller = await getCallerAccount(claims);
      if (!caller || caller.orgId !== target.orgId) return forbid(res);
      const callerPermissions = await resolveAccountPermissions(caller);
      if (!callerPermissions.includes('accounts.edit')) return forbid(res);
    } else {
      return forbid(res);
    }

    await prisma.account.update({
      where: { id: accountId },
      data: { status: 'DELETED' }
    });
    audit('account_deleted', { accountId, by: claims.sub });
    return res.json({
      success: true,
      message: 'Account deleted successfully'
    });
  } catch (_e) {
    return res.status(500).json({ error: 'server_error' });
  }
}

// 管理员重置密码（3.12）：只有开通了后台登录（有 username/passwordHash）的账号才有密码可重置
export async function resetAccountPassword(req: Request, res: Response) {
  try {
    const claims = getClaims(req);
    const { accountId } = req.params as any;

    const target = await prisma.account.findUnique({ where: { id: accountId } });
    if (!target) {
      return res.status(404).json({ error: 'account_not_found', detail: 'Account not found' });
    }

    if (!target.passwordHash) {
      return res.status(400).json({
        error: 'account_no_password',
        detail: 'This account has not been granted backend login and has no password'
      });
    }

    if (!target.email) {
      return res.status(400).json({
        error: 'account_no_email',
        detail: 'This account has no email on file to send the new password to'
      });
    }

    // 权限验证
    if (claims.userType === 'USER') {
      const org = await prisma.organization.findUnique({ where: { id: target.orgId } });
      if (!org || org.userId !== claims.sub) return forbid(res);
    } else if (claims.userType === 'ACCOUNT') {
      const caller = await getCallerAccount(claims);
      if (!caller || caller.orgId !== target.orgId) return forbid(res);
      const callerPermissions = await resolveAccountPermissions(caller);
      if (!callerPermissions.includes('accounts.edit')) return forbid(res);
    } else {
      return forbid(res);
    }

    // 密码由后端随机生成，不再从请求体接收明文，也不在响应里回显——只发邮件通知本人
    const newPassword = generateRandomPassword();
    const passwordHash = await bcrypt.hash(newPassword, env.passwordHashRounds);
    await prisma.account.update({ where: { id: accountId }, data: { passwordHash } });

    // 撤销该账号所有 refresh_tokens
    await prisma.refreshToken.updateMany({
      where: { subjectAccountId: accountId, status: 'ACTIVE' },
      data: { status: 'REVOKED', revokedAt: new Date(), revokeReason: 'password_reset_by_admin' }
    });

    const mailer = getMailer();
    const { subject, html } = Templates.accountPasswordReset({
      brand: 'Tymoe',
      recipientName: target.name || target.username || 'there',
      value: newPassword,
    });
    await mailer.send(target.email, subject, html);

    audit('account_password_reset', { accountId, by: claims.sub, resetBy: claims.userType });
    return res.json({
      success: true,
      message: `Password has been reset and emailed to ${target.email}. The account must log in again.`
    });
  } catch (_e) {
    return res.status(500).json({ error: 'server_error' });
  }
}

// 管理员重置 PIN（3.13）：USER 是组织 owner 即可为组织内任意账号重置；
// ACCOUNT 调用者需要 accounts.edit 权限位（自己重置自己的 PIN 也走这个入口）
export async function resetAccountPin(req: Request, res: Response) {
  try {
    const claims = getClaims(req);
    const { accountId } = req.params as any;

    const target = await prisma.account.findUnique({ where: { id: accountId } });
    if (!target) {
      return res.status(404).json({ error: 'account_not_found', detail: 'Account not found' });
    }

    if (!target.email) {
      return res.status(400).json({
        error: 'account_no_email',
        detail: 'This account has no email on file to send the new PIN to'
      });
    }

    // 权限验证
    if (claims.userType === 'USER') {
      const org = await prisma.organization.findUnique({ where: { id: target.orgId } });
      if (!org || org.userId !== claims.sub) return forbid(res);
    } else if (claims.userType === 'ACCOUNT') {
      const caller = await getCallerAccount(claims);
      if (!caller || caller.orgId !== target.orgId) return forbid(res);
      if (caller.id !== target.id) {
        const callerPermissions = await resolveAccountPermissions(caller);
        if (!callerPermissions.includes('accounts.edit')) return forbid(res);
      }
    } else {
      return forbid(res);
    }

    // PIN 由后端随机生成，不再从请求体接收明文，也不在响应里回显——只发邮件通知本人
    const result = await accountService.resetPinCode(accountId, claims.sub as string);
    audit('account_pin_admin_reset', { accountId, by: claims.sub, resetBy: claims.userType });

    const mailer = getMailer();
    const { subject, html } = Templates.accountPinReset({
      brand: 'Tymoe',
      recipientName: target.name || target.username || 'there',
      value: result.newPinCode,
    });
    await mailer.send(target.email, subject, html);

    return res.json({
      success: true,
      message: `PIN code has been reset and emailed to ${target.email}`
    });
  } catch (e: any) {
    if (e?.message === 'account_not_found') {
      return res.status(404).json({ error: 'account_not_found', detail: 'Account not found' });
    }
    if (e?.message === 'pinCode_generation_failed') {
      return res.status(409).json({ error: 'pinCode_generation_failed', detail: 'Could not generate a unique PIN, please try again' });
    }
    return res.status(400).json({ error: 'invalid_request', detail: e?.message || 'Invalid request' });
  }
}

// 自己修改密码（仅 ACCOUNT 且 OWNER/MANAGER）
export async function changeOwnPassword(req: Request, res: Response) {
  try {
    const claims = getClaims(req);

    if (claims.userType !== 'ACCOUNT') {
      return res.status(400).json({
        error: 'only_account_can_change_password',
        detail: 'Only account users can change their password'
      });
    }

    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        error: 'invalid_request',
        detail: 'currentPassword and newPassword are required'
      });
    }

    const acc = await prisma.account.findUnique({ where: { id: claims.sub as string } });
    if (!acc) {
      return res.status(404).json({ error: 'account_not_found', detail: 'Account not found' });
    }

    if (!acc.passwordHash) {
      return res.status(400).json({
        error: 'staff_no_password',
        detail: 'STAFF accounts do not have passwords'
      });
    }

    const ok = await bcrypt.compare(currentPassword, acc.passwordHash);
    if (!ok) {
      return res.status(400).json({
        error: 'invalid_current_password',
        detail: 'Current password is incorrect'
      });
    }

    // 验证新密码强度——跟 identity.ts 的 validatePassword 保持一致（USER/ACCOUNT 同一套规则，
    // 前端现在会实时展示这几条要求满足情况，后端不能只查长度，否则展示的勾选是假的）
    if (newPassword.length < 8) {
      return res.status(400).json({
        error: 'password_too_short',
        detail: 'New password must be at least 8 characters long'
      });
    }
    if (!/[A-Z]/.test(newPassword)) {
      return res.status(400).json({
        error: 'password_needs_uppercase',
        detail: 'New password must contain at least one uppercase letter'
      });
    }
    if (!/[a-z]/.test(newPassword)) {
      return res.status(400).json({
        error: 'password_needs_lowercase',
        detail: 'New password must contain at least one lowercase letter'
      });
    }
    if (!/\d/.test(newPassword)) {
      return res.status(400).json({
        error: 'password_needs_digit',
        detail: 'New password must contain at least one digit'
      });
    }

    const passwordHash = await bcrypt.hash(newPassword, env.passwordHashRounds);
    await prisma.account.update({ where: { id: acc.id }, data: { passwordHash } });

    // 撤销所有 refresh_tokens（强制重新登录）
    await prisma.refreshToken.updateMany({
      where: { subjectAccountId: acc.id, status: 'ACTIVE' },
      data: { status: 'REVOKED', revokedAt: new Date(), revokeReason: 'password_changed' }
    });

    audit('account_change_password', { accountId: acc.id });
    return res.json({
      success: true,
      message: 'Password changed successfully. Please log in again with your new password.'
    });
  } catch (_e) {
    return res.status(500).json({ error: 'server_error' });
  }
}


