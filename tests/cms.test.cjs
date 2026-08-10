'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { renderJourneyPage, renderSite } = require('../cloudbase/functions/asuka-cms/lib/render-journey.cjs');
const {
  migrateAirportMetrics,
  stripInternal,
  synchronizeJourney,
  validateHomepage,
  validateJourney,
} = require('../cloudbase/functions/asuka-cms/lib/validation');

const root = path.resolve(__dirname, '..');
const data = JSON.parse(fs.readFileSync(path.join(root, 'content/journeys/kanto-6d.json'), 'utf8'));
const homepage = JSON.parse(fs.readFileSync(path.join(root, 'content/homepage.json'), 'utf8'));
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

test('关东6日内容通过发布校验', () => {
  assert.equal(validateJourney(structuredClone(data)).id, 'kanto-6d');
});

test('官网首页内容通过发布校验并固定3张封面、6项精选和3种出发方式', () => {
  assert.equal(validateHomepage(structuredClone(homepage)).id, 'homepage');
  assert.equal(homepage.hero.slides.length, 3);
  assert.equal(homepage.selection.items.length, 6);
  assert.equal(homepage.ways.items.length, 3);
});

test('静态生成结果幂等并保留通用行程目录', () => {
  const once = renderSite(html, data);
  const twice = renderSite(once, data);
  assert.equal(twice, once);
  assert.equal((once.match(/ASUKA_CMS:JOURNEY_CATALOG:START/g) || []).length, 1);
  assert.equal((once.match(/ASUKA_CMS:KANTO_JOURNEY:START/g) || []).length, 0);
  assert.match(once, /href="journeys\/kanto-6d\/"/);
});

test('首页地区入口连接通用目录并按地区筛选已发布行程', () => {
  assert.match(html, /openChildPanel\('regionProducts','heart'\)/);
  assert.match(html, /id="regionProducts"/);
  assert.match(html, /cards\.filter\(card=>card\.dataset\.region===regionId\)/);
  assert.match(html, /href="#regionProducts" onclick="return regionAction/);
  assert.doesNotMatch(html, /kantoProducts|kantoJourney|kantoInquiry|productInquiryForm/);
});

test('官网逐日使用后台当前的行车里程与预计驾驶时间', () => {
  const rendered = renderJourneyPage(data);
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
  const rendered = renderJourneyPage(data);
  const adminSource = fs.readFileSync(path.join(root, 'admin-src', 'main.js'), 'utf8');
  const adminStyles = fs.readFileSync(path.join(root, 'admin-src', 'styles.css'), 'utf8');
  const journeyStyles = fs.readFileSync(path.join(root, 'journeys', 'journey.css'), 'utf8');
  assert.match(rendered, /class="metric-routes"/);
  assert.match(rendered, /<i>羽田机场 → 东京酒店<\/i><b>约30—50分钟<\/b>/);
  assert.match(rendered, /<i>东京酒店 → 成田机场<\/i><b>约60—90分钟<\/b>/);
  assert.doesNotMatch(rendered, /羽田约30—50分钟｜成田约60—90分钟/);
  assert.match(adminSource, /preview-metric-routes/);
  assert.match(adminSource, /多条路线时，每条路线占一行/);
  assert.match(adminStyles, /\.preview-metric-route > b[\s\S]*?white-space:\s*nowrap/);
  assert.match(journeyStyles, /\.metric-routes > span\s*\{[\s\S]*?grid-template-columns:\s*minmax\(100px,\s*1fr\)\s+auto/);
});

test('官网行程数据卡与后台预览保持两列并在手机端切换单列', () => {
  const adminStyles = fs.readFileSync(path.join(root, 'admin-src', 'styles.css'), 'utf8');
  const journeyStyles = fs.readFileSync(path.join(root, 'journeys', 'journey.css'), 'utf8');
  assert.match(adminStyles, /\.preview-metrics\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(journeyStyles, /\.metric-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2,\s*1fr\)/);
  assert.match(journeyStyles, /@media \(max-width:\s*760px\)[\s\S]*?\.metric-grid\s*\{[\s\S]*?grid-template-columns:\s*1fr/);
});

test('官网地图保持原始比例且桌面标题采用规整均衡换行', () => {
  const journeyStyles = fs.readFileSync(path.join(root, 'journeys', 'journey.css'), 'utf8');
  assert.match(journeyStyles, /\.map-media picture,\s*\.map-media img\s*\{[^}]*height:\s*auto/);
  assert.match(journeyStyles, /\.section-heading\s*\{[^}]*grid-template-columns:\s*minmax\(300px,\s*\.9fr\)\s+minmax\(0,\s*1fr\)/);
  assert.match(journeyStyles, /\.section-heading\s*\{[^}]*max-width:\s*1040px/);
  assert.match(journeyStyles, /\.section-heading h2\s*\{[^}]*font-size:\s*clamp\(31px,\s*3\.65vw,\s*44px\)[^}]*text-wrap:\s*balance/);
  assert.match(journeyStyles, /@media \(max-width:\s*760px\)[\s\S]*?\.section-heading\s*\{[\s\S]*?display:\s*block/);
});

test('全站字体使用本地WOFF2标题字与系统黑体正文', () => {
  const fontCss = fs.readFileSync(path.join(root, 'fonts', 'asuka-fonts.css'), 'utf8');
  const fontFile = fs.readFileSync(path.join(root, 'fonts', 'asuka-serif-sc-500.woff2'));
  const adminHtml = fs.readFileSync(path.join(root, 'admin-src', 'index.html'), 'utf8');
  const adminStyles = fs.readFileSync(path.join(root, 'admin-src', 'styles.css'), 'utf8');
  const journeyStyles = fs.readFileSync(path.join(root, 'journeys', 'journey.css'), 'utf8');
  const journeyPage = renderJourneyPage(data);
  const maps = [
    'images/maps/kanto-route-map-v24.svg',
    'images/maps/kanto-route-map-mobile-v24.svg',
  ].map((file) => fs.readFileSync(path.join(root, file), 'utf8'));

  assert.equal(fontFile.subarray(0, 4).toString('ascii'), 'wOF2');
  assert.ok(fontFile.length < 750 * 1024);
  assert.match(fontCss, /font-family:\s*"Asuka Serif SC"/);
  assert.match(fontCss, /font-display:\s*swap/);
  assert.match(fontCss, /--font-ui:[^;]*"PingFang SC"[^;]*"Microsoft YaHei"/);
  assert.doesNotMatch(fontCss, /https?:\/\//);
  assert.match(html, /fonts\/asuka-fonts\.css\?v=34\.3/);
  assert.match(adminHtml, /\.\.\/fonts\/asuka-fonts\.css\?v=34\.3/);
  assert.match(journeyPage, /fonts\/asuka-fonts\.css\?v=34\.3/);
  assert.match(adminStyles, /font-family:\s*var\(--font-ui\)/);
  assert.match(adminStyles, /\.preview-home-hero h2[\s\S]*?font-family:\s*var\(--font-display\)/);
  assert.match(journeyStyles, /^@import url\("\.\.\/fonts\/asuka-fonts\.css\?v=34\.3"\);/);
  assert.match(journeyStyles, /--serif:\s*var\(--font-display\)/);
  assert.match(journeyStyles, /\.hero-copy,[\s\S]*?font-family:\s*var\(--sans\)/);
  for (const map of maps) {
    assert.match(map, /<g id="asuka-map-glyphs">/);
    assert.match(map, /<use href="#asuka-glyph-/);
    assert.doesNotMatch(map, /<text\b[^>]*>[^<]*[\u3400-\u9fff]/);
    assert.doesNotMatch(map, /data:font|Asuka Map Serif|LXGW WenKai|Nimbus Sans/);
  }
});

test('后台右侧内容跟随七个左侧栏目切换', () => {
  const adminSource = fs.readFileSync(path.join(root, 'admin-src', 'main.js'), 'utf8');
  const adminStyles = fs.readFileSync(path.join(root, 'admin-src', 'styles.css'), 'utf8');
  for (const renderer of [
    'renderHomepagePreview',
    'renderOverviewPreview',
    'renderDaysPreview',
    'renderHighlightsPreview',
    'renderStaysPreview',
    'renderPublishPreview',
    'renderStaffPreview',
  ]) {
    assert.match(adminSource, new RegExp(`function ${renderer}\\(`));
  }
  assert.match(adminSource, /const previewRenderers = \{[\s\S]*?home:[\s\S]*?overview:[\s\S]*?days:[\s\S]*?highlights:[\s\S]*?stays:[\s\S]*?publish:[\s\S]*?staff:/);
  assert.match(adminSource, /previewRenderers\[state\.tab\]\(state\.content\)/);
  assert.match(adminSource, /elements\.previewTitle\.textContent = title/);
  assert.match(adminSource, /async function selectTab\([\s\S]*?renderEditor\(\);[\s\S]*?renderPreview\(\);/);
  assert.match(adminStyles, /\.journey-preview\.mobile \.preview-facts,[\s\S]*?\.journey-preview\.mobile \.preview-check-list\s*\{\s*grid-template-columns:\s*1fr/);
  assert.match(adminStyles, /\.journey-preview\.mobile \.preview-metrics\s*\{\s*grid-template-columns:\s*1fr/);
});

test('首页四个CMS区块静态生成幂等并保护功能链接', () => {
  const once = renderSite(html, data, homepage);
  const twice = renderSite(once, data, homepage);
  assert.equal(twice, once);
  for (const marker of ['HOMEPAGE_META_IMAGE', 'HOMEPAGE_PRELOAD', 'HOMEPAGE_HERO', 'HOMEPAGE_INTRO', 'HOMEPAGE_SELECTION', 'HOMEPAGE_WAYS']) {
    assert.equal((once.match(new RegExp(`ASUKA_CMS:${marker}:START`, 'g')) || []).length, 1);
  }
  assert.match(once, /<button class="primary hero-primary" onclick="openPanel\('heart'\)">/);
  assert.match(once, /href="#entry"/);
  assert.match(once, /href="journeys\/kanto-6d\/"/);
  assert.equal((once.match(/class="entry-card reveal"/g) || []).length, 3);
  assert.match(once, /onclick="openPanel\('custom'\)"/);
  assert.match(once, /onclick="openPanel\('themes'\)"/);
});

test('更换第一张封面时同步更新兼容分享图与首屏预加载', () => {
  const changed = structuredClone(homepage);
  changed.hero.slides[0].image = {
    ...changed.hero.slides[0].image,
    webp480: 'images/responsive/kyoto-pagoda-v22-480.webp',
    webp960: 'images/responsive/kyoto-pagoda-v22-960.webp',
    webp1600: 'images/responsive/kyoto-pagoda-v22-1600.webp',
    fallback: 'images/responsive/kyoto-pagoda-v22-960.jpg',
    alt: '京都古都街町与五重塔“实景”',
  };
  const rendered = renderSite(html, data, changed);
  assert.match(rendered, /property="og:image" content="https:\/\/z2816372267-dev\.github\.io\/japan-signature-journeys\/images\/responsive\/kyoto-pagoda-v22-960\.jpg"/);
  assert.match(rendered, /property="og:image:alt" content="京都古都街町与五重塔“实景”"/);
  assert.match(rendered, /rel="preload" as="image" href="images\/responsive\/kyoto-pagoda-v22-960\.webp"/);
  assert.doesNotMatch(rendered, /property="og:image" content="[^"]*japan-traditional-street/);
});

test('用户输入会在静态生成时转义', () => {
  const unsafe = structuredClone(data);
  unsafe.card.title = '<script>alert(1)</script>';
  const unsafeHomepage = structuredClone(homepage);
  unsafeHomepage.intro.title = '<script>alert(2)</script>';
  const rendered = renderSite(html, unsafe, unsafeHomepage);
  assert.doesNotMatch(rendered, /<script>alert\([12]\)<\/script>/);
  assert.match(rendered, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(rendered, /&lt;script&gt;alert\(2\)&lt;\/script&gt;/);
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

test('后台明确标出逐日动线来源并可跳转到指定日期编辑', () => {
  const adminSource = fs.readFileSync(path.join(root, 'admin-src', 'main.js'), 'utf8');
  const adminStyles = fs.readFileSync(path.join(root, 'admin-src', 'styles.css'), 'utf8');
  assert.match(adminSource, /function routeSourcePanel\(\)/);
  assert.match(adminSource, /AUTO SYNC · 每日行程/);
  assert.match(adminSource, /data-edit-route-day/);
  assert.match(adminSource, /await selectTab\('days'\)/);
  assert.match(adminSource, /当天标题｜同步动线/);
  assert.match(adminSource, /当天路线｜同步动线/);
  assert.match(adminStyles, /\.route-source-days\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(adminStyles, /@media \(max-width: 520px\)[\s\S]*?\.route-source-days\s*\{[\s\S]*?grid-template-columns:\s*1fr/);
});

test('草稿冲突通过数据库专用接口恢复且保留本机副本', () => {
  const functionSource = fs.readFileSync(path.join(root, 'cloudbase', 'functions', 'asuka-cms', 'index.js'), 'utf8');
  const adminSource = fs.readFileSync(path.join(root, 'admin-src', 'main.js'), 'utf8');
  assert.match(functionSource, /async function getDraft\(actor, event\)/);
  assert.match(functionSource, /getDraft: \{ role: 'editor', handler: getDraft \}/);
  assert.match(adminSource, /callCms\('getDraft', \{ resourceId \}\)/);
  assert.match(adminSource, /conflictBackupKey/);
  assert.match(adminSource, /storeConflictBackup\(resourceId\)/);
  assert.match(adminSource, /data-restore-conflict-backup/);
  assert.match(adminSource, /后台云函数仍是旧版本/);
});

test('发布中心强制先保存后发布并只在独立页面存在时开放链接', () => {
  const functionSource = fs.readFileSync(path.join(root, 'cloudbase', 'functions', 'asuka-cms', 'index.js'), 'utf8');
  const adminSource = fs.readFileSync(path.join(root, 'admin-src', 'main.js'), 'utf8');
  const adminStyles = fs.readFileSync(path.join(root, 'admin-src', 'styles.css'), 'utf8');
  assert.match(adminSource, /保存后台草稿/);
  assert.match(adminSource, /检查并发布到官网/);
  assert.match(adminSource, /if \(state\.dirty\) return showToast\('请先保存后台草稿/);
  assert.match(adminSource, /elements\.saveButton\.disabled = state\.saving \|\| !state\.dirty/);
  assert.match(adminSource, /elements\.quickPublishButton\.disabled = state\.saving \|\| state\.dirty/);
  assert.match(adminSource, /resource\.sitePageReady = resourceId === 'homepage' \|\| result\.sitePageReady === true/);
  assert.match(adminSource, /首次成功发布后，这里才会出现官网链接/);
  assert.match(functionSource, /async function publishedPageExists\(resource\)/);
  assert.match(functionSource, /sitePageReady/);
  assert.match(adminStyles, /\.publish-step\s*\{[\s\S]*?grid-template-columns:\s*42px minmax\(0, 1fr\) auto/);
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
  assert.match(source, /CONTENT_RESOURCES/);
  assert.match(source, /resourceId: resource\.id/);
  assert.match(source, /content\/homepage\.json/);
  assert.match(source, /renderSite\(currentIndex, nextCatalog, homepageContent\)/);
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
  missingHighlight.highlights.items = [];
  assert.throws(() => validateJourney(missingHighlight), /亮点区必须包含1—8项内容/);

  const missingStay = structuredClone(data);
  missingStay.stays.groups[0].hotels = [];
  assert.throws(() => validateJourney(missingStay), /住宿组1酒店/);
});

test('官网包含基础搜索信息与站点地图入口', () => {
  const sitemap = fs.readFileSync(path.join(root, 'sitemap.xml'), 'utf8');
  assert.match(html, /<meta name="description"/);
  assert.match(html, /<link rel="canonical"/);
  assert.match(html, /<meta property="og:image"/);
  assert.ok(fs.existsSync(path.join(root, 'favicon.svg')));
  assert.ok(fs.existsSync(path.join(root, 'robots.txt')));
  assert.ok(fs.existsSync(path.join(root, 'sitemap.xml')));
  assert.match(sitemap, /journeys\/kanto-6d\//);
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
  const rendered = renderSite(html, data, homepage);
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
  const rendered = renderSite(html, data, homepage);

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
  assert.match(rendered, /lostpointercapture/);
  assert.doesNotMatch(rendered, /pauseSelectionAuto\('hover'\)|pauseSelectionAuto\('focus'\)/);
  assert.match(rendered, /document\.addEventListener\('visibilitychange'/);
  assert.match(rendered, /\{threshold:\.12\}/);
  assert.doesNotMatch(rendered, /reducedMotion\|\|!selectionInView/);
});

test('首页内容板块收紧比例并为轮播图片提供精确响应式尺寸', () => {
  const rendered = renderSite(html, data, homepage);

  assert.match(rendered, /\.intro\.section\{padding-top:92px;padding-bottom:92px\}/);
  assert.match(rendered, /\.asuka-selection\.section\{padding-top:84px;padding-bottom:80px\}/);
  assert.match(rendered, /\.asuka-selection-slide\{flex-basis:clamp\(640px,56vw,900px\)\}/);
  assert.match(rendered, /\.entry-card\{min-height:430px;padding:30px\}/);
  assert.match(rendered, /@media\(max-width:760px\)\{\.intro\.section\{padding-top:58px;padding-bottom:60px\}/);
  assert.equal((rendered.match(/\(max-width:1607px\) 56vw, 900px/g) || []).length, 6);
});

test('封面行动区使用低干扰深色按钮并显示探索别样日本', () => {
  const rendered = renderSite(html, data, homepage);

  assert.match(rendered, /<button class="primary hero-primary"[^>]*><span>探索别样日本<\/span>/);
  assert.doesNotMatch(rendered, />探索日本心旅行</);
  assert.match(rendered, /class="link-light hero-secondary"/);
  assert.match(rendered, /\.hero-primary\{[^}]*background:#10231cba[^}]*backdrop-filter:blur\(7px\)/);
  assert.match(rendered, /\.hero-primary:focus-visible,\.hero-secondary:focus-visible/);
  assert.match(rendered, /2026-08-10-v34\.3-typography/);
});

test('统一后台为首页与动态行程保存独立草稿和预览图片', () => {
  const adminSource = fs.readFileSync(path.join(root, 'admin-src', 'main.js'), 'utf8');
  const adminHtml = fs.readFileSync(path.join(root, 'admin-src', 'index.html'), 'utf8');
  assert.match(adminHtml, /data-tab="home"/);
  assert.match(adminHtml, /V34\.3 · 全站字体与排版统一/);
  assert.match(adminSource, /homepage: createResourceState\(initialHomepage\)/);
  assert.match(adminSource, /'kanto-6d': createResourceState\(initialJourney\)/);
  assert.match(adminSource, /`asuka-cms:\$\{resourceId\}:draft`/);
  assert.match(adminSource, /callCms\('getContent', \{ resourceId \}\)/);
  assert.match(adminSource, /callCms\('saveDraft', \{ resourceId, content: resource\.content/);
  assert.match(adminSource, /callCms\('stageAsset', \{[\s\S]*?resourceId,/);
  assert.match(adminSource, /callCms\('publish', \{[\s\S]*?resourceId: state\.resourceId/);
});
