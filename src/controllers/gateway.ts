// src/controllers/gateway.ts
import { Request, Response } from 'express';
import { AccessClaims } from '../services/token.js';

/**
 * Traefik ForwardAuth endpoint
 *
 * This endpoint is designed to work with Traefik's ForwardAuth middleware.
 * It verifies the JWT token and returns custom headers for downstream services.
 *
 * Request: GET /api/auth-service/v1/auth/gateway-check
 * Headers: Authorization: Bearer <token>
 *
 * Success Response: 200 OK (no body)
 * Headers:
 *   X-User-Id: <sub from token>
 *   X-User-Type: USER | ACCOUNT
 *   X-User-Role: <role from organization>
 *   X-Org-Id: <organization ID(s)>
 *   X-Org-Name: <organization name(s)>
 *   X-Product-Type: <product type(s)>
 *
 * Error Response: 401 Unauthorized (handled by requireBearer middleware)
 */
export async function gatewayCheck(req: Request, res: Response) {
  // Claims are already verified and attached by requireBearer middleware
  const claims = (req as any).claims as AccessClaims;

  // Extract user/account information
  const userId = claims.sub;
  const userType = claims.userType;

  let role: string;
  let orgId: string;
  let orgName: string;
  let productType: string;

  if (userType === 'USER' && claims.organizations && claims.organizations.length > 0) {
    // For USER: use first organization (or could send all as comma-separated)
    const firstOrg = claims.organizations[0];
    role = firstOrg.role;
    orgId = firstOrg.id;
    orgName = firstOrg.orgName;
    productType = firstOrg.productType;

    // Optional: Send all organizations as comma-separated values
    const allOrgIds = claims.organizations.map(o => o.id).join(',');
    const allOrgNames = claims.organizations.map(o => o.orgName).join(',');
    const allProductTypes = claims.organizations.map(o => o.productType).join(',');

    res.setHeader('X-All-Org-Ids', allOrgIds);
    res.setHeader('X-All-Org-Names', allOrgNames);
    res.setHeader('X-All-Product-Types', allProductTypes);
  } else if (userType === 'ACCOUNT' && claims.organization) {
    // For ACCOUNT: use the single organization
    role = claims.organization.role;
    orgId = claims.organization.id;
    orgName = claims.organization.orgName;
    productType = claims.organization.productType;

    // Add ACCOUNT-specific headers
    if (claims.username) {
      res.setHeader('X-Username', claims.username);
    }
    if (claims.employeeNumber) {
      res.setHeader('X-Employee-Number', claims.employeeNumber);
    }
    if (claims.accountType) {
      res.setHeader('X-Account-Type', claims.accountType);
    }
  } else {
    // Fallback: token has no organization information
    return res.status(400).json({
      error: 'invalid_token_structure',
      detail: 'Token missing organization information'
    });
  }

  // Set standard headers for downstream services
  res.setHeader('X-User-Id', userId);
  res.setHeader('X-User-Type', userType);
  res.setHeader('X-User-Role', role);
  res.setHeader('X-Org-Id', orgId);
  res.setHeader('X-Org-Name', orgName);
  res.setHeader('X-Product-Type', productType);

  // Add email if available (USER tokens)
  if (claims.email) {
    res.setHeader('X-User-Email', claims.email);
  }

  // Add device ID if available (POS tokens)
  if (claims.deviceId) {
    res.setHeader('X-Device-Id', claims.deviceId);
  }

  // Return 200 OK with no body (Traefik ForwardAuth requirement)
  return res.status(200).end();
}
