// src/routes/gateway.ts
import { Router } from 'express';
import { requireBearer } from '../middleware/bearer.js';
import { gatewayCheck } from '../controllers/gateway.js';

const router = Router();

/**
 * GET /auth/gateway-check
 * Traefik ForwardAuth 网关鉴权端点，供微服务网关校验 JWT 并透传身份信息
 */
router.get('/gateway-check', requireBearer, gatewayCheck);

export default router;
