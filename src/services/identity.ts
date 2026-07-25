import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { prisma } from '../infra/prisma.js';
import { env } from '../config/env.js';
import { getMailer } from './mailer.js';
import { Templates } from './templates.js';
import { audit } from '../middleware/audit.js';
import { revokeFamily, revokeAllUserTokens } from './token.js';
import { encryptShortLived, decryptShortLived, isEncKeyAvailable } from '../utils/crypto.js';

interface CreateUserArgs {
  email: string;
  password: string;
  name?: string;
  phone?: string;
  organizationName?: string;
}

interface UpdateProfileArgs {
  email?: string;
  name?: string;
  phone?: string;
}

export class IdentityService {
  private mailer = getMailer();

  /**
   * Validate password strength
   * Requirements: min 8 chars, uppercase, lowercase, digit
   */
  validatePassword(password: string): { valid: boolean; error?: string } {
    if (!password) {
      return { valid: false, error: 'password_required' };
    }

    if (password.length < 8) {
      return { valid: false, error: 'password_too_short' };
    }

    if (password.length > 128) {
      return { valid: false, error: 'password_too_long' };
    }

    // Check for at least one uppercase letter
    if (!/[A-Z]/.test(password)) {
      return { valid: false, error: 'password_needs_uppercase' };
    }

    // Check for at least one lowercase letter
    if (!/[a-z]/.test(password)) {
      return { valid: false, error: 'password_needs_lowercase' };
    }

    // Check for at least one digit
    if (!/\d/.test(password)) {
      return { valid: false, error: 'password_needs_digit' };
    }

    // Common weak passwords
    const weakPasswords = ['password', '12345678', 'qwerty123', 'Password123'];
    if (weakPasswords.includes(password.toLowerCase().replace(/\d/g, ''))) {
      return { valid: false, error: 'password_too_common' };
    }

    return { valid: true };
  }

  async createOrReuseUserForSignup(args: CreateUserArgs) {
    // Validate password strength
    const passwordValidation = this.validatePassword(args.password);
    if (!passwordValidation.valid) {
      throw new Error(passwordValidation.error);
    }

    const existingUser = await prisma.user.findUnique({
      where: { email: args.email }
    });

    if (existingUser && existingUser.emailVerifiedAt) {
      // User exists and is already verified - don't create duplicate
      return { user: existingUser, created: false };
    }

    const passwordHash = await bcrypt.hash(args.password, env.passwordHashRounds);

    if (existingUser && !existingUser.emailVerifiedAt) {
      // Update existing unverified user
      const updatedUser = await prisma.user.update({
        where: { id: existingUser.id },
        data: {
          passwordHash,
          name: args.name,
          phone: args.phone,
        }
      });
      return { user: updatedUser, created: false };
    }

    // Create new user
    const newUser = await prisma.user.create({
      data: {
        email: args.email,
        passwordHash,
        name: args.name,
        phone: args.phone,
      }
    });

    // Create organization if provided
    if (args.organizationName && args.organizationName.trim()) {
      await prisma.organization.create({
        data: {
          userId: newUser.id,
          orgName: args.organizationName.trim(),
          orgType: 'MAIN' as any,
          description: `${args.organizationName.trim()} organization`
        }
      });

      // UserRole管理已移到employee-service
      // 组织ownership通过organization.ownerId字段管理
    }

    return { user: newUser, created: true };
  }

  async issueEmailVerification(userId: string, purpose: string, sentTo: string, resendCount: number = 0) {
    // 生成6位数字验证码
    const code = (Math.floor(Math.random() * 900000) + 100000).toString();
    // 使用 bcrypt 哈希验证码 (salt rounds = 10)
    const verificationCodeHash = await bcrypt.hash(code, 10);
    // 密码重置10分钟过期,其他30分钟
    const minutes = purpose === 'password_reset' ? 10 : 30;
    const expiresAt = new Date(Date.now() + minutes * 60 * 1000);

    await prisma.emailVerification.create({
      data: {
        userId,
        verificationCodeHash,
        purpose: purpose as any,
        sentTo,
        expiresAt,
        consumedAt: null,
        attempts: 0
      }
    });

    const { subject, html} = (purpose === 'change_email' ? Templates.changeEmail : Templates.signupCode)({
      brand: 'Tymoe',
      email: sentTo,
      selector: '',
      token: code,
      minutes
    });
    await this.mailer.send(sentTo, subject, html);

    return { code };
  }

  /**
   * 重新发送验证码 (文档1.3)
   * @param userId - 用户ID
   * @param email - 邮箱地址
   * @param purpose - 验证目的
   */
  async resendVerificationCode(userId: string, email: string, purpose: string) {
    // 查询最新的未消费验证记录
    const latestVerification = await prisma.emailVerification.findFirst({
      where: {
        userId,
        purpose: purpose as any,
        consumedAt: null
      },
      orderBy: { createdAt: 'desc' }
    });

    const resendCount = latestVerification ? (latestVerification.attempts || 0) : 0;

    // 检查重发次数 (同一验证会话最多重发5次)
    if (resendCount >= 5) {
      throw new Error('resend_limit_exceeded');
    }

    // 标记旧验证码为过期
    if (latestVerification) {
      await prisma.emailVerification.update({
        where: { id: latestVerification.id },
        data: { expiresAt: new Date() }
      });
    }

    // 生成新验证码
    const result = await this.issueEmailVerification(userId, purpose, email, resendCount + 1);
    
    return result;
  }

  async consumeEmailVerification(email: string, code: string) {
    // 1. 通过 email 查找用户
    const user = await prisma.user.findUnique({
      where: { email }
    });

    if (!user) {
      throw new Error('verification_not_found');
    }

    // 2. 查询最新的未消费验证记录
    const verification = await prisma.emailVerification.findFirst({
      where: {
        userId: user.id,
        purpose: 'signup',
        consumedAt: null,
        expiresAt: { gt: new Date() }
      },
      orderBy: { createdAt: 'desc' }
    });

    if (!verification) {
      throw new Error('verification_not_found');
    }

    // 3. 检查过期
    if (verification.expiresAt < new Date()) {
      throw new Error('code_expired');
    }

    // 4. 检查尝试次数
    if (verification.attempts >= 10) {
      throw new Error('too_many_attempts');
    }

    // 5. 使用 bcrypt 比对验证码
    const isValid = await bcrypt.compare(code, verification.verificationCodeHash);
    
    if (!isValid) {
      // Increment attempts for invalid code
      await prisma.emailVerification.update({ where: { id: verification.id }, data: { attempts: verification.attempts + 1 } });
      throw new Error('invalid_code');
    }

    // 6. 验证码匹配，更新记录
    await prisma.$transaction([
      prisma.emailVerification.update({ 
        where: { id: verification.id }, 
        data: { consumedAt: new Date() } 
      }),
      prisma.user.update({
        where: { id: user.id },
        data: { emailVerifiedAt: new Date() }
      }),
    ]);

    return user;
  }

  async issuePasswordReset(userId: string, sentTo: string) {
    const token = (Math.floor(Math.random() * 900000) + 100000).toString();
    const verificationCodeHash = crypto.createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + env.resetCodeTtlSec * 1000);

    await prisma.emailVerification.create({
      data: {
        userId,
        verificationCodeHash,
        purpose: 'password_reset',
        sentTo,
        expiresAt,
        consumedAt: null,
      }
    });

    const { subject, html } = Templates.resetCode({ brand: 'Tymoe', email: sentTo, selector: '', token, minutes: Math.ceil(env.resetCodeTtlSec / 60) });
    await this.mailer.send(sentTo, subject, html);
    return { token };
  }

  async consumePasswordReset(email: string, token: string, newPassword: string) {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const reset = await prisma.emailVerification.findFirst({
      where: { sentTo: email, purpose: 'password_reset', consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      include: { user: true }
    });

    if (!reset) {
      throw new Error('invalid_code');
    }

    if (reset.consumedAt) {
      throw new Error('code_already_used');
    }

    if (reset.expiresAt < new Date()) {
      throw new Error('code_expired');
    }

    if (reset.attempts >= env.codeAttemptMax) {
      throw new Error('too_many_attempts');
    }

    if (reset.verificationCodeHash !== tokenHash) {
      // Increment attempts for invalid token
      await prisma.emailVerification.update({ where: { id: reset.id }, data: { attempts: reset.attempts + 1 } });
      throw new Error('invalid_code');
    }

    // Hash new password
    const passwordHash = await bcrypt.hash(newPassword, env.passwordHashRounds);

    // Mark reset as consumed, update password, and batch sweep other resets
    await prisma.$transaction([
      prisma.emailVerification.update({ where: { id: reset.id }, data: { consumedAt: new Date() } }),
      prisma.user.update({
        where: { id: reset.userId },
        data: { passwordHash }
      }),
    ]);

    audit('password_reset_consumed', { userId: reset.userId });

    // Revoke all refresh token families for this user
    await this.revokeAllUserTokens(reset.userId, 'password_reset');

    return reset.user;
  }

  async updateUserProfile(userId: string, patch: UpdateProfileArgs) {
    const updates: any = {};

    // Handle regular fields
    if (patch.name !== undefined) updates.name = patch.name;
    if (patch.phone !== undefined) updates.phone = patch.phone;

    // Note: subdomain functionality removed in simplified architecture

    // Handle email change (requires verification)
    if (patch.email !== undefined) {
      const existing = await prisma.user.findFirst({
        where: {
          email: patch.email,
          id: { not: userId }
        }
      });
      if (existing) {
        throw new Error('email_taken');
      }

      // For email changes, issue verification but don't update immediately
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (user) {
        await this.issueEmailVerification(userId, 'change_email', patch.email);
      }
      // Don't include email in updates - it will be updated when verification is consumed
    }

    // Apply other updates
    if (Object.keys(updates).length > 0) {
      await prisma.user.update({
        where: { id: userId },
        data: updates
      });
    }

    return await prisma.user.findUnique({ where: { id: userId } });
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user) {
      throw new Error('user_not_found');
    }

    // Verify current password
    const isValidCurrent = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isValidCurrent) {
      throw new Error('invalid_current_password');
    }

    // Validate new password strength
    const passwordValidation = this.validatePassword(newPassword);
    if (!passwordValidation.valid) {
      throw new Error(passwordValidation.error);
    }

    // Hash new password
    const passwordHash = await bcrypt.hash(newPassword, env.passwordHashRounds);

    // Update password
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash }
    });

    // Revoke all refresh token families for security
    await this.revokeAllUserTokens(userId, 'password_change');

    return user;
  }

  private async revokeAllUserTokens(userId: string, reason: string) {
    // Use the centralized token service function for better consistency and auditing
    const result = await revokeAllUserTokens(userId, reason);
    
    audit('user_tokens_revoked', {
      userId,
      reason,
      revokedFamilies: result.revokedFamilies,
      revokedTokens: result.revokedTokens
    });

    return result;
  }
}