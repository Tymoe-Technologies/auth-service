-- 远程授权按权限位筛选收件人
--
-- 原先批准邮件发给「有邮箱 + 开通后台登录 + ACTIVE」的所有员工，不看权限位，
-- 等于任何能登 Portal 的员工都能批准退款 —— 比现场 PIN 授权（要求 refunds.edit）
-- 松得多，两条授权路径口径不一致。
--
-- 加上 requiredPermission 后，发起时记录本次需要的权限位，只发给拥有它的账号。
-- 历史记录为空，按 refunds.edit 处理（这个功能原本就是为退款做的）。

ALTER TABLE "RemoteAuthRequest" ADD COLUMN "requiredPermission" TEXT;
