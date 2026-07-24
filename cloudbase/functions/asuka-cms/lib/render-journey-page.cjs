'use strict';

const { normalizeJourney, seasonDefinition } = require('./journey-model');

const SITE_ORIGIN = 'https://z2816372267-dev.github.io/japan-signature-journeys';

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function textWithBreaks(value) {
  return escapeHtml(value).replaceAll('\n', '<br>');
}

function safeAssetPath(value) {
  const path = String(value ?? '').trim();
  if (!/^images\/[a-zA-Z0-9_./-]+$/.test(path) || path.includes('..')) {
    throw new Error(`不安全的图片路径：${path || '(空)'}`);
  }
  return escapeHtml(path);
}

function renderPicture(image, options = {}) {
  if (!image) return '';
  const pictureClass = options.pictureClass ? ` class="${escapeHtml(options.pictureClass)}"` : '';
  const imageClass = options.imageClass ? ` class="${escapeHtml(options.imageClass)}"` : '';
  const sizes = escapeHtml(options.sizes || '100vw');
  const loading = options.eager ? 'eager' : 'lazy';
  const priority = options.eager ? ' fetchpriority="high"' : '';
  return `<picture${pictureClass}>
          <source type="image/webp" srcset="${safeAssetPath(image.webp480)} 480w, ${safeAssetPath(image.webp960)} 960w, ${safeAssetPath(image.webp1600)} 1600w" sizes="${sizes}">
          <img${imageClass} src="${safeAssetPath(image.fallback)}" width="${Number(image.width) || 1600}" height="${Number(image.height) || 1200}" alt="${escapeHtml(image.alt)}" loading="${loading}" decoding="async"${priority}>
        </picture>`;
}

function renderSectionHeading(eyebrow, title, copy = '') {
  return `<header class="section-heading">
            <p>${escapeHtml(eyebrow)}</p>
            <h2>${textWithBreaks(title)}</h2>
            ${copy ? `<div>${textWithBreaks(copy)}</div>` : ''}
          </header>`;
}

function metricLines(value) {
  return String(value ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function renderMetric(label, title, item) {
  const routes = metricLines(item?.value);
  const content = routes.length > 1
    ? `<span class="metric-routes">${routes.map((line) => {
      const divider = line.indexOf('：');
      if (divider < 1) return `<span>${escapeHtml(line)}</span>`;
      return `<span><i>${escapeHtml(line.slice(0, divider))}</i><b>${escapeHtml(line.slice(divider + 1))}</b></span>`;
    }).join('')}</span>`
    : `<strong>${escapeHtml(routes[0] || '')}</strong>`;
  return `<div class="metric-card">
            <small>${escapeHtml(label)}</small>
            <span class="metric-label">${escapeHtml(title)}</span>
            ${content}
            ${item?.note ? `<em>${textWithBreaks(item.note)}</em>` : ''}
          </div>`;
}

function renderMap(data) {
  const map = data.map;
  let media = '';
  if (map.mode === 'legacy') {
    media = `<a class="map-media" href="${safeAssetPath(map.desktop)}" target="_blank" rel="noopener">
              <picture>
                <source media="(max-width: 760px)" srcset="${safeAssetPath(map.mobile)}">
                <img src="${safeAssetPath(map.desktop)}" width="1600" height="1000" alt="${escapeHtml(map.alt)}" loading="lazy" decoding="async">
              </picture>
            </a>`;
  } else if (map.mode === 'image' && map.image) {
    media = `<a class="map-media" href="${safeAssetPath(map.image.fallback)}" target="_blank" rel="noopener">
              ${renderPicture(map.image, { sizes: '(max-width: 760px) calc(100vw - 40px), 980px' })}
            </a>`;
  }
  return `<section class="content-section map-section" id="map">
          ${renderSectionHeading('JOURNEY MAP', map.title, map.copy)}
          ${media}
          <section class="route-summary${media ? '' : ' route-summary--primary'}" aria-label="逐日路线摘要">
            ${map.days.map((day) => `<article>
              <span>DAY ${escapeHtml(day.number)}</span>
              <div><strong>${escapeHtml(day.title)}</strong><p>${escapeHtml(day.route)}</p></div>
            </article>`).join('')}
          </section>
          <p class="map-caption">${escapeHtml(map.caption)}</p>
        </section>`;
}

function renderHighlights(data) {
  return `<section class="content-section" id="highlights">
          ${renderSectionHeading('WHY THIS JOURNEY', data.highlights.title, data.highlights.copy)}
          <div class="highlight-grid">
            ${data.highlights.items.map((item) => `<article class="highlight-card">
              ${renderPicture(item.image, { sizes: '(max-width: 760px) calc(100vw - 40px), 440px' })}
              <div><small>${escapeHtml(item.eyebrow)}</small><h3>${escapeHtml(item.title)}</h3></div>
            </article>`).join('')}
          </div>
        </section>`;
}

function renderDay(day, index) {
  return `<article class="day-card${index === 0 ? ' is-open' : ''}">
            <button class="day-toggle" type="button" aria-expanded="${index === 0 ? 'true' : 'false'}">
              <span>DAY ${escapeHtml(day.number)}</span>
              <span><strong>${escapeHtml(day.title)}</strong><small>${escapeHtml(day.route)}</small></span>
              <i aria-hidden="true"></i>
            </button>
            <div class="day-content">
              <div class="day-content-inner">
                <div class="day-stops">${day.stops.map((stop) => `<span>${escapeHtml(stop)}</span>`).join('')}</div>
                <p class="day-story">${textWithBreaks(day.story)}</p>
                ${day.image ? renderPicture(day.image, {
    pictureClass: 'day-picture',
    sizes: '(max-width: 760px) calc(100vw - 40px), 800px',
  }) : ''}
                <div class="metric-grid">
                  ${renderMetric('DISTANCE', '行车里程', day.distance)}
                  ${renderMetric('DURATION', '预计驾驶时间', day.duration)}
                  ${renderMetric('ACTIVITY', '体力消耗', day.activity)}
                  ${renderMetric('COMFORT', '舒适度', day.comfort)}
                </div>
                <div class="practical-grid">
                  <div><small>BREAKFAST</small><span>${textWithBreaks(day.meals.breakfast)}</span></div>
                  <div><small>LUNCH</small><span>${textWithBreaks(day.meals.lunch)}</span></div>
                  <div><small>DINNER</small><span>${textWithBreaks(day.meals.dinner)}</span></div>
                  <div><small>HOTEL</small><span>${textWithBreaks(day.hotel)}</span></div>
                </div>
                ${day.footnote ? `<p class="day-footnote">${textWithBreaks(day.footnote)}</p>` : ''}
              </div>
            </div>
          </article>`;
}

function renderStays(data) {
  return `<section class="content-section" id="stays">
          ${renderSectionHeading('SELECTED STAYS', data.stays.title, data.stays.copy)}
          <div class="stay-grid">
            ${data.stays.groups.map((group) => `<article>
              <small>${escapeHtml(group.eyebrow)}</small>
              <h3>${escapeHtml(group.title)}</h3>
              <ul>${group.hotels.map((hotel) => `<li>${escapeHtml(hotel)}</li>`).join('')}</ul>
              <p>${textWithBreaks(group.copy)}</p>
            </article>`).join('')}
          </div>
        </section>`;
}

function renderNotes(data) {
  return `<section class="content-section" id="notes">
          ${renderSectionHeading('JOURNEY NOTES', data.notes.title, data.notes.copy)}
          <div class="note-grid">
            ${data.notes.items.map((item) => `<article><h3>${escapeHtml(item.title)}</h3><p>${textWithBreaks(item.copy)}</p></article>`).join('')}
          </div>
          <p class="photo-note">${escapeHtml(data.notes.photoDisclaimer)}</p>
        </section>`;
}

function guestOptions(max, start = 0) {
  return Array.from({ length: max - start + 1 }, (_, index) => index + start)
    .map((count) => `<option value="${count}"${count === (start ? 2 : 0) ? ' selected' : ''}>${count}位</option>`)
    .join('');
}

function renderBookingCard(data) {
  return `<aside class="booking-side">
          <div class="booking-card">
            <small>JOURNEY INFORMATION</small>
            <h2>${textWithBreaks(data.booking.title)}</h2>
            <dl>
              <div><dt>产品归属</dt><dd>${escapeHtml(data.booking.productGroup)}</dd></div>
              <div><dt>产品编号</dt><dd>${escapeHtml(data.productCode)}</dd></div>
              <div><dt>适合月份</dt><dd>${escapeHtml(data.management.travelMonths)}</dd></div>
              <div><dt>当前状态</dt><dd>${escapeHtml(data.booking.currentStatus)}</dd></div>
              <div><dt>出发日期</dt><dd>${escapeHtml(data.booking.departure)}</dd></div>
              <div><dt>参考价格</dt><dd>${escapeHtml(data.booking.price)}</dd></div>
              <div><dt>旅行方式</dt><dd>${escapeHtml(data.booking.travelStyle)}</dd></div>
            </dl>
            <a href="#enquiry">咨询此行程 <span aria-hidden="true">→</span></a>
          </div>
        </aside>`;
}

function renderEnquiry(data) {
  const maxGuests = data.booking.maxGuests;
  return `<section class="enquiry-section" id="enquiry" data-max-guests="${maxGuests}">
        <div class="page-wrap enquiry-layout">
          <header>
            <p>JOURNEY ENQUIRY · ${escapeHtml(data.productCode)}</p>
            <h2>咨询此行程</h2>
            <div>选择日期与同行人数后，旅行顾问将依据本产品内容继续为你服务。</div>
          </header>
          <form id="journeyEnquiryForm">
            <div class="field">
              <label for="departure">希望出发日期 <b>*</b></label>
              <input id="departure" name="departure" type="date" required>
            </div>
            <div class="party-fields">
              <div class="field">
                <label for="adults">成人 <b>*</b></label>
                <select id="adults" name="adults" required>${guestOptions(maxGuests, 1)}</select>
              </div>
              <div class="field">
                <label for="children">儿童 <b>*</b></label>
                <select id="children" name="children" required>${guestOptions(Math.max(0, maxGuests - 1), 0)}</select>
              </div>
            </div>
            <div class="child-ages" id="childAges" hidden>
              <label>请补充每位儿童的年龄 <b>*</b></label>
              <div id="ageInputs"></div>
            </div>
            <p class="party-total" id="partyTotal" aria-live="polite"></p>
            <button type="submit">提交产品咨询 <span aria-hidden="true">→</span></button>
            <p class="form-note">当前为表单演示。接入正式客服渠道后，产品编号、日期与人数会一并发送给旅行顾问。</p>
          </form>
        </div>
      </section>`;
}

function renderJourneyPage(input) {
  const data = normalizeJourney(structuredClone(input));
  const season = seasonDefinition(data.management.season);
  const canonical = `${SITE_ORIGIN}/journeys/${encodeURIComponent(data.id)}/`;
  const title = data.seo.title || data.card.title.replaceAll('\n', ' ');
  const description = data.seo.description || data.card.summary;
  const heroFallback = safeAssetPath(data.hero.image.fallback);
  const seasonHeading = season.label === data.management.seasonVariant
    ? season.label
    : `${season.label} · ${data.management.seasonVariant}`;
  const breadcrumb = data.hero.breadcrumb.map((item) => `<span>${escapeHtml(item)}</span>`).join('<i aria-hidden="true"></i>');
  const facts = data.overview.facts.map((fact) => `<div><small>${escapeHtml(fact.label)}</small><strong>${escapeHtml(fact.value)}</strong></div>`).join('');
  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'TouristTrip',
    name: data.card.title.replaceAll('\n', ' '),
    description,
    touristType: '小团深度旅行',
    itinerary: data.days.map((day) => ({
      '@type': 'TouristAttraction',
      name: `第${day.number}天 ${day.title}`,
      description: day.route,
    })),
    provider: {
      '@type': 'TravelAgency',
      name: '飞鸟旅行 Asuka Travel',
      url: SITE_ORIGIN,
    },
  }).replaceAll('<', '\\u003c');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <base href="../../">
  <title>${escapeHtml(title)}｜飞鸟旅行 Asuka Travel</title>
  <meta name="description" content="${escapeHtml(description)}">
  <meta name="theme-color" content="${escapeHtml(season.colors[1])}">
  <link rel="canonical" href="${escapeHtml(canonical)}">
  <meta property="og:type" content="website">
  <meta property="og:title" content="${escapeHtml(title)}｜飞鸟旅行">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:url" content="${escapeHtml(canonical)}">
  <meta property="og:image" content="${SITE_ORIGIN}/${heroFallback}">
  <link rel="preload" as="image" href="${heroFallback}" fetchpriority="high">
  <link rel="stylesheet" href="journeys/journey.css?v=33">
  <script type="application/ld+json">${jsonLd}</script>
  <script src="journeys/journey.js?v=33" defer></script>
</head>
<body data-season="${escapeHtml(data.management.season)}" data-journey="${escapeHtml(data.id)}">
  <a class="skip-link" href="#main">跳至主要内容</a>
  <header class="site-header">
    <a class="back-home" href="index.html?region=${escapeHtml(data.regionId)}#heart"><span aria-hidden="true">←</span> 返回${escapeHtml(data.management.regionName)}</a>
    <a class="brand" href="index.html" aria-label="返回飞鸟旅行首页"><strong>飞鸟旅行</strong><span>ASUKA TRAVEL</span></a>
    <span class="season-label">${escapeHtml(seasonHeading)}</span>
  </header>

  <main id="main">
    <section class="journey-hero">
      ${renderPicture(data.hero.image, { pictureClass: 'hero-picture', sizes: '100vw', eager: true })}
      <div class="hero-shade"></div>
      <div class="season-motif" aria-hidden="true"><i></i><i></i><i></i></div>
      <div class="page-wrap hero-content">
        <div class="breadcrumbs">${breadcrumb}</div>
        <p class="hero-kicker">${escapeHtml(data.hero.kicker)}</p>
        <h1>${textWithBreaks(data.hero.title)}</h1>
        <p class="hero-copy">${textWithBreaks(data.hero.copy)}</p>
        <div class="hero-tags">${data.hero.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join('')}</div>
        <span class="hero-status">${escapeHtml(data.hero.status)}</span>
      </div>
    </section>

    <nav class="journey-nav" aria-label="行程页导航">
      <div class="page-wrap">
        <a href="#overview">行程概览</a>
        <a href="#map">行程地图</a>
        <a href="#highlights">旅行亮点</a>
        <a href="#days">每日行程</a>
        <a href="#stays">酒店甄选</a>
        <a href="#notes">行程说明</a>
      </div>
    </nav>

    <div class="page-wrap">
      <section class="content-section overview-section" id="overview">
        ${renderSectionHeading('JOURNEY OVERVIEW', data.overview.title, data.overview.copy)}
        <div class="fact-grid">${facts}</div>
        <div class="route-line"><strong>完整动线</strong><span>${escapeHtml(data.overview.route)}</span></div>
      </section>
      ${renderMap(data)}
    </div>

    <div class="page-wrap content-layout">
      <div>
        ${renderHighlights(data)}
        <section class="content-section" id="days">
          ${renderSectionHeading('DAY BY DAY', '每日行程')}
          <div class="day-list">${data.days.map(renderDay).join('')}</div>
        </section>
        ${renderStays(data)}
        ${renderNotes(data)}
      </div>
      ${renderBookingCard(data)}
    </div>
    ${renderEnquiry(data)}
  </main>

  <footer class="site-footer">
    <a class="brand brand--footer" href="index.html"><strong>飞鸟旅行</strong><span>ASUKA TRAVEL</span></a>
    <p>以细致的在地理解，连接日本真正值得抵达的风景。</p>
    <small>© ASUKA TRAVEL</small>
  </footer>
</body>
</html>`.replace(/[ \t]+$/gm, '');
}

module.exports = {
  SITE_ORIGIN,
  escapeHtml,
  renderJourneyPage,
  renderPicture,
  safeAssetPath,
  textWithBreaks,
};
