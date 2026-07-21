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

export async function callCms(action, payload = {}) {
  const response = await app.callFunction({
    name: CMS_CONFIG.functionName,
    data: { action, ...payload },
  });
  const result = response?.result;
  if (!result?.ok) {
    throw new CmsApiError(result?.error?.code || 'REQUEST_FAILED', result?.error?.message || '后台请求失败');
  }
  return result.data;
}

export async function currentUser() {
  try {
    return await auth.getCurrentUser();
  } catch {
    return null;
  }
}

export async function requestEmailCode(email) {
  return auth.getVerification({ email });
}

export async function finishEmailLogin(email, verificationCode, verificationInfo) {
  if (verificationInfo?.is_user) {
    await auth.signInWithEmail({
      email,
      verificationCode,
      verificationInfo,
    });
  } else {
    const verified = await auth.verify({
      verification_id: verificationInfo.verification_id,
      verification_code: verificationCode,
    });
    await auth.signUp({
      email,
      verification_code: verificationCode,
      verification_token: verified.verification_token,
      name: email.split('@')[0],
    });
  }
  return currentUser();
}

export async function signOut() {
  await auth.signOut();
}
