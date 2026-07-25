import { Request, Response, NextFunction } from 'express';

export function requireUser(req: Request, res: Response, next: NextFunction) {
  const claims = (req as any).claims || {};
  if (claims.userType !== 'USER') return res.status(403).json({ error: 'user_only' });
  next();
}

export function requireAccount(req: Request, res: Response, next: NextFunction) {
  const claims = (req as any).claims || {};
  if (claims.userType !== 'ACCOUNT') return res.status(403).json({ error: 'account_only' });
  next();
}

/**
 * 细粒度权限校验：只限制 ACCOUNT（员工）token，USER（老板）token 永远放行。
 * 默认按 HTTP 方法推断：GET/HEAD 需要 `${module}.view`，其余方法需要 `${module}.edit`。
 * 部分模块在 permissionCatalog 里只注册了单一权限位，这种要传 forceAction 显式指定，
 * 不走方法推断。必须放在 requireBearer 之后，依赖 req.claims 已经被填充。
 */
export function requireModulePermission(module: string, forceAction?: 'view' | 'edit') {
  return (req: Request, res: Response, next: NextFunction) => {
    const claims = (req as any).claims || {};

    if (claims.userType !== 'ACCOUNT') {
      next();
      return;
    }

    const action = forceAction ?? (['GET', 'HEAD'].includes(req.method) ? 'view' : 'edit');
    const permissions: string[] = claims.permissions || [];
    const required = `${module}.${action}`;

    if (!permissions.includes(required)) {
      return res.status(403).json({ error: 'forbidden', detail: `Missing permission: ${required}` });
    }

    next();
  };
}

export function requireOrgAccess(paramName: string = 'orgId') {
  return (req: Request, res: Response, next: NextFunction) => {
    const claims = (req as any).claims || {};
    const orgId = (req.params as any)[paramName] || (req.query as any)[paramName] || (req.body as any)[paramName] || claims.organization?.id;
    if (!orgId) return res.status(400).json({ error: 'organization_required' });
    if (claims.userType === 'ACCOUNT' && claims.organization?.id !== orgId) {
      return res.status(403).json({ error: 'org_mismatch' });
    }
    next();
  };
}


