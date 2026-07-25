// src/services/token.ts
import { env } from '../config/env.js';
import { prisma } from '../infra/prisma.js';
import * as crypto from 'crypto';
import { SignJWT, importPKCS8, JWTPayload } from 'jose';
import { open } from '../infra/cryptoVault.js';

export type AccessClaims = {
  jti: string;
  iat: number;
  exp: number;
  iss: string;
  aud: string | string[];
  sub: string;
  email?: string;  // User 登录时包含
  userType: 'USER' | 'ACCOUNT' | 'CONSUMER';
  username?: string;  // Account 后台登录时包含
  employeeNumber?: string;
  name?: string;       // Account 真实姓名（POS 收据展示用）

  // USER 专属字段
  organizations?: Array<{
    id: string;
    orgName: string;
    orgType: string;
    parentOrgId: string | null;
    role: 'USER' | 'OWNER';
    status: string;
  }>;

  // ACCOUNT 专属字段
  organization?: {
    id: string;
    orgName: string;
    orgType: string;
    parentOrgId: string | null;
    status: string;
  };

  // CONSUMER 专属字段
  phone?: string;           // 顾客手机号
  organizationId?: string;  // 顾客所属组织 ID

  roles?: string[];  // 角色列表（已废弃，保留向后兼容）
  scopes?: string[];  // OAuth scopes（已废弃，保留向后兼容）
  deviceId?: string | null;  // POS 登录时包含
  permissions?: string[];  // ACCOUNT 专属：细粒度权限位（如 "devices.view"），按 permissionSetId 解析
};

function nowSec() { 
  return Math.floor(Date.now() / 1000); 
}

function resolveAudience(inputAud: string | string[] | undefined, organizationId?: string): string {
  if (typeof inputAud === 'string' && inputAud.trim()) return inputAud.trim();
  const prefix = (env.defaultAudPrefix || 'tymoe-service').replace(/:$/, '');
  return organizationId ? `${prefix}:${organizationId}` : prefix;
}

async function getActivePrivateKey() {
  const k = await prisma.key.findFirst({ where: { status: 'ACTIVE' } });
  if (!k) throw new Error('no_active_key');
  
  // Decrypt private key if encrypted
  const pkcs8 = env.keystoreEncKey ? open(k.privatePem) : k.privatePem;
  const privateKey = await importPKCS8(pkcs8, 'RS256');
  return { privateKey, kid: k.kid };
}

export async function signAccessToken(payload: {
  sub: string;
  email?: string;
  userType: 'USER' | 'ACCOUNT' | 'CONSUMER';
  username?: string;
  employeeNumber?: string;
  name?: string;       // Account 真实姓名

  // USER 专属字段
  organizations?: Array<{
    id: string;
    orgName: string;
    orgType: string;
    parentOrgId: string | null;
    role: 'USER' | 'OWNER';
    status: string;
  }>;

  // ACCOUNT 专属字段
  organization?: {
    id: string;
    orgName: string;
    orgType: string;
    parentOrgId: string | null;
    status: string;
  };

  // CONSUMER 专属字段
  phone?: string;
  organizationId?: string;

  roles?: string[];
  scopes?: string[];
  deviceId?: string | null; // POS 登录专用
  permissions?: string[];
  aud?: string | string[];
  ttlSec?: number; // 可选：自定义有效期（秒），用于 POS 4.5 小时等场景
}): Promise<string> {
  const iat = nowSec();
  const exp = iat + Number((payload.ttlSec ?? env.accessTtlSec) || 1800);
  const jti = crypto.randomUUID();
  const aud = resolveAudience(payload.aud, payload.organization?.id || undefined);

  const claims: AccessClaims = {
    jti, iat, exp, iss: env.issuerUrl, aud,
    sub: payload.sub,
    email: payload.email,
    userType: payload.userType,
    username: payload.username,
    employeeNumber: payload.employeeNumber,
    name: payload.name,
    organizations: payload.organizations,
    organization: payload.organization,
    phone: payload.phone,
    organizationId: payload.organizationId,
    roles: payload.roles,
    scopes: payload.scopes,
    deviceId: payload.deviceId ?? null,
    permissions: payload.permissions,
  };

  const { privateKey, kid } = await getActivePrivateKey();
  return await new SignJWT(claims as unknown as JWTPayload)
    .setProtectedHeader({ alg: 'RS256', kid })
    .setIssuer(env.issuerUrl)
    .setAudience(typeof aud === 'string' ? aud : aud[0])
    .setSubject(payload.sub)
    .setIssuedAt(iat)
    .setExpirationTime(exp)
    .sign(privateKey);
}

export async function signIdToken(payload: {
  sub: string; 
  organizationId?: string;
  aud: string;
  nonce?: string;
  acr?: string;
}): Promise<string> {
  const iat = nowSec();
  const exp = iat + 300; // ID Token 短期有效
  const { privateKey, kid } = await getActivePrivateKey();
  
  const claims: JWTPayload = {
    iss: env.issuerUrl,
    aud: payload.aud,
    sub: payload.sub,
    iat, exp,
    jti: crypto.randomUUID(),
    organizationId: payload.organizationId,
    acr: payload.acr ?? 'normal',
    ...(payload.nonce ? { nonce: payload.nonce } : {}),
  };
  
  return await new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid })
    .setIssuer(env.issuerUrl)
    .setAudience(payload.aud)
    .setSubject(payload.sub)
    .setIssuedAt(iat)
    .setExpirationTime(exp)
    .sign(privateKey);
}

// ===== Refresh Token Family =====

export async function issueRefreshFamily(args: {
  userId?: string;
  accountId?: string;
  consumerId?: string; // Consumer 登录
  deviceId?: string | null;
  clientId: string;
  organizationId?: string
}) {
  const id = crypto.randomUUID();
  const familyId = crypto.randomUUID();

  // 撤销该用户在同一 clientId 下的旧 ACTIVE token，防止登录堆积
  const subjectFilter = args.userId
    ? { subjectUserId: args.userId }
    : args.accountId
    ? { subjectAccountId: args.accountId }
    : { subjectConsumerId: args.consumerId };

  await prisma.refreshToken.updateMany({
    where: { ...subjectFilter, clientId: args.clientId, status: 'ACTIVE' },
    data: { status: 'REVOKED', revokedAt: new Date(), revokeReason: 'new_login' },
  });

  await prisma.refreshToken.create({
    data: {
      id,
      familyId,
      clientId: args.clientId,
      subjectUserId: args.userId ?? null,
      subjectAccountId: args.accountId ?? null,
      subjectConsumerId: args.consumerId ?? null,
      deviceId: args.deviceId ?? null,
      organizationId: args.organizationId ?? null,
      status: 'ACTIVE',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + Number(env.refreshTtlSec) * 1000)
    }
  });
  
  return { refreshId: id, familyId };
}

export async function rotateRefreshToken(oldId: string) {
  const old = await prisma.refreshToken.findUnique({ where: { id: oldId } });
  if (!old) {
    const err: any = new Error('invalid_refresh_token_not_found');
    err.code = 'not_found';
    throw err;
  }

  if (old.expiresAt && old.expiresAt < new Date()) {
    const err: any = new Error('invalid_refresh_token_expired');
    err.code = 'expired';
    throw err;
  }

  if (old.status !== 'ACTIVE') {
    const err: any = new Error('invalid_refresh_token_inactive');
    err.code = 'inactive';
    throw err;
  }

  // Uber 模式：只更新 lastSeenAt，不生成新的 RT
  await prisma.refreshToken.update({
    where: { id: oldId },
    data: { lastSeenAt: new Date() }
  });

  return {
    refreshId: oldId,  // 返回相同的 RT
    subject: { userId: old.subjectUserId, accountId: old.subjectAccountId, consumerId: old.subjectConsumerId, deviceId: old.deviceId },
    clientId: old.clientId,
    organizationId: old.organizationId,
    lastSeenAt: new Date(),
    createdAt: old.createdAt,
    expiresAt: old.expiresAt
  };
}

export async function revokeFamilyByOldReuse(oldId: string) {
  const old = await prisma.refreshToken.findUnique({ where: { id: oldId } });
  if (!old) return;
  
  await prisma.refreshToken.updateMany({ 
    where: { familyId: old.familyId }, 
    data: { 
      status: 'REVOKED', 
      revokedAt: new Date(), 
      revokeReason: 'reuse_detected' 
    } 
  });
}

export async function revokeFamily(familyId: string, reason: string) {
  await prisma.refreshToken.updateMany({ 
    where: { familyId }, 
    data: { 
      status: 'REVOKED', 
      revokedAt: new Date(), 
      revokeReason: reason 
    }
  });
}

export async function revokeAllUserTokens(userId: string, reason: string): Promise<{
  revokedFamilies: number;
  revokedTokens: number;
}> {
  const activeTokens = await prisma.refreshToken.findMany({
    where: {
      subjectUserId: userId,
      status: 'ACTIVE'
    },
    select: { familyId: true }
  });

  const uniqueFamilies: string[] = Array.from(
    new Set(activeTokens.map(t => t.familyId).filter((id): id is string => !!id))
  );
  
  if (uniqueFamilies.length === 0) {
    return { revokedFamilies: 0, revokedTokens: 0 };
  }

  const result = await prisma.refreshToken.updateMany({
    where: {
      familyId: { in: uniqueFamilies },
      status: 'ACTIVE'
    },
    data: {
      status: 'REVOKED',
      revokedAt: new Date(),
      revokeReason: reason
    }
  });

  return {
    revokedFamilies: uniqueFamilies.length,
    revokedTokens: result.count
  };
}

export async function revokeUserTokensGlobally(userId: string, reason: string): Promise<{
  revokedFamilies: number;
  revokedTokens: number;
}> {
  const activeTokens = await prisma.refreshToken.findMany({
    where: {
      subjectUserId: userId,
      status: { in: ['ACTIVE', 'ROTATED'] }
    },
    select: { familyId: true }
  });

  const uniqueFamilies: string[] = Array.from(
    new Set(activeTokens.map(t => t.familyId).filter((id): id is string => !!id))
  );
  
  if (uniqueFamilies.length === 0) {
    return { revokedFamilies: 0, revokedTokens: 0 };
  }

  const result = await prisma.refreshToken.updateMany({
    where: {
      familyId: { in: uniqueFamilies },
      status: { in: ['ACTIVE', 'ROTATED'] }
    },
    data: {
      status: 'REVOKED',
      revokedAt: new Date(),
      revokeReason: reason
    }
  });

  return {
    revokedFamilies: uniqueFamilies.length,
    revokedTokens: result.count
  };
}