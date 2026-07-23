'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { renderSite } = require('../cloudbase/functions/asuka-cms/lib/render-journey.cjs');
const { migrateAirportMetrics, stripInternal, synchronizeJourney, validateJourney } = require('../cloudbase/functions/asuka-cms/lib/validation');

const root = path.resolve(__dirname, '..');
const data = JSON.parse(fs.readFileSync(path.join(root, 'content/journeys/kanto-6d.json'), 'utf8'));
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

test('关东6日内容通过发布校验', () => {
  assert.equal(validateJourney(structuredClone(data)).id, 'kanto-6d');
});

test('静态生成结果幂等并保留三个CMS区块', () => {
  const once = renderSite(html, data);
  const twice = renderSite(once, data);
  assert.equal(twice, once);
  assert.equal((once.match(/ASUKA_CMS:KANTO_CARD:START/g) || []).length, 1);
  assert.equal((once.match(/ASUKA_CMS:KANTO_JOURNEY:START/g) || []).length, 1);
  assert.equal((once.match(/ASUKA_CMS:KANTO_INQUIRY:START/g) || []).length, 1);
});

test('官网逐日使用后台当前的行车里程与预计驾驶时间', () => {
  const rendered = renderSite(html, data);
  for (const day of data.days) {
    for (const line of [...day.distance.value.split('\n'), ...day.duration.value.split('\n')]) {
      for (const part of line.split('：')) assert.ok(rendered.includes(part));
    }
    assert.ok(rendered.includes(day.distance.note));
    assert.ok(rendered.includes(day.duration.note));
  }
  assert.doesNotMatch(rendered, /参考车程：/);
  assert.doesNotMatch(rendered, /预计耗时：/);
});

test('接送机双机场路线在官网与后台预览中逐行展示', () => {
  const rendered = renderSite(html, data);
  const adminSource = fs.readFileSync(path.join(root, 'admin-src', 'main.js'), 'utf8');
  const adminStyles = fs.readFileSync(path.join(root, 'admin-src', 'styles.css'), 'utf8');
  assert.match(rendered, /metric-card--routes/);
  assert.match(rendered, /metric-route-name">羽田机场 → 东京酒店/);
  assert.match(rendered, /metric-route-value">约30—50分钟/);
  assert.match(rendered, /metric-route-name">东京酒店 → 成田机场/);
  assert.doesNotMatch(rendered, /羽田约30—50分钟｜成田约60—90分钟/);
  assert.match(adminSource, /preview-metric-routes/);
  assert.match(adminSource, /多条路线时，每条路线占一行/);
  assert.match(adminStyles, /\.preview-metric-route > b[\s\S]*?white-space:\s*nowrap/);
  assert.match(rendered, /v29\.1: keep airport transfer routes and values on clear independent lines/);
});

test('官网行程数据卡与后台预览保持两列并在手机端切换单列', () => {
  const rendered = renderSite(html, data);
  const adminStyles = fs.readFileSync(path.join(root, 'admin-src', 'styles.css'), 'utf8');
  assert.match(adminStyles, /\.preview-metrics\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(rendered, /v27: match the CMS preview's readable two-column journey data cards/);
  assert.match(rendered, /\.itinerary \.day-metrics\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\);gap:10px/);
  assert.match(rendered, /border-radius:7px;background:#e9e3d9/);
  assert.match(rendered, /@media\(max-width:540px\)\{\.itinerary \.day-metrics\{grid-template-columns:1fr\}/);
});

test('后台右侧内容跟随六个左侧栏目切换', () => {
  const adminSource = fs.readFileSync(path.join(root, 'admin-src', 'main.js'), 'utf8');
  const adminStyles = fs.readFileSync(path.join(root, 'admin-src', 'styles.css'), 'utf8');
  for (const renderer of [
    'renderOverviewPreview',
    'renderDaysPreview',
    'renderHighlightsPreview',
    'renderStaysPreview',
    'renderPublishPreview',
    'renderStaffPreview',
  ]) {
    assert.match(adminSource, new RegExp(`function ${renderer}\\(`));
  }
  assert.match(adminSource, /const previewRenderers = \{[\s\S]*?overview:[\s\S]*?days:[\s\S]*?highlights:[\s\S]*?stays:[\s\S]*?publish:[\s\S]*?staff:/);
  assert.match(adminSource, /previewRenderers\[state\.tab\]\(state\.content\)/);
  assert.match(adminSource, /elements\.previewTitle\.textContent = title/);
  assert.match(adminSource, /async function selectTab\([\s\S]*?renderEditor\(\);[\s\S]*?renderPreview\(\);/);
  assert.match(adminStyles, /\.journey-preview\.mobile \.preview-facts,[\s\S]*?\.journey-preview\.mobile \.preview-check-list\s*\{\s*grid-template-columns:\s*1fr/);
  assert.match(adminStyles, /\.journey-preview\.mobile \.preview-metrics\s*\{\s*grid-template-columns:\s*1fr/);
});

test('用户输入会在静态生成时转义', () => {
  const unsafe = structuredClone(data);
  unsafe.card.title = '<script>alert(1)</script>';
  const rendered = renderSite(html, unsafe);
  assert.doesNotMatch(rendered, /<script>alert\(1\)<\/script>/);
  assert.match(rendered, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test('发布内容会移除仅供后台使用的内部字段', () => {
  const draft = structuredClone(data);
  draft.hero.image._assetId = 'temporary-asset';
  const clean = stripInternal(draft);
  assert.equal(clean.hero.image._assetId, undefined);
  assert.equal(clean.hero.image.webp480, data.hero.image.webp480);
});

test('构建后的后台不包含常见密钥前缀', () => {
  const adminDir = path.join(root, 'admin');
  const files = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(fullPath);
      else files.push(fullPath);
    }
  };
  walk(adminDir);
  const output = files.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
  assert.doesNotMatch(output, /github_pat_[A-Za-z0-9_]+/);
  assert.doesNotMatch(output, /AKID[A-Za-z0-9]{12,}/);
  assert.doesNotMatch(output, /SecretKey\s*[:=]\s*['"][^'"]+/i);
});

test('后台邮箱登录统一使用 CloudBase 无密码登录流程', () => {
  const apiSource = fs.readFileSync(path.join(root, 'admin-src', 'lib', 'api.js'), 'utf8');
  assert.match(apiSource, /await auth\.signInWithEmail\(/);
  assert.doesNotMatch(apiSource, /auth\.signUp\(/);
  assert.doesNotMatch(apiSource, /auth\.verify\(/);
  assert.match(apiSource, /invalid_verification_code/);
});

test('产品标题与地图逐日路线只维护一份并自动同步', () => {
  const draft = structuredClone(data);
  draft.card.title = '统一后的产品标题';
  draft.days[2].route = '富士 → 箱根 → 伊豆';
  draft.days[2].title = '同步后的第三天';
  synchronizeJourney(draft);
  assert.equal(draft.hero.title, draft.card.title);
  assert.equal(draft.booking.title, draft.card.title);
  assert.equal(draft.hero.kicker, draft.card.kicker);
  assert.deepEqual(draft.map.days[2], {
    number: draft.days[2].number,
    title: draft.days[2].title,
    route: draft.days[2].route,
  });
});

test('接送机日按羽田与成田分别显示车程和驾驶时间', () => {
  for (const day of [data.days[0], data.days[5]]) {
    assert.match(day.distance.value, /羽田/);
    assert.match(day.distance.value, /成田/);
    assert.match(day.duration.value, /羽田/);
    assert.match(day.duration.value, /成田/);
    assert.match(day.distance.value, /\n/);
    assert.match(day.duration.value, /\n/);
    assert.doesNotMatch(day.distance.value, /｜/);
    assert.doesNotMatch(day.duration.value, /｜/);
  }
});

test('旧草稿中的双机场单行数据会安全迁移，不会再次覆盖新排版', () => {
  const legacy = structuredClone(data);
  legacy.days[0].distance.value = '羽田约20—25公里｜成田约65—75公里';
  legacy.days[0].duration.value = '羽田约30—50分钟｜成田约60—90分钟';
  legacy.days[5].distance.value = '羽田约20—25公里｜成田约65—75公里';
  legacy.days[5].duration.value = '羽田约30—50分钟｜成田约60—90分钟';
  migrateAirportMetrics(legacy);
  assert.equal(legacy.days[0].distance.value, data.days[0].distance.value);
  assert.equal(legacy.days[0].duration.value, data.days[0].duration.value);
  assert.equal(legacy.days[5].distance.value, data.days[5].distance.value);
  assert.equal(legacy.days[5].duration.value, data.days[5].duration.value);
});

test('同一个后台在手机端保留保存入口且官网提供手机菜单', () => {
  const adminStyles = fs.readFileSync(path.join(root, 'admin-src', 'styles.css'), 'utf8');
  const adminHtml = fs.readFileSync(path.join(root, 'admin-src', 'index.html'), 'utf8');
  assert.match(adminHtml, /id="saveButton"/);
  assert.match(adminHtml, /aria-controls="cmsSidebar" aria-expanded="false"/);
  assert.doesNotMatch(adminStyles, /\.cms-topbar p,\s*\.profile-chip,\s*#saveButton/);
  assert.match(adminStyles, /\.topbar-actions \.secondary,[\s\S]*?\.topbar-actions \.primary/);
  assert.match(html, /id="mobileNavToggle"/);
  assert.match(html, /id="mobileNavPanel"/);
  assert.match(html, /function openMobilePanel\(id\)/);
});

test('多人草稿与发布请求具有版本冲突和幂等保护', () => {
  const source = fs.readFileSync(path.join(root, 'cloudbase', 'functions', 'asuka-cms', 'index.js'), 'utf8');
  assert.match(source, /currentRevision !== expectedRevision/);
  assert.match(source, /DRAFT_CONFLICT/);
  assert.match(source, /publishJobId\(/);
  assert.match(source, /PUBLISH_IN_PROGRESS/);
  assert.match(source, /alreadyCurrent/);
  assert.match(source, /markAssetsPublished\(/);
});

test('响应式图片请求控制在 CloudBase 事件上限以内', () => {
  const browserSource = fs.readFileSync(path.join(root, 'admin-src', 'lib', 'images.js'), 'utf8');
  const functionSource = fs.readFileSync(path.join(root, 'cloudbase', 'functions', 'asuka-cms', 'index.js'), 'utf8');
  assert.match(browserSource, /MAX_OUTPUT_BYTES = 3 \* 1024 \* 1024/);
  assert.match(browserSource, /QUALITY_PROFILES/);
  assert.match(functionSource, /total > 3 \* 1024 \* 1024/);
  assert.match(functionSource, /Promise\.all\(Object\.entries\(specs\)/);
});

test('工作人员邀请会自动完成并支持权限管理', () => {
  const source = fs.readFileSync(path.join(root, 'cloudbase', 'functions', 'asuka-cms', 'index.js'), 'utf8');
  const adminSource = fs.readFileSync(path.join(root, 'admin-src', 'main.js'), 'utf8');
  assert.match(source, /acceptedAt: now\(\)/);
  assert.match(source, /revokeInvite:/);
  assert.match(source, /LAST_ADMIN/);
  assert.match(adminSource, /data-save-staff/);
  assert.match(adminSource, /data-toggle-staff/);
  assert.match(adminSource, /data-revoke-invite/);
});

test('部署配置要求云函数实际使用60秒超时', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'cloudbaserc.json'), 'utf8'));
  const cms = config.functions.find((item) => item.name === 'asuka-cms');
  assert.equal(cms.timeout, 60);
  assert.equal(cms.runtime, 'Nodejs20.19');
});

test('发布校验覆盖地图、亮点与住宿等完整结构', () => {
  const missingMap = structuredClone(data);
  missingMap.map.caption = '';
  assert.throws(() => validateJourney(missingMap), /行程地图注释/);

  const missingHighlight = structuredClone(data);
  missingHighlight.highlights.items.pop();
  assert.throws(() => validateJourney(missingHighlight), /亮点区必须保留4项内容/);

  const missingStay = structuredClone(data);
  missingStay.stays.groups[0].hotels = [];
  assert.throws(() => validateJourney(missingStay), /住宿组1酒店/);
});

test('官网包含基础搜索信息与站点地图入口', () => {
  assert.match(html, /<meta name="description"/);
  assert.match(html, /<link rel="canonical"/);
  assert.match(html, /<meta property="og:image"/);
  assert.ok(fs.existsSync(path.join(root, 'favicon.svg')));
  assert.ok(fs.existsSync(path.join(root, 'robots.txt')));
  assert.ok(fs.existsSync(path.join(root, 'sitemap.xml')));
});

test('官网进入画面保持纵向品牌结构且不增加外部资源', () => {
  const rendered = renderSite(html, data);
  const entryStart = rendered.indexOf('<div class="site-entry"');
  const entryEnd = rendered.indexOf('</div>\n  <header', entryStart);
  const entry = rendered.slice(entryStart, entryEnd);
  assert.ok(entryStart > -1);
  assert.ok(entry.indexOf('site-entry-bird') < entry.indexOf('site-entry-rule'));
  assert.ok(entry.indexOf('site-entry-rule') < entry.indexOf('site-entry-title'));
  assert.ok(entry.indexOf('site-entry-title') < entry.indexOf('site-entry-en'));
  assert.doesNotMatch(entry, /<img|https?:\/\//);
  assert.match(rendered, /background:#f0f0f1;color:#1a1c1f/);
  assert.match(rendered, /@media\(prefers-reduced-motion:reduce\)/);
  assert.match(rendered, /setTimeout\(leave,3200\)/);
});

test('飞鸟之选使用本地响应式图片并保留中央主图与两侧预告结构', () => {
  const rendered = renderSite(html, data);
  const start = rendered.indexOf('<section class="asuka-selection');
  const end = rendered.indexOf('<section class="entry section"', start);
  const selection = rendered.slice(start, end);

  assert.ok(start > -1);
  assert.equal((selection.match(/data-selection-slide/g) || []).length, 6);
  assert.equal((selection.match(/class="asuka-selection-slide is-active"/g) || []).length, 1);
  assert.equal((selection.match(/loading="lazy"/g) || []).length, 6);
  assert.equal((selection.match(/-v22-480\.webp/g) || []).length, 6);
  assert.equal((selection.match(/-v22-960\.webp/g) || []).length, 6);
  assert.equal((selection.match(/-v22-1600\.webp/g) || []).length, 6);
  assert.doesNotMatch(selection, /https?:\/\//);
  assert.match(rendered, /scroll-snap-type:x mandatory/);
  assert.match(rendered, /\.asuka-selection-slide\.is-active\{opacity:1;filter:none\}/);
  assert.match(rendered, /@media\(max-width:760px\)\{\.asuka-selection/);
});

test('飞鸟之选支持自动轮播、按钮、键盘与手机原生滑动并通过CMS发布保留', () => {
  const rendered = renderSite(html, data);

  assert.match(rendered, /id="asukaSelectionPrev"/);
  assert.match(rendered, /id="asukaSelectionNext"/);
  assert.match(rendered, /id="asukaSelectionStatus" aria-live="polite"/);
  assert.match(rendered, /event\.key!=='ArrowLeft'&&event\.key!=='ArrowRight'/);
  assert.match(rendered, /selectionViewport\.scrollTo\(\{left,behavior\}\)/);
  assert.match(rendered, /overscroll-behavior-x:contain/);
  assert.match(rendered, /selectionAutoDelay=4500/);
  assert.match(rendered, /scheduleSelectionAuto/);
  assert.match(rendered, /new IntersectionObserver\(\(\[entry\]\)=>/);
  assert.match(rendered, /pauseSelectionAuto\('pointer'\)/);
  assert.match(rendered, /pauseSelectionAuto\('hover'\)/);
  assert.match(rendered, /document\.addEventListener\('visibilitychange'/);
  assert.match(rendered, /reducedMotion\|\|!selectionInView/);
  assert.match(rendered, /2026-07-23-v31-1-selection-autoplay/);
});
