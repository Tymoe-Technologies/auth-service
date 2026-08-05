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
 * 历史账号（没有 permissionSetId）的兜底权限：这次改动前 OWNER/MANAGER 本来就没有模块级区分，
 * 所以兜底给全部模块的 view+edit，保证上线不会让存量账号突然被限制。
 */
export const LEGACY_DEFAULT_PERMISSIONS: string[] = ALL_PERMISSIONS;
