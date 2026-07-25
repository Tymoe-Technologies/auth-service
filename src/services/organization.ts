// src/services/organization.ts
import { prisma } from '../infra/prisma.js';
import { audit } from '../middleware/audit.js';

export interface CreateOrganizationRequest {
  userId: string; // 所有者(老板)
  orgName: string;
  orgType: 'MAIN' | 'BRANCH' | 'FRANCHISE';
  parentOrgId?: string; // MAIN 必须为空；BRANCH/FRANCHISE 必须提供 MAIN 父组织
  description?: string;
  location?: string; // 向后兼容
  street?: string;
  city?: string;
  province?: string;
  postalCode?: string;
  country?: string;
  latitude?: number;
  longitude?: number;
  phone?: string;
  email?: string;
}

// 从结构化字段拼接完整地址字符串
export function buildLocationString(fields: {
  street?: string | null;
  city?: string | null;
  province?: string | null;
  postalCode?: string | null;
  country?: string | null;
}): string | null {
  const parts: string[] = [];
  if (fields.street) parts.push(fields.street);
  if (fields.city) parts.push(fields.city);
  // 省份和邮编放在一起：如 "BC V6G 1C7"
  const provincePostal = [fields.province, fields.postalCode].filter(Boolean).join(' ');
  if (provincePostal) parts.push(provincePostal);
  if (fields.country) parts.push(fields.country);
  return parts.length > 0 ? parts.join(', ') : null;
}

export class OrganizationService {
  /**
   * 验证父组织是否合法
   * - MAIN: 不允许 parentOrgId
   * - BRANCH/FRANCHISE: 必须存在且为当前 userId 拥有的 MAIN 组织，且状态 ACTIVE
   */
  async validateParentOrg(params: {
    userId: string;
    orgType: 'MAIN' | 'BRANCH' | 'FRANCHISE';
    parentOrgId?: string;
  }): Promise<{ ok: boolean; error?: string }> {
    const { userId, orgType, parentOrgId } = params;
    if (orgType === 'MAIN') {
      if (parentOrgId) return { ok: false, error: 'main_org_must_not_have_parent' };
      return { ok: true };
    }

    if (!parentOrgId) return { ok: false, error: 'parent_org_required' };

    const parent = await prisma.organization.findFirst({
      where: {
        id: parentOrgId,
        userId,
        orgType: 'MAIN',
        status: 'ACTIVE',
      },
      select: { id: true },
    });

    if (!parent) return { ok: false, error: 'invalid_parent_org' };
    return { ok: true };
  }

  /**
   * 创建新组织（支持层级）
   */
  async createOrganization(request: CreateOrganizationRequest) {
    const validation = await this.validateParentOrg({
      userId: request.userId,
      orgType: request.orgType,
      parentOrgId: request.parentOrgId,
    });
    if (!validation.ok) {
      throw new Error(validation.error);
    }

    // 如果提供了结构化字段，自动拼接 location
    const location = request.street
      ? buildLocationString(request)
      : request.location;

    const organization = await prisma.organization.create({
      data: {
        userId: request.userId,
        orgName: request.orgName,
        orgType: request.orgType as any,
        parentOrgId: request.orgType === 'MAIN' ? null : request.parentOrgId!,
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
        email: request.email,
        status: 'ACTIVE',
      },
    });

    audit('org_created', {
      organizationId: organization.id,
      userId: request.userId,
      orgType: request.orgType,
      parentOrgId: organization.parentOrgId,
    });

    return organization;
  }

  /** 获取组织信息 */
  async getOrganization(organizationId: string) {
    return await prisma.organization.findUnique({ where: { id: organizationId } });
  }

  /**
   * 公开解析：通过 subdomain 或 UUID 找到主店，并返回主店 + 所有 children 门店
   * 用于消费者端前端启动时一次性获取品牌身份和门店列表（不含在线点单业务字段）
   *
   * @param slug subdomain（如 "sweet7"）或主店 UUID
   * @returns 主店及其所有 children，按 id asc 排序；找不到返回 null
   */
  async resolveBySlug(slug: string): Promise<{
    main: Awaited<ReturnType<typeof prisma.organization.findUnique>>;
    stores: Awaited<ReturnType<typeof prisma.organization.findMany>>;
  } | null> {
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(slug);

    // 先定位主店：UUID 直接查；否则按 subdomain 查（仅 MAIN 有 subdomain）
    const main = isUUID
      ? await prisma.organization.findUnique({ where: { id: slug } })
      : await prisma.organization.findFirst({ where: { subdomain: slug, orgType: 'MAIN' } });

    if (!main || main.status !== 'ACTIVE' || main.orgType !== 'MAIN') {
      return null;
    }

    // 取所有子门店（BRANCH/FRANCHISE），含 INACTIVE 由调用方/前端决定如何展示
    const branches = await prisma.organization.findMany({
      where: { parentOrgId: main.id, status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
    });

    return { main, stores: [main, ...branches] };
  }

  /**
   * 获取用户拥有的组织列表
   */
  async getUserOrganizations(userId: string) {
    const organizations = await prisma.organization.findMany({
      where: {
        userId,
        status: 'ACTIVE',
      },
      orderBy: { createdAt: 'asc' },
    });
    return organizations;
  }

  /**
   * 基础权限检查（考虑组织存在/状态/所有者/可选的组织类型）
   */
  async checkUserPermission(params: {
    userId: string;
    organizationId: string;
    requiredOrgType?: 'MAIN' | 'BRANCH' | 'FRANCHISE';
  }): Promise<{ hasAccess: boolean; reason?: string }> {
    const { userId, organizationId, requiredOrgType } = params;
    const org = await prisma.organization.findUnique({ where: { id: organizationId } });
    if (!org) return { hasAccess: false, reason: 'org_not_found' };
    if (org.status !== 'ACTIVE') return { hasAccess: false, reason: 'org_not_active' };
    if (org.userId !== userId) return { hasAccess: false, reason: 'access_denied' };
    if (requiredOrgType && org.orgType !== requiredOrgType) {
      return { hasAccess: false, reason: 'org_type_mismatch' };
    }
    return { hasAccess: true };
  }

  /** 更新组织信息 */
  async updateOrganization(organizationId: string, updates: {
    orgName?: string;
    description?: string;
    location?: string;
    street?: string;
    city?: string;
    province?: string;
    postalCode?: string;
    country?: string;
    latitude?: number;
    longitude?: number;
    phone?: string;
    email?: string;
  }) {
    // 如果提供了结构化字段，自动更新 location
    if (updates.street !== undefined) {
      updates.location = buildLocationString(updates) ?? undefined;
    }

    const organization = await prisma.organization.update({
      where: { id: organizationId },
      data: updates,
    });

    audit('organization_updated', {
      organizationId,
      updates,
    });

    return organization;
  }

  /** 暂停组织 */
  async suspendOrganization(organizationId: string, reason?: string) {
    await prisma.organization.update({
      where: { id: organizationId },
      data: { status: 'SUSPENDED' },
    });
    audit('organization_suspended', { organizationId, reason });
  }

  /** 激活组织 */
  async activateOrganization(organizationId: string) {
    await prisma.organization.update({
      where: { id: organizationId },
      data: { status: 'ACTIVE' },
    });
    audit('organization_activated', { organizationId });
  }

  /** 删除组织（软删除） */
  async deleteOrganization(organizationId: string) {
    await prisma.organization.update({
      where: { id: organizationId },
      data: { status: 'DELETED' },
    });
    audit('organization_deleted', { organizationId });
  }
}

export const organizationService = new OrganizationService();