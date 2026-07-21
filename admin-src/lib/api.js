import cloudbase from '@cloudbase/js-sdk';
import { CMS_CONFIG } from '../config.js';

const app = cloudbase.init({
  env: CMS_CONFIG.envId,
  region: CMS_CONFIG.region,
});

export const auth = app.auth({ persistence: 'local' });

export class CmsApiError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'CmsApiError';
    this.code = code;
  }
}

const ERROR_MESSAGES = Object.freeze({
  invalid_verification_code: '验证码不正确或已失效，请重新获取最新验证码。',
  verification_code_expired: '验证码已失效，请重新获取最新验证码。',
  invalid_grant: '验证码不正确或已失效，请重新获取最新验证码。',
  provider_not_enabled: 'CloudBase 尚未开启邮箱验证码登录。',
  login_method_disabled: 'CloudBase 尚未开启邮箱验证码登录。',
  registration_not_supported: 'CloudBase 当前未允许新用户注册，请检查邮箱登录配置。',
  permission_denied: '当前请求被 CloudBase 拒绝，请检查安全域名和云函数权限。',
  functions_time_limit_exceeded: '云函数实际超时时间仍然过短。请在 CloudBase 将 asuka-cms 的超时时间设为60秒并重新部署后再试。',
  function_time_limit_exceeded: '云函数实际超时时间仍然过短。请在 CloudBase 将 asuka-cms 的超时时间设为60秒并重新部署后再试。',
});

function serviceError(error, fallback) {
  if (error instanceof CmsApiError) return error;
  const directError = typeof error === 'string' ? error : '';
  const nestedError = typeof error?.error === 'string' ? error.error : '';
  const code = String(error?.code || error?.error_code || error?.error?.code || nestedError || directError || 'REQUEST_FAILED');
  const normalizedCode = code.toLowerCase();
  const detail = [error?.message, error?.error_description, error?.msg, error?.error?.message, nestedError, directError]
    .find((value) => typeof value === 'string' && value.trim());
  const embeddedTimeout = /FUNCTIONS?_TIME_LIMIT_EXCEEDED/i.test(detail || '')
    ? ERROR_MESSAGES.functions_time_limit_exceeded
    : '';
  const message = ERROR_MESSAGES[normalizedCode] || embeddedTimeout || detail || `${fallback}（${code}）`;
  return new CmsApiError(code, message);
}

export async function callCms(action, payload = {}) {
  try {
    const response = await app.callFunction({
      name: CMS_CONFIG.functionName,
      data: { action, ...payload },
    });
    const result = response?.result;
    if (!result?.ok) {
      throw new CmsApiError(result?.error?.code || 'REQUEST_FAILED', result?.error?.message || '后台请求失败');
    }
    return result.data;
  } catch (error) {
    throw serviceError(error, '连接飞鸟旅行后台失败');
  }
}

export async function currentUser() {
  try {
    return await auth.getCurrentUser();
  } catch {
    return null;
  }
}

export async function requestEmailCode(email) {
  try {
    return await auth.getVerification({ email });
  } catch (error) {
    throw serviceError(error, '验证码发送失败');
  }
}

export async function finishEmailLogin(email, verificationCode, verificationInfo) {
  if (!verificationInfo?.verification_id) {
    throw new CmsApiError('VERIFICATION_MISSING', '验证码请求已失效，请重新获取验证码。');
  }
  try {
    // CloudBase's passwordless helper performs both branches itself: existing
    // users are signed in and first-time users are registered, then signed in.
    await auth.signInWithEmail({
      email,
      verificationCode,
      verificationInfo,
    });
    return currentUser();
  } catch (error) {
    throw serviceError(error, '邮箱登录失败');
  }
}

export async function signOut() {
  await auth.signOut();
}
