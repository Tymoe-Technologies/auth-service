// 内部服务路由 - 仅供其他后端服务调用
import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../infra/prisma.js';
import { env } from '../config/env.js';
import { organizationService } from '../services/organization.js';

const router = Router();

// 内部服务认证中间件 - 验证 X-Service-API-Key
function requireInternalServiceKey(req: Request, res: Response, next: NextFunction) {
  const apiKey = req.headers['x-service-api-key'] as string | undefined;

  if (!apiKey || apiKey !== env.internalServiceKey) {
    return res.status(403).json({
      error: 'forbidden',
      detail: 'Invalid or missing internal service API key',
    });
  }

  next();
}

router.use(requireInternalServiceKey);

// 通过 orgId 获取组织基本信息（供其他服务查询 orgName 等）
router.get('/org/:orgId', async (req: Request, res: Response) => {
  try {
    const { orgId } = req.params;

    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: {
        id: true,
        orgName: true,
        orgType: true,
        parentOrgId: true,
        status: true,
        location: true,
        street: true,
        city: true,
        province: true,
        postalCode: true,
        country: true,
        latitude: true,
        longitude: true,
        phone: true,
        email: true,
        timezone: true,
        businessHours: true,
        subdomain: true,
        customDomain: true,
        themeSettings: true,
      },
    });

    if (!org) {
      return res.status(404).json({
        error: 'organization_not_found',
        detail: 'Organization not found',
      });
    }

    res.json({
      success: true,
      data: {
        orgId: org.id,
        orgName: org.orgName,
        orgType: org.orgType,
        parentOrgId: org.parentOrgId,
        status: org.status,
        location: org.location,
        street: org.street,
        city: org.city,
        province: org.province,
        postalCode: org.postalCode,
        country: org.country,
        latitude: org.latitude,
        longitude: org.longitude,
        phone: org.phone,
        email: org.email,
        timezone: org.timezone,
        businessHours: org.businessHours,
        subdomain: org.subdomain,
        customDomain: org.customDomain,
        themeSettings: org.themeSettings,
      },
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 通过 subdomain 或 UUID 解析主店组织（用于 order-service 的 validateMerchantId 中间件）
// 只返回主店本身，不返回 children；门店列表由 order-service 自己用本地数据库 + auth 的 /org/:orgId 拼装
router.get('/org/by-slug/:slug', async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;
    if (!slug) {
      return res.status(400).json({ error: 'missing_slug' });
    }

    const result = await organizationService.resolveBySlug(slug);
    if (!result || !result.main) {
      return res.status(404).json({ error: 'merchant_not_found' });
    }

    const m = result.main;
    res.json({
      success: true,
      data: {
        orgId: m.id,
        orgName: m.orgName,
        orgType: m.orgType,
        parentOrgId: m.parentOrgId,
        status: m.status,
        timezone: m.timezone,
        businessHours: m.businessHours,
        subdomain: m.subdomain,
        customDomain: m.customDomain,
        themeSettings: m.themeSettings,
      },
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * 查询远程授权请求的批准状态（供 finance-service 校验退款授权）
 *
 * 远程授权不产生 access_token，所以调用方拿不到可验签的凭证，只能回来问
 * 「这个 requestId 批了没」。返回订单号/金额/权限位，由调用方比对是否与
 * 当前操作一致 —— 防止拿 A 单的批准去退 B 单。
 */
router.get('/remote-auth/:requestId', async (req: Request, res: Response) => {
  try {
    const request = await prisma.remoteAuthRequest.findUnique({
      where: { id: req.params.requestId },
      select: {
        id: true, orgId: true, orderId: true, orderNumber: true,
        amount: true, currency: true, status: true,
        requiredPermission: true, approvedAt: true, approvedByEmail: true,
        expiresAt: true,
      },
    });

    if (!request) return res.status(404).json({ error: 'not_found' });

    // 过期但状态还没被刷成 EXPIRED 的，按过期对待
    const isExpired = request.status === 'EXPIRED' || new Date() > request.expiresAt;

    res.json({
      success: true,
      data: {
        ...request,
        requiredPermission: request.requiredPermission ?? 'refunds.edit',
        status: isExpired && request.status !== 'APPROVED' ? 'EXPIRED' : request.status,
      },
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
