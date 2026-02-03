# Traefik 转发鉴权集成指南 (Tymoe 架构)

此文档详细说明了如何使用 `auth-service` 为整个微服务集群提供统一的网关级鉴权支持。

## 1. 核心接口说明

- **接口路径**: `GET /api/auth-service/v1/auth/gateway-check`
- **认证方式**: Bearer Token (JWT)
- **主要逻辑**: 
  - 验证 Token 合法性（包括有效期及黑名单检查）。
  - 识别请求主体类型（USER 客户、ACCOUNT 门店员工 或 DEVICE 设备）。
  - 将用户信息、权限角色和组织 ID 注入 HTTP Header，供下游业务服务（如 booking-service）直接使用。

## 2. 注入的 Header 字段 (下游服务可直接读取)

| Header 字段 | 说明 | 示例 |
| :--- | :--- | :--- |
| `X-User-Id` | 用户的唯一标识符 (sub) | `uuid-xxx-xxx` |
| `X-User-Type` | 主体类型：`USER` (订阅客户) 或 `ACCOUNT` (门店员工) | `USER` |
| `X-User-Role` | 权限角色：`OWNER`, `MANAGER`, `STAFF` | `OWNER` |
| `X-Org-Id` | 当前操作的门店/组织 ID | `org-123` |
| `X-Org-Name` | 组织名称 | `Tymoe Main Store` |
| `X-Device-Id` | (可选) POS/Kiosk 设备 ID | `dev-789` |
| `X-All-Org-Ids`| 用户关联的所有组织 ID (逗号分隔) | `org-1,org-2` |

## 3. 下游服务集成逻辑 (以 Booking Service 为例)

引入 Traefik 网关鉴权后，下游业务服务**不再需要**引入 JWT 校验库或持有密钥。只需从请求头中提取信息并进行业务判断：

```typescript
// 业务逻辑示例 (Node.js/Express)
const userRole = req.headers['x-user-role'];
const orgId = req.headers['x-org-id'];

// 仅限 OWNER 操作的逻辑
if (userRole !== 'OWNER') {
    return res.status(403).send('无权执行此操作');
}
```

## 4. Traefik 配置参考

在 `docker-compose.yml` 中，为需要鉴权的服务添加以下标签：

```yaml
labels:
  - "traefik.http.middlewares.auth-check.forwardauth.address=http://auth-service:3000/api/auth-service/v1/auth/gateway-check"
  - "traefik.http.middlewares.auth-check.forwardauth.trustForwardHeader=true"
  - "traefik.http.middlewares.auth-check.forwardauth.authResponseHeaders=X-User-Id,X-User-Type,X-User-Role,X-Org-Id,X-Org-Name"
```

---
*文档版本: 1.0 (2026-02-03)*
