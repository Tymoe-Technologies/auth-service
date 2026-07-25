// src/services/consumer.ts
import bcrypt from 'bcryptjs';
import { prisma } from '../infra/prisma.js';
import { env } from '../config/env.js';
import { audit } from '../middleware/audit.js';
import { getMailer } from './mailer.js';

/**
 * Consumer Service
 * 负责顾客（会员）认证的核心业务逻辑
 * 支持：手机号 + 短信验证码（首次）、手机号 → 邮件验证码（后续）
 */
export class ConsumerService {

  validatePhone(phone: string): { valid: boolean; error?: string } {
    if (!/^\+\d{8,16}$/.test(phone)) {
      return { valid: false, error: 'invalid_phone_format' };
    }
    return { valid: true };
  }

  /**
   * 发送验证码
   * - Consumer 无邮箱（首次）→ 发 SMS
   * - Consumer 有邮箱（后续）→ 发邮件验证码
   * 返回 method 和脱敏目标，供前端展示
   */
  async sendCode(orgId: string, phone: string): Promise<{
    success: boolean;
    method: 'sms' | 'email';
    maskedTarget: string;
    expiresAt: Date;
    dailyRemaining: number;
    // 仅开发环境返回
    code?: string;
  }> {
    const phoneValidation = this.validatePhone(phone);
    if (!phoneValidation.valid) {
      throw new Error(phoneValidation.error);
    }

    const org = await prisma.organization.findUnique({ where: { id: orgId } });
    if (!org || org.status !== 'ACTIVE') {
      throw new Error('organization_not_found_or_inactive');
    }

    let consumer = await prisma.consumer.findUnique({
      where: { orgId_phone: { orgId, phone } },
    });

    if (!consumer) {
      // 首次：自动创建记录，走 SMS
      consumer = await prisma.consumer.create({
        data: { orgId, phone, status: 'ACTIVE' },
      });
    }

    if (consumer.status !== 'ACTIVE') {
      throw new Error('consumer_suspended');
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // 已绑定邮箱 → 发邮件验证码
    if (consumer.email) {
      return this.sendEmailCode(consumer, orgId, today);
    }

    // 未绑定邮箱 → 发 SMS
    return this.sendSmsCode(consumer, orgId, phone, today);
  }

  private async sendSmsCode(
    consumer: any,
    orgId: string,
    phone: string,
    today: Date,
  ) {
    let dailyCount = consumer.smsCodeDailyCount;
    if (!consumer.smsCodeCountDate || consumer.smsCodeCountDate < today) {
      dailyCount = 0;
    }

    // 防止频繁发送（60 秒间隔）
    if (consumer.smsCodeExpiresAt && consumer.smsCodeExpiresAt > new Date()) {
      const timeSinceIssue = Date.now() - (consumer.smsCodeExpiresAt.getTime() - 5 * 60 * 1000);
      if (timeSinceIssue < 60 * 1000) {
        throw new Error('sms_code_too_frequent');
      }
    }

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const codeHash = await bcrypt.hash(code, env.passwordHashRounds);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    await prisma.consumer.update({
      where: { id: consumer.id },
      data: {
        smsCodeHash: codeHash,
        smsCodeExpiresAt: expiresAt,
        smsCodeDailyCount: dailyCount + 1,
        smsCodeCountDate: today,
      },
    });

    // TODO: 接入实际短信服务
    console.log(`[SMS] org=${orgId} phone=${phone} code=${code} (开发环境)`);

    audit('consumer_sms_code_sent', { consumerId: consumer.id, orgId, phone, dailyCount: dailyCount + 1 });

    const maskedPhone = phone.slice(0, 3) + '****' + phone.slice(-4);

    return {
      success: true,
      method: 'sms' as const,
      maskedTarget: maskedPhone,
      expiresAt,
      dailyRemaining: 999,
      ...(env.nodeEnv === 'development' ? { code } : {}),
    };
  }

  private async sendEmailCode(consumer: any, orgId: string, today: Date) {
    let dailyCount = consumer.emailCodeDailyCount;
    if (!consumer.emailCodeCountDate || consumer.emailCodeCountDate < today) {
      dailyCount = 0;
    }

    // 防止频繁发送（60 秒间隔）
    if (consumer.emailCodeExpiresAt && consumer.emailCodeExpiresAt > new Date()) {
      const timeSinceIssue = Date.now() - (consumer.emailCodeExpiresAt.getTime() - 5 * 60 * 1000);
      if (timeSinceIssue < 60 * 1000) {
        throw new Error('email_code_too_frequent');
      }
    }

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const codeHash = await bcrypt.hash(code, env.passwordHashRounds);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    await prisma.consumer.update({
      where: { id: consumer.id },
      data: {
        emailCodeHash: codeHash,
        emailCodeExpiresAt: expiresAt,
        emailCodeDailyCount: dailyCount + 1,
        emailCodeCountDate: today,
      },
    });

    // 发送邮件
    const mailer = getMailer();
    const html = `
      <p>您的登录验证码为：</p>
      <h2 style="letter-spacing: 4px;">${code}</h2>
      <p>验证码 5 分钟内有效，请勿泄露给他人。</p>
    `;
    await mailer.send(consumer.email, '您的登录验证码', html).catch((err: any) => {
      console.error('[EmailCode] 发送失败', err);
      throw new Error('email_send_failed');
    });

    audit('consumer_email_code_sent', { consumerId: consumer.id, orgId, email: consumer.email, dailyCount: dailyCount + 1 });

    // 脱敏邮箱：a***@gmail.com
    const [local, domain] = consumer.email.split('@');
    const maskedEmail = local[0] + '***@' + domain;

    return {
      success: true,
      method: 'email' as const,
      maskedTarget: maskedEmail,
      expiresAt,
      dailyRemaining: 999,
      ...(env.nodeEnv === 'development' ? { code } : {}),
    };
  }

  /**
   * 手机号 + 短信验证码登录（首次）
   * 首次登录时必须提供 name 和 email，登录成功后绑定
   */
  async loginWithSmsCode(
    orgId: string,
    phone: string,
    code: string,
    profile?: { name?: string; email?: string },
  ): Promise<{ consumer: any; organization: any; isFirstLogin: boolean }> {
    const consumer = await prisma.consumer.findUnique({
      where: { orgId_phone: { orgId, phone } },
      include: { organization: true },
    });

    if (!consumer) throw new Error('consumer_not_found');
    if (consumer.status !== 'ACTIVE') throw new Error('consumer_suspended');
    if (consumer.lockedUntil && consumer.lockedUntil > new Date()) throw new Error('consumer_locked');

    if (!consumer.smsCodeHash || !consumer.smsCodeExpiresAt) throw new Error('no_sms_code_issued');
    if (consumer.smsCodeExpiresAt < new Date()) throw new Error('sms_code_expired');

    const isValid = await bcrypt.compare(code, consumer.smsCodeHash);
    if (!isValid) {
      await this.incrementLoginFailure(consumer.id);
      throw new Error('invalid_sms_code');
    }

    if (consumer.organization.status !== 'ACTIVE') throw new Error('organization_inactive');

    const isFirstLogin = !consumer.email;

    // 如果传入了 profile 信息，顺带绑定（可选）
    if (profile?.email) {
      const emailConflict = await prisma.consumer.findFirst({
        where: { orgId, email: profile.email },
      });
      if (emailConflict && emailConflict.id !== consumer.id) {
        throw new Error('email_already_registered');
      }
    }

    const updateData: any = {
      smsCodeHash: null,
      smsCodeExpiresAt: null,
      lastLoginAt: new Date(),
      loginFailureCount: 0,
      lastLoginFailureAt: null,
      lockedUntil: null,
    };

    if (profile?.name) updateData.name = profile.name;
    if (profile?.email) updateData.email = profile.email;

    const updated = await prisma.consumer.update({
      where: { id: consumer.id },
      data: updateData,
    });

    audit('consumer_login_sms', { consumerId: consumer.id, orgId, phone, isFirstLogin });

    return {
      consumer: {
        id: updated.id,
        orgId: updated.orgId,
        phone: updated.phone,
        name: updated.name,
        email: updated.email,
        status: updated.status,
      },
      organization: {
        id: consumer.organization.id,
        orgName: consumer.organization.orgName,
        orgType: consumer.organization.orgType,
        parentOrgId: consumer.organization.parentOrgId,
        status: consumer.organization.status,
      },
      isFirstLogin,
    };
  }

  /**
   * 手机号 → 邮件验证码登录（后续登录）
   */
  async loginWithEmailCode(
    orgId: string,
    phone: string,
    code: string,
  ): Promise<{ consumer: any; organization: any; isFirstLogin: false }> {
    const consumer = await prisma.consumer.findUnique({
      where: { orgId_phone: { orgId, phone } },
      include: { organization: true },
    });

    if (!consumer) throw new Error('consumer_not_found');
    if (consumer.status !== 'ACTIVE') throw new Error('consumer_suspended');
    if (consumer.lockedUntil && consumer.lockedUntil > new Date()) throw new Error('consumer_locked');

    if (!consumer.emailCodeHash || !consumer.emailCodeExpiresAt) throw new Error('no_email_code_issued');
    if (consumer.emailCodeExpiresAt < new Date()) throw new Error('email_code_expired');

    const isValid = await bcrypt.compare(code, consumer.emailCodeHash);
    if (!isValid) {
      await this.incrementLoginFailure(consumer.id);
      throw new Error('invalid_email_code');
    }

    if (consumer.organization.status !== 'ACTIVE') throw new Error('organization_inactive');

    await prisma.consumer.update({
      where: { id: consumer.id },
      data: {
        emailCodeHash: null,
        emailCodeExpiresAt: null,
        lastLoginAt: new Date(),
        loginFailureCount: 0,
        lastLoginFailureAt: null,
        lockedUntil: null,
      },
    });

    audit('consumer_login_email_code', { consumerId: consumer.id, orgId, phone });

    return {
      consumer: {
        id: consumer.id,
        orgId: consumer.orgId,
        phone: consumer.phone,
        name: consumer.name,
        email: consumer.email,
        status: consumer.status,
      },
      organization: {
        id: consumer.organization.id,
        orgName: consumer.organization.orgName,
        orgType: consumer.organization.orgType,
        parentOrgId: consumer.organization.parentOrgId,
        status: consumer.organization.status,
      },
      isFirstLogin: false,
    };
  }

  /**
   * 获取 Consumer 资料
   */
  async getProfile(consumerId: string): Promise<any> {
    const consumer = await prisma.consumer.findUnique({
      where: { id: consumerId },
      include: { organization: true },
    });

    if (!consumer) throw new Error('consumer_not_found');

    return {
      id: consumer.id,
      orgId: consumer.orgId,
      phone: consumer.phone,
      name: consumer.name,
      email: consumer.email,
      status: consumer.status,
      hasPassword: !!consumer.passwordHash,
      lastLoginAt: consumer.lastLoginAt,
      createdAt: consumer.createdAt,
      organization: {
        id: consumer.organization.id,
        orgName: consumer.organization.orgName,
        orgType: consumer.organization.orgType,
      },
    };
  }

  /**
   * 更新 Consumer 资料
   */
  async updateProfile(consumerId: string, data: { name?: string; email?: string }): Promise<any> {
    // 如果更新 email，检查同 org 内唯一性
    if (data.email) {
      const consumer = await prisma.consumer.findUnique({ where: { id: consumerId }, select: { orgId: true } });
      if (consumer) {
        const conflict = await prisma.consumer.findFirst({
          where: { orgId: consumer.orgId, email: data.email },
        });
        if (conflict && conflict.id !== consumerId) {
          throw new Error('email_already_registered');
        }
      }
    }

    const consumer = await prisma.consumer.update({
      where: { id: consumerId },
      data: { name: data.name, email: data.email },
      include: { organization: true },
    });

    audit('consumer_profile_updated', { consumerId, fields: Object.keys(data) });

    return {
      id: consumer.id,
      orgId: consumer.orgId,
      phone: consumer.phone,
      name: consumer.name,
      email: consumer.email,
      status: consumer.status,
    };
  }

  /**
   * 设置或修改密码
   */
  async setPassword(consumerId: string, newPassword: string): Promise<void> {
    if (newPassword.length < 6) throw new Error('password_too_short');
    const hash = await bcrypt.hash(newPassword, env.passwordHashRounds);
    await prisma.consumer.update({ where: { id: consumerId }, data: { passwordHash: hash } });
    audit('consumer_password_set', { consumerId });
  }

  private async incrementLoginFailure(consumerId: string): Promise<void> {
    const consumer = await prisma.consumer.findUnique({
      where: { id: consumerId },
      select: { loginFailureCount: true },
    });
    if (!consumer) return;

    const newCount = consumer.loginFailureCount + 1;
    const maxFailures = env.loginLockThreshold || 10;
    const shouldLock = newCount >= maxFailures;

    if (shouldLock) {
      const lockDuration = (env.loginLockMinutes || 30) * 60 * 1000;
      const lockedUntil = new Date(Date.now() + lockDuration);
      await prisma.consumer.update({
        where: { id: consumerId },
        data: { loginFailureCount: newCount, lastLoginFailureAt: new Date(), lockedUntil },
      });
      audit('consumer_locked', { consumerId, reason: 'max_failures', failureCount: newCount, lockedUntil: lockedUntil.toISOString() });
    } else {
      await prisma.consumer.update({
        where: { id: consumerId },
        data: { loginFailureCount: newCount, lastLoginFailureAt: new Date() },
      });
    }
  }
}

export const consumerService = new ConsumerService();
