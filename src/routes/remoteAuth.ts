/**
 * 远程授权路由
 * - POST  /request              POS 发起授权请求（需要 Bearer token）
 * - GET   /:requestId/status    POS 轮询状态（需要 Bearer token）
 * - GET   /approve/:token       Manager 打开审批页（无需认证，token 即凭证）
 * - POST  /approve/:token       Manager 点击批准（无需认证）
 */

import { Router, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { requireBearer } from '../middleware/bearer.js';
import {
  createRemoteAuthRequest,
  getRemoteAuthStatus,
  approveRemoteAuthRequest,
  getRemoteAuthRequestByToken,
} from '../services/remoteAuth.js';

const router = Router();

// ─── POS 端（需要 Bearer token） ─────────────────────────────────

router.post('/request', requireBearer, async (req: Request, res: Response) => {
  const claims = (req as any).claims;
  const orgId: string = claims.orgId || claims.organization?.id;
  const accountId: string = claims.sub || claims.accountId;
  const accountName: string = claims.name || claims.accountName;

  if (!orgId) {
    return res.status(400).json({ error: 'missing_org_id', detail: 'Token does not contain orgId' });
  }

  const { orderId, orderNumber, amount, currency, reason, deviceId } = req.body;
  if (!orderId || !orderNumber || amount == null || !reason) {
    return res.status(400).json({ error: 'missing_fields', detail: 'orderId, orderNumber, amount, reason are required' });
  }

  try {
    const result = await createRemoteAuthRequest({
      orgId,
      deviceId: deviceId || '',
      orderId,
      orderNumber,
      amount: Number(amount),
      currency: currency || 'CAD',
      reason,
      createdByAccountId: accountId,
      createdByName: accountName,
    });

    res.json({ success: true, requestId: result.requestId, managerCount: result.managerCount });
  } catch (err: any) {
    console.error('[remoteAuth] createRemoteAuthRequest error:', err);
    res.status(500).json({ error: 'server_error', detail: err.message });
  }
});

router.get('/:requestId/status', requireBearer, async (req: Request, res: Response) => {
  const { requestId } = req.params;
  try {
    const status = await getRemoteAuthStatus(requestId);
    if (!status) return res.status(404).json({ error: 'not_found' });
    res.json({ success: true, ...status });
  } catch (err: any) {
    res.status(500).json({ error: 'server_error', detail: err.message });
  }
});

// 审批页专用中间件：放开 CSP + CORS（manager 从任意设备访问）
const approvalMiddleware = [
  cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'] }),
  (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'unsafe-inline'; connect-src *; style-src 'unsafe-inline'"
    );
    next();
  },
];

// ─── Manager 审批页（无需认证） ───────────────────────────────────

router.options('/approve/:token', cors({ origin: '*' })); // 处理预检请求

router.get('/approve/:token', ...approvalMiddleware, async (req: Request, res: Response) => {
  const { token } = req.params;
  const request = await getRemoteAuthRequestByToken(token);

  if (!request) {
    return res.status(404).send(buildApprovalPage({ error: '链接无效或已失效。' }));
  }

  const isExpired = request.status === 'EXPIRED' || new Date() > request.expiresAt;
  if (isExpired) {
    return res.send(buildApprovalPage({ error: '此授权链接已过期，请让员工重新发起申请。' }));
  }
  if (request.status === 'APPROVED') {
    return res.send(buildApprovalPage({
      alreadyApproved: true,
      orderNumber: request.orderNumber,
      amount: request.amount,
      currency: request.currency,
    }));
  }

  res.send(buildApprovalPage({
    token,
    orderNumber: request.orderNumber,
    amount: request.amount,
    currency: request.currency,
    reason: request.reason,
    requesterName: request.createdByName || '员工',
    expiresAt: request.expiresAt,
  }));
});

router.post('/approve/:token', ...approvalMiddleware, async (req: Request, res: Response) => {
  const { token } = req.params;
  // 支持表单提交（form）和 JSON（fetch）两种方式
  const approverEmail: string | undefined = req.body?.approverEmail;

  try {
    const result = await approveRemoteAuthRequest(token, approverEmail);

    if (!result.success) {
      if (result.error === 'not_found') {
        return res.status(404).send(buildApprovalPage({ error: '链接无效。' }));
      }
      if (result.error === 'expired') {
        return res.send(buildApprovalPage({ error: '此授权链接已过期。' }));
      }
    }

    // 成功
    return res.send(buildApprovalPage({
      approved: true,
      orderNumber: result.orderNumber,
      amount: result.amount,
      currency: result.currency,
    }));
  } catch (err: any) {
    console.error('[remoteAuth] approve error:', err);
    res.status(500).send(buildApprovalPage({ error: '服务器错误，请稍后重试。' }));
  }
});

export default router;

// ─── 审批页 HTML ──────────────────────────────────────────────────

interface ApprovalPageParams {
  token?: string;
  orderNumber?: string;
  amount?: number;
  currency?: string;
  reason?: string;
  requesterName?: string;
  expiresAt?: Date;
  error?: string;
  approved?: boolean;
  alreadyApproved?: boolean;
}

function buildApprovalPage(p: ApprovalPageParams): string {
  const amountStr = p.amount != null ? `$${Number(p.amount).toFixed(2)} ${p.currency ?? 'CAD'}` : '';

  let body = '';

  if (p.error) {
    body = `
      <div class="icon error">✕</div>
      <h2>无法处理</h2>
      <p class="desc">${p.error}</p>`;
  } else if (p.approved) {
    body = `
      <div class="icon success">✓</div>
      <h2>退款已授权</h2>
      <p class="desc">订单 <strong>#${p.orderNumber}</strong> 的退款（${amountStr}）已成功授权。<br>收银台将自动执行退款操作。</p>`;
  } else if (p.alreadyApproved) {
    body = `
      <div class="icon success">✓</div>
      <h2>已授权</h2>
      <p class="desc">订单 <strong>#${p.orderNumber}</strong> 的退款已经授权过了。</p>`;
  } else {
    // 待审批页面
    const expireText = p.expiresAt
      ? `链接有效期至 ${p.expiresAt.toLocaleString('zh-CN', { hour12: false })}`
      : '';
    body = `
      <div class="card-header">退款授权请求</div>
      <p class="requester"><strong>${p.requesterName}</strong> 正在申请以下退款：</p>
      <table class="info-table">
        <tr><td>订单编号</td><td><strong>#${p.orderNumber}</strong></td></tr>
        <tr><td>退款金额</td><td class="amount">${amountStr}</td></tr>
        <tr><td>退款原因</td><td>${p.reason}</td></tr>
      </table>
      <button id="approveBtn" class="btn-approve" onclick="doApprove()">✓ 批准退款</button>
      <p class="expire">${expireText}</p>
      <script>
        async function doApprove() {
          var btn = document.getElementById('approveBtn');
          btn.disabled = true;
          btn.textContent = '处理中...';
          try {
            var res = await fetch(window.location.href, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
            var html = await res.text();
            document.open(); document.write(html); document.close();
          } catch(e) {
            btn.disabled = false;
            btn.textContent = '✓ 批准退款';
            alert('请求失败，请重试');
          }
        }
      </script>`;
  }

  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>退款授权 - Tymoe POS</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #f5f5f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 16px; }
  .card { background: #fff; border-radius: 16px; padding: 36px 32px; max-width: 440px; width: 100%; box-shadow: 0 4px 24px rgba(0,0,0,0.10); text-align: center; }
  .card-header { font-size: 13px; font-weight: 600; color: #6b7280; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 20px; }
  .icon { font-size: 52px; margin-bottom: 16px; }
  .icon.success { color: #16a34a; }
  .icon.error { color: #dc2626; }
  h2 { font-size: 22px; color: #111827; margin-bottom: 10px; }
  .desc { color: #6b7280; font-size: 14px; line-height: 1.6; margin-bottom: 0; }
  .requester { color: #374151; font-size: 14px; margin-bottom: 18px; }
  .info-table { width: 100%; border-collapse: collapse; background: #f9fafb; border-radius: 8px; overflow: hidden; margin-bottom: 24px; text-align: left; }
  .info-table td { padding: 10px 14px; font-size: 13px; color: #374151; border-bottom: 1px solid #e5e7eb; }
  .info-table tr:last-child td { border-bottom: none; }
  .info-table td:first-child { color: #9ca3af; width: 80px; }
  .amount { color: #dc2626 !important; font-size: 18px !important; font-weight: 700 !important; }
  .btn-approve { width: 100%; padding: 15px; background: #16a34a; color: #fff; border: none; border-radius: 10px; font-size: 17px; font-weight: 700; cursor: pointer; letter-spacing: 0.5px; transition: background 0.15s; }
  .btn-approve:hover { background: #15803d; }
  .btn-approve:disabled { background: #9ca3af; cursor: not-allowed; }
  .expire { margin-top: 14px; font-size: 11px; color: #9ca3af; }
  .brand { margin-top: 28px; font-size: 11px; color: #d1d5db; }
</style>
</head>
<body>
<div class="card">
  ${body}
  <p class="brand">Tymoe POS System</p>
</div>
</body>
</html>`;
}
