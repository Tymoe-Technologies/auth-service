// src/controllers/franchiseInvitation.ts
import { Request, Response } from 'express';
import { franchiseInvitationService } from '../services/franchiseInvitation.js';

const ERROR_STATUS: Record<string, number> = {
  invalid_parent_org: 400,
  invitation_already_pending: 409,
  invitation_not_found: 404,
  invitation_not_pending: 409,
  invitation_expired: 410,
  invitation_already_accepted: 409,
  invalid_credentials: 401,
  pin_code_must_be_4_digits: 400,
  password_too_short: 400,
};

function handleServiceError(res: Response, error: any) {
  const message = error?.message ?? 'server_error';
  const status = ERROR_STATUS[message] ?? 500;
  return res.status(status).json({ error: message });
}

// 主账户：发出加盟邀请
export async function createFranchiseInvitation(req: Request, res: Response) {
  const claims = (req as any).claims;
  const { orgId } = req.params;
  const { email, proposedOrgName } = req.body || {};

  if (!email) {
    return res.status(400).json({ error: 'missing_required_fields', detail: 'email is required' });
  }

  try {
    const invitation = await franchiseInvitationService.createInvitation({
      parentOrgId: orgId,
      invitedByUserId: claims.sub,
      email,
      proposedOrgName,
    });
    return res.status(201).json({
      success: true,
      data: {
        id: invitation.id,
        email: invitation.email,
        status: invitation.status,
        expiresAt: invitation.expiresAt,
        createdAt: invitation.createdAt,
      },
    });
  } catch (error) {
    return handleServiceError(res, error);
  }
}

// 主账户：查看邀请列表
export async function listFranchiseInvitations(req: Request, res: Response) {
  const claims = (req as any).claims;
  const { orgId } = req.params;

  try {
    const invitations = await franchiseInvitationService.listInvitations(orgId, claims.sub);
    return res.json({
      success: true,
      data: invitations.map(inv => ({
        id: inv.id,
        email: inv.email,
        proposedOrgName: inv.proposedOrgName,
        status: inv.status,
        expiresAt: inv.expiresAt,
        acceptedAt: inv.acceptedAt,
        createdOrgId: inv.createdOrgId,
        createdAt: inv.createdAt,
      })),
    });
  } catch (error) {
    return handleServiceError(res, error);
  }
}

// 主账户：撤销邀请
export async function revokeFranchiseInvitation(req: Request, res: Response) {
  const claims = (req as any).claims;
  const { id } = req.params;

  try {
    await franchiseInvitationService.revokeInvitation(id, claims.sub);
    return res.json({ success: true });
  } catch (error) {
    return handleServiceError(res, error);
  }
}

// 公开：受邀落地页展示邀请信息
export async function getFranchiseInvitationPublic(req: Request, res: Response) {
  const { token } = req.params;

  try {
    const invitation = await franchiseInvitationService.getInvitationByToken(token);
    return res.json({ success: true, data: invitation });
  } catch (error) {
    return handleServiceError(res, error);
  }
}

// 公开：受邀人接受邀请，创建 FRANCHISE 组织，owner 身份是 User（挂靠已有 User 或新建）
export async function acceptFranchiseInvitation(req: Request, res: Response) {
  const { token } = req.params;
  const {
    orgName, description, street, city, province, postalCode, country,
    latitude, longitude, phone, email,
    password, pinCode, name,
  } = req.body || {};

  if (!orgName || !password || !pinCode) {
    return res.status(400).json({
      error: 'missing_required_fields',
      detail: 'orgName, password, and pinCode are required',
    });
  }

  try {
    const result = await franchiseInvitationService.acceptInvitation(token, {
      orgName, description, street, city, province, postalCode, country,
      latitude, longitude, phone, email,
      password, pinCode, name,
    });
    return res.status(201).json({
      success: true,
      data: {
        organizationId: result.organization.id,
        orgName: result.organization.orgName,
        userId: result.user.id,
        email: result.user.email,
        pinCodeApplied: result.pinCodeApplied,
      },
    });
  } catch (error) {
    return handleServiceError(res, error);
  }
}
