import initialContent from '../content/journeys/kanto-6d.json';
import initialCatalog from '../content/journeys/index.json';
import initialHomepage from '../content/homepage.json';
import { CMS_CONFIG } from './config.js';
import {
  callCms,
  currentUser,
  finishEmailLogin,
  requestEmailCode,
  signOut,
} from './lib/api.js';
import { formatBytes, prepareResponsiveImage } from './lib/images.js';
import {
  JOURNEY_ID_PATTERN,
  REGIONS,
  SEASONS,
  addBlankDay,
  cloneValue,
  createJourneyFromTemplate,
  duplicateDay,
  moveDay,
  normalizeJourney,
  regionById,
  removeDay,
  seasonById,
} from './lib/journey-template.js';

const clone = cloneValue;
const DEMO_MODE = new URLSearchParams(location.search).get('demo') === '1';
const initialJourney = normalizeJourney(initialContent);

const RESOURCE_META = {
  homepage: {
    label: '官网首页',
    shortLabel: '首页',
    defaultMessage: '更新飞鸟旅行官网首页内容',
    initial: initialHomepage,
  },
  'kanto-6d': {
    label: '关东山海6日',
    shortLabel: '关东6日',
    defaultMessage: '更新关东6日行程内容',
    initial: initialJourney,
  },
};

function createResourceState(initial) {
  return {
    content: clone(initial),
    published: clone(initial),
    dirty: false,
    revision: 0,
    draftInfo: null,
    publishRequestId: null,
    previewUrls: new Map(),
    history: [],
    localSaveTimer: null,
    loaded: false,
  };
}

const state = {
  actor: null,
  resourceId: 'homepage',
  activeJourneyId: initialJourney.id,
  resources: {
    homepage: createResourceState(initialHomepage),
    'kanto-6d': createResourceState(initialJourney),
  },
  journeys: clone(initialCatalog.journeys || []),
  journeysLoaded: false,
  tab: 'home',
  selectedDay: 0,
  device: 'desktop',
  saving: false,
  verificationInfo: null,
  staff: null,
  previewFrame: 0,
  previewFocus: null,
  homepagePreviewSlide: 0,
  modalReturnFocus: null,
};

for (const property of ['content', 'published', 'dirty', 'revision', 'draftInfo', 'publishRequestId', 'previewUrls', 'history', 'localSaveTimer']) {
  Object.defineProperty(state, property, {
    configurable: false,
    enumerable: true,
    get() {
      return state.resources[state.resourceId][property];
    },
    set(value) {
      state.resources[state.resourceId][property] = value;
    },
  });
}

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
  sidebarClose: document.querySelector('#sidebarClose'),
  currentJourneyCard: document.querySelector('#currentJourneyCard'),
  currentJourneyName: document.querySelector('#currentJourneyName'),
  currentJourneyMeta: document.querySelector('#currentJourneyMeta'),
  currentJourneyStatus: document.querySelector('#currentJourneyStatus'),
  journeyStepList: document.querySelector('#journeyStepList'),
  previewLocation: document.querySelector('#previewLocation'),
  previewLocationTitle: document.querySelector('#previewLocationTitle'),
  previewLocationHint: document.querySelector('#previewLocationHint'),
  modalBackdrop: document.querySelector('#modalBackdrop'),
  modalContent: document.querySelector('#modalContent'),
  modalClose: document.querySelector('#modalClose'),
  toastRegion: document.querySelector('#toastRegion'),
};

const TAB_COPY = {
  home: ['HOMEPAGE CONTENT', '首页内容'],
  journeys: ['JOURNEY LIBRARY', '全部行程'],
  overview: ['JOURNEY CONTENT', '产品概览'],
  days: ['DAY BY DAY', '每日行程'],
  highlights: ['VISUAL STORY', '亮点与图片'],
  stays: ['STAYS & NOTES', '酒店与说明'],
  publish: ['PUBLISH CENTER', '预览与发布'],
  staff: ['TEAM ACCESS', '工作人员'],
};

const PREVIEW_COPY = {
  home: ['LIVE HOMEPAGE', '首页实时预览'],
  journeys: ['JOURNEY LIBRARY', '行程状态预览'],
  overview: ['LIVE WEBSITE', '产品概览预览'],
  days: ['LIVE WEBSITE', '每日行程预览'],
  highlights: ['LIVE WEBSITE', '亮点与图片预览'],
  stays: ['LIVE WEBSITE', '酒店与说明预览'],
  publish: ['PUBLISH STATUS', '预览与发布检查'],
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

function isJourneyResource(resourceId = state.resourceId) {
  return resourceId !== 'homepage';
}

function registerJourneyResource(item, initial = null) {
  const id = String(item?.id || initial?.id || '');
  if (!JOURNEY_ID_PATTERN.test(id)) return null;
  const title = String(item?.title || initial?.card?.title || id).replaceAll('\n', ' ');
  RESOURCE_META[id] = {
    label: title,
    shortLabel: title.length > 12 ? `${title.slice(0, 12)}…` : title,
    defaultMessage: `更新${title}行程`,
    initial: initial ? normalizeJourney(initial) : null,
  };
  if (!state.resources[id]) state.resources[id] = createResourceState(RESOURCE_META[id].initial);
  return state.resources[id];
}

initialCatalog.journeys?.forEach((item) => registerJourneyResource(
  item,
  item.id === initialJourney.id ? initialJourney : null,
));

function currentResourceMeta() {
  const stored = RESOURCE_META[state.resourceId] || {
    label: state.resourceId,
    shortLabel: state.resourceId,
    defaultMessage: `更新${state.resourceId}`,
    initial: null,
  };
  const liveTitle = isJourneyResource()
    ? String(state.resources[state.resourceId]?.content?.card?.title || '').replaceAll('\n', ' ').trim()
    : '';
  if (!liveTitle) return stored;
  return {
    ...stored,
    label: liveTitle,
    shortLabel: liveTitle.length > 12 ? `${liveTitle.slice(0, 12)}…` : liveTitle,
    defaultMessage: `更新${liveTitle}行程`,
  };
}

function currentJourneyId() {
  if (JOURNEY_ID_PATTERN.test(state.activeJourneyId || '')) return state.activeJourneyId;
  if (isJourneyResource()) return state.resourceId;
  return state.journeys[0]?.id || initialJourney.id || '';
}

function updateSidebarContext() {
  const resourceId = currentJourneyId();
  const resource = state.resources[resourceId];
  const item = state.journeys.find((journey) => journey.id === resourceId);
  const content = resource?.content;
  const hasJourney = Boolean(resourceId && (resource || item));
  const title = String(content?.card?.title || item?.title || '尚未选择行程').replaceAll('\n', ' ');
  const productCode = content?.productCode || item?.productCode || resourceId;
  const season = seasonById(content?.management?.season || item?.season || 'all');
  const daysCount = content?.days?.length || item?.daysCount || 0;
  const visibility = content?.management?.visibility || item?.visibility || 'hidden';
  let status = visibility === 'hidden' ? '官网隐藏' : '官网展示';
  let statusTone = visibility === 'hidden' ? 'hidden' : 'published';
  if (resource?.dirty) {
    status = '未保存';
    statusTone = 'dirty';
  } else if (item?.hasDraft || resource?.draftInfo) {
    status = '有草稿';
    statusTone = 'draft';
  }

  elements.currentJourneyCard.classList.toggle('is-empty', !hasJourney);
  elements.currentJourneyCard.dataset.status = statusTone;
  elements.currentJourneyName.textContent = hasJourney ? title : '尚未选择行程';
  elements.currentJourneyMeta.textContent = hasJourney
    ? [productCode, season.label, daysCount ? `${daysCount}天` : ''].filter(Boolean).join(' · ')
    : '请先从“行程管理”选择一项';
  elements.currentJourneyStatus.textContent = hasJourney ? status : '未选择';
  elements.journeyStepList.querySelectorAll('[data-tab]').forEach((button) => {
    button.disabled = !hasJourney;
  });
}

function defaultPreviewFocus(tab = state.tab) {
  const meta = currentResourceMeta();
  const day = state.content?.days?.[state.selectedDay];
  const defaults = {
    home: {
      anchor: 'home-hero',
      title: '官网首页 · 首页内容',
      hint: '右侧显示官网首页；点击或输入任一字段后，会定位并高亮对应区块。',
    },
    journeys: {
      anchor: 'journey-library',
      title: '行程管理 · 内部目录',
      hint: '右侧汇总行程数量与状态；此区域仅供后台管理，不会直接出现在官网。',
    },
    overview: {
      anchor: 'journey-hero',
      title: `${meta.shortLabel} · 产品概览`,
      hint: '右侧显示当前行程的官网首屏与概览；选择字段后会定位到更具体的位置。',
    },
    days: {
      anchor: 'journey-day',
      title: `${meta.shortLabel} · DAY ${day?.number || '01'}`,
      hint: `右侧正在显示“${day?.title || '尚未填写标题'}”这一天的官网内容。`,
    },
    highlights: {
      anchor: 'highlights',
      title: `${meta.shortLabel} · 亮点与图片`,
      hint: '右侧显示当前行程的旅行亮点区；选择某一张卡片后会单独高亮。',
    },
    stays: {
      anchor: 'stays',
      title: `${meta.shortLabel} · 酒店与说明`,
      hint: '右侧显示住宿甄选与行程说明；选择字段后会定位到对应分组。',
    },
    publish: {
      anchor: 'publish-status',
      title: `${meta.shortLabel} · 预览与发布`,
      hint: '右侧是内部发布检查，不会出现在游客看到的官网页面中。',
    },
    staff: {
      anchor: 'staff-status',
      title: '后台设置 · 工作人员',
      hint: '右侧是账号与权限概览，仅供后台内部查看。',
    },
  };
  return { ...defaults[tab], tab, resourceId: state.resourceId };
}

function resetPreviewFocus(tab = state.tab) {
  state.previewFocus = defaultPreviewFocus(tab);
  if (tab === 'home') state.homepagePreviewSlide = 0;
}

function previewAnchorForPath(path) {
  if (state.tab === 'home') {
    const selectionItem = path.match(/^selection\.items\.(\d+)/);
    if (selectionItem) return `home-selection-${selectionItem[1]}`;
    const wayItem = path.match(/^ways\.items\.(\d+)/);
    if (wayItem) return `home-way-${wayItem[1]}`;
    if (path.startsWith('selection.')) return 'home-selection';
    if (path.startsWith('ways.')) return 'home-ways';
    if (path.startsWith('intro.')) return 'home-intro';
    return 'home-hero';
  }
  if (state.tab === 'overview') {
    if (path.startsWith('overview.')) return 'journey-overview';
    if (path.startsWith('map.')) return 'journey-map';
    if (path.startsWith('booking.')) return 'journey-booking';
    return 'journey-hero';
  }
  if (state.tab === 'days') return 'journey-day';
  if (state.tab === 'highlights') {
    const item = path.match(/^highlights\.items\.(\d+)/);
    return item ? `highlight-${item[1]}` : 'highlights';
  }
  if (state.tab === 'stays') {
    const group = path.match(/^stays\.groups\.(\d+)/);
    if (group) return `stay-${group[1]}`;
    if (path.startsWith('notes.')) return 'journey-notes';
    return 'stays';
  }
  if (state.tab === 'publish') return path.includes('history') ? 'publish-history' : 'publish-check';
  if (state.tab === 'staff') return 'staff-team';
  return defaultPreviewFocus().anchor;
}

function editorControlPath(control) {
  if (control.matches('[data-season-select]')) return 'management.season';
  return control.dataset.path
    || control.dataset.arrayPath
    || control.dataset.imageUpload
    || control.dataset.imageAlt
    || '';
}

function editorControlLabel(control) {
  const fieldElement = control.closest('.field');
  const label = fieldElement?.querySelector('label, .image-label');
  return label?.textContent?.trim() || control.getAttribute('aria-label') || '';
}

function editorCardTitle(control) {
  return control.closest('.form-card')?.querySelector('.form-card-head h3')?.textContent?.trim()
    || TAB_COPY[state.tab]?.[1]
    || '当前内容';
}

function updatePreviewLocation() {
  const focus = state.previewFocus || defaultPreviewFocus();
  elements.previewLocationTitle.textContent = focus.title;
  elements.previewLocationHint.textContent = focus.hint;
  elements.previewLocation.dataset.tab = state.tab;
}

function scrollPreviewToTarget(target) {
  const stageRect = elements.previewStage.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const top = elements.previewStage.scrollTop + targetRect.top - stageRect.top - 34;
  elements.previewStage.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
}

function applyPreviewFocus(options = {}) {
  updatePreviewLocation();
  elements.journeyPreview.querySelectorAll('.is-preview-focus').forEach((target) => target.classList.remove('is-preview-focus'));
  elements.journeyPreview.querySelectorAll('.preview-focus-tag').forEach((tag) => tag.remove());
  const focus = state.previewFocus || defaultPreviewFocus();
  const target = elements.journeyPreview.querySelector(`[data-preview-anchor="${CSS.escape(focus.anchor)}"]`)
    || elements.journeyPreview.querySelector('[data-preview-anchor]');
  if (!target) return;
  target.classList.add('is-preview-focus');
  const tag = document.createElement('span');
  tag.className = 'preview-focus-tag';
  tag.textContent = '正在编辑这里';
  target.append(tag);
  if (options.scroll) requestAnimationFrame(() => scrollPreviewToTarget(target));
}

function focusPreviewForControl(control) {
  const path = editorControlPath(control);
  if (!path) return;
  const slide = path.match(/^hero\.slides\.(\d+)/);
  if (state.tab === 'home' && slide) state.homepagePreviewSlide = Number(slide[1]);
  const fieldLabel = editorControlLabel(control);
  const cardTitle = editorCardTitle(control);
  const resourceLabel = state.tab === 'home' ? '官网首页' : currentResourceMeta().shortLabel;
  const hiddenFromBody = path.startsWith('seo.');
  state.previewFocus = {
    tab: state.tab,
    resourceId: state.resourceId,
    anchor: previewAnchorForPath(path),
    title: `${resourceLabel} · ${cardTitle}`,
    hint: hiddenFromBody
      ? `当前字段：${fieldLabel || '搜索与分享信息'}。此内容不会显示在页面正文中，右侧以行程首屏确认页面归属。`
      : `当前字段：${fieldLabel || cardTitle}。右侧已经定位并高亮它在页面中的对应位置。`,
  };
  if (state.tab === 'home' && slide) renderPreview();
  applyPreviewFocus({ scroll: true });
}

function localDraftKey(resourceId = state.resourceId) {
  return `asuka-cms:${resourceId}:draft`;
}

function hasAnyDirtyResource() {
  return Object.values(state.resources).some((resource) => resource.dirty);
}

function getResourcePath(resourceId, path) {
  return path.split('.').reduce((value, part) => value?.[part], state.resources[resourceId].content);
}

function getPath(path) {
  return getResourcePath(state.resourceId, path);
}

function setResourcePath(resourceId, path, value) {
  const parts = path.split('.');
  let target = state.resources[resourceId].content;
  parts.slice(0, -1).forEach((part, index) => {
    const next = parts[index + 1];
    if (target[part] == null) target[part] = /^\d+$/.test(next) ? [] : {};
    target = target[part];
  });
  target[parts[parts.length - 1]] = value;
  if (resourceId === state.resourceId) synchronizeContent(path);
}

function setPath(path, value) {
  setResourcePath(state.resourceId, path, value);
}

function synchronizeContent(changedPath = '') {
  if (!isJourneyResource()) return;
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
  if (changedPath === 'management.season') {
    const season = seasonById(content.management.season);
    content.management.seasonVariant = season.variant;
  }
  if (changedPath === 'regionId') {
    const region = regionById(content.regionId);
    Object.assign(content.management, {
      regionCode: region.code,
      regionName: region.name,
      regionLatin: region.latin,
    });
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

function selectField(label, path, items, options = {}) {
  const value = String(getPath(path) ?? '');
  const full = options.full === false ? '' : ' full';
  return `<div class="field${full}">
    <label>${escapeHtml(label)}</label>
    <select data-path="${escapeHtml(path)}">
      ${items.map((item) => `<option value="${escapeHtml(item.value)}"${String(item.value) === value ? ' selected' : ''}>${escapeHtml(item.label)}</option>`).join('')}
    </select>
    ${options.help ? `<div class="field-help"><span>${escapeHtml(options.help)}</span><span></span></div>` : ''}
  </div>`;
}

function numberField(label, path, options = {}) {
  const value = Number(getPath(path) ?? options.min ?? 0);
  const full = options.full === false ? '' : ' full';
  return `<div class="field${full}">
    <label>${escapeHtml(label)}</label>
    <input data-path="${escapeHtml(path)}" data-value-type="number" type="number" min="${Number(options.min ?? 0)}" max="${Number(options.max ?? 9999)}" step="${Number(options.step ?? 1)}" value="${value}" />
    ${options.help ? `<div class="field-help"><span>${escapeHtml(options.help)}</span><span></span></div>` : ''}
  </div>`;
}

function seasonSelector() {
  const selected = state.content.management?.season || 'all';
  return `<div class="season-template-grid full">
    ${SEASONS.map((season) => `<button class="season-template${season.id === selected ? ' active' : ''}" data-season-select="${season.id}" type="button" style="--season-paper:${season.palette[0]};--season-ink:${season.palette[1]};--season-accent:${season.palette[2]}">
      <span><i></i><i></i><i></i></span>
      <strong>${escapeHtml(season.label)}</strong>
      <small>${escapeHtml(season.motif)}</small>
    </button>`).join('')}
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
        <span>${image?._templatePlaceholder ? '模板占位图 · 发布前请替换' : image?._assetId ? '新图片 · 待发布' : image ? '当前官网图片' : '暂未设置'}</span>
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

function renderHomepageEditor() {
  return `<div class="editor-section editor-section--homepage">
    ${demoBanner()}
    ${sectionIntro('HOMEPAGE CONTENT', '官网首页', '统一管理官网封面、品牌介绍、飞鸟之选和三种出发方式。桌面与手机使用同一份内容；版式、颜色、动画与按钮去向已锁定，不会被误改。')}
    <aside class="locked-layout-note"><strong>已锁定设计</strong><span>导航、字体比例、区块间距、轮播动画、首个精选行程入口及三种出发方式的按钮去向均由系统保护。</span></aside>
    ${formCard('首页封面', '封面继续使用3张本地响应式图片轮播；这里只维护游客看到的文字。', `<div class="form-grid">
      ${field('英文眉题', 'hero.eyebrow', { max: 100, full: false })}
      ${field('封面标题（换行处按回车）', 'hero.title', { max: 100, full: false, textarea: true })}
      ${field('封面介绍（换行处按回车）', 'hero.copy', { max: 500, textarea: true, size: 'long' })}
      ${field('主按钮文字', 'hero.primaryLabel', { max: 30, full: false })}
      ${field('次按钮文字', 'hero.secondaryLabel', { max: 30, full: false })}
      ${field('图片说明', 'hero.credit', { max: 180 })}
    </div>`)}
    ${state.content.hero.slides.map((slide, index) => formCard(`封面轮播图 ${String(index + 1).padStart(2, '0')}`, index === 0 ? '第一张为官网首屏优先加载图片；建议横图主体居中，手机裁切后仍清晰。' : '轮播图会在首页自动切换，并继续使用本地图片保证中国大陆加载速度。', `<div class="form-grid">${imageUploader(`第${index + 1}张封面图片`, `hero.slides.${index}.image`, slide.image)}</div>`)).join('')}
    ${formCard('品牌介绍', '官网封面下方的品牌主张与两段说明。', `<div class="form-grid">
      ${field('英文眉题', 'intro.eyebrow', { max: 80, full: false })}
      ${field('品牌标题（换行处按回车）', 'intro.title', { max: 100, full: false, textarea: true })}
      ${field('第一段重点文字', 'intro.lead', { max: 400, textarea: true })}
      ${field('第二段说明', 'intro.copy', { max: 500, textarea: true, size: 'long' })}
    </div>`)}
    ${formCard('飞鸟之选 · 区块标题', '保持6项中央主图与两侧预告的自动轮播结构。', `<div class="form-grid">
      ${field('英文眉题', 'selection.eyebrow', { max: 80, full: false })}
      ${field('中文标题', 'selection.title', { max: 80, full: false })}
      ${field('区块说明', 'selection.copy', { max: 400, textarea: true })}
    </div>`)}
    ${state.content.selection.items.map((item, index) => formCard(`飞鸟之选 ${String(index + 1).padStart(2, '0')} · ${item.title}`, index === 0 ? '第一项按钮固定进入当前关东山海6日独立详情页；其余项目固定进入日本心旅行。' : '按钮去向已固定为日本心旅行，只需维护文案和图片。', `<div class="form-grid">
      ${field('地区英文', `selection.items.${index}.placeLatin`, { max: 30, full: false })}
      ${field('地区中文', `selection.items.${index}.placeCn`, { max: 20, full: false })}
      ${field('英文眉题', `selection.items.${index}.kicker`, { max: 80, full: false })}
      ${field('中文标题', `selection.items.${index}.title`, { max: 80, full: false })}
      ${field('说明文字', `selection.items.${index}.copy`, { max: 400, textarea: true })}
      ${field('按钮文字', `selection.items.${index}.ctaLabel`, { max: 30, full: false })}
      ${imageUploader('卡片图片', `selection.items.${index}.image`, item.image)}
    </div>`)).join('')}
    ${formCard('三种出发方式 · 区块标题', '三个按钮的功能去向已锁定，只维护展示文字和图片。', `<div class="form-grid">
      ${field('英文眉题', 'ways.eyebrow', { max: 80, full: false })}
      ${field('中文标题', 'ways.title', { max: 80, full: false })}
      ${field('区块说明', 'ways.copy', { max: 300, textarea: true })}
    </div>`)}
    ${state.content.ways.items.map((item, index) => formCard(`出发方式 ${String(index + 1).padStart(2, '0')} · ${item.title}`, ['固定进入“日本心旅行”。', '固定进入“个性化定制”。', '固定进入“主题鉴赏行”。'][index], `<div class="form-grid">
      ${field('英文眉题', `ways.items.${index}.kicker`, { max: 80, full: false })}
      ${field('中文标题', `ways.items.${index}.title`, { max: 80, full: false })}
      ${field('说明文字', `ways.items.${index}.copy`, { max: 400, textarea: true })}
      ${field('按钮文字', `ways.items.${index}.ctaLabel`, { max: 30, full: false })}
      ${imageUploader('卡片图片', `ways.items.${index}.image`, item.image)}
    </div>`)).join('')}
  </div>`;
}

function journeyDisplayItem(item) {
  const resource = state.resources[item.id];
  const content = resource?.content;
  if (!content) return item;
  return {
    ...item,
    title: content.card?.title || item.title,
    regionName: content.management?.regionName || item.regionName,
    season: content.management?.season || item.season,
    seasonVariant: content.management?.seasonVariant || item.seasonVariant,
    visibility: content.management?.visibility || item.visibility,
    daysCount: content.days?.length || item.daysCount,
  };
}

function upsertJourneyListFromContent(content, extra = {}) {
  const item = {
    id: content.id,
    productCode: content.productCode,
    title: content.card?.title || content.id,
    regionId: content.regionId,
    regionCode: content.management?.regionCode,
    regionName: content.management?.regionName,
    season: content.management?.season || 'all',
    seasonVariant: content.management?.seasonVariant || '',
    visibility: content.management?.visibility || 'hidden',
    order: Number(content.management?.order || 0),
    daysCount: content.days?.length || 0,
    href: `journeys/${content.id}/`,
    ...extra,
  };
  const index = state.journeys.findIndex((entry) => entry.id === content.id);
  if (index >= 0) state.journeys[index] = { ...state.journeys[index], ...item };
  else state.journeys.push(item);
  state.journeys.sort((left, right) => String(left.regionCode || '').localeCompare(String(right.regionCode || ''))
    || Number(left.order || 0) - Number(right.order || 0));
  registerJourneyResource(item, content);
  updateSidebarContext();
  return item;
}

function renderJourneysEditor() {
  const journeys = state.journeys.map(journeyDisplayItem);
  return `<div class="editor-section editor-section--journeys">
    ${demoBanner()}
    ${sectionIntro('JOURNEY LIBRARY', '全部行程', '每个行程拥有独立草稿、季节视觉、官网详情页和发布记录。可从关东6日框架新建，也可复制任意现有行程后继续调整。')}
    <div class="journey-library-actions">
      <div><strong>${journeys.length} 个行程</strong><span>已发布与隐藏草稿统一管理</span></div>
      <button class="primary" data-new-journey type="button">＋ 新增行程</button>
    </div>
    <div class="journey-library-grid">
      ${journeys.map((raw) => {
    const item = journeyDisplayItem(raw);
    const season = seasonById(item.season);
    const region = regionById(item.regionId || item.regionCode);
    const pageUrl = `${CMS_CONFIG.publicSiteUrl}journeys/${encodeURIComponent(item.id)}/`;
    return `<article class="journey-library-card" style="--journey-paper:${season.palette[0]};--journey-ink:${season.palette[1]};--journey-accent:${season.palette[2]}">
          <div class="journey-library-motif"><i></i><i></i><i></i><small>${escapeHtml(region.code)} · ${escapeHtml(region.latin)}</small></div>
          <div class="journey-library-copy">
            <div class="journey-library-status"><span class="${item.visibility === 'hidden' ? 'hidden' : ''}">${item.visibility === 'hidden' ? '官网隐藏' : '官网展示'}</span>${item.hasDraft ? '<b>有后台草稿</b>' : ''}</div>
            <small>${escapeHtml(season.label)} · ${escapeHtml(item.seasonVariant || season.variant)}</small>
            <h3>${withBreaks(item.title || item.id)}</h3>
            <p>${Number(item.daysCount || 0)}天行程 · ${escapeHtml(item.productCode || item.id)}</p>
            <div>
              <button class="primary" data-open-journey="${escapeHtml(item.id)}" type="button">编辑行程</button>
              <button class="secondary" data-copy-journey="${escapeHtml(item.id)}" type="button">复制</button>
              ${item.visibility !== 'hidden' ? `<a href="${escapeHtml(pageUrl)}" target="_blank" rel="noopener">官网 ↗</a>` : ''}
            </div>
          </div>
        </article>`;
  }).join('')}
    </div>
    ${journeys.length ? '' : '<div class="journey-library-empty"><h3>还没有行程</h3><p>点击“新增行程”，从关东6日框架开始制作。</p></div>'}
  </div>`;
}

function overviewFactEditor(index) {
  return `<div class="metric-editor"><small>OVERVIEW FACT ${index + 1}</small>
    <input data-path="overview.facts.${index}.label" data-max="30" maxlength="30" value="${escapeHtml(state.content.overview.facts[index]?.label || '')}" aria-label="概览信息${index + 1}英文标签" />
    <input data-path="overview.facts.${index}.value" data-max="120" maxlength="120" value="${escapeHtml(state.content.overview.facts[index]?.value || '')}" aria-label="概览信息${index + 1}内容" />
  </div>`;
}

function renderOverviewEditor() {
  const meta = currentResourceMeta();
  const mapMode = state.content.map?.mode || 'summary';
  return `<div class="editor-section">
    ${demoBanner()}
    ${sectionIntro('PRODUCT OVERVIEW', meta.label, '这里控制地区归属、四季模板、产品卡片、详情页首屏、概览与咨询信息。保存草稿不会影响官网，只有管理员发布后才会更新。')}
    ${formCard('行程设置与四季模板', '季节只改变视觉元素、颜色与氛围，不会破坏已锁定的阅读顺序和手机排版。新行程默认“官网隐藏”，确认无误后再切换为展示。', `<div class="form-grid">
      ${field('网址编号（创建后不可修改）', 'id', { max: 64, full: false, readonly: true })}
      ${field('产品编号', 'productCode', { max: 32, full: false })}
      ${selectField('所属地区', 'regionId', REGIONS.map((region) => ({ value: region.id, label: `${region.code} · ${region.name}｜${region.places}` })), { full: false })}
      ${selectField('官网展示状态', 'management.visibility', [
    { value: 'hidden', label: '官网隐藏（仅后台可见）' },
    { value: 'published', label: '官网展示' },
  ], { full: false })}
      ${seasonSelector()}
      ${field('季节主题说明', 'management.seasonVariant', { max: 40, full: false, help: '例如：樱花与新绿、枫狩与金秋。' })}
      ${field('适合月份', 'management.travelMonths', { max: 40, full: false, help: '例如：3月下旬—4月中旬。' })}
      ${numberField('地区内排序', 'management.order', { min: 0, max: 9999, full: false, help: '数字越小，在官网地区列表中越靠前。' })}
      ${numberField('咨询人数上限', 'booking.maxGuests', { min: 1, max: 50, full: false })}
    </div>`)}
    ${formCard('产品卡片', '游客在对应地区的行程列表中首先看到的内容。', `<div class="form-grid">
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
    ${formCard('行程地图', '逐日路线会自动跟随“每日行程”。一般行程选择“路线摘要”即可；已有专业地图或上传一张地图时可切换其他方式。', `<div class="form-grid">
      ${selectField('地图展示方式', 'map.mode', [
    { value: 'summary', label: '路线摘要（推荐，无需地图图片）' },
    { value: 'image', label: '上传地图图片' },
    ...(state.content.map?.desktop && state.content.map?.mobile ? [{ value: 'legacy', label: '沿用当前桌面／手机地图' }] : []),
  ], { full: false })}
      ${field('地图标题', 'map.title', { max: 100, full: false })}
      ${field('地图替代文字', 'map.alt', { max: 220, full: false })}
      ${field('地图介绍', 'map.copy', { max: 700, textarea: true, size: 'long' })}
      ${field('地图注释', 'map.caption', { max: 400, textarea: true })}
      ${mapMode === 'image' ? imageUploader('地图图片', 'map.image', state.content.map.image, '建议横图；系统会生成手机与桌面响应式版本。') : ''}
    </div>`)}
    ${formCard('产品信息', '用于详情页右侧咨询卡片；咨询卡标题自动跟随产品标题。', `<div class="form-grid">
      ${field('产品归属', 'booking.productGroup', { max: 100, full: false })}
      ${field('当前状态', 'booking.currentStatus', { max: 60, full: false })}
      ${field('出发日期', 'booking.departure', { max: 80, full: false })}
      ${field('参考价格', 'booking.price', { max: 80, full: false })}
      ${field('旅行方式', 'booking.travelStyle', { max: 80, full: false })}
    </div>`)}
    ${formCard('搜索与分享信息', '用于浏览器标题、搜索结果和社交分享说明。', `<div class="form-grid">
      ${field('网页标题', 'seo.title', { max: 100, full: false })}
      ${field('网页说明', 'seo.description', { max: 220, textarea: true })}
    </div>`)}
  </div>`;
}

function metricEditor(dayPath, key, eyebrow, label) {
  const metric = getPath(`${dayPath}.${key}`);
  const multiline = key === 'distance' || key === 'duration';
  const valueControl = multiline
    ? `<textarea data-path="${dayPath}.${key}.value" data-max="120" data-size="metric" maxlength="120" aria-label="${escapeHtml(label)}" placeholder="多条路线时，每条路线占一行">${escapeHtml(metric?.value || '')}</textarea>`
    : `<input data-path="${dayPath}.${key}.value" data-max="120" maxlength="120" value="${escapeHtml(metric?.value || '')}" aria-label="${escapeHtml(label)}" />`;
  return `<div class="metric-editor"><small>${escapeHtml(eyebrow)} · ${escapeHtml(label)}</small>
    ${valueControl}
    <input data-path="${dayPath}.${key}.note" data-max="160" maxlength="160" value="${escapeHtml(metric?.note || '')}" aria-label="${escapeHtml(label)}补充说明" placeholder="补充说明" />
  </div>`;
}

function renderDaysEditor() {
  state.selectedDay = Math.max(0, Math.min(state.selectedDay, state.content.days.length - 1));
  const day = state.content.days[state.selectedDay];
  const path = `days.${state.selectedDay}`;
  return `<div class="editor-section">
    ${demoBanner()}
    ${sectionIntro('DAY BY DAY', `每日行程 · 共${state.content.days.length}天`, '可新增、复制、移动或删除天数；系统会自动重排 DAY 编号，并同步官网路线摘要、晚数和行程时长。')}
    <div class="day-tabs">${state.content.days.map((item, index) => `<button class="${index === state.selectedDay ? 'active' : ''}" data-select-day="${index}" type="button"><strong>DAY ${escapeHtml(item.number)}</strong><span>${escapeHtml((item.title || '待填写').slice(0, 8))}</span></button>`).join('')}<button class="day-tab-add" data-day-action="append" type="button" aria-label="在末尾新增一天">＋<span>新增</span></button></div>
    <div class="day-manage-bar">
      <div><strong>DAY ${escapeHtml(day.number)}</strong><span>${escapeHtml(day.title || '尚未填写标题')}</span></div>
      <div>
        <button data-day-action="up" type="button"${state.selectedDay === 0 ? ' disabled' : ''}>↑ 上移</button>
        <button data-day-action="down" type="button"${state.selectedDay === state.content.days.length - 1 ? ' disabled' : ''}>↓ 下移</button>
        <button data-day-action="duplicate" type="button">复制当天</button>
        <button data-day-action="add-after" type="button">＋ 后插一天</button>
        <button class="danger" data-day-action="remove" type="button"${state.content.days.length === 1 ? ' disabled' : ''}>删除</button>
      </div>
    </div>
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
  const meta = currentResourceMeta();
  const isHomepage = state.resourceId === 'homepage';
  const liveUrl = isHomepage ? CMS_CONFIG.publicSiteUrl : `${CMS_CONFIG.publicSiteUrl}journeys/${encodeURIComponent(state.resourceId)}/`;
  const dirtyText = state.dirty ? '当前有尚未保存或发布的修改' : '当前草稿与最近保存状态一致';
  const history = state.history.length
    ? state.history.map((item) => `<div class="history-item"><div><strong>${escapeHtml(item.message || meta.defaultMessage)}</strong><span>${escapeHtml(item.publishedByName || item.publishedBy || '')} · ${formatDate(item.publishedAt)}</span></div><a href="${escapeHtml(item.commitUrl)}" target="_blank" rel="noopener">${escapeHtml(String(item.commitSha || '').slice(0, 7))} ↗</a></div>`).join('')
    : '<p>还没有后台发布记录。</p>';
  return `<div class="editor-section">
    ${demoBanner()}
    ${sectionIntro('PUBLISH CENTER', `发布管理 · ${meta.shortLabel}`, `当前管理的是“${meta.label}”。草稿仅在后台可见；点击发布后，系统会生成静态官网文件并提交到 GitHub，GitHub Pages 通常会在1—3分钟内更新。`)}
    <div class="publish-grid">
      <section class="publish-card"><small>DRAFT STATUS</small><h3>${state.dirty ? '有待处理修改' : '草稿已保存'}</h3><p>${dirtyText}</p><button class="secondary" data-save-draft type="button">保存当前草稿</button></section>
      <section class="publish-card"><small>LIVE WEBSITE</small><h3>${isHomepage ? '飞鸟旅行官网' : '独立行程页'}</h3><p>发布不会让游客依赖后台数据库，官网继续以静态文件高速加载。</p><a class="primary" style="display:inline-flex;align-items:center;text-decoration:none" href="${escapeHtml(liveUrl)}" target="_blank" rel="noopener">查看官网 ↗</a></section>
      <section class="publish-card full"><small>ONE-CLICK PUBLISH</small><h3>确认无误后更新${meta.label}</h3><p>${isHomepage ? '系统只更新官网首页内容；各个行程的独立草稿与详情页不会被覆盖。' : '系统会提交当前文字、响应式图片、独立行程页和首页地区目录；其他行程不会被覆盖。'}</p><button class="primary admin-only" data-open-publish type="button">检查并发布官网</button></section>
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
    home: renderHomepageEditor,
    journeys: renderJourneysEditor,
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
  updateSidebarContext();
}

function bindEditorEvents() {
  elements.editorCanvas.querySelectorAll('[data-path]').forEach((control) => {
    control.addEventListener('input', () => {
      const value = control.dataset.valueType === 'number' ? Number(control.value) : control.value;
      setPath(control.dataset.path, value);
      const counter = elements.editorCanvas.querySelector(`[data-counter-for="${CSS.escape(control.dataset.path)}"]`);
      if (counter) counter.textContent = `${control.value.length}/${control.dataset.max}`;
      markDirty();
      if (['management.season', 'map.mode', 'regionId'].includes(control.dataset.path)) renderEditor();
    });
  });

  elements.editorCanvas.querySelectorAll('[data-season-select]').forEach((button) => {
    button.addEventListener('click', () => {
      focusPreviewForControl(button);
      setPath('management.season', button.dataset.seasonSelect);
      synchronizeContent('management.season');
      markDirty();
      renderEditor();
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
      resetPreviewFocus('days');
      renderEditor();
      schedulePreview();
    });
  });

  elements.editorCanvas.querySelectorAll('[data-day-action]').forEach((button) => {
    button.addEventListener('click', () => {
      const action = button.dataset.dayAction;
      let changed = false;
      if (action === 'append') {
        changed = addBlankDay(state.content);
        if (changed) state.selectedDay = state.content.days.length - 1;
      } else if (action === 'add-after') {
        changed = addBlankDay(state.content, state.selectedDay + 1);
        if (changed) state.selectedDay += 1;
      } else if (action === 'duplicate') {
        changed = duplicateDay(state.content, state.selectedDay);
        if (changed) state.selectedDay += 1;
      } else if (action === 'up') {
        changed = moveDay(state.content, state.selectedDay, state.selectedDay - 1);
        if (changed) state.selectedDay -= 1;
      } else if (action === 'down') {
        changed = moveDay(state.content, state.selectedDay, state.selectedDay + 1);
        if (changed) state.selectedDay += 1;
      } else if (action === 'remove') {
        if (!confirm(`确定删除 DAY ${state.content.days[state.selectedDay].number} 吗？`)) return;
        changed = removeDay(state.content, state.selectedDay);
        state.selectedDay = Math.min(state.selectedDay, state.content.days.length - 1);
      }
      if (!changed) return showToast(state.content.days.length >= 30 ? '最多支持30天行程' : '至少保留1天', 'error');
      resetPreviewFocus('days');
      markDirty();
      renderEditor();
      schedulePreview();
    });
  });

  elements.editorCanvas.querySelectorAll('[data-image-upload]').forEach((input) => {
    input.addEventListener('change', () => handleImageUpload(input));
  });

  elements.editorCanvas.querySelectorAll('[data-save-draft]').forEach((button) => button.addEventListener('click', saveDraft));
  elements.editorCanvas.querySelectorAll('[data-open-publish]').forEach((button) => button.addEventListener('click', openPublishModal));
  elements.editorCanvas.querySelectorAll('[data-new-journey]').forEach((button) => button.addEventListener('click', () => openJourneyModal()));
  elements.editorCanvas.querySelectorAll('[data-open-journey]').forEach((button) => {
    button.addEventListener('click', () => selectJourney(button.dataset.openJourney));
  });
  elements.editorCanvas.querySelectorAll('[data-copy-journey]').forEach((button) => {
    button.addEventListener('click', () => openJourneyModal(button.dataset.copyJourney));
  });

  const staffForm = elements.editorCanvas.querySelector('#staffInviteForm');
  if (staffForm) staffForm.addEventListener('submit', inviteStaff);
  elements.editorCanvas.querySelectorAll('[data-save-staff]').forEach((button) => button.addEventListener('click', () => saveStaffAccess(button)));
  elements.editorCanvas.querySelectorAll('[data-toggle-staff]').forEach((button) => button.addEventListener('click', () => toggleStaffAccess(button)));
  elements.editorCanvas.querySelectorAll('[data-revoke-invite]').forEach((button) => button.addEventListener('click', () => revokeStaffInvite(button)));
}

function markDirty() {
  markResourceDirty(state.resourceId);
}

function markResourceDirty(resourceId) {
  const resource = state.resources[resourceId];
  resource.dirty = true;
  resource.publishRequestId = null;
  clearTimeout(resource.localSaveTimer);
  resource.localSaveTimer = setTimeout(() => saveLocalDraft(resourceId), 450);
  if (resourceId === state.resourceId) {
    updateSaveState();
    schedulePreview();
  }
  updateSidebarContext();
}

function updateSaveState(message) {
  elements.saveState.classList.toggle('dirty', state.dirty && !state.saving);
  elements.saveState.classList.toggle('saving', state.saving);
  elements.saveState.lastChild.textContent = message || (state.saving ? '正在保存…' : state.dirty ? '有未保存修改' : '内容已同步');
  updateSidebarContext();
}

function saveLocalDraft(resourceId = state.resourceId) {
  const resource = state.resources[resourceId];
  try {
    localStorage.setItem(localDraftKey(resourceId), JSON.stringify({
      content: resource.content,
      savedAt: new Date().toISOString(),
      revision: resource.revision,
      dirty: resource.dirty,
    }));
  } catch {
    // Local storage is an extra recovery layer; server drafts remain authoritative.
  }
}

function restoreLocalDraft(resourceId, serverUpdatedAt) {
  const resource = state.resources[resourceId];
  try {
    const cached = JSON.parse(localStorage.getItem(localDraftKey(resourceId)) || 'null');
    if (!cached?.content || cached.content.id !== resourceId) return;
    const isNewer = !serverUpdatedAt || new Date(cached.savedAt) > new Date(serverUpdatedAt);
    if (isNewer && (cached.dirty === true || cached.dirty == null)) {
      resource.content = cached.content;
      resource.dirty = true;
      if (resourceId === state.resourceId) synchronizeContent();
      showToast(`已恢复此设备上较新的${RESOURCE_META[resourceId].shortLabel}未提交草稿`);
    }
  } catch {
    localStorage.removeItem(localDraftKey(resourceId));
  }
}

function validateJourneyForPublish() {
  synchronizeContent();
  const errors = [];
  const content = state.content;
  if (!JOURNEY_ID_PATTERN.test(content.id || '')) errors.push('网址编号格式不正确');
  if (!content.productCode?.trim()) errors.push('产品编号不能为空');
  if (!REGIONS.some((region) => region.id === content.regionId)) errors.push('请选择所属地区');
  if (!SEASONS.some((season) => season.id === content.management?.season)) errors.push('请选择季节模板');
  if (!content.management?.seasonVariant?.trim() || !content.management?.travelMonths?.trim()) errors.push('季节主题与适合月份不能为空');
  if (!content.card?.title?.trim()) errors.push('产品标题不能为空');
  if (!content.card?.summary?.trim()) errors.push('产品摘要不能为空');
  if (!content.hero?.copy?.trim() || !content.hero?.image?.alt || !content.hero?.image?.webp480 || !content.hero?.image?.fallback || content.hero.image._templatePlaceholder) errors.push('首屏介绍和图片必须完整，并替换模板占位图');
  if (!content.overview?.title?.trim() || !content.overview?.copy?.trim() || !content.overview?.route?.trim()) errors.push('行程概览信息不完整');
  if (!content.overview?.facts?.length || content.overview.facts.length > 8 || content.overview.facts.some((fact) => !fact.label?.trim() || !fact.value?.trim())) errors.push('行程概览的1—8项信息必须填写完整');
  if (!content.map?.title?.trim() || !content.map?.copy?.trim() || !content.map?.caption?.trim() || !content.map?.alt?.trim()) errors.push('行程地图标题与说明不完整');
  if (content.map?.mode === 'image' && (!content.map.image?.alt || !content.map.image?.webp480 || !content.map.image?.fallback)) errors.push('地图图片信息不完整');
  if (!content.highlights?.items?.length || content.highlights.items.length > 8 || content.highlights.items.some((item) => !item.title?.trim() || !item.eyebrow?.trim() || !item.image?.alt || item.image._templatePlaceholder)) errors.push('1—8项行程亮点必须填写完整，并替换模板占位图');
  if (!content.stays?.groups?.length || content.stays.groups.some((group) => !group.title?.trim() || !group.hotels?.length)) errors.push('酒店甄选信息不完整');
  if (!content.notes?.items?.length || content.notes.items.some((item) => !item.title?.trim() || !item.copy?.trim())) errors.push('行程说明信息不完整');
  if (!Array.isArray(content.days) || content.days.length < 1 || content.days.length > 30) errors.push('行程必须包含1—30天');
  content.days?.forEach((day, index) => {
    if (!day.title?.trim() || !day.route?.trim()) errors.push(`第${index + 1}天标题和路线不能为空`);
    if (!day.story?.trim()) errors.push(`第${index + 1}天行程描述不能为空`);
    if (!day.stops?.length || day.stops.some((item) => !item.trim())) errors.push(`第${index + 1}天停靠点不能为空`);
    if (!day.distance?.value?.trim()) errors.push(`第${index + 1}天行车里程不能为空`);
    if (!day.duration?.value?.trim()) errors.push(`第${index + 1}天预计驾驶时间不能为空`);
    if (!day.activity?.value?.trim() || !day.comfort?.value?.trim()) errors.push(`第${index + 1}天体力与舒适度不能为空`);
    if (!day.meals?.breakfast?.trim() || !day.meals?.lunch?.trim() || !day.meals?.dinner?.trim() || !day.hotel?.trim()) errors.push(`第${index + 1}天餐食与住宿不能为空`);
    if (day.image && (!day.image.alt || !day.image.webp480 || !day.image.fallback)) errors.push(`第${index + 1}天图片信息不完整`);
  });
  if (!content.booking?.productGroup?.trim() || !content.booking?.currentStatus?.trim() || !content.booking?.departure?.trim() || !content.booking?.price?.trim() || !content.booking?.travelStyle?.trim()) errors.push('产品咨询信息不完整');
  if (!Number.isInteger(Number(content.booking?.maxGuests)) || Number(content.booking.maxGuests) < 1 || Number(content.booking.maxGuests) > 50) errors.push('咨询人数上限须为1—50人');
  if (!content.seo?.title?.trim() || !content.seo?.description?.trim()) errors.push('搜索与分享信息不完整');
  return errors;
}

function validateDraftForSave() {
  if (state.resourceId === 'homepage') return [];
  const errors = [];
  if (!JOURNEY_ID_PATTERN.test(state.content?.id || '')) errors.push('网址编号格式不正确');
  if (!state.content?.productCode?.trim()) errors.push('产品编号不能为空');
  if (!state.content?.card?.title?.trim()) errors.push('产品标题不能为空');
  if (!Array.isArray(state.content?.days) || !state.content.days.length || state.content.days.length > 30) errors.push('行程须保留1—30天');
  return errors;
}

function validateHomepageForPublish() {
  const errors = [];
  const content = state.content;
  if (!content.hero?.eyebrow?.trim() || !content.hero?.title?.trim() || !content.hero?.copy?.trim()) errors.push('首页封面文字必须填写完整');
  if (!content.hero?.primaryLabel?.trim() || !content.hero?.secondaryLabel?.trim() || !content.hero?.credit?.trim()) errors.push('首页封面按钮和图片说明必须填写完整');
  if (content.hero?.slides?.length !== 3 || content.hero.slides.some((slide) => !slide.image?.alt || !slide.image?.webp480 || !slide.image?.fallback)) errors.push('首页封面的3张轮播图片必须填写完整');
  if (!content.intro?.eyebrow?.trim() || !content.intro?.title?.trim() || !content.intro?.lead?.trim() || !content.intro?.copy?.trim()) errors.push('品牌介绍文字必须填写完整');
  if (!content.selection?.eyebrow?.trim() || !content.selection?.title?.trim() || !content.selection?.copy?.trim()) errors.push('飞鸟之选区块标题必须填写完整');
  if (content.selection?.items?.length !== 6) errors.push('飞鸟之选必须保留6项内容');
  else content.selection.items.forEach((item, index) => {
    if (!item.placeLatin?.trim() || !item.placeCn?.trim() || !item.kicker?.trim() || !item.title?.trim() || !item.copy?.trim() || !item.ctaLabel?.trim()) errors.push(`飞鸟之选第${index + 1}项文字不完整`);
    if (!item.image?.alt || !item.image?.webp480 || !item.image?.fallback) errors.push(`飞鸟之选第${index + 1}项图片不完整`);
  });
  if (!content.ways?.eyebrow?.trim() || !content.ways?.title?.trim() || !content.ways?.copy?.trim()) errors.push('三种出发方式区块标题必须填写完整');
  if (content.ways?.items?.length !== 3) errors.push('三种出发方式必须保留3项内容');
  else content.ways.items.forEach((item, index) => {
    if (!item.kicker?.trim() || !item.title?.trim() || !item.copy?.trim() || !item.ctaLabel?.trim()) errors.push(`出发方式第${index + 1}项文字不完整`);
    if (!item.image?.alt || !item.image?.webp480 || !item.image?.fallback) errors.push(`出发方式第${index + 1}项图片不完整`);
  });
  return errors;
}

function validateContentForPublish() {
  return state.resourceId === 'homepage' ? validateHomepageForPublish() : validateJourneyForPublish();
}

async function saveDraft() {
  const resourceId = state.resourceId;
  const resource = state.resources[resourceId];
  const errors = validateDraftForSave();
  if (errors.length) return showToast(errors[0], 'error');
  if (DEMO_MODE) {
    resource.dirty = false;
    if (isJourneyResource(resourceId)) upsertJourneyListFromContent(resource.content, { hasDraft: true });
    saveLocalDraft(resourceId);
    if (resourceId === state.resourceId) {
      updateSaveState();
      schedulePreview();
    }
    return showToast('演示模式：草稿已保存在此浏览器');
  }
  state.saving = true;
  updateSaveState();
  elements.saveButton.disabled = true;
  try {
    synchronizeContent();
    const result = await callCms('saveDraft', { resourceId, content: resource.content, revision: resource.revision });
    resource.revision = Number(result.revision) || resource.revision;
    resource.dirty = false;
    if (isJourneyResource(resourceId)) upsertJourneyListFromContent(resource.content, { hasDraft: true });
    saveLocalDraft(resourceId);
    if (resourceId === state.resourceId) {
      updateSaveState(`已保存 ${formatTime(result.savedAt)}`);
      schedulePreview();
    }
    showToast(`${RESOURCE_META[resourceId].shortLabel}草稿已安全保存`);
  } catch (error) {
    if (resourceId === state.resourceId) updateSaveState('保存失败');
    if (error.code === 'DRAFT_CONFLICT' && resourceId === state.resourceId) openDraftConflictModal(error.message);
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
  const resourceId = state.resourceId;
  const resource = state.resources[resourceId];
  const path = input.dataset.imageUpload;
  const card = input.closest('[data-image-card]');
  const controls = card.querySelector('.image-controls');
  const existing = getResourcePath(resourceId, path);
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
      resource.previewUrls.set(path, prepared.previewUrl);
      showToast(`演示图片处理完成：${prepared.original.width}×${prepared.original.height}`);
    } else {
      const staged = await callCms('stageAsset', {
        resourceId,
        alt,
        slug: prepared.slug,
        replacesAssetId: existing?._assetId || '',
        variants: prepared.variants,
      });
      setResourcePath(resourceId, path, staged.image);
      resource.previewUrls.set(path, staged.previewUrl || prepared.previewUrl);
      showToast('新图片已暂存，发布官网后正式生效');
    }
    markResourceDirty(resourceId);
    if (resourceId === state.resourceId) renderEditor();
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

function metricLines(value) {
  return String(value ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function previewMetricRoute(line) {
  const separator = line.indexOf('：');
  if (separator < 1) return `<span class="preview-metric-route">${escapeHtml(line)}</span>`;
  return `<span class="preview-metric-route"><span>${escapeHtml(line.slice(0, separator))}</span><b>${escapeHtml(line.slice(separator + 1))}</b></span>`;
}

function previewMetric(eyebrow, label, metric) {
  const lines = metricLines(metric?.value || '待补充');
  const note = metric?.note || '';
  if (lines.length > 1) {
    return `<div class="preview-metric preview-metric--routes"><small>${escapeHtml(eyebrow)}</small><strong>${escapeHtml(label)}</strong><span class="preview-metric-routes">${lines.map(previewMetricRoute).join('')}</span>${note ? `<span class="preview-metric-note">${withBreaks(note)}</span>` : ''}</div>`;
  }
  return `<div class="preview-metric"><small>${escapeHtml(eyebrow)}</small><strong>${escapeHtml(label)}：${escapeHtml(lines[0] || '')}</strong>${note ? `<span class="preview-metric-note">${withBreaks(note)}</span>` : ''}</div>`;
}

function renderHomepagePreview(data) {
  const slideIndex = Math.max(0, Math.min(state.homepagePreviewSlide, data.hero.slides.length - 1));
  const heroImage = currentImageUrl(`hero.slides.${slideIndex}.image`, data.hero.slides[slideIndex]?.image);
  return `<section class="preview-home-hero" data-preview-anchor="home-hero"${heroImage ? ` style="background-image:url('${escapeHtml(heroImage)}')"` : ''}>
      <div class="preview-home-hero-copy"><small>${escapeHtml(data.hero.eyebrow)}</small><h2>${withBreaks(data.hero.title)}</h2><p>${withBreaks(data.hero.copy)}</p><div><span>${escapeHtml(data.hero.primaryLabel)}</span><b>${escapeHtml(data.hero.secondaryLabel)} ↓</b></div></div>
      <em>${escapeHtml(data.hero.credit)}</em>
    </section>
    <div class="preview-home-content">
      <section class="preview-home-intro" data-preview-anchor="home-intro">
        <div><small>${escapeHtml(data.intro.eyebrow)}</small><h3>${withBreaks(data.intro.title)}</h3></div>
        <div><strong>${withBreaks(data.intro.lead)}</strong><p>${withBreaks(data.intro.copy)}</p></div>
      </section>
      <section class="preview-home-selection" data-preview-anchor="home-selection">
        ${previewSectionTitle(data.selection.eyebrow, data.selection.title, data.selection.copy)}
        <div class="preview-home-selection-list">${data.selection.items.map((item, index) => {
          const image = currentImageUrl(`selection.items.${index}.image`, item.image);
          return `<article data-preview-anchor="home-selection-${index}"${index === 0 ? ' class="active"' : ''}>${image ? `<img src="${escapeHtml(image)}" alt="" />` : ''}<div><small>${escapeHtml(item.placeLatin)} · ${escapeHtml(item.placeCn)}</small><span>${escapeHtml(item.kicker)}</span><h4>${escapeHtml(item.title)}</h4><p>${withBreaks(item.copy)}</p><b>${escapeHtml(item.ctaLabel)} →</b></div></article>`;
        }).join('')}</div>
      </section>
      <section class="preview-home-ways" data-preview-anchor="home-ways">
        ${previewSectionTitle(data.ways.eyebrow, data.ways.title, data.ways.copy)}
        <div class="preview-home-way-grid">${data.ways.items.map((item, index) => {
          const image = currentImageUrl(`ways.items.${index}.image`, item.image);
          return `<article data-preview-anchor="home-way-${index}"${image ? ` style="background-image:url('${escapeHtml(image)}')"` : ''}><div><small>${escapeHtml(item.kicker)}</small><h4>${escapeHtml(item.title)}</h4><p>${withBreaks(item.copy)}</p><b>${escapeHtml(item.ctaLabel)} →</b></div></article>`;
        }).join('')}</div>
      </section>
    </div>`;
}

function renderJourneysPreview() {
  const items = state.journeys.map(journeyDisplayItem);
  const visible = items.filter((item) => item.visibility !== 'hidden');
  const drafts = items.filter((item) => item.hasDraft || state.resources[item.id]?.dirty);
  const regions = new Set(items.map((item) => item.regionId || item.regionCode).filter(Boolean));
  return `<header class="preview-system-head" data-preview-anchor="journey-library">
      <span class="preview-system-badge">内部行程目录</span>
      <small>JOURNEY LIBRARY</small><h2>${items.length}个行程 · ${regions.size}个地区</h2><p>这里汇总后台行程状态，不会作为官网页面直接展示。</p>
    </header>
    <div class="preview-system-content">
      <div class="preview-status-grid">
        <article><small>ALL JOURNEYS</small><strong>${items.length}个</strong><span>后台全部行程</span></article>
        <article><small>ON WEBSITE</small><strong>${visible.length}个</strong><span>官网当前展示</span></article>
        <article><small>WITH DRAFTS</small><strong>${drafts.length}个</strong><span>有草稿或本机修改</span></article>
      </div>
      <section class="preview-system-card"><small>REGIONAL PRODUCTS</small><h3>行程状态</h3><div class="preview-team-list">${items.map((item) => `<div><span><strong>${escapeHtml(String(item.title || item.id).replaceAll('\n', ' '))}</strong><small>${escapeHtml(item.regionName || regionById(item.regionId).name)} · ${Number(item.daysCount || 0)}天</small></span><b>${item.visibility === 'hidden' ? '官网隐藏' : '官网展示'}</b></div>`).join('')}</div></section>
    </div>`;
}

function renderOverviewPreview(data) {
  const hero = currentImageUrl('hero.image', data.hero.image);
  const mapImage = data.map.mode === 'image'
    ? currentImageUrl('map.image', data.map.image)
    : data.map.mode === 'legacy'
      ? imageUrl(state.device === 'mobile' ? data.map.mobile : data.map.desktop)
      : '';
  const facts = data.overview.facts || [];
  const bookingItems = [
    ['CURRENT STATUS', data.booking.currentStatus],
    ['DEPARTURE', data.booking.departure],
    ['REFERENCE PRICE', data.booking.price],
    ['TRAVEL STYLE', data.booking.travelStyle],
  ];
  return `<section class="preview-hero" data-preview-anchor="journey-hero"${hero ? ` style="background-image:url('${escapeHtml(hero)}')"` : ''}>
      <div class="preview-hero-content"><small>${escapeHtml(data.hero.kicker)}</small><h2>${withBreaks(data.hero.title)}</h2><p>${escapeHtml(data.hero.copy)}</p><div class="preview-tags">${(data.hero.tags || []).map((tag) => `<span>${escapeHtml(tag)}</span>`).join('')}</div></div>
    </section>
    <div class="preview-content">
      <section class="preview-overview-block" data-preview-anchor="journey-overview">
        ${previewSectionTitle('JOURNEY OVERVIEW', data.overview.title, data.overview.copy)}
        <div class="preview-route">${escapeHtml(data.overview.route)}</div>
        <div class="preview-facts">${facts.map((fact) => `<div><small>${escapeHtml(fact.label)}</small><strong>${escapeHtml(fact.value)}</strong></div>`).join('')}</div>
      </section>
      <section class="preview-map-card" data-preview-anchor="journey-map"><small>ROUTE MAP · ${escapeHtml(data.map.mode === 'summary' ? '路线摘要' : '地图图片')}</small><h4>${escapeHtml(data.map.title)}</h4><p>${escapeHtml(data.map.copy)}</p>${mapImage ? `<img src="${escapeHtml(mapImage)}" alt="${escapeHtml(data.map.alt)}" />` : `<div class="preview-route-days">${data.map.days.map((day) => `<span><small>DAY ${escapeHtml(day.number)}</small><b>${escapeHtml(day.title || '待填写')}</b><i>${escapeHtml(day.route || '待填写路线')}</i></span>`).join('')}</div>`}<span>${escapeHtml(data.map.caption)}</span></section>
      <aside class="preview-booking" data-preview-anchor="journey-booking">
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
      <article class="preview-day" data-preview-anchor="journey-day">
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
  return `<div class="preview-content preview-content--highlights" data-preview-anchor="highlights">
      ${previewSectionTitle('VISUAL STORY', data.highlights.title, data.highlights.copy)}
      <div class="preview-highlight-grid">${data.highlights.items.map((item, index) => {
        const image = currentImageUrl(`highlights.items.${index}.image`, item.image);
        return `<article class="preview-highlight-card${image ? '' : ' empty'}" data-preview-anchor="highlight-${index}"${image ? ` style="background-image:url('${escapeHtml(image)}')"` : ''}><div><small>${escapeHtml(item.eyebrow)}</small><h4>${escapeHtml(item.title)}</h4></div></article>`;
      }).join('')}</div>
    </div>`;
}

function renderStaysPreview(data) {
  return `<div class="preview-content preview-content--stays" data-preview-anchor="stays">
      ${previewSectionTitle('STAYS & NOTES', data.stays.title, data.stays.copy)}
      <div class="preview-stay-grid">${data.stays.groups.map((group, index) => `<article class="preview-stay-card" data-preview-anchor="stay-${index}"><small>${escapeHtml(group.eyebrow)}</small><h4>${escapeHtml(group.title)}</h4><ul>${group.hotels.map((hotel) => `<li>${escapeHtml(hotel)}</li>`).join('')}</ul><p>${escapeHtml(group.copy)}</p></article>`).join('')}</div>
      <section class="preview-notes" data-preview-anchor="journey-notes">
        ${previewSectionTitle('TRAVEL NOTES', data.notes.title, data.notes.copy)}
        <div class="preview-note-grid">${data.notes.items.map((item) => `<article><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.copy)}</p></article>`).join('')}</div>
        <p class="preview-disclaimer">${escapeHtml(data.notes.photoDisclaimer)}</p>
      </section>
    </div>`;
}

function renderPublishPreview(data) {
  const errors = validateContentForPublish();
  const latest = state.history[0];
  const isHomepage = state.resourceId === 'homepage';
  const meta = currentResourceMeta();
  const checks = errors.length
    ? errors.slice(0, 4).map((error) => `<li class="warning">${escapeHtml(error)}</li>`).join('')
    : isHomepage
      ? '<li>首页4个内容板块字段完整</li><li>3张封面、6项飞鸟之选和3种出发方式图片完整</li><li>按钮去向与轮播动画已锁定</li><li>官网继续使用静态文件高速加载</li>'
      : `<li>${data.days.length}天行程字段完整</li><li>${escapeHtml(seasonById(data.management?.season).label)}视觉模板已应用</li><li>响应式图片与独立静态页已准备</li><li>官网继续使用静态文件高速加载</li>`;
  const contentStatus = isHomepage
    ? [`${data.selection.items.length}项飞鸟之选`, `${data.hero.slides.length}张封面 · ${data.ways.items.length}种出发方式`]
    : [`${data.days.length}天行程`, `${data.highlights.items.length}项亮点 · ${data.stays.groups.length}组住宿`];
  return `<header class="preview-system-head" data-preview-anchor="publish-status">
      <span class="preview-system-badge ${state.dirty ? 'warning' : ''}">${state.dirty ? '有待处理修改' : '草稿状态正常'}</span>
      <small>PUBLISH CENTER</small><h2>${escapeHtml(meta.label)}发布检查</h2><p>这里是内部发布检查，不会作为官网页面展示给游客。</p>
    </header>
    <div class="preview-system-content">
      <div class="preview-status-grid">
        <article><small>DRAFT</small><strong>${state.dirty ? '尚未保存' : '已保存'}</strong><span>${state.dirty ? '请先保存草稿' : '可以继续发布检查'}</span></article>
        <article><small>CONTENT</small><strong>${escapeHtml(contentStatus[0])}</strong><span>${escapeHtml(contentStatus[1])}</span></article>
        <article><small>VALIDATION</small><strong>${errors.length ? `${errors.length}项待完善` : '检查通过'}</strong><span>${errors.length ? '发布前需要处理' : '关键字段均已填写'}</span></article>
      </div>
      <section class="preview-system-card" data-preview-anchor="publish-check"><small>PRE-PUBLISH CHECK</small><h3>发布检查</h3><ul class="preview-check-list">${checks}</ul></section>
      <section class="preview-system-card" data-preview-anchor="publish-history"><small>LATEST PUBLISH</small><h3>最近发布</h3>${latest ? `<div class="preview-history"><strong>${escapeHtml(latest.message || meta.defaultMessage)}</strong><span>${escapeHtml(latest.publishedByName || latest.publishedBy || '')} · ${escapeHtml(formatDate(latest.publishedAt))}</span><b>${escapeHtml(String(latest.commitSha || '').slice(0, 7))}</b></div>` : '<p class="preview-empty">后台尚未读取到发布记录。</p>'}</section>
    </div>`;
}

function renderStaffPreview() {
  const staff = state.staff?.staff || (state.actor ? [state.actor] : []);
  const invites = (state.staff?.invites || []).filter((invite) => invite.active);
  const activeStaff = staff.filter((person) => person.active !== false);
  return `<header class="preview-system-head preview-system-head--staff" data-preview-anchor="staff-status">
      <span class="preview-system-badge">仅工作人员可见</span>
      <small>TEAM ACCESS</small><h2>账号与权限状态</h2><p>这里是内部权限概览，不会出现在飞鸟旅行官网。</p>
    </header>
    <div class="preview-system-content">
      <div class="preview-status-grid">
        <article><small>ACTIVE STAFF</small><strong>${activeStaff.length}人</strong><span>当前可正常使用后台</span></article>
        <article><small>PENDING</small><strong>${invites.length}人</strong><span>等待首次邮箱登录</span></article>
        <article><small>YOUR ROLE</small><strong>${state.actor?.role === 'admin' ? '管理员' : '编辑'}</strong><span>${escapeHtml(state.actor?.name || state.actor?.email || '当前账号')}</span></article>
      </div>
      <section class="preview-system-card" data-preview-anchor="staff-team"><small>ACTIVE TEAM</small><h3>已加入人员</h3><div class="preview-team-list">${activeStaff.length ? activeStaff.map((person) => `<div><span><strong>${escapeHtml(person.name || person.email)}</strong><small>${escapeHtml(person.email || '')}</small></span><b>${person.role === 'admin' ? '管理员' : '编辑'}</b></div>`).join('') : '<p class="preview-empty">暂无人员记录。</p>'}</div></section>
      <section class="preview-system-card"><small>PENDING INVITES</small><h3>待加入邮箱</h3><div class="preview-team-list">${invites.length ? invites.map((invite) => `<div><span><strong>${escapeHtml(invite.email)}</strong><small>${escapeHtml(formatDate(invite.createdAt))}</small></span><b>${invite.role === 'admin' ? '管理员' : '编辑'}</b></div>`).join('') : '<p class="preview-empty">当前没有待加入邀请。</p>'}</div></section>
    </div>`;
}

const previewRenderers = {
  home: renderHomepagePreview,
  journeys: renderJourneysPreview,
  overview: renderOverviewPreview,
  days: renderDaysPreview,
  highlights: renderHighlightsPreview,
  stays: renderStaysPreview,
  publish: renderPublishPreview,
  staff: renderStaffPreview,
};

function renderPreview() {
  if (!state.previewFocus
    || state.previewFocus.tab !== state.tab
    || state.previewFocus.resourceId !== state.resourceId) {
    resetPreviewFocus();
  }
  const [eyebrow, title] = PREVIEW_COPY[state.tab];
  elements.previewEyebrow.textContent = eyebrow;
  elements.previewTitle.textContent = title;
  const season = isJourneyResource() ? state.content?.management?.season || 'all' : 'all';
  elements.journeyPreview.className = `journey-preview preview-${state.tab} preview-season-${season}${state.device === 'mobile' ? ' mobile' : ''}`;
  elements.journeyPreview.innerHTML = `<div class="preview-browser"><i></i><i></i><i></i></div>${previewRenderers[state.tab](state.content)}`;
  applyPreviewFocus();
}

async function loadHistory() {
  if (DEMO_MODE) return;
  const resourceId = state.resourceId;
  try {
    const result = await callCms('history', { resourceId });
    state.resources[resourceId].history = result.items || [];
  } catch (error) {
    showToast(`发布记录读取失败：${error.message}`, 'error');
  }
}

async function loadJourneys(options = {}) {
  if (state.journeysLoaded && !options.force) return;
  if (DEMO_MODE) {
    state.journeysLoaded = true;
    return;
  }
  const result = await callCms('listJourneys');
  const items = Array.isArray(result.items) ? result.items : [];
  state.journeys = items;
  items.forEach((item) => registerJourneyResource(
    item,
    item.id === initialJourney.id ? initialJourney : null,
  ));
  state.journeysLoaded = true;
  updateSidebarContext();
}

async function loadResource(resourceId, options = {}) {
  const resource = state.resources[resourceId];
  const meta = RESOURCE_META[resourceId];
  if (!resource || !meta) throw new Error('后台内容类型不受支持');
  if (resource.loaded && !options.force) return;
  if (DEMO_MODE) {
    resource.loaded = true;
    if (options.restoreLocal !== false) restoreLocalDraft(resourceId, null);
    return;
  }
  const result = await callCms('getContent', { resourceId });
  if (result.content?.id && result.content.id !== resourceId) {
    throw new Error(`云函数尚未支持${meta.label}。请部署 V33 asuka-cms 云函数包后重新进入后台。`);
  }
  const nextContent = clone(result.content || meta.initial);
  const nextPublished = clone(result.published || result.content || meta.initial);
  resource.content = isJourneyResource(resourceId) ? normalizeJourney(nextContent) : nextContent;
  resource.published = isJourneyResource(resourceId) && nextPublished ? normalizeJourney(nextPublished) : nextPublished;
  resource.draftInfo = result.draftInfo || null;
  resource.revision = Number(result.draftInfo?.revision) || 0;
  resource.publishRequestId = null;
  resource.dirty = false;
  resource.loaded = true;
  if (options.restoreLocal !== false) restoreLocalDraft(resourceId, result.draftInfo?.updatedAt);
  if (isJourneyResource(resourceId)) {
    resource.content = normalizeJourney(resource.content);
    registerJourneyResource({ id: resourceId, title: resource.content.card?.title }, resource.content);
    upsertJourneyListFromContent(resource.content, { hasDraft: Boolean(result.draftInfo) });
  }
  updateSidebarContext();
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
  if (tab === 'journeys') {
    try {
      await loadJourneys();
    } catch (error) {
      showToast(`行程目录读取失败：${error.message}`, 'error');
    }
  }
  const journeyTabs = ['overview', 'days', 'highlights', 'stays', 'publish'];
  let nextResourceId = state.resourceId;
  if (tab === 'home') nextResourceId = 'homepage';
  else if (journeyTabs.includes(tab)) {
    nextResourceId = isJourneyResource(nextResourceId) ? nextResourceId : currentJourneyId();
    state.activeJourneyId = nextResourceId;
  }
  state.tab = tab;
  state.resourceId = nextResourceId;
  resetPreviewFocus(tab);
  document.querySelectorAll('.nav-item').forEach((button) => button.classList.toggle('active', button.dataset.tab === tab));
  const [eyebrow, baseTitle] = TAB_COPY[tab];
  elements.sectionEyebrow.textContent = eyebrow;
  elements.sectionTitle.textContent = journeyTabs.includes(tab) ? `${baseTitle} · ${currentResourceMeta().shortLabel}` : baseTitle;
  elements.cmsApp.classList.remove('sidebar-open');
  elements.mobileMenu.setAttribute('aria-expanded', 'false');
  updateSidebarContext();
  if (!state.resources[nextResourceId]?.loaded) {
    elements.editorCanvas.innerHTML = `<div class="editor-loading"><span></span><p>正在读取${escapeHtml(RESOURCE_META[nextResourceId].label)}最新内容…</p></div>`;
    elements.journeyPreview.innerHTML = '';
    try {
      await loadResource(nextResourceId);
    } catch (error) {
      elements.editorCanvas.innerHTML = `<div class="editor-section">${sectionIntro('SETUP REQUIRED', '内容暂时无法读取', error.message)}</div>`;
      showToast(error.message, 'error');
      return;
    }
  }
  synchronizeContent();
  updateSaveState();
  renderEditor();
  renderPreview();
  elements.previewStage.scrollTo({ top: 0, behavior: 'smooth' });
  if (tab === 'publish') await loadHistory();
  if (tab === 'staff') await loadStaff();
  if (state.tab !== tab || !['publish', 'staff'].includes(tab)) return;
  renderEditor();
  renderPreview();
}

async function selectJourney(resourceId) {
  const item = state.journeys.find((journey) => journey.id === resourceId);
  if (!item && !state.resources[resourceId]) return showToast('没有找到这个行程', 'error');
  if (!state.resources[resourceId]) registerJourneyResource(item);
  state.activeJourneyId = resourceId;
  state.resourceId = resourceId;
  state.selectedDay = 0;
  updateSidebarContext();
  await selectTab('overview');
}

async function openJourneyModal(sourceResourceId = '') {
  try {
    await loadJourneys();
    const preferredSource = sourceResourceId
      || (isJourneyResource() ? state.resourceId : '')
      || state.journeys[0]?.id
      || 'kanto-6d';
    if (!state.resources[preferredSource]) {
      const item = state.journeys.find((journey) => journey.id === preferredSource);
      if (item) registerJourneyResource(item);
    }
    if (!state.resources[preferredSource]?.loaded) await loadResource(preferredSource);
    const source = state.resources[preferredSource].content;
    const sourceOptions = state.journeys.map((journey) => `<option value="${escapeHtml(journey.id)}"${journey.id === preferredSource ? ' selected' : ''}>${escapeHtml(String(journey.title || journey.id).replaceAll('\n', ' '))}</option>`).join('');
    openModal(`<p class="editor-kicker">NEW JOURNEY</p>
      <h2>${sourceResourceId ? '复制行程' : '新增行程'}</h2>
      <p>选择现有行程作为版式框架，再决定保留正文参考或从空白字段开始。新行程默认官网隐藏，可放心分阶段保存草稿。</p>
      <form class="journey-create-form" id="journeyCreateForm">
        <div class="field full"><label for="journeySource">框架来源</label><select id="journeySource">${sourceOptions}</select></div>
        <div class="journey-template-mode full">
          <label><input type="radio" name="templateMode" value="structure"${sourceResourceId ? '' : ' checked'}><span><strong>仅保留结构</strong><small>清空路线文字并标记占位图片，适合全新目的地</small></span></label>
          <label><input type="radio" name="templateMode" value="copy"${sourceResourceId ? ' checked' : ''}><span><strong>复制全部内容</strong><small>保留正文与图片，适合同路线季节版或相近产品</small></span></label>
        </div>
        <div class="journey-create-grid full">
          <div class="field"><label for="newJourneyTitle">行程标题</label><input id="newJourneyTitle" maxlength="80" required placeholder="例如：京都奈良·关西雅行5日"></div>
          <div class="field"><label for="newJourneyId">网址编号</label><input id="newJourneyId" maxlength="64" required pattern="[a-z][a-z0-9-]{2,63}" placeholder="例如：kansai-5d"><div class="field-help"><span>仅小写字母、数字和连字符，创建后不可改。</span><span></span></div></div>
          <div class="field"><label for="newProductCode">产品编号</label><input id="newProductCode" maxlength="32" required placeholder="例如：AS-KANSAI-05"></div>
          <div class="field"><label for="newJourneyDays">行程天数</label><input id="newJourneyDays" type="number" min="1" max="30" value="${source.days.length}" required></div>
          <div class="field"><label for="newJourneyRegion">所属地区</label><select id="newJourneyRegion">${REGIONS.map((region) => `<option value="${region.id}"${region.id === source.regionId ? ' selected' : ''}>${region.code} · ${region.name}</option>`).join('')}</select></div>
          <div class="field"><label for="newJourneySeason">季节模板</label><select id="newJourneySeason">${SEASONS.map((season) => `<option value="${season.id}"${season.id === source.management.season ? ' selected' : ''}>${season.label}｜${season.motif}</option>`).join('')}</select></div>
          <div class="field full"><label for="newTravelMonths">适合月份</label><input id="newTravelMonths" maxlength="40" value="${escapeHtml(source.management.travelMonths || '全年适用')}" placeholder="例如：3月下旬—4月中旬"></div>
        </div>
        <div class="template-safety-note full"><strong>发布保护已开启</strong><span>“仅保留结构”会阻止模板占位图直接发布；请替换图片并补全必填内容。</span></div>
        <div class="modal-actions full"><button class="secondary" data-close-modal type="button">取消</button><button class="primary" type="submit">创建并开始编辑</button></div>
      </form>`);
    elements.modalContent.querySelector('[data-close-modal]').addEventListener('click', closeModal);
    elements.modalContent.querySelector('#journeyCreateForm').addEventListener('submit', createJourney);
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function createJourney(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const resourceId = form.querySelector('#newJourneyId').value.trim().toLowerCase();
  const title = form.querySelector('#newJourneyTitle').value.trim();
  const productCode = form.querySelector('#newProductCode').value.trim().toUpperCase();
  const sourceResourceId = form.querySelector('#journeySource').value;
  if (!JOURNEY_ID_PATTERN.test(resourceId)) return showToast('网址编号格式不正确', 'error');
  if (state.journeys.some((item) => item.id === resourceId)) return showToast('这个网址编号已被使用', 'error');
  if (state.journeys.some((item) => String(item.productCode).toUpperCase() === productCode)) return showToast('这个产品编号已被使用', 'error');
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  button.textContent = '正在创建…';
  try {
    if (!state.resources[sourceResourceId]?.loaded) await loadResource(sourceResourceId);
    const content = createJourneyFromTemplate(state.resources[sourceResourceId].content, {
      id: resourceId,
      title,
      productCode,
      daysCount: Number(form.querySelector('#newJourneyDays').value),
      regionId: form.querySelector('#newJourneyRegion').value,
      season: form.querySelector('#newJourneySeason').value,
      travelMonths: form.querySelector('#newTravelMonths').value.trim(),
      mode: form.querySelector('[name="templateMode"]:checked').value,
    });
    let result = { revision: 1, savedAt: new Date().toISOString() };
    if (!DEMO_MODE) {
      result = await callCms('createJourney', {
        resourceId,
        sourceResourceId,
        content,
      });
    }
    const resource = registerJourneyResource({ id: resourceId, title }, content);
    resource.content = content;
    resource.published = null;
    resource.revision = Number(result.revision) || 1;
    resource.draftInfo = { revision: resource.revision, updatedAt: result.savedAt };
    resource.dirty = false;
    resource.loaded = true;
    upsertJourneyListFromContent(content, { hasDraft: true });
    saveLocalDraft(resourceId);
    closeModal();
    showToast('新行程已建立并保存为隐藏草稿');
    await selectJourney(resourceId);
  } catch (error) {
    button.disabled = false;
    button.textContent = '重试创建';
    showToast(error.message, 'error');
  }
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
    await loadResource(state.resourceId, { force: true, restoreLocal: false });
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
  const meta = currentResourceMeta();
  const isHomepage = state.resourceId === 'homepage';
  const errors = validateContentForPublish();
  if (errors.length) {
    openModal(`<p class="editor-kicker">CHECK REQUIRED</p><h2>发布前还需完善</h2><p>请先处理以下内容：</p><div class="publish-checks">${errors.slice(0, 8).map((error) => `<div>● ${escapeHtml(error)}</div>`).join('')}</div><div class="modal-actions"><button class="primary" data-close-modal type="button">返回修改</button></div>`);
    elements.modalContent.querySelector('[data-close-modal]').addEventListener('click', closeModal);
    return;
  }
  state.publishRequestId ||= window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const checks = isHomepage
    ? '<div>✓ 首页封面、品牌介绍、飞鸟之选与出发方式完整</div><div>✓ 桌面与手机共用同一份响应式图片</div><div>✓ 版式、动画与功能链接保持锁定</div>'
    : `<div>✓ ${state.content.days.length}天行程字段完整</div><div>✓ ${escapeHtml(seasonById(state.content.management?.season).label)}视觉与手机排版已应用</div><div>✓ 响应式图片和逐日路线完整</div>`;
  openModal(`<p class="editor-kicker">READY TO PUBLISH</p><h2>确认发布${escapeHtml(meta.label)}？</h2><p>本次只更新“${escapeHtml(meta.label)}”的文字、响应式图片与对应静态页面；不会覆盖另一个内容资源。GitHub Pages 通常在1—3分钟内显示最新版。</p>
    <div class="publish-checks">${checks}<div>✓ 发布密钥只在云函数中使用</div></div>
    <div class="field full"><label for="publishMessage">本次提交说明</label><input id="publishMessage" maxlength="100" value="${escapeHtml(meta.defaultMessage)}" /></div>
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
      resourceId: state.resourceId,
      content: state.content,
      message,
      revision: state.revision,
      requestId: state.publishRequestId,
    });
    if (result.draftAdvanced) {
      state.published = stripClientInternal(clone(state.content));
      state.publishRequestId = null;
      state.dirty = true;
      if (isJourneyResource()) upsertJourneyListFromContent(state.content, { hasDraft: true });
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
    if (isJourneyResource()) upsertJourneyListFromContent(state.content, { hasDraft: false });
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
    element.hidden = state.actor?.role !== 'admin'
      || (element === elements.quickPublishButton && ['journeys', 'staff'].includes(state.tab));
  });
  elements.saveButton.hidden = ['journeys', 'staff'].includes(state.tab);
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
    state.resourceId = 'homepage';
    state.tab = 'home';
    await loadResource('homepage');
    await loadJourneys().catch((error) => showToast(`行程目录读取失败：${error.message}`, 'error'));
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

document.querySelectorAll('.nav-item[data-tab]').forEach((button) => button.addEventListener('click', () => selectTab(button.dataset.tab)));
document.querySelector('[data-action="new-journey"]')?.addEventListener('click', () => {
  elements.cmsApp.classList.remove('sidebar-open');
  elements.mobileMenu.setAttribute('aria-expanded', 'false');
  openJourneyModal();
});
document.querySelectorAll('[data-device]').forEach((button) => button.addEventListener('click', () => {
  state.device = button.dataset.device;
  document.querySelectorAll('[data-device]').forEach((item) => item.classList.toggle('active', item === button));
  renderPreview();
}));
elements.editorCanvas.addEventListener('focusin', (event) => {
  const control = event.target.closest('[data-path], [data-array-path], [data-image-upload], [data-image-alt], [data-season-select]');
  if (control && elements.editorCanvas.contains(control)) focusPreviewForControl(control);
});

elements.sendCodeButton.addEventListener('click', sendCode);
elements.loginForm.addEventListener('submit', login);
elements.saveButton.addEventListener('click', saveDraft);
elements.quickPublishButton.addEventListener('click', openPublishModal);
elements.signOutButton.addEventListener('click', async () => {
  if (hasAnyDirtyResource() && !confirm('当前有未保存修改，确定退出吗？')) return;
  if (!DEMO_MODE) await signOut();
  location.href = location.pathname;
});
elements.mobileMenu.addEventListener('click', () => {
  const open = elements.cmsApp.classList.toggle('sidebar-open');
  elements.mobileMenu.setAttribute('aria-expanded', String(open));
});
elements.sidebarClose.addEventListener('click', () => {
  elements.cmsApp.classList.remove('sidebar-open');
  elements.mobileMenu.setAttribute('aria-expanded', 'false');
  elements.mobileMenu.focus();
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
  if (!hasAnyDirtyResource()) return;
  event.preventDefault();
  event.returnValue = '';
});

bootstrap();
