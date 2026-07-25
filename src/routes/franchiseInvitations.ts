// src/routes/franchiseInvitations.ts
import { Router } from 'express';
import { requireBearer } from '../middleware/bearer.js';
import {
  getFranchiseInvitationPublic,
  acceptFranchiseInvitation,
  revokeFranchiseInvitation,
} from '../controllers/franchiseInvitation.js';

const router = Router();

// 公开路由：受邀人无需登录即可查看邀请信息 / 接受邀请
router.get('/:token', getFranchiseInvitationPublic);
router.post('/:token/accept', acceptFranchiseInvitation);

router.use(requireBearer);

// 主账户撤销邀请（发起邀请的入口在 organizations.ts 里，因为需要挂在 orgId 下面）
router.delete('/:id', revokeFranchiseInvitation);

export default router;
