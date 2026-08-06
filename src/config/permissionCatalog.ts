// src/config/permissionCatalog.ts
// 细粒度权限目录：跨微服务的功能模块 x view/edit 权限位，供 Portal 和各服务共同引用。
// 没有预设档位——每个 PermissionSet 都是从空白开始手动勾选。

export const PERMISSION_MODULES = [
  'devices',
  'printSettings',
  'menuAvailability',
  'orders',
  'bookings',
  'members',
  'payments',
  'cashDrawer',
  'giftCards',
  'uberOperations',
  'reports',
  'menuCatalog',
  'recipesSupplies',
  'multiMenu',
  'bookingSetup',
  'loyaltyRewards',
  'salesChannels',
  'menuPricingCosts',
  'taxSettings',
  'refunds',
  'financialReports',
  'loyaltyProgram',
  'uberIntegration',
  'accounts',
  'settings',
] as const;

export type PermissionModule = typeof PERMISSION_MODULES[number];
export type PermissionAction = 'view' | 'edit';

// 每个模块支持的权限位；未列出的模块默认支持 ['view', 'edit']
const MODULE_ACTION_OVERRIDES: Partial<Record<PermissionModule, PermissionAction[]>> = {
  reports: ['view'],
  financialReports: ['view'],
  refunds: ['edit'],
  settings: ['view'], // POS 端"设置"入口的粗粒度门禁；进去之后各子项仍按各自模块的权限位控制
};

export function getModuleActions(module: PermissionModule): PermissionAction[] {
  return MODULE_ACTION_OVERRIDES[module] ?? ['view', 'edit'];
}

// 展开成完整的权限位列表，如 ["devices.view","devices.edit",...]
export const ALL_PERMISSIONS: string[] = PERMISSION_MODULES.flatMap(m =>
  getModuleActions(m).map(action => `${m}.${action}`)
);

export function isValidPermission(permission: string): boolean {
  return ALL_PERMISSIONS.includes(permission);
}

/**
 * 没有分配权限组的账号拥有的权限：空。
 *
 * 原先这里兜底给 ALL_PERMISSIONS，是为了让改造前的存量账号不被突然限制。
 * 但那意味着「没配权限组 = 拥有全部权限」，在二次授权场景下后果被放大——
 * 任何没配权限组的普通员工都能当经理用，替别人放行退款、无销售开箱。
 *
 * 确认无存量账号后改为空数组：没显式授予就是没有。
 * 副作用：新建账号必须分配权限组才能做事，这正是期望的行为。
 */
export const NO_PERMISSION_SET_DEFAULTS: string[] = [];

/** @deprecated 用 NO_PERMISSION_SET_DEFAULTS；保留别名避免遗漏引用 */
export const LEGACY_DEFAULT_PERMISSIONS = NO_PERMISSION_SET_DEFAULTS;
