// src/controllers/organizations.ts
import { Request, Response } from 'express';
import { prisma } from '../infra/prisma.js';
import { audit } from '../middleware/audit.js';
import { isValidPhoneNumber } from 'libphonenumber-js';
import { buildLocationString, organizationService } from '../services/organization.js';
import { geocodeAddress } from '../services/geocoding.js';
import { uploadLogo, deleteLogo } from '../services/cloudinary.js';

// 验证邮箱格式
function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

// 验证组织名称
function validateOrgName(orgName: string): { valid: boolean; error?: string } {
  if (!orgName || orgName.trim().length < 2) {
    return { valid: false, error: 'Organization name must be at least 2 characters' };
  }
  if (orgName.length > 100) {
    return { valid: false, error: 'Organization name must not exceed 100 characters' };
  }
  return { valid: true };
}

// 验证 subdomain 格式（与消费者端前端规则一致：a-z0-9-, 长度 3-50）
function isValidSubdomain(subdomain: string): boolean {
  return /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/i.test(subdomain);
}

// 验证 customDomain 格式（简单域名校验）
function isValidCustomDomain(domain: string): boolean {
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(domain);
}

// 公开数据脱敏：去掉 userId 等内部字段
function toPublicOrg(org: any) {
  return {
    id: org.id,
    parentOrgId: org.parentOrgId,
    orgName: org.orgName,
    orgType: org.orgType,
    description: org.description,
    location: org.location,
    street: org.street,
    unit: org.unit,
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
    status: org.status,
  };
}

// 2.1 创建组织
export async function createOrganization(req: Request, res: Response) {
  const { orgName, orgType, parentOrgId, description, location, street, unit, city, province, postalCode, country, latitude, longitude, phone, email, timezone, businessHours, subdomain, customDomain, themeSettings } = req.body;
  const claims = (req as any).claims;
  const userId = claims?.sub;

  try {
    // 验证必填字段
    if (!orgName || !orgType) {
      return res.status(400).json({
        error: 'missing_required_fields',
        detail: 'orgName and orgType are required'
      });
    }

    // 验证 orgType
    if (!['MAIN', 'BRANCH', 'FRANCHISE'].includes(orgType)) {
      return res.status(400).json({
        error: 'invalid_org_type',
        detail: 'orgType must be MAIN, BRANCH, or FRANCHISE'
      });
    }

    // FRANCHISE 不再允许主账户直接创建，必须走加盟邀请流程（受邀人自主 onboarding）
    if (orgType === 'FRANCHISE') {
      return res.status(400).json({
        error: 'use_franchise_invitation',
        detail: 'FRANCHISE organizations can only be created by inviting a franchise owner via POST /organizations/:orgId/franchise-invitations'
      });
    }

    // 验证组织名称
    const nameValidation = validateOrgName(orgName);
    if (!nameValidation.valid) {
      return res.status(400).json({
        error: 'invalid_org_name',
        detail: nameValidation.error
      });
    }

    // 验证电话格式
    if (phone) {
      try {
        if (!isValidPhoneNumber(phone)) {
          return res.status(400).json({
            error: 'invalid_phone',
            detail: 'Phone number format is invalid. Please use international format (e.g., +16041234567)'
          });
        }
      } catch (e) {
        return res.status(400).json({
          error: 'invalid_phone',
          detail: 'Phone number format is invalid'
        });
      }
    }

    // 验证邮箱格式
    if (email && !isValidEmail(email)) {
      return res.status(400).json({
        error: 'invalid_email',
        detail: 'Email format is invalid'
      });
    }

    // 根据 orgType 验证 parentOrgId
    if (orgType === 'MAIN') {
      // MAIN 组织不能有父组织
      if (parentOrgId !== null && parentOrgId !== undefined) {
        return res.status(400).json({
          error: 'invalid_parent_org',
          detail: 'MAIN organization cannot have a parent organization'
        });
      }
      // 用户可以拥有多个不同品牌的 MAIN 组织（例如：既是7分甜的老板，又是名创优品的老板）
    } else {
      // BRANCH 或 FRANCHISE 必须有父组织
      if (!parentOrgId) {
        return res.status(400).json({
          error: 'missing_parent_org',
          detail: 'BRANCH and FRANCHISE organizations must have a parent organization'
        });
      }

      // 验证父组织
      const parentOrg = await prisma.organization.findUnique({
        where: { id: parentOrgId }
      });

      if (!parentOrg) {
        return res.status(400).json({
          error: 'invalid_parent_org',
          detail: 'Parent organization not found'
        });
      }

      if (parentOrg.userId !== userId) {
        return res.status(400).json({
          error: 'invalid_parent_org',
          detail: 'Parent organization must belong to you'
        });
      }

      if (parentOrg.orgType !== 'MAIN') {
        return res.status(400).json({
          error: 'invalid_parent_org',
          detail: 'Parent organization must be a MAIN organization'
        });
      }

      if (parentOrg.status !== 'ACTIVE') {
        return res.status(400).json({
          error: 'invalid_parent_org',
          detail: 'Parent organization must be active'
        });
      }
    }

    // 如果提供了结构化地址字段，自动拼接 location
    const computedLocation = street
      ? buildLocationString({ street, city, province, postalCode, country })
      : location?.trim() || null;

    // 经纬度：优先用显式传入的；缺失时用地址地理编码补上（失败为 null，不阻塞创建）
    let resolvedLat: number | null = latitude != null ? parseFloat(latitude) : null;
    let resolvedLng: number | null = longitude != null ? parseFloat(longitude) : null;
    if ((resolvedLat == null || resolvedLng == null) && computedLocation) {
      const geo = await geocodeAddress(computedLocation);
      if (geo) {
        resolvedLat = geo.latitude;
        resolvedLng = geo.longitude;
      }
    }

    // 品牌身份字段：仅 MAIN 允许设置 subdomain / customDomain
    let cleanSubdomain: string | null = null;
    let cleanCustomDomain: string | null = null;
    if (orgType === 'MAIN') {
      if (subdomain != null && subdomain !== '') {
        const trimmedSub = String(subdomain).trim().toLowerCase();
        if (!isValidSubdomain(trimmedSub)) {
          return res.status(400).json({
            error: 'invalid_subdomain',
            detail: 'Subdomain must be 3-50 chars, [a-z0-9-], start/end with alphanumeric'
          });
        }
        cleanSubdomain = trimmedSub;
      }
      if (customDomain != null && customDomain !== '') {
        const trimmedDomain = String(customDomain).trim().toLowerCase();
        if (!isValidCustomDomain(trimmedDomain)) {
          return res.status(400).json({ error: 'invalid_custom_domain', detail: 'Invalid domain format' });
        }
        cleanCustomDomain = trimmedDomain;
      }
    } else if (subdomain != null || customDomain != null) {
      return res.status(400).json({
        error: 'invalid_brand_field',
        detail: 'subdomain/customDomain can only be set on MAIN organization (branches inherit from parent)'
      });
    }

    // 创建组织
    let organization;
    try {
      organization = await prisma.organization.create({
        data: {
          userId,
          orgName: orgName.trim(),
          orgType: orgType as any,
          parentOrgId: parentOrgId || null,
          description: description?.trim() || null,
          location: computedLocation,
          street: street?.trim() || null,
          unit: unit?.trim() || null,
          city: city?.trim() || null,
          province: province?.trim() || null,
          postalCode: postalCode?.trim() || null,
          country: country?.trim() || null,
          latitude: resolvedLat,
          longitude: resolvedLng,
          phone: phone || null,
          email: email || null,
          timezone: timezone?.trim() || null,
          businessHours: businessHours ?? null,
          subdomain: cleanSubdomain,
          customDomain: cleanCustomDomain,
          themeSettings: themeSettings ?? null,
          status: 'ACTIVE'
        }
      });
    } catch (err: any) {
      // Prisma P2002: 唯一约束冲突
      if (err?.code === 'P2002') {
        const target = String(err?.meta?.target ?? '');
        if (target.includes('subdomain')) {
          return res.status(409).json({ error: 'subdomain_taken', detail: 'Subdomain already in use' });
        }
        if (target.includes('customDomain') || target.includes('custom_domain')) {
          return res.status(409).json({ error: 'custom_domain_taken', detail: 'Custom domain already in use' });
        }
      }
      throw err;
    }

    audit('org_created', {
      userId,
      orgId: organization.id,
      orgType
    });

    return res.status(201).json({
      success: true,
      message: 'Organization created successfully',
      data: {
        ...toPublicOrg(organization),
        createdAt: organization.createdAt,
        updatedAt: organization.updatedAt
      }
    });
  } catch (error) {
    console.error('Create organization error:', error);
    audit('org_create_error', { userId, error: String(error) });
    return res.status(500).json({ error: 'server_error' });
  }
}

// 2.2 获取用户的所有组织
export async function getOrganizations(req: Request, res: Response) {
  const claims = (req as any).claims;
  const userId = claims?.sub;
  const { orgType, status } = req.query;

  try {
    // 构建查询条件：
    // - USER（老板）：自己名下的组织 + 自己名下主店旗下的加盟店（owner 换成加盟商本人 User 后，
    //   主店仍需要在自己的组织列表里看到旗下所有加盟店，只是仅可见不可管理）
    // - ACCOUNT（员工）：不是任何组织的 owner（Organization.userId 永远不会等于员工的 id），
    //   只能看到自己所属的那一个组织——比如给新员工选组织时，下拉框至少要能看到自己所在的这家店
    let where: any;
    if (claims?.userType === 'ACCOUNT') {
      const account = await prisma.account.findUnique({ where: { id: userId }, select: { orgId: true } });
      where = { id: account?.orgId ?? '__none__' };
    } else {
      where = {
        OR: [
          { userId },
          { parent: { is: { userId } } }
        ]
      };
    }

    if (orgType && ['MAIN', 'BRANCH', 'FRANCHISE'].includes(orgType as string)) {
      where.orgType = orgType;
    }

    if (status && ['ACTIVE', 'SUSPENDED', 'DELETED'].includes(status as string)) {
      where.status = status;
    } else {
      // 默认只返回 ACTIVE
      where.status = 'ACTIVE';
    }

    // 查询组织列表
    const organizations = await prisma.organization.findMany({
      where,
      orderBy: [
        { orgType: 'asc' }, // MAIN 优先 (按字母排序 BRANCH < FRANCHISE < MAIN)
        { createdAt: 'asc' }
      ]
    });

    // 获取父组织信息
    const parentOrgIds = organizations
      .map(org => org.parentOrgId)
      .filter((id): id is string => !!id);

    const parentOrgs = parentOrgIds.length > 0
      ? await prisma.organization.findMany({
          where: { id: { in: parentOrgIds } },
          select: { id: true, orgName: true }
        })
      : [];

    const parentOrgMap = new Map(parentOrgs.map(org => [org.id, org.orgName]));

    // 主店需要看到旗下加盟店 owner 的账号信息（姓名/邮箱/电话），方便联系或核实身份；
    // 自己名下的组织（canManage===true）owner 就是自己，不用查
    const ownerUserIds = organizations
      .filter(org => org.userId !== userId)
      .map(org => org.userId);

    const ownerUsers = ownerUserIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: ownerUserIds } },
          select: { id: true, name: true, email: true, phone: true }
        })
      : [];

    const ownerUserMap = new Map(ownerUsers.map(u => [u.id, u]));

    // 完整信息对主店只读开放（含地址、联系方式、品牌资料）；canManage 只控制能不能编辑/删除，
    // 不影响能看到什么——加盟店旗下关系仅可见不可管理。
    const data = organizations.map(org => {
      const canManage = org.userId === userId;
      const owner = ownerUserMap.get(org.userId);
      return {
        ...toPublicOrg(org),
        canManage,
        ...(org.parentOrgId && { parentOrgName: parentOrgMap.get(org.parentOrgId) }),
        ...(!canManage && owner && {
          owner: { name: owner.name, email: owner.email, phone: owner.phone }
        }),
        createdAt: org.createdAt
      };
    });

    return res.json({
      success: true,
      data,
      total: data.length
    });
  } catch (error) {
    console.error('Get organizations error:', error);
    return res.status(500).json({ error: 'server_error' });
  }
}

// 2.3 获取单个组织详情
export async function getOrganization(req: Request, res: Response) {
  const { orgId } = req.params;
  const claims = (req as any).claims;
  const userId = claims?.sub;

  try {
    // 查询组织
    const organization = await prisma.organization.findUnique({
      where: { id: orgId }
    });

    if (!organization) {
      return res.status(404).json({
        error: 'org_not_found',
        detail: 'Organization not found'
      });
    }

    // 检查权限：组织所属的 USER（老板）本人、隶属于该组织的 ACCOUNT（员工）、
    // 或者该组织是自己名下主店旗下的加盟店（仅可见，不代表可管理）都可以查看
    const isOwner = organization.userId === userId;
    const isStaffOfOrg = claims?.userType === 'ACCOUNT' && claims?.organization?.id === orgId;
    let isParentOwner = false;
    if (!isOwner && !isStaffOfOrg && organization.parentOrgId) {
      const parent = await prisma.organization.findUnique({
        where: { id: organization.parentOrgId },
        select: { userId: true }
      });
      isParentOwner = parent?.userId === userId;
    }
    if (!isOwner && !isStaffOfOrg && !isParentOwner) {
      return res.status(403).json({
        error: 'access_denied',
        detail: "You don't have permission to access this organization"
      });
    }

    // 查询父组织信息（如果有）
    let parentOrgName: string | undefined;
    if (organization.parentOrgId) {
      const parentOrg = await prisma.organization.findUnique({
        where: { id: organization.parentOrgId },
        select: { orgName: true }
      });
      parentOrgName = parentOrg?.orgName;
    }

    // 统计子组织数量
    let statistics: { branchCount?: number; franchiseCount?: number } | undefined;
    if (organization.orgType === 'MAIN') {
      const [branchCount, franchiseCount] = await Promise.all([
        prisma.organization.count({
          where: {
            parentOrgId: organization.id,
            orgType: 'BRANCH',
            status: 'ACTIVE'
          }
        }),
        prisma.organization.count({
          where: {
            parentOrgId: organization.id,
            orgType: 'FRANCHISE',
            status: 'ACTIVE'
          }
        })
      ]);
      statistics = { branchCount, franchiseCount };
    }

    // 完整信息对主店只读开放；canManage 只控制能不能编辑/删除，不影响能看到什么
    const canManage = isOwner;

    // 主店查看旗下加盟店时，附带 owner 的账号信息（姓名/邮箱/电话）
    let owner: { name: string | null; email: string; phone: string | null } | undefined;
    if (!canManage && isParentOwner) {
      const ownerUser = await prisma.user.findUnique({
        where: { id: organization.userId },
        select: { name: true, email: true, phone: true }
      });
      if (ownerUser) owner = ownerUser;
    }

    return res.json({
      success: true,
      data: {
        ...toPublicOrg(organization),
        canManage,
        ...(parentOrgName && { parentOrgName }),
        ...(owner && { owner }),
        createdAt: organization.createdAt,
        updatedAt: organization.updatedAt,
        ...(canManage && statistics && { statistics })
      }
    });
  } catch (error) {
    console.error('Get organization error:', error);
    return res.status(500).json({ error: 'server_error' });
  }
}

// 2.4 更新组织信息
export async function updateOrganization(req: Request, res: Response) {
  const { orgId } = req.params;
  const { orgName, description, location, street, unit, city, province, postalCode, country, latitude, longitude, phone, email, timezone, businessHours, subdomain, customDomain, themeSettings } = req.body;
  const claims = (req as any).claims;
  const userId = claims?.sub;

  try {
    // 查询组织
    const organization = await prisma.organization.findUnique({
      where: { id: orgId }
    });

    if (!organization) {
      return res.status(404).json({
        error: 'org_not_found',
        detail: 'Organization not found'
      });
    }

    // 检查权限
    if (organization.userId !== userId) {
      return res.status(403).json({
        error: 'access_denied',
        detail: "You don't have permission to update this organization"
      });
    }

    // 验证字段格式
    if (orgName !== undefined) {
      const nameValidation = validateOrgName(orgName);
      if (!nameValidation.valid) {
        return res.status(400).json({
          error: 'invalid_org_name',
          detail: nameValidation.error
        });
      }
    }

    if (phone !== undefined && phone !== null) {
      try {
        if (!isValidPhoneNumber(phone)) {
          return res.status(400).json({
            error: 'invalid_phone',
            detail: 'Phone number format is invalid. Please use international format'
          });
        }
      } catch (e) {
        return res.status(400).json({
          error: 'invalid_phone',
          detail: 'Phone number format is invalid'
        });
      }
    }

    if (email !== undefined && email !== null && !isValidEmail(email)) {
      return res.status(400).json({
        error: 'invalid_email',
        detail: 'Email format is invalid'
      });
    }

    // 构建更新数据
    const updateData: any = {};
    if (orgName !== undefined) updateData.orgName = orgName.trim();
    if (description !== undefined) updateData.description = description?.trim() || null;
    if (street !== undefined) {
      updateData.street = street?.trim() || null;
      updateData.unit = unit?.trim() || null;
      updateData.city = city?.trim() || null;
      updateData.province = province?.trim() || null;
      updateData.postalCode = postalCode?.trim() || null;
      updateData.country = country?.trim() || null;
      // 自动拼接 location
      const newLocation = buildLocationString({ street, city, province, postalCode, country });
      updateData.location = newLocation;
      // 经纬度：优先用显式传入的；否则按新地址重新地理编码（地址已变，旧坐标作废）
      if (latitude != null && longitude != null) {
        updateData.latitude = parseFloat(latitude);
        updateData.longitude = parseFloat(longitude);
      } else {
        const geo = newLocation ? await geocodeAddress(newLocation) : null;
        updateData.latitude = geo ? geo.latitude : null;
        updateData.longitude = geo ? geo.longitude : null;
      }
    } else if (location !== undefined) {
      updateData.location = location?.trim() || null;
    }
    if (phone !== undefined) updateData.phone = phone || null;
    if (email !== undefined) updateData.email = email || null;
    if (timezone !== undefined) updateData.timezone = timezone?.trim() || null;
    if (businessHours !== undefined) updateData.businessHours = businessHours;

    // 品牌身份字段：仅 MAIN 可改 subdomain/customDomain
    if (subdomain !== undefined || customDomain !== undefined) {
      if (organization.orgType !== 'MAIN') {
        return res.status(400).json({
          error: 'invalid_brand_field',
          detail: 'subdomain/customDomain can only be set on MAIN organization'
        });
      }
    }
    if (subdomain !== undefined) {
      if (subdomain === null || subdomain === '') {
        updateData.subdomain = null;
      } else {
        const trimmedSub = String(subdomain).trim().toLowerCase();
        if (!isValidSubdomain(trimmedSub)) {
          return res.status(400).json({
            error: 'invalid_subdomain',
            detail: 'Subdomain must be 3-50 chars, [a-z0-9-], start/end with alphanumeric'
          });
        }
        updateData.subdomain = trimmedSub;
      }
    }
    if (customDomain !== undefined) {
      if (customDomain === null || customDomain === '') {
        updateData.customDomain = null;
      } else {
        const trimmedDomain = String(customDomain).trim().toLowerCase();
        if (!isValidCustomDomain(trimmedDomain)) {
          return res.status(400).json({ error: 'invalid_custom_domain', detail: 'Invalid domain format' });
        }
        updateData.customDomain = trimmedDomain;
      }
    }
    if (themeSettings !== undefined) {
      updateData.themeSettings = themeSettings ?? null;
    }

    // 更新组织
    let updatedOrg;
    try {
      updatedOrg = await prisma.organization.update({
        where: { id: orgId },
        data: updateData
      });
    } catch (err: any) {
      if (err?.code === 'P2002') {
        const target = String(err?.meta?.target ?? '');
        if (target.includes('subdomain')) {
          return res.status(409).json({ error: 'subdomain_taken', detail: 'Subdomain already in use' });
        }
        if (target.includes('customDomain') || target.includes('custom_domain')) {
          return res.status(409).json({ error: 'custom_domain_taken', detail: 'Custom domain already in use' });
        }
      }
      throw err;
    }

    audit('org_updated', {
      userId,
      orgId,
      updatedFields: Object.keys(updateData)
    });

    return res.json({
      success: true,
      message: 'Organization updated successfully',
      data: {
        ...toPublicOrg(updatedOrg),
        createdAt: updatedOrg.createdAt,
        updatedAt: updatedOrg.updatedAt
      }
    });
  } catch (error) {
    console.error('Update organization error:', error);
    return res.status(500).json({ error: 'server_error' });
  }
}

// 主店解除与旗下加盟店的关联：加盟店 owner 保留自己的账号/员工/菜单/设备等所有数据，
// 只是不再挂在这个品牌下面——parentOrgId 清空，orgType 从 FRANCHISE 升级为 MAIN，
// 变成一个完全独立的主店。只有该加盟店的父组织（MAIN）的 owner 本人能发起。
export async function dissociateFranchise(req: Request, res: Response) {
  const { orgId } = req.params;
  const claims = (req as any).claims;
  const userId = claims?.sub;

  try {
    const organization = await prisma.organization.findUnique({
      where: { id: orgId }
    });

    if (!organization) {
      return res.status(404).json({
        error: 'org_not_found',
        detail: 'Organization not found'
      });
    }

    if (organization.orgType !== 'FRANCHISE') {
      return res.status(400).json({
        error: 'not_a_franchise',
        detail: 'Only a FRANCHISE location can be dissociated'
      });
    }

    if (!organization.parentOrgId) {
      return res.status(400).json({
        error: 'already_independent',
        detail: 'This location is not associated with any parent organization'
      });
    }

    const parent = await prisma.organization.findUnique({
      where: { id: organization.parentOrgId },
      select: { userId: true }
    });

    if (!parent || parent.userId !== userId) {
      return res.status(403).json({
        error: 'access_denied',
        detail: "You don't have permission to dissociate this organization"
      });
    }

    const updatedOrg = await prisma.organization.update({
      where: { id: orgId },
      data: { orgType: 'MAIN', parentOrgId: null }
    });

    audit('franchise_dissociated', {
      userId,
      orgId,
      formerParentOrgId: organization.parentOrgId
    });

    return res.json({
      success: true,
      message: 'Franchise location has been dissociated and is now an independent main store',
      data: {
        ...toPublicOrg(updatedOrg),
        canManage: true,
        createdAt: updatedOrg.createdAt,
        updatedAt: updatedOrg.updatedAt
      }
    });
  } catch (error) {
    console.error('Dissociate franchise error:', error);
    return res.status(500).json({ error: 'server_error' });
  }
}

// 2.5 删除组织（软删除）
export async function deleteOrganization(req: Request, res: Response) {
  const { orgId } = req.params;
  const claims = (req as any).claims;
  const userId = claims?.sub;

  try {
    // 查询组织
    const organization = await prisma.organization.findUnique({
      where: { id: orgId }
    });

    if (!organization) {
      return res.status(404).json({
        error: 'org_not_found',
        detail: 'Organization not found'
      });
    }

    // 检查权限
    if (organization.userId !== userId) {
      return res.status(403).json({
        error: 'access_denied',
        detail: "You don't have permission to delete this organization"
      });
    }

    // 检查是否有活跃的子组织
    const activeChildren = await prisma.organization.count({
      where: {
        parentOrgId: orgId,
        status: 'ACTIVE'
      }
    });

    if (activeChildren > 0) {
      return res.status(400).json({
        error: 'has_active_children',
        detail: 'Cannot delete organization with active branches or franchises. Please delete them first.'
      });
    }

    // 软删除组织的同时，把该组织下还活跃的员工账号一并软删除——
    // 组织都没了，让用户先手动逐个删账号没有意义，直接级联处理
    const [, accountsResult] = await prisma.$transaction([
      prisma.organization.update({
        where: { id: orgId },
        data: { status: 'DELETED' }
      }),
      prisma.account.updateMany({
        where: { orgId, status: 'ACTIVE' },
        data: { status: 'DELETED' }
      })
    ]);

    audit('org_deleted', { userId, orgId, deletedAccountCount: accountsResult.count });

    return res.json({
      success: true,
      message: 'Organization deleted successfully'
    });
  } catch (error) {
    console.error('Delete organization error:', error);
    return res.status(500).json({ error: 'server_error' });
  }
}

// 2.6 公开解析：通过 subdomain 或 UUID 获取主店品牌信息 + 所有门店
// 用于消费者端前端启动时一次性获取品牌身份；不需要 JWT
export async function resolvePublic(req: Request, res: Response) {
  const { slug } = req.params;
  if (!slug) {
    return res.status(400).json({ error: 'missing_slug', detail: 'slug is required' });
  }

  try {
    const result = await organizationService.resolveBySlug(slug);
    if (!result || !result.main) {
      return res.status(404).json({ error: 'merchant_not_found', detail: 'No merchant found for this identifier' });
    }

    const { main, stores } = result;

    // 设置 CDN/浏览器缓存（5 分钟），与 order-service 的缓存策略一致
    res.set('Cache-Control', 'public, max-age=300, s-maxage=300');

    return res.json({
      success: true,
      data: {
        organizationId: main.id,
        slug: main.subdomain,
        merchantName: main.orgName,
        themeSettings: main.themeSettings,
        customDomain: main.customDomain,
        stores: stores.map(s => ({
          ...toPublicOrg(s),
          isMainStore: s.id === main.id,
        })),
      }
    });
  } catch (error) {
    console.error('Resolve public organization error:', error);
    return res.status(500).json({ error: 'server_error' });
  }
}

// 2.7 上传组织 Logo（仅 MAIN 组织可上传，子店/加盟店继承主店 logo）
export async function uploadOrgLogo(req: Request, res: Response) {
  try {
    const { orgId } = req.params;
    const claims = (req as any).claims;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: 'no_file', detail: 'Image file is required' });
    }

    const org = await prisma.organization.findUnique({ where: { id: orgId } });
    if (!org) {
      return res.status(404).json({ error: 'organization_not_found' });
    }

    // 仅主店可上传
    if (org.orgType !== 'MAIN') {
      return res.status(403).json({ error: 'forbidden', detail: 'Only MAIN organizations can upload a logo. Branch and franchise stores inherit the logo from their parent.' });
    }

    // 权限：必须是 org owner
    if (claims.userType === 'USER' && org.userId !== claims.sub) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const { url, publicId } = await uploadLogo(file.buffer, orgId);

    // 存入 themeSettings.logoUrl
    const currentTheme = (org.themeSettings as any) || {};
    await prisma.organization.update({
      where: { id: orgId },
      data: {
        themeSettings: { ...currentTheme, logoUrl: url, logoPublicId: publicId },
      },
    });

    audit('org_logo_uploaded', { orgId, url, publicId, actorId: claims.sub });

    return res.json({ success: true, logoUrl: url });
  } catch (error: any) {
    console.error('Upload org logo error:', error);
    return res.status(500).json({ error: 'upload_failed', detail: error.message });
  }
}

// 2.8 删除组织 Logo
export async function deleteOrgLogo(req: Request, res: Response) {
  try {
    const { orgId } = req.params;
    const claims = (req as any).claims;

    const org = await prisma.organization.findUnique({ where: { id: orgId } });
    if (!org) {
      return res.status(404).json({ error: 'organization_not_found' });
    }

    if (org.orgType !== 'MAIN') {
      return res.status(403).json({ error: 'forbidden', detail: 'Only MAIN organizations can manage the logo.' });
    }

    if (claims.userType === 'USER' && org.userId !== claims.sub) {
      return res.status(403).json({ error: 'forbidden' });
    }

    await deleteLogo(orgId);

    const currentTheme = (org.themeSettings as any) || {};
    delete currentTheme.logoUrl;
    delete currentTheme.logoPublicId;
    await prisma.organization.update({
      where: { id: orgId },
      data: { themeSettings: currentTheme },
    });

    audit('org_logo_deleted', { orgId, actorId: claims.sub });

    return res.json({ success: true });
  } catch (error: any) {
    console.error('Delete org logo error:', error);
    return res.status(500).json({ error: 'delete_failed', detail: error.message });
  }
}
