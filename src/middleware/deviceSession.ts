import { Request, Response, NextFunction } from 'express';
import { deviceSessionService } from '../services/deviceSession.js';
import { prisma } from '../infra/prisma.js';

/**
 * 设备会话认证中间件
 * 基于 X-Device-ID + X-Session-Token 头部验证设备身份（无需用户登录）
 * 用于 POS 启动时主动验证本地设备激活是否在后端仍然有效
 *
 * 成功：将 device 对象挂在 req.device 上交给下游
 * 失败：返回 401 + 具体 errorCode，前端据此清除本地激活并跳回激活页
 */
export async function requireDeviceSession(req: Request, res: Response, next: NextFunction) {
  const deviceId = req.headers['x-device-id'] as string | undefined;
  const sessionToken = req.headers['x-session-token'] as string | undefined;

  if (!deviceId || !sessionToken) {
    return res.status(401).json({
      error: 'missing_device_credentials',
      code: 'missing_device_credentials',
      message: 'X-Device-ID and X-Session-Token headers are required',
    });
  }

  try {
    const device = await prisma.device.findUnique({ where: { id: deviceId } });
    if (!device) {
      return res.status(401).json({
        error: 'device_not_found',
        code: 'device_not_found',
        message: 'Device not registered',
      });
    }

    if (device.status !== 'ACTIVE') {
      return res.status(401).json({
        error: 'device_not_active',
        code: 'device_not_active',
        message: `Device status is ${device.status}`,
      });
    }

    const valid = await deviceSessionService.validateSessionToken(deviceId, sessionToken);
    if (!valid) {
      return res.status(401).json({
        error: 'invalid_session',
        code: 'invalid_session',
        message: 'Session token is invalid or revoked',
      });
    }

    (req as any).device = device;
    next();
  } catch (e: any) {
    console.error('[requireDeviceSession] error:', e);
    return res.status(500).json({
      error: 'server_error',
      code: 'server_error',
      message: 'Failed to validate device session',
    });
  }
}
