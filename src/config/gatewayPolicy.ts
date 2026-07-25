// src/config/gatewayPolicy.ts
// 网关层「路径 x 角色」授权策略：由 gatewayCheck 在 ForwardAuth 阶段调用。
// 未命中任何规则的路径保持现状放行（不改变现有行为），只有显式列出的
// prefix 才会做角色限制——新增限制时只需要在 RULES 里加一行。

export type GatewayRole = 'USER' | 'ACCOUNT' | 'CONSUMER';

interface GatewayRule {
  prefix: string;
  allow: GatewayRole[];
}

const RULES: GatewayRule[] = [
  // 订阅/计费管理只对主账户（老板）开放，加盟店 OWNER/MANAGER 不该碰
  { prefix: '/api/subscription-service/', allow: ['USER'] },
];

/**
 * 判断某个角色是否允许访问给定 URI。
 * @param uri Traefik 转发过来的原始请求路径（X-Forwarded-Uri）
 * @param role 调用者角色
 */
export function evaluateGatewayPolicy(uri: string, role: GatewayRole): boolean {
  const rule = RULES.find(r => uri.startsWith(r.prefix));
  if (!rule) return true;
  return rule.allow.includes(role);
}
