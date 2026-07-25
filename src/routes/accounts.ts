import { Router } from 'express';
import { loginBackend, loginPOS, logout, me, createAccount, listAccounts, getAccount, updateAccount, deleteAccount, resetAccountPassword, resetAccountPin, changeOwnPassword } from '../controllers/account.js';
import { requireBearer } from '../middleware/bearer.js';
import { requireModulePermission } from '../middleware/permission.js';

const router = Router();
const requireAccounts = requireModulePermission('accounts');

// 登录（无需认证）
router.post('/login', loginBackend);
router.post('/login-pos', loginPOS);

// 登出（需要认证，操作自己的会话，不算"账号管理"）
router.post('/logout', requireBearer, logout);

// 我的信息（需要认证，查自己，不算"账号管理"）
router.get('/me', requireBearer, me);

// 账号管理（需要认证 + accounts 权限位）
router.post('/', requireBearer, requireAccounts, createAccount);
router.get('/', requireBearer, requireAccounts, listAccounts);
router.get('/:accountId', requireBearer, requireAccounts, getAccount);
router.patch('/:accountId', requireBearer, requireAccounts, updateAccount);
router.delete('/:accountId', requireBearer, requireAccounts, deleteAccount);

// 密码/PIN管理
// 改自己的密码不算"账号管理"，不加权限门；重置别人的密码/PIN 是管理动作，需要 accounts.edit
router.post('/change-password', requireBearer, changeOwnPassword);
router.post('/:accountId/reset-password', requireBearer, requireModulePermission('accounts', 'edit'), resetAccountPassword);
router.post('/:accountId/reset-pin', requireBearer, requireModulePermission('accounts', 'edit'), resetAccountPin);

export default router;


