import { Router } from 'express';
import { sendCode, login, refresh, getProfile, updateProfile, setPassword, listAddresses, createAddress, deleteAddress } from '../controllers/consumer.js';
import { requireBearer } from '../middleware/bearer.js';

const router = Router();

// 公开端点（无需认证）
router.post('/send-code', sendCode);
router.post('/login', login);
router.post('/refresh', refresh);

// 需要认证的端点（Bearer Token，CONSUMER 类型）
router.get('/profile', requireBearer, getProfile);
router.patch('/profile', requireBearer, updateProfile);
router.post('/set-password', requireBearer, setPassword);

// 配送地址管理
router.get('/addresses', requireBearer, listAddresses);
router.post('/addresses', requireBearer, createAddress);
router.delete('/addresses/:id', requireBearer, deleteAddress);

export default router;
