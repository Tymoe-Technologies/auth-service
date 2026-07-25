import { Router } from 'express';
import {
  register,
  verify,
  resend,
  login,
  logout,
  forgotPassword,
  resetPassword,
  changePassword,
  resetPin,
  getProfile,
  updateProfile,
  changeEmail,
  verifyEmailChange,
  verifyToken,
  getMyAvatar,
  updateMyAvatar
} from '../controllers/identity.js';
import { requireBearer } from '../middleware/bearer.js';
import { createRateLimiter } from '../middleware/rate.js';
import { 
  dualLoginRateLimit, 
  dualRegistrationRateLimit, 
  dualPasswordResetRateLimit,
  dualVerificationRateLimit,
  markSuccessfulRequest
} from '../middleware/redisRate.js';
import { env } from '../config/env.js';

const router = Router();

// Rate limiters for identity endpoints using env configuration
const registerLimiter = createRateLimiter({
  windowMs: env.rateWindowSec * 1000,
  max: env.rateMaxRegister,
  message: { error: 'too_many_requests', detail: 'Registration rate limit exceeded' }
});

const resetLimiter = createRateLimiter({
  windowMs: env.rateWindowSec * 1000,
  max: env.rateMaxReset,
  message: { error: 'too_many_requests', detail: 'Password reset rate limit exceeded' }
});

const loginLimiter = createRateLimiter({
  windowMs: env.rateWindowSec * 1000,
  max: env.rateMaxLogin,
  message: { error: 'too_many_requests', detail: 'Login rate limit exceeded' }
});

// Identity management endpoints

// 移除 CAPTCHA 相关端点

// Registration and verification (enhanced with dual rate limiting)
// 第一部分：User 用户管理模块 (14个端点，严格对齐 API端点设计文档.md)

// 1.1 用户注册
router.post('/register', dualRegistrationRateLimit, markSuccessfulRequest, register);

// 1.2 邮箱验证
router.post('/verification', dualVerificationRateLimit, markSuccessfulRequest, verify);

// 1.3 重新发送验证码
router.post('/resend', resend);

// 1.4 用户登录 (不返回token,只返回用户信息和组织列表)
router.post('/login', dualLoginRateLimit, markSuccessfulRequest, login);

// 1.5 & 1.6 获取 OAuth Token & 刷新 Token (在 /oauth/token 端点，由 oidc.ts 处理)

// 1.7 用户登出
router.post('/logout', requireBearer, logout);

// 1.8 忘记密码
router.post('/forgot-password', dualPasswordResetRateLimit, markSuccessfulRequest, forgotPassword);

// 1.9 重置密码
router.post('/reset-password', resetPassword);

// 1.10 修改密码 (已登录)
router.post('/change-password', requireBearer, changePassword);

// 重置自己的 PIN 码（登录 POS 用的那个，仅 USER 身份）
router.post('/reset-pin', requireBearer, resetPin);

// 1.11 获取当前用户信息
router.get('/profile', requireBearer, getProfile);

// 1.12 更新用户信息
router.patch('/profile', requireBearer, updateProfile);

// 1.13 修改邮箱 (第1步: 请求验证码)
router.post('/change-email', requireBearer, changeEmail);

// 1.14 修改邮箱 (第2步: 确认验证码)
router.post('/verification-email-change', requireBearer, verifyEmailChange);

// POS 头像配置（ACCOUNT 员工 / USER 加盟店 owner 都支持，按 token 的 userType 分流）
router.get('/me/avatar', requireBearer, getMyAvatar);
router.patch('/me/avatar', requireBearer, updateMyAvatar);

// 1.15 Gateway ForwardAuth 验证端点（供 Traefik 调用，验证 token 并透传用户信息）
router.get('/verify', requireBearer, verifyToken);

export default router;