// src/controllers/oidc.ts
import { Request, Response } from 'express';
import { env } from '../config/env.js';
import { buildJwksWithEtag, ensureOneActiveKey } from '../infra/keystore.js';
import { prisma } from '../infra/prisma.js';
import { issueRefreshFamily, rotateRefreshToken, signAccessToken } from '../services/token.js';
import { audit } from '../middleware/audit.js';
import * as bcrypt from 'bcryptjs';
import { jtiCache, isRedisConnected } from '../infra/redis.js';
import { authenticateClient, validateGrantType } from '../services/clientAuth.js';
import { accountService } from '../services/account.js';
import { userAuthService } from '../services/userAuth.js';
import { resolveAccountPermissions } from '../services/permissionSet.js';

// ===== JWKS with ETag =====
export async function jwks(req: Request, res: Response){
  await ensureOneActiveKey();
  const { jwks, etag } = await buildJwksWithEtag();
  const inm = req.header('if-none-match') || req.header('If-None-Match');
  if (inm && inm === etag) {
    return res.status(304)
      .set('Cache-Control', `public, max-age=${env.jwksMaxAgeSec}`)
      .set('ETag', etag).end();
  }
  return res.status(200)
    .set('Cache-Control', `public, max-age=${env.jwksMaxAgeSec}`)
    .set('ETag', etag).json(jwks);
}

// ===== Token Endpoint =====
export async function token(req: Request, res: Response){
  const { grant_type } = req.body || {};
  try{
    // Client authentication
    const clientAuthResult = await authenticateClient(req);
    if (!clientAuthResult.success) {
      return res.status(401).json({ 
        error: 'invalid_client', 
        error_description: clientAuthResult.error 
      });
    }

    const { clientId, clientType } = clientAuthResult;
    
    // Validate grant type is allowed for client type
    if (!validateGrantType(clientType!, grant_type)) {
      return res.status(400).json({ 
        error: 'unauthorized_client',
        error_description: `Grant type '${grant_type}' not allowed for ${clientType} client`
      });
    }

    if (grant_type === 'authorization_code'){
      return res.status(400).json({ error: 'unsupported_grant_type' });
    }

    if (grant_type === 'refresh_token'){
      const { refresh_token } = req.body;
      try{
        const rotated = await rotateRefreshToken(refresh_token);

        // 根据 subject 类型重新生成完整的 access_token
        let at: string;
        let expiresIn = Number(env.accessTtlSec);

        // User 刷新
        if (rotated.subject.userId) {
          const user = await prisma.user.findUnique({
            where: { id: rotated.subject.userId },
            select: { id: true, email: true }
          });

          if (!user) {
            throw { code: 'user_not_found' };
          }

          // 查询该用户的所有最新组织列表（完整信息，返回所有）
          const orgs = await prisma.organization.findMany({
            where: { userId: user.id, status: 'ACTIVE' },
            select: {
              id: true,
              orgName: true,
              orgType: true,
              parentOrgId: true,
              status: true
            },
            orderBy: { createdAt: 'asc' }
          });

          // 构建完整的 organizations 数组；FRANCHISE 组织下这个 User 是加盟店 owner
          const organizations = orgs.map(org => ({
            id: org.id,
            orgName: org.orgName,
            orgType: org.orgType,
            parentOrgId: org.parentOrgId,
            role: (org.orgType === 'FRANCHISE' ? 'OWNER' : 'USER') as 'USER' | 'OWNER',
            status: org.status
          }));

          // POS owner（refresh 带 deviceId）续期时保持设备绑定 + 4.5 小时 TTL
          const isPos = !!rotated.subject.deviceId;
          at = await signAccessToken({
            sub: user.id,
            email: user.email,
            userType: 'USER',
            organizations,
            deviceId: rotated.subject.deviceId,
            aud: clientId!,
            ttlSec: isPos ? 16200 : undefined,
          });
          if (isPos) expiresIn = 16200;
        }
        // Account 刷新
        else if (rotated.subject.accountId) {
          const account = await prisma.account.findUnique({
            where: { id: rotated.subject.accountId },
            select: {
              id: true,
              username: true,
              accountCode: true,
              name: true,
              orgId: true,
              status: true,
              permissionSetId: true,
              organization: {
                select: {
                  id: true,
                  orgName: true,
                  orgType: true,
                  parentOrgId: true,
                  status: true
                }
              }
            }
          });

          if (!account) {
            throw { code: 'account_not_found' };
          }
          // 账号已停用则拒绝续期（离职/禁用即时生效）
          if (account.status !== 'ACTIVE') {
            throw { code: 'inactive' };
          }

          // 构建完整的 organization 对象
          const organization = {
            id: account.organization.id,
            orgName: account.organization.orgName,
            orgType: account.organization.orgType,
            parentOrgId: account.organization.parentOrgId,
            status: account.organization.status
          };

          // POS 账号（refresh 带 deviceId）续期时保持设备绑定 + 4.5 小时 TTL
          const isPos = !!rotated.subject.deviceId;
          const permissions = await resolveAccountPermissions(account);
          at = await signAccessToken({
            sub: account.id,
            userType: 'ACCOUNT',
            username: account.username || undefined,
            employeeNumber: account.accountCode,
            name: account.name ?? account.username ?? undefined,
            organization,
            permissions,
            deviceId: rotated.subject.deviceId,
            aud: clientId!,
            ttlSec: isPos ? 16200 : undefined,
          });
          if (isPos) expiresIn = 16200;
        } else {
          throw { code: 'invalid_subject' };
        }

        audit('token_refresh', {
          refreshTokenId: refresh_token,
          userId: rotated.subject.userId,
          accountId: rotated.subject.accountId
        });

        return res.json({
          access_token: at,
          refresh_token: rotated.refreshId,
          token_type: 'Bearer',
          expires_in: expiresIn
        });
      }catch(e:any){
        if (['expired','inactive','not_found'].includes(e?.code)) {
          audit('token_refresh_failed', { refreshTokenId: refresh_token, reason: e.code });
          return res.status(401).json({ error: 'invalid_refresh_token' });
        }
        throw e;
      }
    }

    if (grant_type === 'password') {
      const { email, username, pin_code, password } = req.body || {};
      const deviceId = (req.headers['x-device-id'] || req.headers['X-Device-ID']) as string | undefined;
      const sessionToken = (req.headers['x-session-token'] || req.headers['X-Session-Token']) as string | undefined;

      // Account POS 登录：pin_code + X-Device-ID + X-Session-Token（最优先判断，因为有明确的 pin_code 字段）
      if (pin_code && deviceId && sessionToken && !email && !username && !password) {
        // 先尝试现有员工 PIN（Account），未命中再尝试加盟店 owner PIN（User）
        try {
          const { account: acc, device } = await accountService.authenticatePOS(pin_code, deviceId, sessionToken);

          // 构建完整的 organization 对象
          const organization = {
            id: device.organization.id,
            orgName: device.organization.orgName,
            orgType: device.organization.orgType,
            parentOrgId: device.organization.parentOrgId,
            status: device.organization.status
          };

          const permissions = await resolveAccountPermissions(acc);
          const at = await signAccessToken({
            sub: acc.id,
            userType: 'ACCOUNT',
            username: acc.username ?? undefined,
            employeeNumber: acc.accountCode,
            name: acc.name ?? acc.username ?? undefined,
            organization,
            permissions,
            deviceId,
            aud: clientId!,
            ttlSec: 16200, // 4.5 小时
          });
          // 签发 refresh token（带 deviceId 绑定），让 POS 能静默续期，
          // auth-service 短暂不可用时在岗员工不会被强制重新登录
          const { refreshId: posRefreshId } = await issueRefreshFamily({
            accountId: acc.id,
            clientId: clientId!,
            organizationId: acc.orgId,
            deviceId,
          });
          audit('oauth_password_account_pos', { clientId, accountId: acc.id, deviceId: device.id });
          return res.json({ access_token: at, refresh_token: posRefreshId, token_type: 'Bearer', expires_in: 16200 });
        } catch (accErr: any) {
          if (accErr?.message !== 'invalid_credentials') throw accErr;

          // 加盟店 owner PIN（User 身份）
          const { user, device } = await userAuthService.authenticateOwnerPOS(pin_code, deviceId, sessionToken);
          const org = device.organization;

          const organizations = [{
            id: org.id,
            orgName: org.orgName,
            orgType: org.orgType,
            parentOrgId: org.parentOrgId,
            role: 'OWNER' as const,
            status: org.status,
          }];

          const at = await signAccessToken({
            sub: user.id,
            email: user.email,
            userType: 'USER',
            // 加盟店 owner 走 POS 登录时也要带上显示名，否则前端会兜底到 sub(UUID) 显示
            name: user.name ?? user.email ?? undefined,
            organizations,
            deviceId,
            aud: clientId!,
            ttlSec: 16200, // 4.5 小时
          });
          const { refreshId: posRefreshId } = await issueRefreshFamily({
            userId: user.id,
            clientId: clientId!,
            organizationId: org.id,
            deviceId,
          });
          audit('oauth_password_owner_pos', { clientId, userId: user.id, deviceId: device.id });
          return res.json({ access_token: at, refresh_token: posRefreshId, token_type: 'Bearer', expires_in: 16200 });
        }
      }

      // Account 后台登录：username + password (真正的 username，不是 email)
      // 必须先判断 Account 登录，因为 username 字段会被 User 登录逻辑误认为是邮箱
      if (username && password && !email && !pin_code && !username.includes('@')) {
        // 验证 username 不能包含 @ 符号（防御性编程，虽然已经在 if 条件中检查）
        if (username.includes('@')) {
          return res.status(400).json({
            error: 'invalid_username',
            error_description: 'Username cannot contain @ symbol'
          });
        }

        const acc = await accountService.authenticateBackend(username, password);

        // 构建完整的 organization 对象
        const organization = {
          id: acc.organization.id,
          orgName: acc.organization.orgName,
          orgType: acc.organization.orgType,
          parentOrgId: acc.organization.parentOrgId,
          status: acc.organization.status
        };

        const permissions = await resolveAccountPermissions(acc);
        const at = await signAccessToken({
          sub: acc.id,
          userType: 'ACCOUNT',
          username: acc.username!,
          employeeNumber: acc.accountCode,
          organization,
          permissions,
          aud: clientId!,
        });
        const { refreshId } = await issueRefreshFamily({ accountId: acc.id, clientId: clientId!, organizationId: acc.orgId });
        audit('oauth_password_account_backend', { clientId, accountId: acc.id, username: acc.username });
        return res.json({
          access_token: at,
          refresh_token: refreshId,
          token_type: 'Bearer',
          expires_in: Number(env.accessTtlSec)
        });
      }

      // 用户（老板）后台登录：username(实际是email) + password
      // 兼容 API 文档：支持 username 字段传邮箱，或 email 字段传邮箱
      const userEmail = email || username;
      if (userEmail && password && !pin_code) {
        const user = await prisma.user.findUnique({ where: { email: userEmail } });
        if (!user) return res.status(401).json({ error: 'invalid_grant' });
        const ok = await bcrypt.compare(password, user.passwordHash);
        if (!ok) return res.status(401).json({ error: 'invalid_grant' });
        if (!user.emailVerifiedAt) return res.status(403).json({ error: 'email_not_verified' });

        // 查询该用户的所有组织（完整信息，返回所有）
        const orgs = await prisma.organization.findMany({
          where: { userId: user.id, status: 'ACTIVE' },
          select: {
            id: true,
            orgName: true,
            orgType: true,
            parentOrgId: true,
            status: true
          },
          orderBy: { createdAt: 'asc' }
        });
        const primaryOrgId = orgs[0]?.id || null;

        // 构建完整的 organizations 数组；FRANCHISE 组织下这个 User 是加盟店 owner
        const organizations = orgs.map(org => ({
          id: org.id,
          orgName: org.orgName,
          orgType: org.orgType,
          parentOrgId: org.parentOrgId,
          role: (org.orgType === 'FRANCHISE' ? 'OWNER' : 'USER') as 'USER' | 'OWNER',
          status: org.status
        }));

        const at = await signAccessToken({
          sub: user.id,
          email: user.email,
          userType: 'USER',
          organizations,
          aud: clientId!,
        });
        const { refreshId } = await issueRefreshFamily({ userId: user.id, clientId: clientId!, organizationId: primaryOrgId ?? undefined });

        audit('oauth_password_user_login', { clientId, userId: user.id, email: user.email });
        return res.json({
          access_token: at,
          refresh_token: refreshId,
          token_type: 'Bearer',
          expires_in: Number(env.accessTtlSec)
        });
      }

      return res.status(400).json({ error: 'invalid_request' });
    }

    return res.status(400).json({ error: 'unsupported_grant_type' });

  }catch(e:any){
    return res.status(500).json({ error: 'server_error', detail: e?.message, requestId: res.locals.requestId });
  }
}

// ===== UserInfo =====
export async function userinfo(req: Request, res: Response){
  try {
    // 由 requireBearer 验证并注入的 claims
    const claims = (req as any).claims || {};
    const { sub, userType } = claims;

    if (!sub || !userType) {
      return res.status(401).json({
        error: 'invalid_token',
        detail: 'Token is invalid or expired'
      });
    }

    // User 类型
    if (userType === 'USER') {
      const user = await prisma.user.findUnique({
        where: { id: sub },
        select: {
          email: true,
          name: true,
          phone: true,
          emailVerifiedAt: true,
          createdAt: true,
        }
      });

      if (!user) {
        return res.status(404).json({
          error: 'user_not_found',
          detail: 'User or account not found'
        });
      }

      // 查询该用户的所有组织（完整信息，返回所有）
      const organizations = await prisma.organization.findMany({
        where: {
          userId: sub,
          status: 'ACTIVE'
        },
        select: {
          id: true,
          orgName: true,
          orgType: true,
          parentOrgId: true,
          status: true
        },
        orderBy: { createdAt: 'asc' }
      });

      return res.json({
        success: true,
        userType: 'USER',
        data: {
          email: user.email,
          name: user.name,
          phone: user.phone,
          emailVerified: !!user.emailVerifiedAt,
          createdAt: user.createdAt,
          organizations: organizations.map(org => ({
            id: org.id,
            orgName: org.orgName,
            orgType: org.orgType,
            parentOrgId: org.parentOrgId,
            role: org.orgType === 'FRANCHISE' ? 'OWNER' : 'USER',
            status: org.status
          }))
        }
      });
    }

    // Account 类型
    if (userType === 'ACCOUNT') {
      const account = await prisma.account.findUnique({
        where: { id: sub },
        select: {
          username: true,
          accountCode: true,
          name: true,
          email: true,
          phone: true,
          lastLoginAt: true,
          createdAt: true,
          orgId: true,
          permissionSetId: true,
          organization: {
            select: {
              id: true,
              orgName: true,
              orgType: true,
              parentOrgId: true,
              status: true
            }
          }
        }
      });

      if (!account) {
        return res.status(404).json({
          error: 'user_not_found',
          detail: 'User or account not found'
        });
      }

      const permissions = await resolveAccountPermissions(account);

      return res.json({
        success: true,
        userType: 'ACCOUNT',
        data: {
          username: account.username,
          employeeNumber: account.accountCode,
          name: account.name,
          email: account.email,
          phone: account.phone,
          lastLoginAt: account.lastLoginAt,
          createdAt: account.createdAt,
          permissions,
          organization: {
            id: account.organization.id,
            orgName: account.organization.orgName,
            orgType: account.organization.orgType,
            parentOrgId: account.organization.parentOrgId,
            status: account.organization.status
          }
        }
      });
    }

    return res.status(400).json({
      error: 'invalid_token',
      detail: 'Invalid userType in token'
    });

  } catch (error: any) {
    return res.status(500).json({ error: 'server_error', detail: error?.message });
  }
}

// ===== Check Token Blacklist (Internal Service) =====
export async function checkBlacklist(req: Request, res: Response){
  try {
    // 1. 验证内部服务密钥
    const serviceKey = req.header('x-internal-service-key') || req.header('X-Internal-Service-Key');
    if (!serviceKey || serviceKey !== env.internalServiceKey) {
      audit('blacklist_check_invalid_key', { ip: req.ip, providedKey: serviceKey?.substring(0, 10) });
      return res.status(403).json({
        error: 'invalid_service_key',
        detail: 'Invalid internal service key'
      });
    }

    // 2. 获取 jti
    const { jti } = req.body || {};
    if (!jti) {
      return res.status(400).json({
        error: 'missing_jti',
        detail: 'jti is required'
      });
    }

    // 3. 检查 Redis 黑名单
    if (!isRedisConnected()) {
      // Redis 未连接，假设不在黑名单中（降级处理）
      return res.json({
        success: true,
        blacklisted: false
      });
    }

    const blacklisted = await jtiCache.isBlacklisted(jti);
    const reason = blacklisted ? await jtiCache.getBlacklistReason(jti) : null;

    audit('blacklist_check', {
      jti: jti.substring(0, 10),
      blacklisted,
      reason,
      ip: req.ip
    });

    return res.json({
      success: true,
      blacklisted,
      ...(reason ? { reason } : {})
    });

  } catch (error: any) {
    audit('blacklist_check_error', { error: error.message, ip: req.ip });
    return res.status(500).json({ error: 'server_error', detail: error?.message });
  }
}