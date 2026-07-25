// src/routes/permissionSets.ts
import { Router } from 'express';
import { requireBearer } from '../middleware/bearer.js';
import {
  getPermissionCatalog,
  updatePermissionSetHandler,
  deletePermissionSetHandler,
} from '../controllers/permissionSet.js';

const router = Router();

router.use(requireBearer);

// 权限目录：模块 + 每个模块支持的权限位，供前端渲染勾选表
router.get('/catalog', getPermissionCatalog);

router.put('/:id', updatePermissionSetHandler);
router.delete('/:id', deletePermissionSetHandler);

export default router;
