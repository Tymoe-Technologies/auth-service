// src/services/account.ts
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { Account, Device } from '@prisma/client';
import { prisma } from '../infra/prisma.js';
import { env } from '../config/env.js';
import { audit } from '../middleware/audit.js';

/**
 * Account创建请求接口
 */
export interface CreateAccountRequest {
  orgId: string;
  // 要不要给这个员工开通 Portal 后台登录（username+password）；不开通就只能用 PIN 登 POS。
  // 员工的具体权限完全由 permissionSetId 决定，跟能不能登录后台是两件独立的事。
  grantBackendLogin: boolean;
  username?: string;
  password?: string;
  accountCode: string;
  pinCode: string;
  name?: string;
  email?: string;
  phone?: string;
  permissionSetId?: string | null;
  createdBy: string; // User ID 或 Account ID
}

/**
 * Account Service
 * 负责Account账号管理的核心业务逻辑
 */
export class AccountService {
  /**
   * 验证PIN码格式
   * @param pinCode - PIN码
   * @returns 验证结果
   */
  validatePinCode(pinCode: string): { valid: boolean; error?: string } {
    if (!/^\d{4}$/.test(pinCode)) {
      return { valid: false, error: 'pin_code_must_be_4_digits' };
    }
    return { valid: true };
  }

  /**
   * PIN 快速查找键：HMAC-SHA256(pepper, orgId + ':' + pinCode)，可索引。
   * pepper 未配置时返回 null → 调用方降级为逐个 bcrypt 比对。
   * 注意：这只是查找加速，真正的校验仍是 bcrypt.compare。
   */
  private computePinLookup(orgId: string, pinCode: string): string | null {
    if (!env.pinLookupPepper) return null;
    return crypto
      .createHmac('sha256', env.pinLookupPepper)
      .update(`${orgId}:${pinCode}`)
      .digest('hex');
  }

  /**
   * 验证员工号格式
   * @param accountCode - 员工号
   * @returns 验证结果
   */
  validateEmployeeNumber(accountCode: string): { valid: boolean; error?: string } {
    if (!accountCode || accountCode.trim().length === 0) {
      return { valid: false, error: 'employee_number_required' };
    }

    // 支持 UTF-8 字符（包括中文、英文、数字等）
    // 长度限制：1-50 个字符
    const trimmed = accountCode.trim();
    if (trimmed.length < 1 || trimmed.length > 50) {
      return { valid: false, error: 'employee_number_length_invalid' };
    }

    return { valid: true };
  }

  /**
   * 创建新的Account账号
   * @param request - 创建请求
   * @param creatorType - 创建者类型（USER或ACCOUNT）
   * @returns 创建的账号和明文PIN（仅此一次）
   */
  async createAccount(
    request: CreateAccountRequest,
    creatorType: 'USER' | 'ACCOUNT'
  ): Promise<{
    account: any;
    pinCode: string; // 明文PIN，仅创建时返回一次
  }> {
    // 1. 验证员工号格式
    const empValidation = this.validateEmployeeNumber(request.accountCode);
    if (!empValidation.valid) {
      throw new Error(empValidation.error);
    }

    // 2. 验证PIN码格式
    const pinValidation = this.validatePinCode(request.pinCode);
    if (!pinValidation.valid) {
      throw new Error(pinValidation.error);
    }

    // 3. 检查组织是否存在且活跃
    const organization = await prisma.organization.findUnique({
      where: { id: request.orgId },
    });

    if (!organization || organization.status !== 'ACTIVE') {
      throw new Error('organization_not_found_or_inactive');
    }

    // 4. 开通后台登录需要username和password
    if (request.grantBackendLogin) {
      if (!request.username || !request.password) {
        throw new Error('username_password_required');
      }

      // 验证username不能包含@符号
      if (request.username.includes('@')) {
        throw new Error('username_cannot_contain_at_symbol');
      }

      // 检查username唯一性（全局唯一，仅ACTIVE状态）
      const existingUsername = await prisma.account.findFirst({
        where: {
          username: request.username,
          status: 'ACTIVE',
        },
      });

      if (existingUsername) {
        throw new Error('username_already_exists');
      }

      // 验证密码强度
      if (request.password.length < 8) {
        throw new Error('password_too_short');
      }
    }

    // 6. 检查员工号在组织内唯一（仅ACTIVE状态）
    const existingEmployee = await prisma.account.findFirst({
      where: {
        orgId: request.orgId,
        accountCode: request.accountCode,
        status: 'ACTIVE',
      },
    });

    if (existingEmployee) {
      throw new Error('employee_number_exists_in_org');
    }

    // 6.5. 检查PIN码在组织内唯一（仅ACTIVE状态）
    // 需要查询该组织所有ACTIVE账号，逐一比对pinCode hash
    const activeAccounts = await prisma.account.findMany({
      where: {
        orgId: request.orgId,
        status: 'ACTIVE',
      },
      select: {
        id: true,
        pinCodeHash: true,
      },
    });

    for (const acc of activeAccounts) {
      const isMatch = await bcrypt.compare(request.pinCode, acc.pinCodeHash);
      if (isMatch) {
        throw new Error('pinCode_already_exists');
      }
    }

    // 7. Hash密码和PIN码
    // 不开通后台登录的员工不需要 username 和 password，即使提供了也忽略（防止浪费全局唯一的 username 资源）
    let passwordHash = null;
    let username = null;

    if (request.grantBackendLogin) {
      passwordHash = await bcrypt.hash(request.password!, env.passwordHashRounds);
      username = request.username!;
    }

    const pinCodeHash = await bcrypt.hash(request.pinCode, env.passwordHashRounds);
    const pinLookup = this.computePinLookup(request.orgId, request.pinCode);

    // 8. 创建Account记录
    const account = await prisma.account.create({
      data: {
        orgId: request.orgId,
        username,
        passwordHash,
        accountCode: request.accountCode,
        pinCodeHash,
        pinLookup,
        name: request.name || null,
        email: request.email || null,
        phone: request.phone || null,
        permissionSetId: request.permissionSetId || null,
        createdBy: request.createdBy,
        status: 'ACTIVE',
      },
    });

    // 9. 记录审计日志
    audit('account_created', {
      accountId: account.id,
      orgId: request.orgId,
      accountCode: request.accountCode,
      hasUsername: !!account.username,
      createdBy: request.createdBy,
      creatorType,
    });

    // 10. 返回结果（移除hash字段）
    return {
      account: {
        ...account,
        passwordHash: undefined,
        pinCodeHash: undefined,
      },
      pinCode: request.pinCode, // 明文PIN，仅此一次
    };
  }

  /**
   * 后台登录认证（username + password）
   * 只有开通过后台登录（有 username）的账号才能走这个入口，纯 PIN 员工没有 username 自然查不到
   * @param username - 用户名
   * @param password - 密码
   * @returns 账号信息（包含组织信息）
   */
  async authenticateBackend(
    username: string,
    password: string
  ): Promise<Account & { organization: any }> {
    const account = await prisma.account.findFirst({
      where: {
        username,
        status: 'ACTIVE',
      },
      include: {
        organization: true,
      },
    });

    if (!account) {
      throw new Error('invalid_credentials');
    }

    // 2. 检查是否有密码
    if (!account.passwordHash) {
      throw new Error('account_no_password');
    }

    // 3. 检查账号是否锁定（若锁定已过期则即时解锁）
    const now = new Date();
    if (account.lockedUntil && account.lockedUntil <= now) {
      await prisma.account.update({
        where: { id: account.id },
        data: { lockedUntil: null, lockReason: null },
      });
      audit('account_unlocked', {
        accountId: account.id,
        reason: 'lock_expired',
        previousLockedUntil: account.lockedUntil.toISOString(),
        unlockedAt: new Date().toISOString(),
        context: 'authenticateBackend',
      });
    }
    if (account.lockedUntil && account.lockedUntil > now) {
      throw new Error('account_locked');
    }

    // 4. 验证密码
    const isValid = await bcrypt.compare(password, account.passwordHash);
    if (!isValid) {
      await this.incrementLoginFailure(account.id);
      throw new Error('invalid_credentials');
    }

    // 5. 检查组织状态
    if (account.organization.status !== 'ACTIVE') {
      throw new Error('organization_inactive');
    }

    // 6. 登录成功后更新登录状态（重置失败计数并清锁）
    await this.updateLastLogin(account.id);

    // 7. 返回账号信息
    return account;
  }

  /**
   * POS登录认证（pinCode + deviceId + sessionToken）
   * 适用所有类型的Account
   * @param pinCode - PIN码
   * @param deviceId - 设备ID
   * @param sessionToken - 会话令牌
   * @returns 账号和设备信息
   */
  async authenticatePOS(
    pinCode: string,
    deviceId: string,
    sessionToken: string
  ): Promise<{
    account: Account;
    device: Device & { organization: any };
  }> {
    // 1. 验证设备存在且活跃
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

    // 2. 验证 sessionToken（新增）
    const { deviceSessionService } = await import('./deviceSession.js');
    const isValidSession = await deviceSessionService.validateSessionToken(deviceId, sessionToken);
    
    if (!isValidSession) {
      throw new Error('invalid_session');
    }

    // 3. 验证 PIN 码
    let account: Account | null = null;
    const lookup = this.computePinLookup(device.orgId, pinCode);

    // 快路径：配置了 pepper 时按 pinLookup 直接命中唯一账号，再单次 bcrypt 确认（O(1)）
    if (lookup) {
      const candidate = await prisma.account.findFirst({
        where: { orgId: device.orgId, status: 'ACTIVE', pinLookup: lookup },
      });
      if (candidate && (await bcrypt.compare(pinCode, candidate.pinCodeHash))) {
        account = candidate;
      }
    }

    // 慢路径 / 降级：未配置 pepper，或该账号 pinLookup 尚未回填 → 逐个 bcrypt 比对
    if (!account) {
      const accounts = await prisma.account.findMany({
        where: { orgId: device.orgId, status: 'ACTIVE' },
      });
      for (const acc of accounts) {
        if (await bcrypt.compare(pinCode, acc.pinCodeHash)) {
          account = acc;
          // 惰性回填 pinLookup（此刻才有明文 PIN），下次登录即走快路径
          if (lookup && acc.pinLookup !== lookup) {
            await prisma.account
              .update({ where: { id: acc.id }, data: { pinLookup: lookup } })
              .catch(() => {});
          }
          break;
        }
      }
    }

    if (!account) {
      throw new Error('invalid_credentials');
    }

    // 4. 检查账号是否锁定（若锁定已过期则即时解锁）
    const now = new Date();
    if (account.lockedUntil && account.lockedUntil <= now) {
      await prisma.account.update({
        where: { id: account.id },
        data: { lockedUntil: null, lockReason: null },
      });
      audit('account_unlocked', {
        accountId: account.id,
        reason: 'lock_expired',
        previousLockedUntil: account.lockedUntil.toISOString(),
        unlockedAt: new Date().toISOString(),
        context: 'authenticatePOS',
        deviceId,
      });
    }
    if (account.lockedUntil && account.lockedUntil > now) {
      throw new Error('account_locked');
    }

    // 5. 检查组织状态
    if (device.organization.status !== 'ACTIVE') {
      throw new Error('organization_inactive');
    }

    // 6/7. 登录后的记账（更新最后登录时间、会话活跃时间）是纯副作用，
    //      不需要等它们完成才发 token → 改为后台执行，减少串行 DB 往返（远程库时省一次约 86ms×2）
    //      失败不影响本次登录（审计已由 oidc 层记录）。
    this.updateLastLogin(account.id).catch((e) =>
      console.warn('[authenticatePOS] 更新登录状态失败(不影响登录):', e?.message),
    );
    deviceSessionService.updateLastActive(deviceId).catch((e) =>
      console.warn('[authenticatePOS] 更新会话活跃失败(不影响登录):', e?.message),
    );

    // 8. 返回账号和设备信息
    return { account, device };
  }

  /**
   * 重置Account的PIN码（管理员操作）——PIN 由后端随机生成并直接发邮件通知本人，
   * 不再从调用方接收明文、也不通过 HTTP 响应回显，杜绝在前端/管理员屏幕上出现明文。
   * @param accountId - 账号ID
   * @param resetBy - 重置操作者ID
   * @returns 新PIN码（明文，仅供调用方发送邮件用，不得再原样返回给 HTTP 客户端）
   */
  async resetPinCode(
    accountId: string,
    resetBy: string
  ): Promise<{
    newPinCode: string;
  }> {
    // 1. 检查账号是否存在
    const account = await prisma.account.findUnique({
      where: { id: accountId },
    });

    if (!account) {
      throw new Error('account_not_found');
    }

    // 2. 组织内其他在职账号 + 组织所有者（User，加盟店 owner 用同一套 PIN 登 POS）的 PIN 哈希，
    // 用于生成时的唯一性碰撞检查——新 PIN 不能跟他们撞车，否则 POS 登录会认成另一个人
    const activeAccounts = await prisma.account.findMany({
      where: {
        orgId: account.orgId,
        status: 'ACTIVE',
        id: { not: accountId },
      },
      select: { pinCodeHash: true },
    });
    const org = await prisma.organization.findUnique({
      where: { id: account.orgId },
      select: { userId: true },
    });
    const owner = org
      ? await prisma.user.findUnique({ where: { id: org.userId }, select: { pinCodeHash: true } })
      : null;

    let newPinCode = '';
    for (let attempt = 0; attempt < 20; attempt++) {
      const candidate = crypto.randomInt(0, 10000).toString().padStart(4, '0');
      let collides = false;
      for (const acc of activeAccounts) {
        if (await bcrypt.compare(candidate, acc.pinCodeHash)) { collides = true; break; }
      }
      if (!collides && owner?.pinCodeHash && await bcrypt.compare(candidate, owner.pinCodeHash)) {
        collides = true;
      }
      if (!collides) { newPinCode = candidate; break; }
    }
    if (!newPinCode) {
      throw new Error('pinCode_generation_failed');
    }

    // 3. Hash新PIN码
    const pinCodeHash = await bcrypt.hash(newPinCode, env.passwordHashRounds);
    const pinLookup = this.computePinLookup(account.orgId, newPinCode);

    // 4. 更新PIN码（同步更新快速查找键）
    await prisma.account.update({
      where: { id: accountId },
      data: { pinCodeHash, pinLookup },
    });

    // 5. 记录审计日志
    audit('account_pin_reset', {
      accountId,
      resetBy,
      resetAt: new Date().toISOString(),
    });

    // 6. 返回明文PIN——只给调用方拿去发邮件，不得再经 HTTP 响应回显给前端
    return { newPinCode };
  }

  /**
   * 更新账号的最后登录时间
   * 在登录成功后调用，同时重置失败计数和锁定状态
   * @param accountId - 账号ID
   */
  async updateLastLogin(accountId: string): Promise<void> {
    await prisma.account.update({
      where: { id: accountId },
      data: {
        lastLoginAt: new Date(),
        loginFailureCount: 0,
        lastLoginFailureAt: null,
        lockedUntil: null,
        lockReason: null,
      },
    });
  }

  /**
   * 增加登录失败计数，必要时锁定账号
   * 在登录失败后调用
   * @param accountId - 账号ID
   */
  async incrementLoginFailure(accountId: string): Promise<void> {
    // 1. 获取当前账号
    const account = await prisma.account.findUnique({
      where: { id: accountId },
      select: { loginFailureCount: true },
    });

    if (!account) return;

    // 2. 增加失败计数
    const newCount = account.loginFailureCount + 1;

    // 3. 检查是否需要锁定（10次失败）
    const maxFailures = env.loginLockThreshold || 10;
    const shouldLock = newCount >= maxFailures;

    if (shouldLock) {
      const lockDuration = (env.loginLockMinutes || 30) * 60 * 1000;
      const lockedUntil = new Date(Date.now() + lockDuration);

      await prisma.account.update({
        where: { id: accountId },
        data: {
          loginFailureCount: newCount,
          lastLoginFailureAt: new Date(),
          lockedUntil,
          lockReason: 'max_failures',
        },
      });

      audit('account_locked', {
        accountId,
        reason: 'max_failures',
        failureCount: newCount,
        lockedUntil: lockedUntil.toISOString(),
      });
    } else {
      await prisma.account.update({
        where: { id: accountId },
        data: {
          loginFailureCount: newCount,
          lastLoginFailureAt: new Date(),
        },
      });

      audit('account_login_failure', {
        accountId,
        failureCount: newCount,
        failureAt: new Date().toISOString(),
      });
    }
  }
}

// 导出单例
export const accountService = new AccountService();
