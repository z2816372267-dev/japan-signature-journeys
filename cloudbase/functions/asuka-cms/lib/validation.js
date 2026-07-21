'use strict';

function cmsError(code, message, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function requireText(value, label, max = 1000) {
  if (typeof value !== 'string' || !value.trim()) {
    throw cmsError('INVALID_CONTENT', `${label} 不能为空`);
  }
  if (value.length > max) {
    throw cmsError('INVALID_CONTENT', `${label} 不能超过 ${max} 字`);
  }
}

function validateAssetPath(path, label) {
  requireText(path, label, 240);
  if (!/^images\/[a-zA-Z0-9_./-]+$/.test(path) || path.includes('..')) {
    throw cmsError('INVALID_CONTENT', `${label} 不是允许的图片路径`);
  }
}

function validateImage(image, label, optional = false) {
  if (!image && optional) return;
  if (!image || typeof image !== 'object') {
    throw cmsError('INVALID_CONTENT', `${label} 缺少图片信息`);
  }
  for (const key of ['webp480', 'webp960', 'webp1600', 'fallback']) {
    validateAssetPath(image[key], `${label}.${key}`);
  }
  requireText(image.alt, `${label}.alt`, 120);
  if (!Number.isFinite(Number(image.width)) || !Number.isFinite(Number(image.height))) {
    throw cmsError('INVALID_CONTENT', `${label} 图片尺寸无效`);
  }
}

function validateJourney(data) {
  if (!data || typeof data !== 'object') throw cmsError('INVALID_CONTENT', '行程内容为空');
  if (data.schemaVersion !== 1) throw cmsError('INVALID_CONTENT', '内容版本不受支持');
  if (data.id !== 'kanto-6d') throw cmsError('INVALID_CONTENT', '当前后台只允许编辑关东6日行程');
  requireText(data.productCode, '产品编号', 32);
  requireText(data.card?.title, '产品标题', 80);
  requireText(data.card?.summary, '产品摘要', 500);
  requireText(data.hero?.copy, '首屏介绍', 500);
  validateImage(data.hero?.image, '首屏图片');

  if (!Array.isArray(data.days) || data.days.length !== 6) {
    throw cmsError('INVALID_CONTENT', '关东6日行程必须包含6天');
  }
  data.days.forEach((day, index) => {
    const prefix = `第${index + 1}天`;
    requireText(day.title, `${prefix}标题`, 80);
    requireText(day.route, `${prefix}路线`, 120);
    requireText(day.story, `${prefix}说明`, 1200);
    requireText(day.distance?.value, `${prefix}行车里程`, 120);
    requireText(day.duration?.value, `${prefix}预计驾驶时间`, 120);
    requireText(day.activity?.value, `${prefix}体力消耗`, 60);
    requireText(day.comfort?.value, `${prefix}舒适度`, 60);
    requireText(day.meals?.breakfast, `${prefix}早餐`, 200);
    requireText(day.meals?.lunch, `${prefix}午餐`, 200);
    requireText(day.meals?.dinner, `${prefix}晚餐`, 200);
    requireText(day.hotel, `${prefix}住宿`, 300);
    validateImage(day.image, `${prefix}图片`, true);
  });

  const serialized = JSON.stringify(data);
  if (Buffer.byteLength(serialized, 'utf8') > 200 * 1024) {
    throw cmsError('CONTENT_TOO_LARGE', '行程文字数据超过200KB限制');
  }
  return data;
}

function stripInternal(value) {
  if (Array.isArray(value)) return value.map(stripInternal);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !key.startsWith('_'))
      .map(([key, item]) => [key, stripInternal(item)]),
  );
}

function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) {
    throw cmsError('INVALID_EMAIL', '请输入有效的工作人员邮箱');
  }
  return email;
}

module.exports = {
  cmsError,
  normalizeEmail,
  stripInternal,
  validateJourney,
};
