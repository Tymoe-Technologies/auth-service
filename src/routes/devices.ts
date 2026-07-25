import { Router } from 'express';
import { createDevice, activateDevice, activateDisplay, listDevices, getDevice, updateDevice, deleteDevice, updateActivationCode, getDeviceSession, validateDeviceSession } from '../controllers/device.js';
import { requireBearer } from '../middleware/bearer.js';
import { requireDeviceSession } from '../middleware/deviceSession.js';
import { requireModulePermission } from '../middleware/permission.js';

const router = Router();
const requireDevices = requireModulePermission('devices');

// 激活（无需认证，设备本身发起，不算"设备管理"）
router.post('/activate', activateDevice);
router.post('/activate-display', activateDisplay);

// 验证设备 session 是否仍然有效（只需 X-Device-ID + X-Session-Token 头），并返回组织 Logo
// POS 启动时调用，失效时前端清除本地激活并跳回激活页
router.get('/me/validate-session', requireDeviceSession, validateDeviceSession);

// 设备管理（需要认证 + devices 权限位）
router.post('/', requireBearer, requireDevices, createDevice);
router.get('/', requireBearer, requireDevices, listDevices);
router.get('/:deviceId', requireBearer, requireDevices, getDevice);
router.get('/:deviceId/session', requireBearer, requireDevices, getDeviceSession);
router.patch('/:deviceId', requireBearer, requireDevices, updateDevice);
router.delete('/:deviceId', requireBearer, requireDevices, deleteDevice);
router.post('/:deviceId/update-activation-code', requireBearer, requireDevices, updateActivationCode);

export default router;


