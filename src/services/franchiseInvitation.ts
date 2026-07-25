// src/services/franchiseInvitation.ts
import bcrypt from 'bcryptjs';
import { prisma } from '../infra/prisma.js';
import { audit } from '../middleware/audit.js';
import { env } from '../config/env.js';
import { getMailer } from './mailer.js';
import { Templates } from './templates.js';
import { buildLocationString } from './organization.js';
import { accountService } from './account.js';

const INVITATION_TTL_DAYS = 7;

export interface CreateInvitationRequest {
  parentOrgId: string;
  invitedByUserId: string;
  email: string;
  proposedOrgName?: string;
}

export interface AcceptInvitationRequest {
  orgName: string;
  description?: string;
  street?: string;
  city?: string;
  province?: string;
  postalCode?: string;
  country?: string;
  latitude?: number;
  longitude?: number;
  phone?: string;
  email?: string;
  password: string;
  pinCode: string;
  name?: string;
}

export class FranchiseInvitationService {
  /** 创建邀请：校验父组织归属，生成 token 并发邮件 */
  async createInvitation(request: CreateInvitationRequest) {
    const parentOrg = await prisma.organization.findFirst({
      where: {
        id: request.parentOrgId,
        userId: request.invitedByUserId,
        orgType: 'MAIN',
        status: 'ACTIVE',
      },
    });

    if (!parentOrg) {
      throw new Error('invalid_parent_org');
    }

    const existingPending = await prisma.franchiseInvitation.findFirst({
      where: {
        parentOrgId: request.parentOrgId,
        email: request.email,
        status: 'PENDING',
      },
    });

    if (existingPending) {
      throw new Error('invitation_already_pending');
    }

    const expiresAt = new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000);

    const invitation = await prisma.franchiseInvitation.create({
      data: {
        parentOrgId: request.parentOrgId,
        invitedByUserId: request.invitedByUserId,
        email: request.email,
        proposedOrgName: request.proposedOrgName,
        expiresAt,
      },
    });

    const link = `${env.portalUrl}/franchise-invitations/${invitation.token}`;
    const { subject, html } = Templates.franchiseInvitation({
      brand: parentOrg.orgName,
      email: request.email,
      link,
      days: INVITATION_TTL_DAYS,
    });
    // 发信不阻塞接口响应：SMTP 偶尔较慢，不应让前端等待超时
    getMailer().send(request.email, subject, html).catch((err) => {
      console.error('[franchiseInvitation] Failed to send invitation email:', err);
    });

    audit('franchise_invitation_created', {
      invitationId: invitation.id,
      parentOrgId: request.parentOrgId,
      invitedByUserId: request.invitedByUserId,
      email: request.email,
    });

    return invitation;
  }

  /** 邀请列表（主账户视角） */
  async listInvitations(parentOrgId: string, userId: string) {
    const parentOrg = await prisma.organization.findFirst({
      where: { id: parentOrgId, userId, orgType: 'MAIN' },
    });
    if (!parentOrg) {
      throw new Error('invalid_parent_org');
    }

    return prisma.franchiseInvitation.findMany({
      where: { parentOrgId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * 撤销/移除邀请：
   * - PENDING：标记为 REVOKED（保留记录，邀请链接立即失效）
   * - REVOKED/EXPIRED：已经作废，直接删除该记录，方便主账户清理列表
   * - ACCEPTED：不允许删除，它是该加盟店的创建凭证，需要保留历史
   */
  async revokeInvitation(id: string, userId: string) {
    const invitation = await prisma.franchiseInvitation.findUnique({ where: { id } });
    if (!invitation || invitation.invitedByUserId !== userId) {
      throw new Error('invitation_not_found');
    }

    if (invitation.status === 'PENDING') {
      await prisma.franchiseInvitation.update({
        where: { id },
        data: { status: 'REVOKED' },
      });
      audit('franchise_invitation_revoked', { invitationId: id, userId });
      return;
    }

    if (invitation.status === 'ACCEPTED') {
      throw new Error('invitation_already_accepted');
    }

    await prisma.franchiseInvitation.delete({ where: { id } });
    audit('franchise_invitation_deleted', { invitationId: id, userId, previousStatus: invitation.status });
  }

  /** 公开信息：供受邀落地页展示邀请所属品牌 */
  async getInvitationByToken(token: string) {
    const invitation = await prisma.franchiseInvitation.findUnique({ where: { token } });
    if (!invitation) {
      throw new Error('invitation_not_found');
    }

    const parentOrg = await prisma.organization.findUnique({
      where: { id: invitation.parentOrgId },
      select: { orgName: true },
    });

    const isExpired = invitation.status === 'PENDING' && invitation.expiresAt < new Date();

    // 邀请邮箱是否已经是一个 User：前端据此切换"设置新密码"还是"验证已有密码"的交互
    const emailHasAccount = !!(await prisma.user.findUnique({
      where: { email: invitation.email },
      select: { id: true },
    }));

    return {
      brand: parentOrg?.orgName ?? null,
      email: invitation.email,
      emailHasAccount,
      proposedOrgName: invitation.proposedOrgName,
      status: isExpired ? 'EXPIRED' : invitation.status,
      expiresAt: invitation.expiresAt,
    };
  }

  /**
   * 受邀人接受邀请：创建 FRANCHISE 组织，owner 身份是 User（不再是 Account）。
   * 邮箱已存在对应 User 时视为"挂靠"（同一个人名下再开一家店，走密码校验确认身份，
   * 不覆盖已有 PIN）；邮箱不存在时新建 User。
   */
  async acceptInvitation(token: string, request: AcceptInvitationRequest) {
    const invitation = await prisma.franchiseInvitation.findUnique({ where: { token } });
    if (!invitation) {
      throw new Error('invitation_not_found');
    }
    if (invitation.status !== 'PENDING') {
      throw new Error('invitation_not_pending');
    }
    if (invitation.expiresAt < new Date()) {
      await prisma.franchiseInvitation.update({
        where: { id: invitation.id },
        data: { status: 'EXPIRED' },
      });
      throw new Error('invitation_expired');
    }

    const pinValidation = accountService.validatePinCode(request.pinCode);
    if (!pinValidation.valid) {
      throw new Error(pinValidation.error);
    }

    const location = request.street ? buildLocationString(request) : undefined;
    // 身份邮箱永远是邀请函本身发给谁（不可被表单里可编辑的"门店联系邮箱"覆盖，
    // 否则填错联系邮箱会导致挂靠/创建到错误的 User 上）；门店联系邮箱是独立的业务信息，可以不同。
    const identityEmail = invitation.email;
    const storeEmail = request.email ?? invitation.email;

    const existingUser = await prisma.user.findUnique({ where: { email: identityEmail } });

    let result: { organization: any; user: any; pinCodeApplied: boolean };
    if (existingUser) {
      // 挂靠到已有 User：密码是身份校验，不是设置新密码，不做强度校验
      const passwordValid = await bcrypt.compare(request.password, existingUser.passwordHash);
      if (!passwordValid) {
        throw new Error('invalid_credentials');
      }

      result = await prisma.$transaction(async (tx) => {
        const organization = await tx.organization.create({
          data: {
            userId: existingUser.id,
            orgName: request.orgName,
            orgType: 'FRANCHISE',
            parentOrgId: invitation.parentOrgId,
            description: request.description,
            location,
            street: request.street,
            city: request.city,
            province: request.province,
            postalCode: request.postalCode,
            country: request.country,
            latitude: request.latitude,
            longitude: request.longitude,
            phone: request.phone,
            email: storeEmail,
            status: 'ACTIVE',
          },
        });

        // 已经有 PIN（可能在管理别的门店）就不覆盖，忽略本次请求里的 pinCode
        let user = existingUser;
        let pinCodeApplied = false;
        if (!existingUser.pinCodeHash) {
          const pinCodeHash = await bcrypt.hash(request.pinCode, env.passwordHashRounds);
          user = await tx.user.update({
            where: { id: existingUser.id },
            data: { pinCodeHash },
          });
          pinCodeApplied = true;
        }

        return { organization, user, pinCodeApplied };
      });
    } else {
      // 新建 User：这里才是真正设置新密码，需要强度校验
      if (request.password.length < 8) {
        throw new Error('password_too_short');
      }

      result = await prisma.$transaction(async (tx) => {
        const passwordHash = await bcrypt.hash(request.password, env.passwordHashRounds);
        const pinCodeHash = await bcrypt.hash(request.pinCode, env.passwordHashRounds);

        const user = await tx.user.create({
          data: {
            email: identityEmail,
            passwordHash,
            pinCodeHash,
            name: request.name,
            phone: request.phone,
          },
        });

        const organization = await tx.organization.create({
          data: {
            userId: user.id,
            orgName: request.orgName,
            orgType: 'FRANCHISE',
            parentOrgId: invitation.parentOrgId,
            description: request.description,
            location,
            street: request.street,
            city: request.city,
            province: request.province,
            postalCode: request.postalCode,
            country: request.country,
            latitude: request.latitude,
            longitude: request.longitude,
            phone: request.phone,
            email: storeEmail,
            status: 'ACTIVE',
          },
        });

        return { organization, user, pinCodeApplied: true };
      });
    }

    const acceptedInvitation = await prisma.franchiseInvitation.update({
      where: { id: invitation.id },
      data: {
        status: 'ACCEPTED',
        acceptedAt: new Date(),
        createdOrgId: result.organization.id,
      },
    });

    audit('franchise_invitation_accepted', {
      invitationId: invitation.id,
      orgId: result.organization.id,
      userId: result.user.id,
      attachedToExistingUser: !!existingUser,
    });

    return {
      organization: result.organization,
      user: result.user,
      invitation: acceptedInvitation,
      pinCodeApplied: result.pinCodeApplied,
    };
  }
}

export const franchiseInvitationService = new FranchiseInvitationService();
