import initialContent from '../content/journeys/kanto-6d.json';
import { CMS_CONFIG } from './config.js';
import {
  callCms,
  currentUser,
  finishEmailLogin,
  requestEmailCode,
  signOut,
} from './lib/api.js';
import { formatBytes, prepareResponsiveImage } from './lib/images.js';

const clone = (value) => (window.structuredClone ? structuredClone(value) : JSON.parse(JSON.stringify(value)));
const DEMO_MODE = new URLSearchParams(location.search).get('demo') === '1';
const LOCAL_DRAFT_KEY = 'asuka-cms:kanto-6d:draft';

const state = {
  actor: null,
  content: clone(initialContent),
  published: clone(initialContent),
  tab: 'overview',
  selectedDay: 0,
  device: 'desktop',
  dirty: false,
  saving: false,
  revision: 0,
  draftInfo: null,
  publishRequestId: null,
  verificationInfo: null,
  previewUrls: new Map(),
  history: [],
  staff: null,
  localSaveTimer: null,
  previewFrame: 0,
  modalReturnFocus: null,
};

const elements = {
  loginScreen: document.querySelector('#loginScreen'),
  loginForm: document.querySelector('#loginForm'),
  loginEmail: document.querySelector('#loginEmail'),
  loginCode: document.querySelector('#loginCode'),
  codeField: document.querySelector('#codeField'),
  sendCodeButton: document.querySelector('#sendCodeButton'),
  loginButton: document.querySelector('#loginButton'),
  loginMessage: document.querySelector('#loginMessage'),
  cmsApp: document.querySelector('#cmsApp'),
  editorCanvas: document.querySelector('#editorCanvas'),
  journeyPreview: document.querySelector('#journeyPreview'),
  previewStage: document.querySelector('#previewStage'),
  previewEyebrow: document.querySelector('#previewEyebrow'),
  previewTitle: document.querySelector('#previewTitle'),
  sectionTitle: document.querySelector('#sectionTitle'),
  sectionEyebrow: document.querySelector('#sectionEyebrow'),
  saveState: document.querySelector('#saveState'),
  saveButton: document.querySelector('#saveButton'),
  quickPublishButton: document.querySelector('#quickPublishButton'),
  profileInitial: document.querySelector('#profileInitial'),
  profileName: document.querySelector('#profileName'),
  profileRole: document.querySelector('#profileRole'),
  signOutButton: document.querySelector('#signOutButton'),
  mobileMenu: document.querySelector('#mobileMenu'),
  modalBackdrop: document.querySelector('#modalBackdrop'),
  modalContent: document.querySelector('#modalContent'),
  modalClose: document.querySelector('#modalClose'),
  toastRegion: document.querySelector('#toastRegion'),
};

const TAB_COPY = {
  overview: ['JOURNEY CONTENT', '产品概览'],
  days: ['DAY BY DAY', '每日行程'],
  highlights: ['VISUAL STORY', '亮点与图片'],
  stays: ['STAYS & NOTES', '酒店与说明'],
  publish: ['PUBLISH CENTER', '发布管理'],
  staff: ['TEAM ACCESS', '工作人员'],
};

const PREVIEW_COPY = {
  overview: ['LIVE WEBSITE', '产品概览预览'],
  days: ['LIVE WEBSITE', '每日行程预览'],
  highlights: ['LIVE WEBSITE', '亮点与图片预览'],
  stays: ['LIVE WEBSITE', '酒店与说明预览'],
  publish: ['PUBLISH STATUS', '发布状态检查'],
  staff: ['INTERNAL ACCESS', '工作人员状态'],
};

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function withBreaks(value) {
  return escapeHtml(value).replaceAll('\n', '<br>');
}

function stripClientInternal(value) {
  if (Array.isArray(value)) return value.map(stripClientInternal);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !key.startsWith('_'))
    .map(([key, item]) => [key, stripClientInternal(item)]));
}

function getPath(path) {
  return path.split('.').reduce((value, part) => value?.[part], state.content);
}

function setPath(path, value) {
  const parts = path.split('.');
  let target = state.content;
  parts.slice(0, -1).forEach((part, index) => {
    const next = parts[index + 1];
    if (target[part] == null) target[part] = /^\d+$/.test(next) ? [] : {};
    target = target[part];
  });
  target[parts[parts.length - 1]] = value;
  synchronizeContent(path);
}

function synchronizeContent(changedPath = '') {
  const content = state.content;
  if (content.card && content.hero && (!changedPath || changedPath === 'card.title' || changedPath === 'card.kicker')) {
    content.hero.title = content.card.title;
    content.hero.kicker = content.card.kicker;
    if (content.booking) content.booking.title = content.card.title;
  }
  if (Array.isArray(content.days) && content.map && (!changedPath || /^days\.\d+\.(number|title|route)$/.test(changedPath))) {
    content.map.days = content.days.map((day) => ({
      number: day.number,
      title: day.title,
      route: day.route,
    }));
  }
}

function imageUrl(path) {
  if (!path) return '';
  if (/^(blob:|data:|https?:)/.test(path)) return path;
  return `${CMS_CONFIG.publicSiteUrl}${String(path).replace(/^\//, '')}`;
}

function currentImageUrl(path, image) {
  return state.previewUrls.get(path) || imageUrl(image?.webp1600 || image?.fallback);
}

function field(label, path, options = {}) {
  const value = getPath(path) ?? '';
  const full = options.full === false ? '' : ' full';
  const max = options.max || 300;
  const help = options.help || '';
  const readonly = options.readonly ? ' readonly aria-readonly="true"' : '';
  const input = options.textarea
    ? `<textarea data-path="${escapeHtml(path)}" data-max="${max}" data-size="${escapeHtml(options.size || 'short')}" maxlength="${max}"${readonly}>${escapeHtml(value)}</textarea>`
    : `<input data-path="${escapeHtml(path)}" data-max="${max}" maxlength="${max}" value="${escapeHtml(value)}" type="${escapeHtml(options.type || 'text')}"${readonly} />`;
  return `<div class="field${full}">
    <label>${escapeHtml(label)}</label>
    ${input}
    <div class="field-help"><span>${escapeHtml(help)}</span><span data-counter-for="${escapeHtml(path)}">${String(value).length}/${max}</span></div>
  </div>`;
}

function arrayEditor(label, path, options = {}) {
  const items = getPath(path) || [];
  return `<div class="field full">
    <label>${escapeHtml(label)}</label>
    <div class="array-editor">
      ${items.map((item, index) => `<span class="array-chip"><input data-array-path="${escapeHtml(path)}" data-array-index="${index}" value="${escapeHtml(item)}" maxlength="${options.max || 80}" aria-label="${escapeHtml(label)} ${index + 1}" /><button data-remove-array="${escapeHtml(path)}" data-remove-index="${index}" type="button" aria-label="删除">×</button></span>`).join('')}
      <button class="add-chip" data-add-array="${escapeHtml(path)}" type="button">＋ 添加</button>
    </div>
    ${options.help ? `<div class="field-help"><span>${escapeHtml(options.help)}</span><span>${items.length}项</span></div>` : ''}
  </div>`;
}

function imageUploader(label, path, image, help) {
  const preview = currentImageUrl(path, image);
  const altPath = `${path}.alt`;
  const alt = image?.alt || '';
  return `<div class="field full">
    <span class="image-label">${escapeHtml(label)}</span>
    <div class="image-uploader" data-image-card="${escapeHtml(path)}">
      <div class="image-preview-thumb">
        ${preview ? `<img src="${escapeHtml(preview)}" alt="" />` : ''}
        <span>${image?._assetId ? '新图片 · 待发布' : image ? '当前官网图片' : '暂未设置'}</span>
      </div>
      <div class="image-controls">
        ${image ? `<input data-path="${escapeHtml(altPath)}" data-max="120" maxlength="120" value="${escapeHtml(alt)}" aria-label="图片说明" placeholder="请填写图片内容说明" />` : `<input data-image-alt="${escapeHtml(path)}" maxlength="120" value="" aria-label="图片说明" placeholder="先填写图片内容说明" />`}
        <label class="file-button">选择新图片<input data-image-upload="${escapeHtml(path)}" type="file" accept="image/jpeg,image/png,image/webp" /></label>
        <p>${escapeHtml(help || '自动生成480、960、1600像素WebP及JPEG备用图，兼顾中国大陆网络与手机端加载。')}</p>
      </div>
    </div>
  </div>`;
}

function sectionIntro(kicker, title, copy) {
  return `<header class="section-intro"><p class="editor-kicker">${escapeHtml(kicker)}</p><h2>${escapeHtml(title)}</h2><p>${escapeHtml(copy)}</p></header>`;
}

function formCard(title, copy, body) {
  return `<section class="form-card"><header class="form-card-head"><div><h3>${escapeHtml(title)}</h3>${copy ? `<p>${escapeHtml(copy)}</p>` : ''}</div></header>${body}</section>`;
}

function overviewFactEditor(index) {
  return `<div class="metric-editor"><small>OVERVIEW FACT ${index + 1}</small>
    <input data-path="overview.facts.${index}.label" data-max="30" maxlength="30" value="${escapeHtml(state.content.overview.facts[index]?.label || '')}" aria-label="概览信息${index + 1}英文标签" />
    <input data-path="overview.facts.${index}.value" data-max="120" maxlength="120" value="${escapeHtml(state.content.overview.facts[index]?.value || '')}" aria-label="概览信息${index + 1}内容" />
  </div>`;
}

function renderOverviewEditor() {
  return `<div class="editor-section">
    ${demoBanner()}
    ${sectionIntro('PRODUCT OVERVIEW', '关东山海6日', '这里控制产品卡片、详情页首屏、概览与右侧产品信息。文字保存为草稿后不会立即影响官网。')}
    ${formCard('产品卡片', '游客在关东产品列表中首先看到的内容。', `<div class="form-grid">
      ${field('英文眉题', 'card.kicker', { max: 80, full: false })}
      ${field('产品标题（换行处按回车）', 'card.title', { max: 80, full: false, textarea: true })}
      ${field('产品摘要', 'card.summary', { max: 300, textarea: true })}
      ${arrayEditor('产品标签', 'card.meta', { max: 30, help: '建议保留3项，手机端排列更规整。' })}
    </div>`)}
    ${formCard('详情页首屏', '首屏决定游客对产品的第一印象；标题与英文眉题会自动跟随产品卡片，避免多个位置内容不一致。', `<div class="form-grid">
      ${field('首屏标题（自动同步）', 'hero.title', { max: 80, full: false, textarea: true, readonly: true, help: '请在上方“产品标题”中修改。' })}
      ${field('行程状态', 'hero.status', { max: 80, full: false })}
      ${arrayEditor('首屏路径', 'hero.breadcrumb', { max: 40, help: '显示在详情页标题上方。' })}
      ${field('首屏介绍', 'hero.copy', { max: 420, textarea: true, size: 'long' })}
      ${arrayEditor('首屏标签', 'hero.tags', { max: 30 })}
      ${imageUploader('首屏主图', 'hero.image', state.content.hero.image)}
    </div>`)}
    ${formCard('行程概览', '概括路线逻辑与旅行节奏。', `<div class="form-grid">
      ${field('概览标题', 'overview.title', { max: 80, full: false })}
      ${field('完整动线', 'overview.route', { max: 220, full: false })}
      ${field('概览说明', 'overview.copy', { max: 500, textarea: true, size: 'long' })}
      <div class="metric-grid full">${state.content.overview.facts.map((_, index) => overviewFactEditor(index)).join('')}</div>
    </div>`)}
    ${formCard('行程地图', '地图图片保持已校准版本；这里维护地图标题和说明。逐日路线会自动跟随“每日行程”。', `<div class="form-grid">
      ${field('地图标题', 'map.title', { max: 100, full: false })}
      ${field('地图替代文字', 'map.alt', { max: 220, full: false })}
      ${field('地图介绍', 'map.copy', { max: 700, textarea: true, size: 'long' })}
      ${field('地图注释', 'map.caption', { max: 400, textarea: true })}
    </div>`)}
    ${formCard('产品信息', '用于详情页右侧咨询卡片；咨询卡标题自动跟随产品标题。', `<div class="form-grid">
      ${field('产品归属', 'booking.productGroup', { max: 100, full: false })}
      ${field('当前状态', 'booking.currentStatus', { max: 60, full: false })}
      ${field('出发日期', 'booking.departure', { max: 80, full: false })}
      ${field('参考价格', 'booking.price', { max: 80, full: false })}
      ${field('旅行方式', 'booking.travelStyle', { max: 80, full: false })}
    </div>`)}
  </div>`;
}

function metricEditor(dayPath, key, eyebrow, label) {
  const metric = getPath(`${dayPath}.${key}`);
  return `<div class="metric-editor"><small>${escapeHtml(eyebrow)} · ${escapeHtml(label)}</small>
    <input data-path="${dayPath}.${key}.value" data-max="120" maxlength="120" value="${escapeHtml(metric?.value || '')}" aria-label="${escapeHtml(label)}" />
    <input data-path="${dayPath}.${key}.note" data-max="160" maxlength="160" value="${escapeHtml(metric?.note || '')}" aria-label="${escapeHtml(label)}补充说明" placeholder="补充说明" />
  </div>`;
}

function renderDaysEditor() {
  const day = state.content.days[state.selectedDay];
  const path = `days.${state.selectedDay}`;
  return `<div class="editor-section">
    ${demoBanner()}
    ${sectionIntro('DAY BY DAY', '每日行程', '逐日编辑标题、路线、景点、文字、图片、行车里程与预计驾驶时间。里程和时间均指当天专车移动，不含游览、用餐和休息。')}
    <div class="day-tabs">${state.content.days.map((item, index) => `<button class="${index === state.selectedDay ? 'active' : ''}" data-select-day="${index}" type="button"><strong>DAY ${escapeHtml(item.number)}</strong><span>${escapeHtml(item.title.slice(0, 6))}</span></button>`).join('')}</div>
    ${formCard(`DAY ${day.number} · 基本内容`, '修改后右侧会立即显示当天预览。', `<div class="form-grid">
      ${field('当天标题', `${path}.title`, { max: 80, full: false })}
      ${field('当天路线', `${path}.route`, { max: 120, full: false })}
      ${arrayEditor('停靠点／体验', `${path}.stops`, { max: 50, help: '建议3—5项，按实际游览顺序填写。' })}
      ${field('行程描述', `${path}.story`, { max: 1200, textarea: true, size: 'long' })}
      ${imageUploader('当天主图', `${path}.image`, day.image, '建议横图，至少1200像素宽；系统会自动压缩并生成手机端版本。')}
    </div>`)}
    ${formCard('行车与体验参数', '机场日已分开显示羽田和成田；自由活动日不虚构统一车程。', `<div class="metric-grid">
      ${metricEditor(path, 'distance', 'DISTANCE', '行车里程')}
      ${metricEditor(path, 'duration', 'DURATION', '预计驾驶时间')}
      ${metricEditor(path, 'activity', 'ACTIVITY', '体力消耗')}
      ${metricEditor(path, 'comfort', 'COMFORT', '舒适度')}
    </div>`)}
    ${formCard('餐食、住宿与提示', '', `<div class="form-grid">
      ${field('早餐', `${path}.meals.breakfast`, { max: 200, full: false, textarea: true })}
      ${field('午餐', `${path}.meals.lunch`, { max: 200, full: false, textarea: true })}
      ${field('晚餐', `${path}.meals.dinner`, { max: 200, full: false, textarea: true })}
      ${field('住宿', `${path}.hotel`, { max: 300, full: false, textarea: true })}
      ${field('旅行提示（可留空）', `${path}.footnote`, { max: 700, textarea: true, size: 'long' })}
    </div>`)}
  </div>`;
}

function renderHighlightsEditor() {
  return `<div class="editor-section">
    ${demoBanner()}
    ${sectionIntro('VISUAL STORY', '亮点与图片', '维护四张旅行亮点卡片。更换图片后，后台会生成四个响应式版本，官网无需从第三方图片服务加载。')}
    ${formCard('亮点区标题', '', `<div class="form-grid">${field('标题', 'highlights.title', { max: 100, full: false })}${field('说明', 'highlights.copy', { max: 400, full: false, textarea: true })}</div>`)}
    ${state.content.highlights.items.map((item, index) => formCard(`亮点 ${String(index + 1).padStart(2, '0')}`, item.title, `<div class="form-grid">
      ${field('英文眉题', `highlights.items.${index}.eyebrow`, { max: 80, full: false })}
      ${field('中文标题', `highlights.items.${index}.title`, { max: 80, full: false })}
      ${imageUploader('亮点图片', `highlights.items.${index}.image`, item.image)}
    </div>`)).join('')}
  </div>`;
}

function renderStaysEditor() {
  return `<div class="editor-section">
    ${demoBanner()}
    ${sectionIntro('STAYS & NOTES', '酒店与说明', '维护酒店甄选、执行提醒与图片授权说明。酒店名称应与每日行程中的住宿字段保持一致。')}
    ${formCard('酒店甄选区', '', `<div class="form-grid">${field('标题', 'stays.title', { max: 100, full: false })}${field('说明', 'stays.copy', { max: 500, full: false, textarea: true })}</div>`)}
    ${state.content.stays.groups.map((group, index) => formCard(group.title, group.eyebrow, `<div class="form-grid">
      ${field('区域／入住日', `stays.groups.${index}.eyebrow`, { max: 80, full: false })}
      ${field('分组标题', `stays.groups.${index}.title`, { max: 80, full: false })}
      ${arrayEditor('酒店列表', `stays.groups.${index}.hotels`, { max: 120 })}
      ${field('选择说明', `stays.groups.${index}.copy`, { max: 400, textarea: true })}
    </div>`)).join('')}
    ${formCard('行程说明区', '', `<div class="form-grid">
      ${field('标题', 'notes.title', { max: 100, full: false })}
      ${field('总说明', 'notes.copy', { max: 500, full: false, textarea: true })}
      ${state.content.notes.items.map((item, index) => `${field(`说明 ${index + 1} 标题`, `notes.items.${index}.title`, { max: 50, full: false })}${field(`说明 ${index + 1} 内容`, `notes.items.${index}.copy`, { max: 400, full: false, textarea: true })}`).join('')}
      ${field('图片说明', 'notes.photoDisclaimer', { max: 300, textarea: true })}
    </div>`)}
  </div>`;
}

function renderPublishEditor() {
  const dirtyText = state.dirty ? '当前有尚未保存或发布的修改' : '当前草稿与最近保存状态一致';
  const history = state.history.length
    ? state.history.map((item) => `<div class="history-item"><div><strong>${escapeHtml(item.message || '更新官网行程')}</strong><span>${escapeHtml(item.publishedByName || item.publishedBy || '')} · ${formatDate(item.publishedAt)}</span></div><a href="${escapeHtml(item.commitUrl)}" target="_blank" rel="noopener">${escapeHtml(String(item.commitSha || '').slice(0, 7))} ↗</a></div>`).join('')
    : '<p>还没有后台发布记录。</p>';
  return `<div class="editor-section">
    ${demoBanner()}
    ${sectionIntro('PUBLISH CENTER', '发布管理', '草稿仅在后台可见；点击发布后，系统会生成静态官网文件并提交到 GitHub，GitHub Pages 通常会在1—3分钟内更新。')}
    <div class="publish-grid">
      <section class="publish-card"><small>DRAFT STATUS</small><h3>${state.dirty ? '有待处理修改' : '草稿已保存'}</h3><p>${dirtyText}</p><button class="secondary" data-save-draft type="button">保存当前草稿</button></section>
      <section class="publish-card"><small>LIVE WEBSITE</small><h3>飞鸟旅行官网</h3><p>发布不会让游客依赖后台数据库，官网继续以静态文件高速加载。</p><a class="primary" style="display:inline-flex;align-items:center;text-decoration:none" href="${CMS_CONFIG.publicSiteUrl}" target="_blank" rel="noopener">查看官网 ↗</a></section>
      <section class="publish-card full"><small>ONE-CLICK PUBLISH</small><h3>确认无误后更新官网</h3><p>系统会一并提交行程文字、响应式图片和静态页面。每次发布都有 GitHub 版本记录，可追溯和回退。</p><button class="primary admin-only" data-open-publish type="button">检查并发布官网</button></section>
      <section class="publish-card full"><small>PUBLISH HISTORY</small><h3>最近发布记录</h3><div class="history-list">${history}</div></section>
    </div>
  </div>`;
}

function renderStaffEditor() {
  const staff = state.staff?.staff || [];
  const invites = state.staff?.invites || [];
  const pendingInvites = invites.filter((invite) => invite.active);
  return `<div class="editor-section">
    ${demoBanner()}
    ${sectionIntro('TEAM ACCESS', '工作人员', '每位工作人员使用自己的邮箱登录。编辑可维护草稿和图片，管理员还可以发布官网及管理人员。')}
    ${formCard('邀请工作人员', '对方首次用该邮箱登录后，会自动加入飞鸟旅行后台。', `<form class="staff-form" id="staffInviteForm">
      <div><label for="staffEmail">工作邮箱</label><input id="staffEmail" type="email" required placeholder="name@example.com" /></div>
      <div><label for="staffRole">权限</label><select id="staffRole"><option value="editor">编辑</option><option value="admin">管理员</option></select></div>
      <button class="primary" type="submit">发送邀请</button>
    </form>`)}
    ${formCard('已加入人员', '可以调整权限或停用离职账号；系统会确保至少保留一位管理员。', `<div class="staff-list">${staff.length ? staff.map((person) => `<div class="staff-item staff-item--managed"><div><strong>${escapeHtml(person.name || person.email)}</strong><span>${escapeHtml(person.email)} · ${person.active === false ? '已停用' : '正常'}${person.uid === state.actor?.uid ? ' · 当前账号' : ''}</span></div><div class="staff-actions"><select data-staff-role="${escapeHtml(person.uid)}" aria-label="${escapeHtml(person.email)}的权限"><option value="editor"${person.role === 'admin' ? '' : ' selected'}>编辑</option><option value="admin"${person.role === 'admin' ? ' selected' : ''}>管理员</option></select><button class="secondary" data-save-staff="${escapeHtml(person.uid)}" data-active="${person.active === false ? 'false' : 'true'}" type="button">保存权限</button><button class="staff-toggle" data-toggle-staff="${escapeHtml(person.uid)}" data-next-active="${person.active === false ? 'true' : 'false'}" data-role="${person.role === 'admin' ? 'admin' : 'editor'}" type="button"${person.uid === state.actor?.uid ? ' disabled title="不能停用当前账号"' : ''}>${person.active === false ? '重新启用' : '停用账号'}</button></div></div>`).join('') : '<p>暂无人员记录。首位管理员登录后会自动出现。</p>'}</div>`)}
    ${formCard('待加入邮箱', '邀请在对方首次登录后会自动转为“已加入”，不再留在待处理列表。', `<div class="staff-list">${pendingInvites.length ? pendingInvites.map((invite) => `<div class="staff-item"><div><strong>${escapeHtml(invite.email)}</strong><span>等待首次登录 · ${formatDate(invite.createdAt)}</span></div><div class="staff-actions"><span class="role-badge">${invite.role === 'admin' ? '管理员' : '编辑'}</span><button class="staff-toggle" data-revoke-invite="${escapeHtml(invite.email)}" type="button">取消邀请</button></div></div>`).join('') : '<p>当前没有待加入邀请。</p>'}</div>`)}
  </div>`;
}

function demoBanner() {
  return DEMO_MODE ? '<div class="demo-banner">当前为本地演示模式：可以体验编辑和预览，但不会连接腾讯云或更新官网。</div>' : '';
}

function renderEditor() {
  const renderers = {
    overview: renderOverviewEditor,
    days: renderDaysEditor,
    highlights: renderHighlightsEditor,
    stays: renderStaysEditor,
    publish: renderPublishEditor,
    staff: renderStaffEditor,
  };
  elements.editorCanvas.innerHTML = renderers[state.tab]();
  bindEditorEvents();
  applyRoleVisibility();
}

function bindEditorEvents() {
  elements.editorCanvas.querySelectorAll('[data-path]').forEach((control) => {
    control.addEventListener('input', () => {
      setPath(control.dataset.path, control.value);
      const counter = elements.editorCanvas.querySelector(`[data-counter-for="${CSS.escape(control.dataset.path)}"]`);
      if (counter) counter.textContent = `${control.value.length}/${control.dataset.max}`;
      markDirty();
    });
  });

  elements.editorCanvas.querySelectorAll('[data-array-path]').forEach((control) => {
    control.addEventListener('input', () => {
      const items = getPath(control.dataset.arrayPath);
      items[Number(control.dataset.arrayIndex)] = control.value;
      markDirty();
    });
  });

  elements.editorCanvas.querySelectorAll('[data-remove-array]').forEach((button) => {
    button.addEventListener('click', () => {
      const items = getPath(button.dataset.removeArray);
      if (items.length <= 1) return showToast('至少保留一项', 'error');
      items.splice(Number(button.dataset.removeIndex), 1);
      markDirty();
      renderEditor();
    });
  });

  elements.editorCanvas.querySelectorAll('[data-add-array]').forEach((button) => {
    button.addEventListener('click', () => {
      getPath(button.dataset.addArray).push('');
      markDirty();
      renderEditor();
      const inputs = elements.editorCanvas.querySelectorAll(`[data-array-path="${CSS.escape(button.dataset.addArray)}"]`);
      inputs[inputs.length - 1]?.focus();
    });
  });

  elements.editorCanvas.querySelectorAll('[data-select-day]').forEach((button) => {
    button.addEventListener('click', () => {
      state.selectedDay = Number(button.dataset.selectDay);
      renderEditor();
      schedulePreview();
    });
  });

  elements.editorCanvas.querySelectorAll('[data-image-upload]').forEach((input) => {
    input.addEventListener('change', () => handleImageUpload(input));
  });

  elements.editorCanvas.querySelectorAll('[data-save-draft]').forEach((button) => button.addEventListener('click', saveDraft));
  elements.editorCanvas.querySelectorAll('[data-open-publish]').forEach((button) => button.addEventListener('click', openPublishModal));

  const staffForm = elements.editorCanvas.querySelector('#staffInviteForm');
  if (staffForm) staffForm.addEventListener('submit', inviteStaff);
  elements.editorCanvas.querySelectorAll('[data-save-staff]').forEach((button) => button.addEventListener('click', () => saveStaffAccess(button)));
  elements.editorCanvas.querySelectorAll('[data-toggle-staff]').forEach((button) => button.addEventListener('click', () => toggleStaffAccess(button)));
  elements.editorCanvas.querySelectorAll('[data-revoke-invite]').forEach((button) => button.addEventListener('click', () => revokeStaffInvite(button)));
}

function markDirty() {
  state.dirty = true;
  state.publishRequestId = null;
  updateSaveState();
  clearTimeout(state.localSaveTimer);
  state.localSaveTimer = setTimeout(saveLocalDraft, 450);
  schedulePreview();
}

function updateSaveState(message) {
  elements.saveState.classList.toggle('dirty', state.dirty && !state.saving);
  elements.saveState.classList.toggle('saving', state.saving);
  elements.saveState.lastChild.textContent = message || (state.saving ? '正在保存…' : state.dirty ? '有未保存修改' : '内容已同步');
}

function saveLocalDraft() {
  try {
    localStorage.setItem(LOCAL_DRAFT_KEY, JSON.stringify({
      content: state.content,
      savedAt: new Date().toISOString(),
      revision: state.revision,
      dirty: state.dirty,
    }));
  } catch {
    // Local storage is an extra recovery layer; server drafts remain authoritative.
  }
}

function restoreLocalDraft(serverUpdatedAt) {
  try {
    const cached = JSON.parse(localStorage.getItem(LOCAL_DRAFT_KEY) || 'null');
    if (!cached?.content || cached.content.id !== 'kanto-6d') return;
    const isNewer = !serverUpdatedAt || new Date(cached.savedAt) > new Date(serverUpdatedAt);
    if (isNewer && (cached.dirty === true || cached.dirty == null)) {
      state.content = cached.content;
      synchronizeContent();
      state.dirty = true;
      showToast('已恢复此设备上较新的未提交草稿');
    }
  } catch {
    localStorage.removeItem(LOCAL_DRAFT_KEY);
  }
}

function validateContentForPublish() {
  synchronizeContent();
  const errors = [];
  const content = state.content;
  if (!content.card?.title?.trim()) errors.push('产品标题不能为空');
  if (!content.card?.summary?.trim()) errors.push('产品摘要不能为空');
  if (!content.hero?.copy?.trim()) errors.push('首屏介绍不能为空');
  if (!content.overview?.title?.trim() || !content.overview?.copy?.trim() || !content.overview?.route?.trim()) errors.push('行程概览信息不完整');
  if (content.overview?.facts?.length !== 4 || content.overview.facts.some((fact) => !fact.label?.trim() || !fact.value?.trim())) errors.push('行程概览的4项信息必须填写完整');
  if (!content.map?.title?.trim() || !content.map?.copy?.trim() || !content.map?.caption?.trim() || !content.map?.alt?.trim()) errors.push('行程地图标题与说明不完整');
  if (content.highlights?.items?.length !== 4 || content.highlights.items.some((item) => !item.title?.trim() || !item.eyebrow?.trim() || !item.image?.alt)) errors.push('4项行程亮点必须填写完整');
  if (!content.stays?.groups?.length || content.stays.groups.some((group) => !group.title?.trim() || !group.hotels?.length)) errors.push('酒店甄选信息不完整');
  if (!content.notes?.items?.length || content.notes.items.some((item) => !item.title?.trim() || !item.copy?.trim())) errors.push('行程说明信息不完整');
  if (content.days.length !== 6) errors.push('必须保留6天行程');
  content.days.forEach((day, index) => {
    if (!day.title.trim()) errors.push(`第${index + 1}天标题不能为空`);
    if (!day.story.trim()) errors.push(`第${index + 1}天行程描述不能为空`);
    if (!day.distance?.value?.trim()) errors.push(`第${index + 1}天行车里程不能为空`);
    if (!day.duration?.value?.trim()) errors.push(`第${index + 1}天预计驾驶时间不能为空`);
    if (day.image && (!day.image.alt || !day.image.webp480 || !day.image.fallback)) errors.push(`第${index + 1}天图片信息不完整`);
  });
  return errors;
}

async function saveDraft() {
  const errors = validateContentForPublish();
  if (errors.length) return showToast(errors[0], 'error');
  if (DEMO_MODE) {
    state.dirty = false;
    updateSaveState();
    saveLocalDraft();
    schedulePreview();
    return showToast('演示模式：草稿已保存在此浏览器');
  }
  state.saving = true;
  updateSaveState();
  elements.saveButton.disabled = true;
  try {
    synchronizeContent();
    const result = await callCms('saveDraft', { content: state.content, revision: state.revision });
    state.revision = Number(result.revision) || state.revision;
    state.dirty = false;
    saveLocalDraft();
    updateSaveState(`已保存 ${formatTime(result.savedAt)}`);
    schedulePreview();
    showToast('草稿已安全保存');
  } catch (error) {
    updateSaveState('保存失败');
    if (error.code === 'DRAFT_CONFLICT') openDraftConflictModal(error.message);
    else showToast(error.message, 'error');
  } finally {
    state.saving = false;
    elements.saveButton.disabled = false;
    setTimeout(() => updateSaveState(), 2400);
  }
}

async function handleImageUpload(input) {
  const file = input.files?.[0];
  if (!file) return;
  const path = input.dataset.imageUpload;
  const card = input.closest('[data-image-card]');
  const controls = card.querySelector('.image-controls');
  const existing = getPath(path);
  const alternateInput = card.querySelector('[data-image-alt]');
  const alt = (existing?.alt || alternateInput?.value || '').trim();
  if (!alt) {
    input.value = '';
    alternateInput?.focus();
    return showToast('请先填写图片内容说明', 'error');
  }
  const progress = document.createElement('div');
  progress.className = 'upload-progress';
  progress.innerHTML = '<i></i><span>正在压缩并生成响应式图片…</span>';
  controls.append(progress);
  input.disabled = true;
  try {
    const prepared = await prepareResponsiveImage(file);
    progress.querySelector('span').textContent = `已优化为 ${formatBytes(prepared.outputBytes)}，正在安全上传…`;
    if (DEMO_MODE) {
      state.previewUrls.set(path, prepared.previewUrl);
      showToast(`演示图片处理完成：${prepared.original.width}×${prepared.original.height}`);
    } else {
      const staged = await callCms('stageAsset', {
        journeyId: state.content.id,
        alt,
        slug: prepared.slug,
        replacesAssetId: existing?._assetId || '',
        variants: prepared.variants,
      });
      setPath(path, staged.image);
      state.previewUrls.set(path, staged.previewUrl || prepared.previewUrl);
      showToast('新图片已暂存，发布官网后正式生效');
    }
    markDirty();
    renderEditor();
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    input.disabled = false;
    progress.remove();
  }
}

function schedulePreview() {
  cancelAnimationFrame(state.previewFrame);
  state.previewFrame = requestAnimationFrame(renderPreview);
}

function previewSectionTitle(kicker, title, copy) {
  return `<header class="preview-section-title"><small>${escapeHtml(kicker)}</small><h3>${escapeHtml(title)}</h3>${copy ? `<p>${escapeHtml(copy)}</p>` : ''}</header>`;
}

function previewMetric(eyebrow, label, metric) {
  const value = metric?.value || '待补充';
  const note = metric?.note || '';
  return `<div><small>${escapeHtml(eyebrow)}</small><strong>${escapeHtml(label)}：${escapeHtml(value)}</strong>${note ? `<span>${escapeHtml(note)}</span>` : ''}</div>`;
}

function renderOverviewPreview(data) {
  const hero = currentImageUrl('hero.image', data.hero.image);
  const mapImage = imageUrl(state.device === 'mobile' ? data.map.mobile : data.map.desktop);
  const facts = data.overview.facts || [];
  const bookingItems = [
    ['CURRENT STATUS', data.booking.currentStatus],
    ['DEPARTURE', data.booking.departure],
    ['REFERENCE PRICE', data.booking.price],
    ['TRAVEL STYLE', data.booking.travelStyle],
  ];
  return `<section class="preview-hero"${hero ? ` style="background-image:url('${escapeHtml(hero)}')"` : ''}>
      <div class="preview-hero-content"><small>${escapeHtml(data.hero.kicker)}</small><h2>${withBreaks(data.hero.title)}</h2><p>${escapeHtml(data.hero.copy)}</p><div class="preview-tags">${data.hero.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join('')}</div></div>
    </section>
    <div class="preview-content">
      ${previewSectionTitle('JOURNEY OVERVIEW', data.overview.title, data.overview.copy)}
      <div class="preview-route">${escapeHtml(data.overview.route)}</div>
      <div class="preview-facts">${facts.map((fact) => `<div><small>${escapeHtml(fact.label)}</small><strong>${escapeHtml(fact.value)}</strong></div>`).join('')}</div>
      <section class="preview-map-card"><small>ROUTE MAP</small><h4>${escapeHtml(data.map.title)}</h4><p>${escapeHtml(data.map.copy)}</p>${mapImage ? `<img src="${escapeHtml(mapImage)}" alt="${escapeHtml(data.map.alt)}" />` : ''}<span>${escapeHtml(data.map.caption)}</span></section>
      <aside class="preview-booking">
        <div><small>TRIP INFORMATION</small><h4>${withBreaks(data.booking.title || data.card.title)}</h4><p>${escapeHtml(data.hero.status)}</p></div>
        <dl>${bookingItems.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value || '待公布')}</dd></div>`).join('')}</dl>
      </aside>
    </div>`;
}

function renderDaysPreview(data) {
  const day = data.days[state.selectedDay] || data.days[0];
  const dayImage = currentImageUrl(`days.${state.selectedDay}.image`, day.image) || currentImageUrl('hero.image', data.hero.image);
  const meals = [
    ['BREAKFAST', '早餐', day.meals.breakfast],
    ['LUNCH', '午餐', day.meals.lunch],
    ['DINNER', '晚餐', day.meals.dinner],
    ['HOTEL', '住宿', day.hotel],
  ];
  return `<div class="preview-content preview-content--day">
      ${previewSectionTitle('DAY BY DAY', `DAY ${day.number} · ${day.title}`, '右侧正在显示左侧当前选中的当天内容。')}
      <div class="preview-day-index" aria-label="当前预览天数">${data.days.map((item, index) => `<span class="${index === state.selectedDay ? 'active' : ''}">${escapeHtml(item.number)}</span>`).join('')}</div>
      <article class="preview-day">
        <header class="preview-day-head"><small>DAY ${escapeHtml(day.number)}</small><h4>${escapeHtml(day.title)}</h4><span>${escapeHtml(day.route)}</span><div class="preview-stops">${day.stops.map((stop) => `<b>${escapeHtml(stop)}</b>`).join('')}</div></header>
        ${dayImage ? `<img src="${escapeHtml(dayImage)}" alt="" />` : ''}
        <div class="preview-day-body"><p>${escapeHtml(day.story)}</p><div class="preview-metrics">
          ${previewMetric('DISTANCE', '行车里程', day.distance)}
          ${previewMetric('DURATION', '预计驾驶时间', day.duration)}
          ${previewMetric('ACTIVITY', '体力消耗', day.activity)}
          ${previewMetric('COMFORT', '舒适度', day.comfort)}
        </div>
        <div class="preview-meals">${meals.map(([eyebrow, label, value]) => `<div><small>${escapeHtml(eyebrow)}</small><strong>${escapeHtml(label)}</strong><p>${withBreaks(value || '待确认')}</p></div>`).join('')}</div>
        ${day.footnote ? `<p class="preview-footnote">${escapeHtml(day.footnote)}</p>` : ''}
        </div>
      </article>
    </div>`;
}

function renderHighlightsPreview(data) {
  return `<div class="preview-content preview-content--highlights">
      ${previewSectionTitle('VISUAL STORY', data.highlights.title, data.highlights.copy)}
      <div class="preview-highlight-grid">${data.highlights.items.map((item, index) => {
        const image = currentImageUrl(`highlights.items.${index}.image`, item.image);
        return `<article class="preview-highlight-card${image ? '' : ' empty'}"${image ? ` style="background-image:url('${escapeHtml(image)}')"` : ''}><div><small>${escapeHtml(item.eyebrow)}</small><h4>${escapeHtml(item.title)}</h4></div></article>`;
      }).join('')}</div>
    </div>`;
}

function renderStaysPreview(data) {
  return `<div class="preview-content preview-content--stays">
      ${previewSectionTitle('STAYS & NOTES', data.stays.title, data.stays.copy)}
      <div class="preview-stay-grid">${data.stays.groups.map((group) => `<article class="preview-stay-card"><small>${escapeHtml(group.eyebrow)}</small><h4>${escapeHtml(group.title)}</h4><ul>${group.hotels.map((hotel) => `<li>${escapeHtml(hotel)}</li>`).join('')}</ul><p>${escapeHtml(group.copy)}</p></article>`).join('')}</div>
      <section class="preview-notes">
        ${previewSectionTitle('TRAVEL NOTES', data.notes.title, data.notes.copy)}
        <div class="preview-note-grid">${data.notes.items.map((item) => `<article><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.copy)}</p></article>`).join('')}</div>
        <p class="preview-disclaimer">${escapeHtml(data.notes.photoDisclaimer)}</p>
      </section>
    </div>`;
}

function renderPublishPreview(data) {
  const errors = validateContentForPublish();
  const latest = state.history[0];
  const checks = errors.length
    ? errors.slice(0, 4).map((error) => `<li class="warning">${escapeHtml(error)}</li>`).join('')
    : '<li>六天行程字段完整</li><li>行车里程与预计驾驶时间完整</li><li>响应式图片路径已准备</li><li>官网继续使用静态文件高速加载</li>';
  return `<header class="preview-system-head">
      <span class="preview-system-badge ${state.dirty ? 'warning' : ''}">${state.dirty ? '有待处理修改' : '草稿状态正常'}</span>
      <small>PUBLISH CENTER</small><h2>发布前状态一目了然</h2><p>这里是内部发布检查，不会作为官网页面展示给游客。</p>
    </header>
    <div class="preview-system-content">
      <div class="preview-status-grid">
        <article><small>DRAFT</small><strong>${state.dirty ? '尚未保存' : '已保存'}</strong><span>${state.dirty ? '请先保存草稿' : '可以继续发布检查'}</span></article>
        <article><small>CONTENT</small><strong>${data.days.length}天行程</strong><span>${data.highlights.items.length}项亮点 · ${data.stays.groups.length}组住宿</span></article>
        <article><small>VALIDATION</small><strong>${errors.length ? `${errors.length}项待完善` : '检查通过'}</strong><span>${errors.length ? '发布前需要处理' : '关键字段均已填写'}</span></article>
      </div>
      <section class="preview-system-card"><small>PRE-PUBLISH CHECK</small><h3>发布检查</h3><ul class="preview-check-list">${checks}</ul></section>
      <section class="preview-system-card"><small>LATEST PUBLISH</small><h3>最近发布</h3>${latest ? `<div class="preview-history"><strong>${escapeHtml(latest.message || '更新官网行程')}</strong><span>${escapeHtml(latest.publishedByName || latest.publishedBy || '')} · ${escapeHtml(formatDate(latest.publishedAt))}</span><b>${escapeHtml(String(latest.commitSha || '').slice(0, 7))}</b></div>` : '<p class="preview-empty">后台尚未读取到发布记录。</p>'}</section>
    </div>`;
}

function renderStaffPreview() {
  const staff = state.staff?.staff || (state.actor ? [state.actor] : []);
  const invites = (state.staff?.invites || []).filter((invite) => invite.active);
  const activeStaff = staff.filter((person) => person.active !== false);
  return `<header class="preview-system-head preview-system-head--staff">
      <span class="preview-system-badge">仅工作人员可见</span>
      <small>TEAM ACCESS</small><h2>账号与权限状态</h2><p>这里是内部权限概览，不会出现在飞鸟旅行官网。</p>
    </header>
    <div class="preview-system-content">
      <div class="preview-status-grid">
        <article><small>ACTIVE STAFF</small><strong>${activeStaff.length}人</strong><span>当前可正常使用后台</span></article>
        <article><small>PENDING</small><strong>${invites.length}人</strong><span>等待首次邮箱登录</span></article>
        <article><small>YOUR ROLE</small><strong>${state.actor?.role === 'admin' ? '管理员' : '编辑'}</strong><span>${escapeHtml(state.actor?.name || state.actor?.email || '当前账号')}</span></article>
      </div>
      <section class="preview-system-card"><small>ACTIVE TEAM</small><h3>已加入人员</h3><div class="preview-team-list">${activeStaff.length ? activeStaff.map((person) => `<div><span><strong>${escapeHtml(person.name || person.email)}</strong><small>${escapeHtml(person.email || '')}</small></span><b>${person.role === 'admin' ? '管理员' : '编辑'}</b></div>`).join('') : '<p class="preview-empty">暂无人员记录。</p>'}</div></section>
      <section class="preview-system-card"><small>PENDING INVITES</small><h3>待加入邮箱</h3><div class="preview-team-list">${invites.length ? invites.map((invite) => `<div><span><strong>${escapeHtml(invite.email)}</strong><small>${escapeHtml(formatDate(invite.createdAt))}</small></span><b>${invite.role === 'admin' ? '管理员' : '编辑'}</b></div>`).join('') : '<p class="preview-empty">当前没有待加入邀请。</p>'}</div></section>
    </div>`;
}

const previewRenderers = {
  overview: renderOverviewPreview,
  days: renderDaysPreview,
  highlights: renderHighlightsPreview,
  stays: renderStaysPreview,
  publish: renderPublishPreview,
  staff: renderStaffPreview,
};

function renderPreview() {
  const [eyebrow, title] = PREVIEW_COPY[state.tab];
  elements.previewEyebrow.textContent = eyebrow;
  elements.previewTitle.textContent = title;
  elements.journeyPreview.className = `journey-preview preview-${state.tab}${state.device === 'mobile' ? ' mobile' : ''}`;
  elements.journeyPreview.innerHTML = `<div class="preview-browser"><i></i><i></i><i></i></div>${previewRenderers[state.tab](state.content)}`;
}

async function loadHistory() {
  if (DEMO_MODE) return;
  try {
    const result = await callCms('history');
    state.history = result.items || [];
  } catch (error) {
    showToast(`发布记录读取失败：${error.message}`, 'error');
  }
}

async function loadStaff() {
  if (DEMO_MODE) {
    state.staff = { staff: [{ uid: 'demo', name: '演示管理员', email: 'demo@asuka.travel', role: 'admin', active: true }], invites: [] };
    return;
  }
  try {
    state.staff = await callCms('listStaff');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function selectTab(tab) {
  if (tab === 'staff' && state.actor?.role !== 'admin') return;
  state.tab = tab;
  document.querySelectorAll('.nav-item').forEach((button) => button.classList.toggle('active', button.dataset.tab === tab));
  [elements.sectionEyebrow.textContent, elements.sectionTitle.textContent] = TAB_COPY[tab];
  elements.cmsApp.classList.remove('sidebar-open');
  elements.mobileMenu.setAttribute('aria-expanded', 'false');
  renderEditor();
  renderPreview();
  elements.previewStage.scrollTo({ top: 0, behavior: 'smooth' });
  if (tab === 'publish') await loadHistory();
  if (tab === 'staff') await loadStaff();
  if (state.tab !== tab || !['publish', 'staff'].includes(tab)) return;
  renderEditor();
  renderPreview();
}

function openModal(html) {
  state.modalReturnFocus = document.activeElement;
  elements.modalContent.innerHTML = html;
  const title = elements.modalContent.querySelector('h2');
  if (title) title.id = 'modalTitle';
  elements.modalBackdrop.hidden = false;
  document.body.style.overflow = 'hidden';
  requestAnimationFrame(() => elements.modalContent.querySelector('button, a, input, select, textarea')?.focus());
}

function closeModal() {
  elements.modalBackdrop.hidden = true;
  elements.modalContent.innerHTML = '';
  document.body.style.overflow = '';
  state.modalReturnFocus?.focus?.();
  state.modalReturnFocus = null;
}

function openDraftConflictModal(message) {
  openModal(`<p class="editor-kicker">NEWER DRAFT FOUND</p><h2>有同事保存了更新版本</h2><p>${escapeHtml(message)}</p><div class="publish-checks"><div>✓ 你当前输入的内容仍保留在此页面和本机临时草稿中</div><div>✓ 系统没有覆盖同事的新版本</div></div><div class="modal-actions"><button class="secondary" data-close-modal type="button">先返回复制内容</button><button class="primary" id="reloadLatestDraft" type="button">读取同事的最新版</button></div>`);
  elements.modalContent.querySelector('[data-close-modal]').addEventListener('click', closeModal);
  elements.modalContent.querySelector('#reloadLatestDraft').addEventListener('click', reloadLatestDraft);
}

async function reloadLatestDraft() {
  const button = elements.modalContent.querySelector('#reloadLatestDraft');
  button.disabled = true;
  button.textContent = '正在读取…';
  try {
    const result = await callCms('getContent');
    state.content = clone(result.content || initialContent);
    state.published = clone(result.published || result.content || initialContent);
    state.draftInfo = result.draftInfo || null;
    state.revision = Number(result.draftInfo?.revision) || 0;
    state.dirty = false;
    state.publishRequestId = null;
    synchronizeContent();
    saveLocalDraft();
    closeModal();
    renderEditor();
    renderPreview();
    updateSaveState();
    showToast('已读取同事保存的最新草稿');
  } catch (error) {
    button.disabled = false;
    button.textContent = '重新读取';
    showToast(error.message, 'error');
  }
}

function openPublishModal() {
  if (state.actor?.role !== 'admin') return showToast('只有管理员可以发布官网', 'error');
  const errors = validateContentForPublish();
  if (errors.length) {
    openModal(`<p class="editor-kicker">CHECK REQUIRED</p><h2>发布前还需完善</h2><p>请先处理以下内容：</p><div class="publish-checks">${errors.slice(0, 8).map((error) => `<div>● ${escapeHtml(error)}</div>`).join('')}</div><div class="modal-actions"><button class="primary" data-close-modal type="button">返回修改</button></div>`);
    elements.modalContent.querySelector('[data-close-modal]').addEventListener('click', closeModal);
    return;
  }
  state.publishRequestId ||= window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  openModal(`<p class="editor-kicker">READY TO PUBLISH</p><h2>确认发布到飞鸟官网？</h2><p>本次会同时更新关东6日的文字、行车数据、响应式图片与静态页面。GitHub Pages 通常在1—3分钟内显示最新版。</p>
    <div class="publish-checks"><div>✓ 六天行程字段完整</div><div>✓ 手机与桌面图片路径有效</div><div>✓ 发布密钥只在云函数中使用</div></div>
    <div class="field full"><label for="publishMessage">本次提交说明</label><input id="publishMessage" maxlength="100" value="更新关东6日行程内容" /></div>
    <div class="modal-actions"><button class="secondary" data-close-modal type="button">取消</button><button class="primary" id="confirmPublish" type="button">确认发布官网</button></div>`);
  elements.modalContent.querySelector('[data-close-modal]').addEventListener('click', closeModal);
  elements.modalContent.querySelector('#confirmPublish').addEventListener('click', publishSite);
}

async function publishSite() {
  const button = elements.modalContent.querySelector('#confirmPublish');
  const message = elements.modalContent.querySelector('#publishMessage')?.value.trim();
  button.disabled = true;
  button.textContent = '正在生成并发布…';
  try {
    if (DEMO_MODE) {
      await new Promise((resolve) => setTimeout(resolve, 700));
      state.dirty = false;
      updateSaveState();
      schedulePreview();
      openModal('<p class="editor-kicker">DEMO COMPLETE</p><h2>演示发布完成</h2><p>正式环境会在这里显示 GitHub 提交地址和最新版官网地址。</p><div class="modal-actions"><button class="primary" data-close-modal type="button">完成</button></div>');
      elements.modalContent.querySelector('[data-close-modal]').addEventListener('click', closeModal);
      return;
    }
    synchronizeContent();
    const result = await callCms('publish', {
      content: state.content,
      message,
      revision: state.revision,
      requestId: state.publishRequestId,
    });
    if (result.draftAdvanced) {
      state.published = stripClientInternal(clone(state.content));
      state.publishRequestId = null;
      state.dirty = true;
      saveLocalDraft();
      updateSaveState('同事另有新草稿');
      schedulePreview();
      openModal(`<p class="editor-kicker">PUBLISHED · NEW DRAFT FOUND</p><h2>官网已发布，但同事又保存了新草稿</h2><p>官网已经收到你刚才确认的版本；为避免覆盖同事随后保存的内容，系统没有改写后台草稿。</p><div class="publish-checks"><div>✓ 官网版本 ${escapeHtml(result.sha.slice(0, 7))}</div><div>✓ 同事的新草稿已安全保留</div></div><div class="modal-actions"><button class="secondary" data-close-modal type="button">先保留当前页面</button><button class="primary" id="reloadLatestDraft" type="button">读取同事的最新版</button></div>`);
      elements.modalContent.querySelector('[data-close-modal]').addEventListener('click', closeModal);
      elements.modalContent.querySelector('#reloadLatestDraft').addEventListener('click', reloadLatestDraft);
      showToast('官网已发布；后台检测到同事的新草稿', 'error');
      return;
    }
    state.revision = Number(result.revision) || state.revision;
    state.dirty = false;
    state.content = stripClientInternal(state.content);
    state.published = clone(state.content);
    state.publishRequestId = null;
    saveLocalDraft();
    updateSaveState(`已发布 ${formatTime(result.publishedAt)}`);
    schedulePreview();
    openModal(`<p class="editor-kicker">PUBLISHED</p><h2>${result.alreadyCurrent ? '官网已经是相同内容' : '官网已提交更新'}</h2><p>${result.alreadyCurrent ? '系统识别到本次内容已经发布过，因此没有重复创建 GitHub 提交。' : 'GitHub Pages 正在生成最新版，通常需要1—3分钟。'}</p><div class="publish-checks"><div>✓ GitHub 版本 ${escapeHtml(result.sha.slice(0, 7))}</div><div>✓ 官网静态内容已确认</div></div><div class="modal-actions"><a class="secondary" style="display:inline-flex;align-items:center;text-decoration:none" href="${escapeHtml(result.commitUrl)}" target="_blank" rel="noopener">查看 GitHub</a><a class="primary" style="display:inline-flex;align-items:center;text-decoration:none" href="${escapeHtml(result.siteUrl)}" target="_blank" rel="noopener">打开最新版官网</a></div>`);
    showToast(result.alreadyCurrent ? '官网已经是最新版' : '官网更新已提交');
  } catch (error) {
    button.disabled = false;
    button.textContent = '重试发布';
    if (error.code === 'DRAFT_CONFLICT') openDraftConflictModal(error.message);
    else showToast(error.message, 'error');
  }
}

async function inviteStaff(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const email = form.querySelector('#staffEmail').value.trim();
  const role = form.querySelector('#staffRole').value;
  const button = form.querySelector('button');
  button.disabled = true;
  try {
    if (DEMO_MODE) {
      state.staff.invites.push({ email, role, active: true, createdAt: new Date().toISOString() });
    } else {
      await callCms('inviteStaff', { email, role });
      await loadStaff();
    }
    showToast('工作人员邮箱已加入授权列表');
    renderEditor();
    renderPreview();
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    button.disabled = false;
  }
}

async function saveStaffAccess(button) {
  const uid = button.dataset.saveStaff;
  const role = elements.editorCanvas.querySelector(`[data-staff-role="${CSS.escape(uid)}"]`)?.value || 'editor';
  const active = button.dataset.active !== 'false';
  button.disabled = true;
  try {
    if (DEMO_MODE) {
      const person = state.staff.staff.find((item) => item.uid === uid);
      if (person) Object.assign(person, { role, active });
    } else {
      await callCms('updateStaff', { uid, role, active });
      await loadStaff();
    }
    renderEditor();
    renderPreview();
    showToast('工作人员权限已更新');
  } catch (error) {
    button.disabled = false;
    showToast(error.message, 'error');
  }
}

async function toggleStaffAccess(button) {
  const uid = button.dataset.toggleStaff;
  const role = elements.editorCanvas.querySelector(`[data-staff-role="${CSS.escape(uid)}"]`)?.value || button.dataset.role || 'editor';
  const active = button.dataset.nextActive === 'true';
  button.disabled = true;
  try {
    if (DEMO_MODE) {
      const person = state.staff.staff.find((item) => item.uid === uid);
      if (person) Object.assign(person, { role, active });
    } else {
      await callCms('updateStaff', { uid, role, active });
      await loadStaff();
    }
    renderEditor();
    renderPreview();
    showToast(active ? '账号已重新启用' : '账号已停用');
  } catch (error) {
    button.disabled = false;
    showToast(error.message, 'error');
  }
}

async function revokeStaffInvite(button) {
  const email = button.dataset.revokeInvite;
  if (!confirm(`确定取消 ${email} 的后台邀请吗？`)) return;
  button.disabled = true;
  try {
    if (DEMO_MODE) {
      const invite = state.staff.invites.find((item) => item.email === email);
      if (invite) invite.active = false;
    } else {
      await callCms('revokeInvite', { email });
      await loadStaff();
    }
    renderEditor();
    renderPreview();
    showToast('邀请已取消');
  } catch (error) {
    button.disabled = false;
    showToast(error.message, 'error');
  }
}

function showToast(message, type = '') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  elements.toastRegion.append(toast);
  setTimeout(() => toast.remove(), 4200);
}

function formatDate(value) {
  if (!value) return '';
  try {
    return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  } catch {
    return value;
  }
}

function formatTime(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

function applyRoleVisibility() {
  document.querySelectorAll('.admin-only').forEach((element) => {
    element.hidden = state.actor?.role !== 'admin';
  });
}

async function initializeApp(actor) {
  state.actor = actor;
  elements.loginScreen.hidden = true;
  elements.cmsApp.hidden = false;
  elements.profileName.textContent = actor.name || actor.email;
  elements.profileInitial.textContent = (actor.name || actor.email || 'A').slice(0, 1).toUpperCase();
  elements.profileRole.textContent = actor.role === 'admin' ? '管理员' : '编辑';
  applyRoleVisibility();
  try {
    if (DEMO_MODE) {
      restoreLocalDraft(null);
    } else {
      const result = await callCms('getContent');
      state.content = clone(result.content || initialContent);
      state.published = clone(result.published || result.content || initialContent);
      state.draftInfo = result.draftInfo || null;
      state.revision = Number(result.draftInfo?.revision) || 0;
      restoreLocalDraft(result.draftInfo?.updatedAt);
    }
    synchronizeContent();
    renderEditor();
    renderPreview();
    updateSaveState();
  } catch (error) {
    elements.editorCanvas.innerHTML = `<div class="editor-section">${sectionIntro('SETUP REQUIRED', '后台服务尚未连接', error.message)}<section class="form-card"><p style="color:var(--muted);line-height:1.8">请确认 CloudBase 云函数、数据库集合和安全域名已经完成配置。</p></section></div>`;
    showToast(error.message, 'error');
  }
}

async function bootstrap() {
  if (DEMO_MODE) {
    await initializeApp({ uid: 'demo', email: 'demo@asuka.travel', name: '演示管理员', role: 'admin' });
    return;
  }
  try {
    const user = await currentUser();
    if (!user) return;
    const result = await callCms('me');
    await initializeApp(result.actor);
  } catch (error) {
    elements.loginMessage.textContent = error.message;
    await signOut().catch(() => {});
  }
}

let codeCountdown = 0;
let countdownTimer = null;

async function sendCode() {
  const email = elements.loginEmail.value.trim().toLowerCase();
  if (!elements.loginEmail.reportValidity()) return;
  elements.sendCodeButton.disabled = true;
  elements.loginMessage.textContent = '正在发送验证码…';
  try {
    state.verificationInfo = await requestEmailCode(email);
    elements.codeField.hidden = false;
    elements.loginButton.disabled = false;
    elements.loginCode.required = true;
    elements.loginCode.focus();
    elements.loginMessage.textContent = '验证码已发送，请检查收件箱和垃圾邮件。';
    codeCountdown = 60;
    clearInterval(countdownTimer);
    countdownTimer = setInterval(() => {
      codeCountdown -= 1;
      elements.sendCodeButton.textContent = codeCountdown > 0 ? `${codeCountdown}秒后重发` : '重新发送';
      if (codeCountdown <= 0) {
        clearInterval(countdownTimer);
        elements.sendCodeButton.disabled = false;
      }
    }, 1000);
  } catch (error) {
    elements.loginMessage.textContent = error.message || '验证码发送失败，请检查 CloudBase 邮箱登录设置。';
    elements.sendCodeButton.disabled = false;
  }
}

async function login(event) {
  event.preventDefault();
  const email = elements.loginEmail.value.trim().toLowerCase();
  const code = elements.loginCode.value.trim();
  if (!state.verificationInfo) return sendCode();
  if (!/^\d{6}$/.test(code)) {
    elements.loginMessage.textContent = '请输入6位数字验证码。';
    return;
  }
  elements.loginButton.disabled = true;
  elements.loginButton.textContent = '正在验证…';
  try {
    await finishEmailLogin(email, code, state.verificationInfo);
    const result = await callCms('me');
    await initializeApp(result.actor);
  } catch (error) {
    elements.loginMessage.textContent = error.message || '登录失败，请重新获取验证码。';
    if (error.code === 'NOT_ALLOWED') await signOut().catch(() => {});
  } finally {
    elements.loginButton.disabled = false;
    elements.loginButton.textContent = '进入后台';
  }
}

document.querySelectorAll('.nav-item').forEach((button) => button.addEventListener('click', () => selectTab(button.dataset.tab)));
document.querySelectorAll('[data-device]').forEach((button) => button.addEventListener('click', () => {
  state.device = button.dataset.device;
  document.querySelectorAll('[data-device]').forEach((item) => item.classList.toggle('active', item === button));
  renderPreview();
}));

elements.sendCodeButton.addEventListener('click', sendCode);
elements.loginForm.addEventListener('submit', login);
elements.saveButton.addEventListener('click', saveDraft);
elements.quickPublishButton.addEventListener('click', openPublishModal);
elements.signOutButton.addEventListener('click', async () => {
  if (state.dirty && !confirm('当前有未保存修改，确定退出吗？')) return;
  if (!DEMO_MODE) await signOut();
  location.href = location.pathname;
});
elements.mobileMenu.addEventListener('click', () => {
  const open = elements.cmsApp.classList.toggle('sidebar-open');
  elements.mobileMenu.setAttribute('aria-expanded', String(open));
});
elements.cmsApp.addEventListener('click', (event) => {
  if (event.target !== elements.cmsApp || !elements.cmsApp.classList.contains('sidebar-open')) return;
  elements.cmsApp.classList.remove('sidebar-open');
  elements.mobileMenu.setAttribute('aria-expanded', 'false');
});
elements.modalClose.addEventListener('click', closeModal);
elements.modalBackdrop.addEventListener('click', (event) => {
  if (event.target === elements.modalBackdrop) closeModal();
});
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (!elements.modalBackdrop.hidden) closeModal();
  else if (elements.cmsApp.classList.contains('sidebar-open')) {
    elements.cmsApp.classList.remove('sidebar-open');
    elements.mobileMenu.setAttribute('aria-expanded', 'false');
    elements.mobileMenu.focus();
  }
});
window.addEventListener('beforeunload', (event) => {
  if (!state.dirty) return;
  event.preventDefault();
  event.returnValue = '';
});

bootstrap();
