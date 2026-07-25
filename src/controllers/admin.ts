// src/controllers/admin.ts
import { Request, Response } from 'express';
import { prisma } from '../infra/prisma.js';
import { audit } from '../middleware/audit.js';
import { isRedisConnected } from '../infra/redis.js';
import { jtiCache } from '../infra/redis.js';

// 获取管理员信息
function getAdmin(req: Request) {
  return (req as any).admin || { name: 'Unknown' };
}

// ===== 6.1 系统健康检查 =====
export async function healthCheck(req: Request, res: Response) {
  try {
    const checks: any = {};

    // 检查数据库
    const dbStart = Date.now();
    try {
      await prisma.$queryRaw`SELECT 1`;
      checks.database = {
        status: 'ok',
        responseTime: Date.now() - dbStart
      };
    } catch (err) {
      checks.database = {
        status: 'error',
        error: (err as Error).message
      };
    }

    // 检查 Redis
    const redisStart = Date.now();
    if (isRedisConnected()) {
      checks.redis = {
        status: 'ok',
        responseTime: Date.now() - redisStart
      };
    } else {
      checks.redis = {
        status: 'error',
        error: 'Connection timeout'
      };
    }

    // 检查内存
    const memUsage = process.memoryUsage();
    const totalMem = memUsage.heapTotal;
    const usedMem = memUsage.heapUsed;
    const memPercent = (usedMem / totalMem) * 100;

    checks.memory = {
      status: memPercent > 90 ? 'warning' : 'ok',
      used: `${Math.round(usedMem / 1024 / 1024)}MB`,
      total: `${Math.round(totalMem / 1024 / 1024)}MB`
    };

    // 确定整体状态
    const hasError = Object.values(checks).some((c: any) => c.status === 'error');
    const hasWarning = Object.values(checks).some((c: any) => c.status === 'warning');
    const status = hasError ? 'degraded' : hasWarning ? 'degraded' : 'healthy';

    return res.json({
      status,
      timestamp: new Date().toISOString(),
      uptime: Math.floor(process.uptime()),
      checks
    });
  } catch (error: any) {
    return res.status(500).json({
      error: 'health_check_failed',
      detail: error.message
    });
  }
}

// ===== 6.2 系统统计信息 =====
export async function getSystemStats(_req: Request, res: Response) {
  try {
    // 统计 Users
    const [
      totalUsers,
      lockedUsers
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { lockedUntil: { gt: new Date() } } })
    ]);

    // 本月新增用户
    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
    const newThisMonth = await prisma.user.count({
      where: { createdAt: { gte: oneMonthAgo } }
    });

    // 统计 Organizations
    const [
      totalOrgs,
      mainOrgs,
      branchOrgs,
      franchiseOrgs,
      activeOrgs,
      suspendedOrgs,
      deletedOrgs
    ] = await Promise.all([
      prisma.organization.count(),
      prisma.organization.count({ where: { orgType: 'MAIN' } }),
      prisma.organization.count({ where: { orgType: 'BRANCH' } }),
      prisma.organization.count({ where: { orgType: 'FRANCHISE' } }),
      prisma.organization.count({ where: { status: 'ACTIVE' } }),
      prisma.organization.count({ where: { status: 'SUSPENDED' } }),
      prisma.organization.count({ where: { status: 'DELETED' } })
    ]);

    // 统计 Accounts
    const [
      totalAccounts,
      activeAccounts,
      suspendedAccounts,
      deletedAccounts
    ] = await Promise.all([
      prisma.account.count(),
      prisma.account.count({ where: { status: 'ACTIVE' } }),
      prisma.account.count({ where: { status: 'SUSPENDED' } }),
      prisma.account.count({ where: { status: 'DELETED' } })
    ]);

    // 统计 Devices
    const [
      totalDevices,
      posDevices,
      kioskDevices,
      tabletDevices,
      pendingDevices,
      activeDevices,
      deletedDevices
    ] = await Promise.all([
      prisma.device.count(),
      prisma.device.count({ where: { deviceType: 'POS' } }),
      prisma.device.count({ where: { deviceType: 'KIOSK' } }),
      prisma.device.count({ where: { deviceType: 'TABLET' } }),
      prisma.device.count({ where: { status: 'PENDING' } }),
      prisma.device.count({ where: { status: 'ACTIVE' } }),
      prisma.device.count({ where: { status: 'DELETED' } })
    ]);

    // 统计 Tokens
    const activeRefreshTokens = await prisma.refreshToken.count({
      where: { status: 'ACTIVE' }
    });

    // 黑名单 tokens 数量（从 Redis 获取，这里简化处理）
    const blacklistedTokens = 0; // 实际需要从 Redis 计算

    return res.json({
      success: true,
      timestamp: new Date().toISOString(),
      stats: {
        users: {
          total: totalUsers,
          locked: lockedUsers,
          newThisMonth
        },
        organizations: {
          total: totalOrgs,
          byType: {
            MAIN: mainOrgs,
            BRANCH: branchOrgs,
            FRANCHISE: franchiseOrgs
          },
          byStatus: {
            ACTIVE: activeOrgs,
            SUSPENDED: suspendedOrgs,
            DELETED: deletedOrgs
          }
        },
        accounts: {
          total: totalAccounts,
          byStatus: {
            ACTIVE: activeAccounts,
            SUSPENDED: suspendedAccounts,
            DELETED: deletedAccounts
          }
        },
        devices: {
          total: totalDevices,
          byType: {
            POS: posDevices,
            KIOSK: kioskDevices,
            TABLET: tabletDevices
          },
          byStatus: {
            PENDING: pendingDevices,
            ACTIVE: activeDevices,
            DELETED: deletedDevices
          }
        },
        tokens: {
          activeRefreshTokens,
          blacklistedTokens
        }
      }
    });
  } catch (error: any) {
    return res.status(500).json({
      error: 'server_error',
      detail: error.message
    });
  }
}

// ===== 6.4 查询审计日志 =====
export async function getAuditLogs(req: Request, res: Response) {
  try {
    const {
      actorUserId,
      actorAccountId,
      actorAdmin,
      action,
      targetUserId,
      targetAccountId,
      targetOrgId,
      targetDeviceId,
      startDate,
      endDate,
      limit = '50',
      offset = '0'
    } = req.query;

    const limitNum = Math.min(1000, Math.max(1, parseInt(limit as string, 10) || 50));
    const offsetNum = Math.max(0, parseInt(offset as string, 10) || 0);

    const where: any = {};

    if (actorUserId) where.actorUserId = actorUserId;
    if (actorAccountId) where.actorAccountId = actorAccountId;
    if (action) where.action = action;

    // For admin filter, we need to search in the detail JSON field
    if (actorAdmin) {
      where.detail = {
        path: ['actorAdmin'],
        string_contains: actorAdmin as string
      };
    }

    if (startDate || endDate) {
      where.at = {};
      if (startDate) where.at.gte = new Date(startDate as string);
      if (endDate) where.at.lte = new Date(endDate as string);
    }

    const [total, items] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        orderBy: { at: 'desc' },
        skip: offsetNum,
        take: limitNum,
        select: {
          id: true,
          action: true,
          actorUserId: true,
          actorAccountId: true,
          subject: true,
          detail: true,
          at: true,
          ip: true,
          userAgent: true
        }
      })
    ]);

    const hasMore = offsetNum + limitNum < total;

    return res.json({
      success: true,
      data: items.map(item => ({
        ...item,
        createdAt: item.at
      })),
      pagination: {
        total,
        limit: limitNum,
        offset: offsetNum,
        hasMore
      }
    });
  } catch (error: any) {
    return res.status(500).json({
      error: 'server_error',
      detail: error.message
    });
  }
}

// ===== 6.5 强制登出 User =====
export async function forceLogoutUser(req: Request, res: Response) {
  try {
    const { userId } = req.params;
    const { reason } = req.body || {};
    const admin = getAdmin(req);

    // 检查用户是否存在
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true }
    });

    if (!user) {
      return res.status(404).json({
        error: 'user_not_found',
        detail: 'User not found'
      });
    }

    // 撤销所有 refresh tokens
    const result = await prisma.refreshToken.updateMany({
      where: {
        subjectUserId: userId,
        status: 'ACTIVE'
      },
      data: {
        status: 'REVOKED',
        revokedAt: new Date(),
        revokeReason: 'admin_force_logout'
      }
    });

    // 将相关 access tokens 加入黑名单（这里简化处理，实际需要获取所有 jti）
    // 由于无法直接获取所有 access token 的 jti，我们只标记 refresh token 为已撤销
    // business-service 在验证 token 时会检查用户的 refresh token 状态

    // 记录审计日志
    audit('admin_force_logout_user', {
      actorAdmin: admin.name,
      targetUserId: userId,
      userEmail: user.email,
      reason: reason || 'No reason provided',
      revokedTokens: result.count
    });

    return res.json({
      success: true,
      message: 'User force logged out successfully',
      data: {
        userId: user.id,
        revokedTokens: result.count,
        reason: reason || 'No reason provided'
      }
    });
  } catch (error: any) {
    return res.status(500).json({
      error: 'server_error',
      detail: error.message
    });
  }
}

// ===== 6.6 强制登出 Account =====
export async function forceLogoutAccount(req: Request, res: Response) {
  try {
    const { accountId } = req.params;
    const { reason } = req.body || {};
    const admin = getAdmin(req);

    // 检查账号是否存在
    const account = await prisma.account.findUnique({
      where: { id: accountId },
      select: { id: true, username: true }
    });

    if (!account) {
      return res.status(404).json({
        error: 'account_not_found',
        detail: 'Account not found'
      });
    }

    // 撤销所有 refresh tokens
    const result = await prisma.refreshToken.updateMany({
      where: {
        subjectAccountId: accountId,
        status: 'ACTIVE'
      },
      data: {
        status: 'REVOKED',
        revokedAt: new Date(),
        revokeReason: 'admin_force_logout'
      }
    });

    // 记录审计日志
    audit('admin_force_logout_account', {
      actorAdmin: admin.name,
      targetAccountId: accountId,
      username: account.username,
      reason: reason || 'No reason provided',
      revokedTokens: result.count
    });

    return res.json({
      success: true,
      message: 'Account force logged out successfully',
      data: {
        accountId: account.id,
        revokedTokens: result.count,
        reason: reason || 'No reason provided'
      }
    });
  } catch (error: any) {
    return res.status(500).json({
      error: 'server_error',
      detail: error.message
    });
  }
}

// ===== 6.7 解锁 User 账号 =====
export async function unlockUser(req: Request, res: Response) {
  try {
    const { userId } = req.params;
    const { reason } = req.body || {};
    const admin = getAdmin(req);

    // 检查用户是否存在
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        lockedUntil: true,
        loginFailureCount: true,
        lockReason: true
      }
    });

    if (!user) {
      return res.status(404).json({
        error: 'user_not_found',
        detail: 'User not found'
      });
    }

    // 检查账号是否被锁定
    if (!user.lockedUntil || user.lockedUntil < new Date()) {
      return res.status(400).json({
        error: 'account_not_locked',
        detail: 'This account is not locked'
      });
    }

    // 解锁账号
    await prisma.user.update({
      where: { id: userId },
      data: {
        lockedUntil: null,
        loginFailureCount: 0,
        lockReason: null,
        lastLoginFailureAt: null
      }
    });

    // 记录审计日志
    audit('admin_unlock_user', {
      actorAdmin: admin.name,
      targetUserId: userId,
      userEmail: user.email,
      reason: reason || 'No reason provided',
      previousLockReason: user.lockReason
    });

    return res.json({
      success: true,
      message: 'User account unlocked successfully',
      data: {
        userId: user.id,
        email: user.email,
        unlockedBy: admin.name,
        reason: reason || 'No reason provided'
      }
    });
  } catch (error: any) {
    return res.status(500).json({
      error: 'server_error',
      detail: error.message
    });
  }
}

// ===== 6.12 强制注销 Device =====
export async function forceLogoutDevice(req: Request, res: Response) {
  try {
    const { deviceId } = req.params;
    const { reason } = req.body || {};
    const admin = getAdmin(req);

    // 检查设备是否存在
    const device = await prisma.device.findUnique({
      where: { id: deviceId },
      select: { id: true, deviceName: true, status: true }
    });

    if (!device) {
      return res.status(404).json({
        error: 'device_not_found',
        detail: 'Device not found'
      });
    }

    // 如果已经是 DELETED，不需要修改
    if (device.status === 'DELETED') {
      return res.json({
        success: true,
        message: 'Device status change to DELETE successfully',
        data: {
          deviceId: device.id,
          status: 'DELETED',
          reason: reason || 'Already deleted'
        }
      });
    }

    // 修改状态为 DELETED
    await prisma.device.update({
      where: { id: deviceId },
      data: {
        status: 'DELETED'
      }
    });

    // 记录审计日志
    audit('admin_force_logout_device', {
      actorAdmin: admin.name,
      targetDeviceId: deviceId,
      deviceName: device.deviceName,
      previousStatus: device.status,
      reason: reason || 'No reason provided'
    });

    return res.json({
      success: true,
      message: 'Device status change to DELETE successfully',
      data: {
        deviceId: device.id,
        status: 'DELETED',
        reason: reason || 'No reason provided'
      }
    });
  } catch (error: any) {
    return res.status(500).json({
      error: 'server_error',
      detail: error.message
    });
  }
}

// ===== 6.3 系统配置信息 =====
export async function getSystemConfig(_req: Request, res: Response) {
  try {
    const { env } = await import('../config/env.js');

    return res.json({
      success: true,
      config: {
        tokenExpiry: {
          accessToken: env.accessTtlSec,
          refreshToken: env.refreshTtlSec
        },
        deviceSettings: {
          secretLength: env.deviceSecretLength,
          validityPeriod: 31536000 // 1 year in seconds
        },
        securitySettings: {
          loginCaptchaThreshold: env.loginCaptchaThreshold,
          loginLockThreshold: env.loginLockThreshold,
          loginLockMinutes: env.loginLockMinutes,
          passwordHashRounds: env.passwordHashRounds
        },
        cacheSettings: {
          jwksMaxAgeSec: env.jwksMaxAgeSec
        },
        systemInfo: {
          version: '2.1.1',
          environment: env.nodeEnv,
          nodeVersion: process.version,
          issuerUrl: env.issuerUrl
        }
      }
    });
  } catch (error: any) {
    return res.status(500).json({
      error: 'server_error',
      detail: error.message
    });
  }
}

// ===== 6.8 清除缓存 =====
export async function clearCache(req: Request, res: Response) {
  try {
    const { cacheType, reason } = req.body || {};
    const admin = getAdmin(req);

    if (!cacheType || !['all', 'subscription', 'blacklist', 'publicKey'].includes(cacheType)) {
      return res.status(400).json({
        error: 'invalid_cache_type',
        detail: 'cacheType must be one of: all, subscription, blacklist, publicKey'
      });
    }

    const clearedItems: any = {};

    // 清除黑名单缓存
    if (cacheType === 'all' || cacheType === 'blacklist') {
      try {
        const { getRedisClient } = await import('../infra/redis.js');
        const redis = await getRedisClient();
        // 清除所有 JTI 缓存
        const keys = await redis.keys('authsvc:jti:*');
        if (keys.length > 0) {
          await redis.del(...keys);
        }
        clearedItems.blacklist = keys.length;
      } catch (err) {
        clearedItems.blacklist = 0;
      }
    }

    // 清除订阅缓存和公钥缓存（这里简化处理，实际需要通知其他服务）
    if (cacheType === 'all' || cacheType === 'subscription') {
      clearedItems.subscription = 0; // 需要通知 business-service
    }

    if (cacheType === 'all' || cacheType === 'publicKey') {
      clearedItems.publicKey = 0; // 需要通知其他服务
    }

    // 记录审计日志
    audit('admin_cache_clear', {
      actorAdmin: admin.name,
      cacheType,
      clearedItems,
      reason: reason || 'Manual cache clear'
    });

    return res.json({
      success: true,
      message: 'Cache cleared successfully',
      data: {
        cacheType,
        clearedItems,
        clearedBy: admin.name,
        reason: reason || 'Manual cache clear'
      }
    });
  } catch (error: any) {
    return res.status(500).json({
      error: 'server_error',
      detail: error.message
    });
  }
}

// ===== 6.9 查看活跃 Token =====
export async function getActiveTokens(req: Request, res: Response) {
  try {
    const {
      userId,
      accountId,
      organizationId,
      limit = '50',
      offset = '0'
    } = req.query;

    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10) || 50));
    const offsetNum = Math.max(0, parseInt(offset as string, 10) || 0);

    const where: any = { status: 'ACTIVE' };

    if (userId) where.subjectUserId = userId;
    if (accountId) where.subjectAccountId = accountId;
    if (organizationId) where.organizationId = organizationId;

    const [total, tokens, userTokens, accountTokens] = await Promise.all([
      prisma.refreshToken.count({ where }),
      prisma.refreshToken.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: offsetNum,
        take: limitNum,
        select: {
          id: true,
          subjectUserId: true,
          subjectAccountId: true,
          organizationId: true,
          clientId: true,
          createdAt: true,
          expiresAt: true,
          lastSeenAt: true
        }
      }),
      prisma.refreshToken.count({ where: { status: 'ACTIVE', subjectUserId: { not: null } } }),
      prisma.refreshToken.count({ where: { status: 'ACTIVE', subjectAccountId: { not: null } } })
    ]);

    return res.json({
      success: true,
      data: {
        totalActiveTokens: total,
        byUserType: {
          USER: userTokens,
          ACCOUNT: accountTokens
        },
        tokens
      },
      pagination: {
        total,
        limit: limitNum,
        offset: offsetNum
      }
    });
  } catch (error: any) {
    return res.status(500).json({
      error: 'server_error',
      detail: error.message
    });
  }
}

// ===== 6.11 轮换 JWT 签名密钥 =====
export async function rotateJwtKey(req: Request, res: Response) {
  try {
    const { reason } = req.body || {};
    const admin = getAdmin(req);

    // 导入密钥轮换函数
    const { rotateKey, getActiveKey } = await import('../infra/keystore.js');

    // 获取当前活跃密钥
    const currentKey = await getActiveKey();
    const oldKid = currentKey?.kid;

    // 轮换密钥
    const newKey = await rotateKey();

    // 记录审计日志
    audit('admin_jwt_key_rotation', {
      actorAdmin: admin.name,
      oldKeyId: oldKid,
      newKeyId: newKey.kid,
      reason: reason || 'Manual rotation'
    });

    return res.json({
      success: true,
      message: 'JWT signing keys rotated successfully',
      data: {
        newKeyId: newKey.kid,
        oldKeyId: oldKid || 'none',
        oldKeyRetentionPeriod: 3600,
        rotatedBy: admin.name,
        reason: reason || 'Manual rotation'
      },
      warning: 'Old tokens will remain valid for 60 minutes. Please inform other services to refresh public keys from /jwks.json'
    });
  } catch (error: any) {
    return res.status(500).json({
      error: 'server_error',
      detail: error.message
    });
  }
}
