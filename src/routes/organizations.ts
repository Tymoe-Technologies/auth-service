// src/routes/organizations.ts
import { Router } from 'express';
import {
  createOrganization,
  getOrganizations,
  getOrganization,
  updateOrganization,
  deleteOrganization,
  dissociateFranchise,
  resolvePublic,
  uploadOrgLogo,
  deleteOrgLogo
} from '../controllers/organizations.js';
import { requireBearer } from '../middleware/bearer.js';
import { uploadSingleImage } from '../middleware/upload.js';
import { createFranchiseInvitation, listFranchiseInvitations } from '../controllers/franchiseInvitation.js';
import { createPermissionSetHandler, listPermissionSetsHandler } from '../controllers/permissionSet.js';

const router = Router();

// 公开端点（无需 JWT）必须在 requireBearer 之前注册
// 2.6 公开解析：消费者端前端启动用
router.get('/public/resolve/:slug', resolvePublic);

// 以下所有端点都需要认证
router.use(requireBearer);

// 2.1 创建组织
router.post('/', createOrganization);

// 2.2 获取用户的所有组织
router.get('/', getOrganizations);

// 2.3 获取单个组织详情
router.get('/:orgId', getOrganization);

// 2.4 更新组织信息
router.put('/:orgId', updateOrganization);

// 2.5 删除组织（软删除）
router.delete('/:orgId', deleteOrganization);

// 主店解除与旗下加盟店的关联（加盟店变成独立主店，数据不受影响）
router.post('/:orgId/dissociate', dissociateFranchise);

// 主账户对旗下 MAIN 组织发出加盟邀请 / 查看邀请列表
router.post('/:orgId/franchise-invitations', createFranchiseInvitation);
router.get('/:orgId/franchise-invitations', listFranchiseInvitations);

// 权限集：创建/列出该组织下的权限集（USER 或该组织自己的 ACCOUNT/OWNER 可管理）
router.post('/:orgId/permission-sets', createPermissionSetHandler);
router.get('/:orgId/permission-sets', listPermissionSetsHandler);

// 2.7 上传组织 Logo（仅 MAIN）
router.post('/:orgId/logo', uploadSingleImage, uploadOrgLogo);

// 2.8 删除组织 Logo
router.delete('/:orgId/logo', deleteOrgLogo);

export default router;
