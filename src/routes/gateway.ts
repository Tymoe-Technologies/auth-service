// src/routes/gateway.ts
import { Router } from 'express';
import { requireBearer } from '../middleware/bearer.js';
import { gatewayCheck } from '../controllers/gateway.js';

const router = Router();

/**
 * GET /auth/gateway-check
 *
 * Traefik ForwardAuth endpoint for microservices gateway
 *
 * This endpoint verifies the JWT token and returns custom headers
 * that Traefik will forward to downstream services.
 *
 * Authentication: Required (Bearer token)
 * Rate limiting: Should be applied at Traefik level
 */
router.get('/gateway-check', requireBearer, gatewayCheck);

export default router;
