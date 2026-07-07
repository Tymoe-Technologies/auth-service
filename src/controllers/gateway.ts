// src/controllers/gateway.ts
import { Request, Response } from 'express';
import { AccessClaims } from '../services/token.js';

/**
 * Traefik ForwardAuth 网关鉴权端点
 *
 * Traefik 将原始请求转发到这里做鉴权，通过后把 response headers
 * 注入到下游微服务的请求头中，下游服务无需再持有 JWT 公钥。
 *
 * 请求：GET /api/auth-service/v1/auth/gateway-check
 * 认证：Authorization: Bearer <access_token>（由 requireBearer 中间件校验）
 *
 * 注意：不再注入 X-Product-Type，productType 已从 USER token 顶层字段移除，
 * 需要时请从 X-All-Org-Ids 对应的组织记录里查询（见 CLAUDE.md 2025-10-11 记录）。
 */
export async function gatewayCheck(req: Request, res: Response) {
  const claims = (req as any).claims as AccessClaims;

  if (!claims?.sub) {
    return res.status(401).json({ error: 'invalid_token' });
  }

  const userId = claims.sub;
  const userType = claims.userType;

  res.setHeader('X-User-Id', userId);
  res.setHeader('X-User-Type', userType);

  if (userType === 'USER' && claims.organizations && claims.organizations.length > 0) {
    const [firstOrg] = claims.organizations;
    res.setHeader('X-User-Role', firstOrg.role);
    res.setHeader('X-Org-Id', firstOrg.id);
    res.setHeader('X-Org-Name', firstOrg.orgName);
    res.setHeader('X-All-Org-Ids', claims.organizations.map(o => o.id).join(','));
    res.setHeader('X-All-Org-Names', claims.organizations.map(o => o.orgName).join(','));
    if (claims.email) {
      res.setHeader('X-User-Email', claims.email);
    }
  } else if (userType === 'ACCOUNT' && claims.organization) {
    res.setHeader('X-User-Role', claims.organization.role);
    res.setHeader('X-Org-Id', claims.organization.id);
    res.setHeader('X-Org-Name', claims.organization.orgName);
    if (claims.username) {
      res.setHeader('X-Username', claims.username);
    }
    if (claims.employeeNumber) {
      res.setHeader('X-Employee-Number', claims.employeeNumber);
    }
    if (claims.accountType) {
      res.setHeader('X-Account-Type', claims.accountType);
    }
  } else if (userType === 'CONSUMER') {
    if (claims.organizationId) {
      res.setHeader('X-Org-Id', claims.organizationId);
    }
    if (claims.phone) {
      res.setHeader('X-User-Phone', claims.phone);
    }
  } else {
    return res.status(400).json({
      error: 'invalid_token_structure',
      detail: 'Token missing organization information'
    });
  }

  if (claims.deviceId) {
    res.setHeader('X-Device-Id', claims.deviceId);
  }

  return res.status(200).end();
}
