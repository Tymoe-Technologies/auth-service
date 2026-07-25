// src/services/userAuth.ts
// 加盟店 owner 的 POS PIN 登录：owner 身份是 User，不是 Account。
import bcrypt from 'bcryptjs';
import { User, Device } from '@prisma/client';
import { prisma } from '../infra/prisma.js';

export class UserAuthService {
  /**
   * 加盟店 owner 的 POS PIN 登录。
   * 一个 Organization 只有一个 userId（唯一所有者），不像 Account 那样一个 org 下
   * 有多个账号要枚举比对，所以直接 device.orgId → Organization.userId → User.pinCodeHash 比对。
   */
  async authenticateOwnerPOS(
    pinCode: string,
    deviceId: string,
    sessionToken: string
  ): Promise<{
    user: User;
    device: Device & { organization: any };
  }> {
    const device = await prisma.device.findUnique({
      where: { id: deviceId },
      include: { organization: true },
    });

    if (!device) {
      throw new Error('device_not_found');
    }
    if (device.status !== 'ACTIVE') {
      throw new Error('device_not_active');
    }

    const { deviceSessionService } = await import('./deviceSession.js');
    const isValidSession = await deviceSessionService.validateSessionToken(deviceId, sessionToken);
    if (!isValidSession) {
      throw new Error('invalid_session');
    }

    const user = await prisma.user.findUnique({ where: { id: device.organization.userId } });
    if (!user || !user.pinCodeHash) {
      throw new Error('invalid_credentials');
    }

    const isValid = await bcrypt.compare(pinCode, user.pinCodeHash);
    if (!isValid) {
      throw new Error('invalid_credentials');
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new Error('account_locked');
    }

    if (device.organization.status !== 'ACTIVE') {
      throw new Error('organization_inactive');
    }

    deviceSessionService.updateLastActive(deviceId).catch((e: any) =>
      console.warn('[authenticateOwnerPOS] 更新会话活跃失败(不影响登录):', e?.message),
    );

    return { user, device };
  }
}

export const userAuthService = new UserAuthService();
