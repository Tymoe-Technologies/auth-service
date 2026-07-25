// src/controllers/permissionSet.ts
import { Request, Response } from 'express';
import {
  createPermissionSet,
  listPermissionSets,
  updatePermissionSet,
  deletePermissionSet,
} from '../services/permissionSet.js';
import { PERMISSION_MODULES, ALL_PERMISSIONS, getModuleActions } from '../config/permissionCatalog.js';

const ERROR_STATUS: Record<string, number> = {
  org_not_found: 404,
  forbidden: 403,
  invalid_permission: 400,
  privilege_escalation: 403,
  permission_set_not_found: 404,
};

function handleServiceError(res: Response, error: any) {
  const message = error?.message ?? 'server_error';
  const status = ERROR_STATUS[message] ?? 500;
  return res.status(status).json({ error: message });
}

function getCaller(req: Request) {
  const claims = (req as any).claims;
  return { userType: claims.userType, sub: claims.sub };
}

// GET /permission-sets/catalog — 公开给已登录用户的权限目录（模块 + 支持的权限位），供前端渲染勾选表
export async function getPermissionCatalog(_req: Request, res: Response) {
  const modules = PERMISSION_MODULES.map(m => ({ module: m, actions: getModuleActions(m) }));
  return res.json({ success: true, data: { modules, allPermissions: ALL_PERMISSIONS } });
}

export async function createPermissionSetHandler(req: Request, res: Response) {
  const { orgId } = req.params;
  const { name, permissions } = req.body || {};
  if (!name || !Array.isArray(permissions)) {
    return res.status(400).json({ error: 'missing_required_fields', detail: 'name and permissions[] are required' });
  }
  try {
    const set = await createPermissionSet(orgId, name, permissions, getCaller(req));
    return res.status(201).json({ success: true, data: set });
  } catch (error) {
    return handleServiceError(res, error);
  }
}

export async function listPermissionSetsHandler(req: Request, res: Response) {
  const { orgId } = req.params;
  try {
    const sets = await listPermissionSets(orgId, getCaller(req));
    return res.json({ success: true, data: sets });
  } catch (error) {
    return handleServiceError(res, error);
  }
}

export async function updatePermissionSetHandler(req: Request, res: Response) {
  const { id } = req.params;
  const { name, permissions } = req.body || {};
  try {
    const set = await updatePermissionSet(id, { name, permissions }, getCaller(req));
    return res.json({ success: true, data: set });
  } catch (error) {
    return handleServiceError(res, error);
  }
}

export async function deletePermissionSetHandler(req: Request, res: Response) {
  const { id } = req.params;
  try {
    await deletePermissionSet(id, getCaller(req));
    return res.json({ success: true });
  } catch (error) {
    return handleServiceError(res, error);
  }
}
