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

function requireTextArray(value, label, { min = 1, max = 20, itemMax = 120 } = {}) {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    throw cmsError('INVALID_CONTENT', `${label} 必须包含 ${min}—${max} 项`);
  }
  value.forEach((item, index) => requireText(item, `${label}.${index + 1}`, itemMax));
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

function synchronizeJourney(data) {
  if (!data || typeof data !== 'object') return data;
  if (data.card && data.hero) {
    data.hero.kicker = data.card.kicker;
    data.hero.title = data.card.title;
  }
  if (data.card && data.booking) data.booking.title = data.card.title;
  if (Array.isArray(data.days) && data.map && typeof data.map === 'object') {
    data.map.days = data.days.map((day) => ({
      number: day.number,
      title: day.title,
      route: day.route,
    }));
  }
  return data;
}

function validateJourney(data) {
  if (!data || typeof data !== 'object') throw cmsError('INVALID_CONTENT', '行程内容为空');
  if (data.schemaVersion !== 1) throw cmsError('INVALID_CONTENT', '内容版本不受支持');
  if (data.id !== 'kanto-6d') throw cmsError('INVALID_CONTENT', '当前后台只允许编辑关东6日行程');
  synchronizeJourney(data);
  requireText(data.productCode, '产品编号', 32);
  requireText(data.card?.kicker, '产品英文眉题', 80);
  requireText(data.card?.title, '产品标题', 80);
  requireText(data.card?.summary, '产品摘要', 500);
  requireTextArray(data.card?.meta, '产品标签', { min: 1, max: 6, itemMax: 30 });
  requireText(data.hero?.kicker, '首屏英文眉题', 80);
  requireText(data.hero?.title, '首屏标题', 80);
  requireText(data.hero?.copy, '首屏介绍', 500);
  requireText(data.hero?.status, '行程状态', 80);
  requireTextArray(data.hero?.breadcrumb, '首屏路径', { min: 1, max: 5, itemMax: 40 });
  requireTextArray(data.hero?.tags, '首屏标签', { min: 1, max: 8, itemMax: 30 });
  validateImage(data.hero?.image, '首屏图片');

  requireText(data.overview?.title, '行程概览标题', 100);
  requireText(data.overview?.copy, '行程概览说明', 700);
  requireText(data.overview?.route, '完整动线', 240);
  if (!Array.isArray(data.overview?.facts) || data.overview.facts.length !== 4) {
    throw cmsError('INVALID_CONTENT', '行程概览必须保留4项信息');
  }
  data.overview.facts.forEach((fact, index) => {
    requireText(fact?.label, `概览信息${index + 1}标签`, 30);
    requireText(fact?.value, `概览信息${index + 1}内容`, 120);
  });

  if (!Array.isArray(data.days) || data.days.length !== 6) {
    throw cmsError('INVALID_CONTENT', '关东6日行程必须包含6天');
  }
  data.days.forEach((day, index) => {
    const prefix = `第${index + 1}天`;
    requireText(day.number, `${prefix}编号`, 2);
    requireText(day.title, `${prefix}标题`, 80);
    requireText(day.route, `${prefix}路线`, 120);
    requireTextArray(day.stops, `${prefix}停靠点`, { min: 1, max: 10, itemMax: 50 });
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

  requireText(data.map?.title, '行程地图标题', 100);
  requireText(data.map?.copy, '行程地图说明', 700);
  requireText(data.map?.caption, '行程地图注释', 400);
  requireText(data.map?.alt, '行程地图替代文字', 220);
  validateAssetPath(data.map?.desktop, '桌面行程地图');
  validateAssetPath(data.map?.mobile, '手机行程地图');
  if (!Array.isArray(data.map?.days) || data.map.days.length !== data.days.length) {
    throw cmsError('INVALID_CONTENT', '地图逐日路线与每日行程不同步');
  }

  requireText(data.highlights?.title, '亮点区标题', 100);
  requireText(data.highlights?.copy, '亮点区说明', 500);
  if (!Array.isArray(data.highlights?.items) || data.highlights.items.length !== 4) {
    throw cmsError('INVALID_CONTENT', '亮点区必须保留4项内容');
  }
  data.highlights.items.forEach((item, index) => {
    requireText(item?.eyebrow, `亮点${index + 1}英文眉题`, 80);
    requireText(item?.title, `亮点${index + 1}标题`, 80);
    validateImage(item?.image, `亮点${index + 1}图片`);
  });

  requireText(data.stays?.title, '住宿区标题', 100);
  requireText(data.stays?.copy, '住宿区说明', 700);
  if (!Array.isArray(data.stays?.groups) || !data.stays.groups.length || data.stays.groups.length > 8) {
    throw cmsError('INVALID_CONTENT', '住宿区必须包含1—8组酒店');
  }
  data.stays.groups.forEach((group, index) => {
    requireText(group?.eyebrow, `住宿组${index + 1}区域`, 80);
    requireText(group?.title, `住宿组${index + 1}标题`, 80);
    requireTextArray(group?.hotels, `住宿组${index + 1}酒店`, { min: 1, max: 10, itemMax: 120 });
    requireText(group?.copy, `住宿组${index + 1}说明`, 500);
  });

  requireText(data.notes?.title, '行程说明标题', 100);
  requireText(data.notes?.copy, '行程总说明', 700);
  if (!Array.isArray(data.notes?.items) || !data.notes.items.length || data.notes.items.length > 10) {
    throw cmsError('INVALID_CONTENT', '行程说明必须包含1—10项内容');
  }
  data.notes.items.forEach((item, index) => {
    requireText(item?.title, `行程说明${index + 1}标题`, 50);
    requireText(item?.copy, `行程说明${index + 1}内容`, 500);
  });
  requireText(data.notes?.photoDisclaimer, '图片说明', 400);

  requireText(data.booking?.title, '咨询卡标题', 80);
  requireText(data.booking?.productGroup, '产品归属', 100);
  requireText(data.booking?.currentStatus, '当前状态', 80);
  requireText(data.booking?.departure, '出发日期', 100);
  requireText(data.booking?.price, '参考价格', 100);
  requireText(data.booking?.travelStyle, '旅行方式', 80);

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
  synchronizeJourney,
  validateJourney,
};
