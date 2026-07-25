// src/services/device.ts
import { Device, Prisma } from '@prisma/client';
import { prisma } from '../infra/prisma.js';
import { audit } from '../middleware/audit.js';
import { deviceSessionService } from './deviceSession.js';

/**
 * Device Service
 * 负责Device设备管理的核心业务逻辑
 */
export class DeviceService {
  /**
   * 生成9位激活码（大写字母与数字）
   */
  generateActivationCode(): string {
    const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 9; i++) {
      const idx = Math.floor(Math.random() * charset.length);
      code += charset[idx];
    }
    return code;
  }

  /**
   * 生成9位deviceId（小写字母与数字）
   */
  generateDeviceId(): string {
    const charset = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let code = '';
    for (let i = 0; i < 9; i++) {
      const idx = Math.floor(Math.random() * charset.length);
      code += charset[idx];
    }
    return code;
  }

  /**
   * 生成唯一激活码（带唯一性检查）
   */
  private async generateUniqueActivationCode(): Promise<string> {
    // 最多尝试20次以避免极低概率的无限循环
    for (let attempt = 0; attempt < 20; attempt++) {
      const code = this.generateActivationCode();
      const exists = await prisma.device.findUnique({ where: { activationCode: code } });
      if (!exists) return code;
    }
    throw new Error('activation_code_generation_failed');
  }

  /**
   * 生成唯一deviceId（带唯一性检查）
   */
  private async generateUniqueDeviceId(): Promise<string> {
    // 最多尝试20次以避免极低概率的无限循环
    for (let attempt = 0; attempt < 20; attempt++) {
      const code = this.generateDeviceId();
      const exists = await prisma.device.findUnique({ where: { id: code } });
      if (!exists) return code;
    }
    throw new Error('device_id_generation_failed');
  }

  /**
   * 创建设备（PENDING 状态，生成唯一激活码和deviceId）
   */
  async createDevice(
    orgId: string,
    deviceType: 'POS' | 'KIOSK' | 'TABLET' | 'DISPLAY',
    deviceName: string,
    createdBy: string
  ): Promise<Device> {
    // 1. 校验组织存在与活跃
    const org = await prisma.organization.findUnique({ where: { id: orgId } });
    if (!org) {
      throw new Error('org_not_found');
    }
    if (org.status !== 'ACTIVE') {
      throw new Error('org_inactive');
    }

    // 2. 验证deviceName在组织内唯一
    const existingDevice = await prisma.device.findFirst({
      where: {
        orgId,
        deviceName,
        status: { notIn: ['DELETED'] },
      },
    });
    if (existingDevice) {
      throw new Error('deviceName_repeated');
    }

    // 3. 生成唯一的deviceId（9位小写字母数字）
    const deviceId = await this.generateUniqueDeviceId();

    // 4. 生成唯一激活码（9位大写字母数字）
    const activationCode = await this.generateUniqueActivationCode();

    // 5. 创建设备
    const device = await prisma.device.create({
      data: {
        id: deviceId,
        orgId,
        deviceType,
        deviceName,
        activationCode,
        status: 'PENDING',
      },
    });

    // 6. 审计
    audit('device_created', {
      deviceId: device.id,
      orgId,
      deviceType,
      deviceName,
      activationCode,
      createdBy,
      createdAt: new Date().toISOString(),
    });

    return device;
  }

  /**
   * 激活设备（id+activationCode）
   * 支持幂等操作：PENDING 或 ACTIVE 设备都可以激活
   * @returns { device, sessionToken } sessionToken 只返回一次
   */
  async activateDevice(
    deviceId: string,
    activationCode: string
  ): Promise<{ device: Device; sessionToken: string }> {
    // 1. 校验设备与激活码匹配
    const device = await prisma.device.findFirst({
      where: { id: deviceId, activationCode },
      include: { organization: true },
    });

    if (!device) {
      throw new Error('invalid_device_or_code');
    }

    // 2. 校验组织活跃
    if (!device.organization || device.organization.status !== 'ACTIVE') {
      throw new Error('org_inactive');
    }

    // 3. 支持幂等激活：PENDING 或 ACTIVE 都可以激活
    // 不再检查状态，允许重复激活

    const now = new Date();

    // 4. 创建或更新 DeviceSession（幂等）
    const { sessionToken, session } = await deviceSessionService.createOrUpdateSession(deviceId);

    // 5. 更新设备为 ACTIVE（如果还不是）
    const updated = await prisma.device.update({
      where: { id: device.id },
      data: {
        status: 'ACTIVE',
        activatedAt: device.status === 'PENDING' ? now : device.activatedAt, // 保留首次激活时间
      },
    });

    // 6. 审计
    audit('device_activated', {
      deviceId: device.id,
      orgId: device.orgId,
      deviceType: device.deviceType,
      activatedAt: now.toISOString(),
      isReactivation: device.status === 'ACTIVE',
    });

    return { device: updated, sessionToken };
  }


  /**
   * 仅通过 activationCode 激活 DISPLAY 设备（无需 deviceId）
   */
  async activateByCode(
    activationCode: string
  ): Promise<{ device: Device; sessionToken: string }> {
    const device = await prisma.device.findFirst({
      where: { activationCode, deviceType: 'DISPLAY' },
      include: { organization: true },
    });

    if (!device) {
      throw new Error('invalid_activation_code');
    }

    if (!device.organization || device.organization.status !== 'ACTIVE') {
      throw new Error('org_inactive');
    }

    const now = new Date();
    const { sessionToken } = await deviceSessionService.createOrUpdateSession(device.id);

    const updated = await prisma.device.update({
      where: { id: device.id },
      data: {
        status: 'ACTIVE',
        activatedAt: device.status === 'PENDING' ? now : device.activatedAt,
      },
    });

    audit('device_activated', {
      deviceId: device.id,
      orgId: device.orgId,
      deviceType: device.deviceType,
      activatedAt: now.toISOString(),
      isReactivation: device.status === 'ACTIVE',
      method: 'activate_by_code',
    });

    return { device: updated, sessionToken };
  }

  /**
   * 更新激活码（仅 ACTIVE 设备；重置为 PENDING 并重置激活相关字段，可选更新设备名称）
   */
  async updateActivationCode(
    deviceId: string,
    orgId: string,
    deviceType: 'POS' | 'KIOSK' | 'TABLET' | 'DISPLAY',
    currentActivationCode: string,
    updatedBy: string,
    newDeviceName?: string
  ): Promise<{ device: Device; newActivationCode: string }> {
    // 1. 获取设备
    const device = await prisma.device.findUnique({ where: { id: deviceId } });
    if (!device) {
      throw new Error('device_not_found');
    }

    // 2. 基本校验
    if (device.orgId !== orgId || device.deviceType !== deviceType || device.activationCode !== currentActivationCode) {
      throw new Error('device_info_mismatch');
    }
    if (device.status !== 'ACTIVE') {
      throw new Error('device_not_active');
    }

    // 3. 如果提供了新设备名称，检查是否重复
    let finalDeviceName = device.deviceName; // 默认保留原名称
    if (newDeviceName && newDeviceName.trim().length > 0) {
      const trimmedName = newDeviceName.trim();
      // 检查新名称是否与其他设备重复（排除当前设备）
      const existingDevice = await prisma.device.findFirst({
        where: {
          orgId,
          deviceName: trimmedName,
          status: { notIn: ['DELETED'] },
          id: { not: deviceId }, // 排除当前设备
        },
      });
      if (existingDevice) {
        throw new Error('deviceName_repeated');
      }
      finalDeviceName = trimmedName;
    }

    // 4. 生成新激活码（唯一）
    const newCode = await this.generateUniqueActivationCode();

    // 5. 删除旧的 DeviceSession（如果存在）
    await deviceSessionService.deleteSession(deviceId);

    // 6. 回退为 PENDING 并重置激活相关字段（deviceName可选更新）
    const updated = await prisma.device.update({
      where: { id: deviceId },
      data: {
        status: 'PENDING',
        activationCode: newCode,
        deviceName: finalDeviceName,
        activatedAt: null,
      },
    });

    // 7. 审计
    audit('device_activation_code_updated', {
      deviceId,
      orgId,
      deviceType,
      previousActivationCode: currentActivationCode,
      newActivationCode: newCode,
      previousDeviceName: device.deviceName,
      newDeviceName: finalDeviceName,
      updatedBy,
      updatedAt: new Date().toISOString(),
    });

    return { device: updated, newActivationCode: newCode };
  }

}

// 导出单例
export const deviceService = new DeviceService();


