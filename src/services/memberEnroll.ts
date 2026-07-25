// src/services/memberEnroll.ts
/**
 * 登录后异步通知 member service 懒注册会员
 * fire-and-forget：不阻塞登录流程，member service 不可用时静默忽略
 */

const MEMBER_SERVICE_URL = process.env.MEMBER_SERVICE_URL || 'http://localhost:7006';
const INTERNAL_SERVICE_KEY = process.env.INTERNAL_SERVICE_KEY || '';

export async function enrollMemberAsync(
  consumerId: string,
  phone: string,
  organizationId: string,
  profile?: { name?: string | null; email?: string | null },
): Promise<void> {
  if (!INTERNAL_SERVICE_KEY) return; // 未配置内部密钥，跳过

  const url = `${MEMBER_SERVICE_URL}/internal/members/enroll`;

  await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-service-api-key': INTERNAL_SERVICE_KEY,
    },
    body: JSON.stringify({
      consumerId,
      phone,
      organizationId,
      name: profile?.name ?? undefined,
      email: profile?.email ?? undefined,
    }),
  });
}
