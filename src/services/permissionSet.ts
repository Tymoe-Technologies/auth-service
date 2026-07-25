// src/services/permissionSet.ts
import { prisma } from '../infra/prisma.js';
import { audit } from '../middleware/audit.js';
import { isValidPermission, LEGACY_DEFAULT_PERMISSIONS } from '../config/permissionCatalog.js';
import type { Account } from '@prisma/client';

/**
 * 解析某个 Account 实际拥有的权限位数组。
 * 加盟店 owner 现在是 User 身份（不受权限组约束，走 USER 全放行的通用逻辑），
 * 不会再有 accountType='OWNER' 的 Account 记录。
 * 有 permissionSetId 就查表，没有则用历史兜底权限。
 */
export async function resolveAccountPermissions(account: Pick<Account, 'permissionSetId'>): Promise<string[]> {
  if (!account.permissionSetId) return LEGACY_DEFAULT_PERMISSIONS;
  const set = await prisma.permissionSet.findUnique({ where: { id: account.permissionSetId } });
  return set?.permissions ?? LEGACY_DEFAULT_PERMISSIONS;
}

interface CallerContext {
  userType: 'USER' | 'ACCOUNT';
  sub: string;
}

/**
 * 校验调用者是否有权在该 orgId 下管理权限集：只有 USER（老板）本人能管——
 * 权限组管理本身涉及"能不能创造出比自己更高权限的组"这种越权风险，索性不让 ACCOUNT
 * 碰这一层，哪怕它拿到了 accounts.edit 也一样。ACCOUNT 调用一律 forbidden。
 */
async function assertCanManageOrg(orgId: string, caller: CallerContext) {
  const org = await prisma.organization.findUnique({ where: { id: orgId } });
  if (!org) throw new Error('org_not_found');

  if (caller.userType !== 'USER') throw new Error('forbidden');
  if (org.userId !== caller.sub) throw new Error('forbidden');
  return { org, callerPermissions: null as string[] | null };
}

function validatePermissions(permissions: string[]) {
  for (const p of permissions) {
    if (!isValidPermission(p)) throw new Error('invalid_permission');
  }
}

/** ACCOUNT 调用者不能创建/更新出超过自己已有权限位的集合，防止越权升级 */
function assertNoPrivilegeEscalation(requested: string[], callerPermissions: string[] | null) {
  if (callerPermissions === null) return; // USER 无限制
  const missing = requested.filter(p => !callerPermissions.includes(p));
  if (missing.length > 0) throw new Error('privilege_escalation');
}

export async function createPermissionSet(
  orgId: string,
  name: string,
  permissions: string[],
  caller: CallerContext
) {
  validatePermissions(permissions);
  const { callerPermissions } = await assertCanManageOrg(orgId, caller);
  assertNoPrivilegeEscalation(permissions, callerPermissions);

  const set = await prisma.permissionSet.create({
    data: { orgId, name, permissions },
  });
  audit('permission_set_created', { permissionSetId: set.id, orgId, callerSub: caller.sub });
  return set;
}

/**
 * 列出该 org 下的权限组——跟"管理权限组"是两回事：给员工创建/编辑账号时要从这里选一个
 * 权限组分配给对方，所以 ACCOUNT（需要 accounts.edit）也能查，但只返回自己权限的子集，
 * 前端下拉框里天然就看不到自己分配不了的权限组，不用等提交时才被 403 拒绝。
 */
export async function listPermissionSets(orgId: string, caller: CallerContext) {
  const org = await prisma.organization.findUnique({ where: { id: orgId } });
  if (!org) throw new Error('org_not_found');

  let callerPermissions: string[] | null = null;
  if (caller.userType === 'USER') {
    if (org.userId !== caller.sub) throw new Error('forbidden');
  } else {
    const account = await prisma.account.findUnique({ where: { id: caller.sub } });
    if (!account || account.orgId !== orgId) throw new Error('forbidden');
    callerPermissions = await resolveAccountPermissions(account);
    if (!callerPermissions.includes('accounts.edit')) throw new Error('forbidden');
  }

  const sets = await prisma.permissionSet.findMany({ where: { orgId }, orderBy: { createdAt: 'asc' } });
  if (callerPermissions === null) return sets;
  return sets.filter(s => s.permissions.every(p => callerPermissions!.includes(p)));
}

export async function updatePermissionSet(
  id: string,
  updates: { name?: string; permissions?: string[] },
  caller: CallerContext
) {
  const existing = await prisma.permissionSet.findUnique({ where: { id } });
  if (!existing) throw new Error('permission_set_not_found');

  const { callerPermissions } = await assertCanManageOrg(existing.orgId, caller);
  if (updates.permissions) {
    validatePermissions(updates.permissions);
    assertNoPrivilegeEscalation(updates.permissions, callerPermissions);
  }

  const set = await prisma.permissionSet.update({
    where: { id },
    data: {
      name: updates.name ?? undefined,
      permissions: updates.permissions ?? undefined,
    },
  });
  audit('permission_set_updated', { permissionSetId: id, callerSub: caller.sub });
  return set;
}

export async function deletePermissionSet(id: string, caller: CallerContext) {
  const existing = await prisma.permissionSet.findUnique({ where: { id } });
  if (!existing) throw new Error('permission_set_not_found');

  await assertCanManageOrg(existing.orgId, caller);
  // Account.permissionSetId 是 onDelete: SetNull，绑定过这个集合的账号会自动回退到历史兜底权限
  await prisma.permissionSet.delete({ where: { id } });
  audit('permission_set_deleted', { permissionSetId: id, callerSub: caller.sub });
}
