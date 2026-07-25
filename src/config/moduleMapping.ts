/**
 * 资源类型到 Subscription Module Key 的映射
 * 用于调用 subscription-service 检查配额
 */

// 所有员工账号（Account）统一算一种坐席配额，不再按类型分档
export const STAFF_MODULE_KEY = 'staff';

export const DEVICE_MODULE_MAPPING: Record<string, string> = {
  KIOSK: 'kiosk',     // Kiosk 设备 - 需要配额
  POS: 'pos',         // POS 设备 - 需要配额
  TABLET: 'tablet',   // Tablet 设备 - 需要配额
};

// 增值功能模块（需要单独购买的 add-on）
export const ADDON_MODULE_KEYS = {
  MEMBER: 'member',   // 会员系统增值模块
} as const;

/**
 * 获取设备类型对应的 module key
 */
export function getDeviceModuleKey(deviceType: string): string | null {
  const normalizedType = deviceType.toUpperCase();
  return DEVICE_MODULE_MAPPING[normalizedType] ?? null;
}

/**
 * 检查设备类型是否需要配额检查
 */
export function deviceNeedsQuotaCheck(deviceType: string): boolean {
  return getDeviceModuleKey(deviceType) !== null;
}
