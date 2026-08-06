/**
 * 远程授权服务
 * 员工发起退款时，若 manager 不在场，可发送邮件请求远程批准
 */

import { prisma } from '../infra/prisma.js';
import { getMailer } from './mailer.js';
import { env } from '../config/env.js';

const EXPIRE_MINUTES = 10;

export interface CreateRemoteAuthParams {
  orgId: string;
  deviceId: string;
  orderId: string;
  orderNumber: string;
  amount: number;
  currency?: string;
  reason: string;
  createdByAccountId: string;
  createdByName?: string;
  /** 需要的权限位，如 refunds.edit；只给拥有它的账号发批准邮件 */
  requiredPermission?: string;
}

export async function createRemoteAuthRequest(params: CreateRemoteAuthParams) {
  const expiresAt = new Date(Date.now() + EXPIRE_MINUTES * 60 * 1000);
  // 历史调用没传时按退款处理（这个功能原本就是为退款做的）
  const requiredPermission = params.requiredPermission || 'refunds.edit';

  const request = await prisma.remoteAuthRequest.create({
    data: {
      orgId: params.orgId,
      deviceId: params.deviceId,
      orderId: params.orderId,
      orderNumber: params.orderNumber,
      amount: params.amount,
      currency: params.currency ?? 'CAD',
      reason: params.reason,
      createdByAccountId: params.createdByAccountId,
      createdByName: params.createdByName,
      requiredPermission,
      expiresAt,
    },
  });

  // 只发给「真的有这个权限位」的账号 —— 与 PIN 授权同一口径。
  // 原先只要求「有邮箱 + 能登后台」，等于任何能登 Portal 的员工都能批准退款，
  // 比现场 PIN 授权松得多。
  //
  // 注意：所有收件人共用同一个批准链接，approverEmail 是批准页上自填的，
  // 所以这里的筛选是这条路径的主要防线（链接被转发仍可被他人批准）。
  // 要更严就得给每个收件人发独立 token，见 REMOTE_AUTH 说明。
  const candidates = await prisma.account.findMany({
    where: {
      orgId: params.orgId,
      username: { not: null },
      status: 'ACTIVE',
      email: { not: null },
    },
    select: { email: true, name: true, permissionSetId: true },
  });

  const permissionSetIds = [...new Set(candidates.map(c => c.permissionSetId).filter(Boolean))] as string[];
  const sets = permissionSetIds.length
    ? await prisma.permissionSet.findMany({
        where: { id: { in: permissionSetIds } },
        select: { id: true, permissions: true },
      })
    : [];
  const permsBySetId = new Map(sets.map(s => [s.id, s.permissions]));

  const managers = candidates.filter(c => {
    // 没分配权限组 = 无权限（与 resolveAccountPermissions 口径一致）
    if (!c.permissionSetId) return false;
    return (permsBySetId.get(c.permissionSetId) ?? []).includes(requiredPermission);
  });

  if (managers.length === 0) {
    // 没有可通知的 manager，仍然创建请求，前端可提示
    return { requestId: request.id, managerCount: 0 };
  }

  // 优先用 PUBLIC_URL（对外可访问地址），回退到 issuerUrl
  const baseUrl = (env.publicUrl || env.issuerUrl).replace(/\/+$/, '');
  const approveUrl = `${baseUrl}/api/auth-service/v1/remote-auth/approve/${request.token}`;
  const amountStr = `$${params.amount.toFixed(2)} ${request.currency}`;
  const requesterName = params.createdByName || '员工';

  const html = buildEmailHtml({
    orderNumber: params.orderNumber,
    amount: amountStr,
    reason: params.reason,
    requesterName,
    approveUrl,
    expireMinutes: EXPIRE_MINUTES,
  });

  const mailer = getMailer();
  const emailList = managers.map(m => m.email!);
  // 逐个发送（避免泄露收件人列表）
  await Promise.allSettled(
    emailList.map(email =>
      mailer.send(email, `[Tymoe POS] 退款授权请求 - 订单 #${params.orderNumber}`, html)
    )
  );

  return { requestId: request.id, managerCount: managers.length };
}

export async function getRemoteAuthStatus(requestId: string) {
  const request = await prisma.remoteAuthRequest.findUnique({
    where: { id: requestId },
    select: { status: true, expiresAt: true, approvedAt: true, approvedByEmail: true },
  });
  if (!request) return null;

  // 检查是否过期
  if (request.status === 'PENDING' && new Date() > request.expiresAt) {
    await prisma.remoteAuthRequest.update({
      where: { id: requestId },
      data: { status: 'EXPIRED' },
    });
    return { status: 'EXPIRED', approvedAt: null, approvedByEmail: null };
  }

  return {
    status: request.status,
    approvedAt: request.approvedAt,
    approvedByEmail: request.approvedByEmail,
  };
}

export async function approveRemoteAuthRequest(token: string, approverEmail?: string) {
  const request = await prisma.remoteAuthRequest.findUnique({
    where: { token },
    select: { id: true, status: true, expiresAt: true, orderNumber: true, amount: true, currency: true, reason: true },
  });

  if (!request) return { success: false, error: 'not_found' };
  if (request.status === 'APPROVED') return { success: true, alreadyApproved: true, orderNumber: request.orderNumber };
  if (request.status === 'EXPIRED' || new Date() > request.expiresAt) {
    await prisma.remoteAuthRequest.update({ where: { token }, data: { status: 'EXPIRED' } });
    return { success: false, error: 'expired' };
  }

  await prisma.remoteAuthRequest.update({
    where: { token },
    data: {
      status: 'APPROVED',
      approvedAt: new Date(),
      approvedByEmail: approverEmail ?? 'unknown',
    },
  });

  return {
    success: true,
    orderNumber: request.orderNumber,
    amount: request.amount,
    currency: request.currency,
  };
}

export async function getRemoteAuthRequestByToken(token: string) {
  const request = await prisma.remoteAuthRequest.findUnique({
    where: { token },
    select: {
      status: true,
      expiresAt: true,
      orderNumber: true,
      amount: true,
      currency: true,
      reason: true,
      createdByName: true,
      createdAt: true,
    },
  });
  return request;
}

// ─── HTML 邮件模板 ────────────────────────────────────────────────

function buildEmailHtml(params: {
  orderNumber: string;
  amount: string;
  reason: string;
  requesterName: string;
  approveUrl: string;
  expireMinutes: number;
}) {
  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>退款授权请求</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 0;">
  <tr><td align="center">
    <table width="520" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.1);">
      <tr><td style="background:#1a1a2e;padding:28px 32px;">
        <h1 style="margin:0;color:#f59e0b;font-size:20px;">Tymoe POS</h1>
        <p style="margin:6px 0 0;color:#9ca3af;font-size:13px;">退款授权请求</p>
      </td></tr>
      <tr><td style="padding:32px;">
        <p style="margin:0 0 16px;color:#374151;font-size:15px;">
          您好，<strong>${params.requesterName}</strong> 正在申请以下退款，需要您的授权：
        </p>
        <table width="100%" style="background:#f9fafb;border-radius:8px;padding:16px;border:1px solid #e5e7eb;" cellpadding="0" cellspacing="0">
          <tr><td style="padding:6px 0;color:#6b7280;font-size:13px;">订单编号</td><td style="padding:6px 0;color:#111827;font-weight:700;font-size:13px;text-align:right;">#${params.orderNumber}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7280;font-size:13px;">退款金额</td><td style="padding:6px 0;color:#ef4444;font-weight:700;font-size:16px;text-align:right;">${params.amount}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7280;font-size:13px;">退款原因</td><td style="padding:6px 0;color:#111827;font-size:13px;text-align:right;">${params.reason}</td></tr>
        </table>
        <div style="margin:28px 0;text-align:center;">
          <a href="${params.approveUrl}" style="display:inline-block;background:#16a34a;color:#fff;text-decoration:none;padding:14px 40px;border-radius:8px;font-size:16px;font-weight:700;letter-spacing:0.5px;">
            ✓ 批准退款
          </a>
        </div>
        <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">
          此链接 <strong>${params.expireMinutes} 分钟</strong>内有效，点击后即视为授权。<br>
          若非您本人操作，请忽略此邮件。
        </p>
      </td></tr>
      <tr><td style="background:#f9fafb;padding:16px 32px;border-top:1px solid #e5e7eb;">
        <p style="margin:0;color:#9ca3af;font-size:11px;text-align:center;">Tymoe POS System · 此邮件由系统自动发送，请勿回复</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}
