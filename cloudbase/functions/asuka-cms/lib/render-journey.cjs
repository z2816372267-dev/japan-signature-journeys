'use strict';

const MARKERS = Object.freeze({
  card: {
    start: '<!-- ASUKA_CMS:KANTO_CARD:START -->',
    end: '<!-- ASUKA_CMS:KANTO_CARD:END -->',
  },
  journey: {
    start: '<!-- ASUKA_CMS:KANTO_JOURNEY:START -->',
    end: '<!-- ASUKA_CMS:KANTO_JOURNEY:END -->',
  },
  inquiry: {
    start: '<!-- ASUKA_CMS:KANTO_INQUIRY:START -->',
    end: '<!-- ASUKA_CMS:KANTO_INQUIRY:END -->',
  },
});

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
  return `<picture${pictureClass}><source type="image/webp" srcset="${safeAssetPath(image.webp480)} 480w, ${safeAssetPath(image.webp960)} 960w, ${safeAssetPath(image.webp1600)} 1600w" sizes="${sizes}" /><img${imageClass} src="${safeAssetPath(image.fallback)}" width="${Number(image.width) || 1600}" height="${Number(image.height) || 1200}" alt="${escapeHtml(image.alt)}" loading="lazy" decoding="async" /></picture>`;
}

function renderHeading(eyebrow, title, copy, compact = false) {
  return `<div class="itinerary-heading${compact ? ' itinerary-heading--compact' : ''}">
            <small>${escapeHtml(eyebrow)}</small>
            <h3>${textWithBreaks(title)}</h3>${copy ? `
            <p>${textWithBreaks(copy)}</p>` : ''}
          </div>`;
}

function renderCard(data) {
  return `<a class="journey-product-card" href="#" onclick="openKantoJourney();return false">
        <div class="journey-product-visual">
          ${renderPicture(data.hero.image, { sizes: '(max-width:760px) calc(100vw - 42px), 520px' })}
        </div>
        <div class="journey-product-copy">
          <small>${escapeHtml(data.card.kicker)}</small>
          <h3>${textWithBreaks(data.card.title)}</h3>
          <p>${textWithBreaks(data.card.summary)}</p>
          <span class="journey-product-meta">${data.card.meta.map((item) => `<span>${escapeHtml(item)}</span>`).join('')}</span>
          <span class="journey-product-arrow" aria-hidden="true">→</span>
        </div>
      </a>`;
}

function renderMap(data) {
  const map = data.map;
  return `<section class="itinerary-section journey-map-section" id="kanto-map">
          ${renderHeading('JOURNEY MAP', map.title, map.copy)}
          <figure class="journey-map-frame">
            <a class="journey-map-link" href="${safeAssetPath(map.desktop)}" target="_blank" rel="noopener" aria-label="打开${escapeHtml(data.card.title.replaceAll('\n', ''))}高清行程地图">
              <picture class="journey-map-picture">
                <source media="(max-width:820px)" type="image/svg+xml" srcset="${safeAssetPath(map.mobile)}" />
                <source type="image/svg+xml" srcset="${safeAssetPath(map.desktop)}" />
                <img src="${safeAssetPath(map.desktop)}" width="1600" height="1000" alt="${escapeHtml(map.alt)}" loading="lazy" decoding="async" />
              </picture>
            </a>
            <figcaption class="journey-map-caption"><span>${escapeHtml(map.caption)}</span><a href="${safeAssetPath(map.desktop)}" target="_blank" rel="noopener">查看高清地图 ↗</a></figcaption>
          </figure>
          <div class="journey-map-mobile-days" aria-label="六日路线摘要">
            ${map.days.map((day) => `<article class="journey-map-day"><small>DAY ${escapeHtml(day.number)}</small><strong>${escapeHtml(day.title)}</strong><span>${escapeHtml(day.route)}</span></article>`).join('\n            ')}
          </div>
        </section>`;
}

function renderHighlights(data) {
  return `<section class="itinerary-section" id="kanto-highlights">
          ${renderHeading('WHY THIS JOURNEY', data.highlights.title, data.highlights.copy)}
          <div class="highlight-grid">
            ${data.highlights.items.map((item) => `<article class="highlight">${renderPicture(item.image, { sizes: '(max-width:760px) calc(100vw - 42px), 420px' })}<div><small>${escapeHtml(item.eyebrow)}</small><h4>${escapeHtml(item.title)}</h4></div></article>`).join('\n            ')}
          </div>
        </section>`;
}

function renderMetric(label, prefix, item) {
  return `<div><small>${escapeHtml(label)}</small><strong>${escapeHtml(prefix)}：${escapeHtml(item.value)}${item.note ? `<br>${escapeHtml(item.note)}` : ''}</strong></div>`;
}

function renderDay(day, index) {
  const picture = day.image
    ? `
                ${renderPicture(day.image, { pictureClass: 'responsive-picture', imageClass: 'day-photo', sizes: '(max-width:760px) calc(100vw - 42px), 800px' })}`
    : '';
  const footnote = day.footnote ? `
                <p class="day-footnote">${textWithBreaks(day.footnote)}</p>` : '';
  return `<article class="day${index === 0 ? ' open' : ''}">
              <button class="day-toggle" onclick="toggleDay(this)" aria-label="展开或收起第${index + 1}天行程"><span class="day-number">DAY ${escapeHtml(day.number)}</span><span class="day-title"><strong>${escapeHtml(day.title)}</strong><span>${escapeHtml(day.route)}</span></span><span class="day-icon">＋</span></button>
              <div class="day-body">
                <div class="day-stops">${day.stops.map((stop) => `<span>${escapeHtml(stop)}</span>`).join('')}</div>
                <p class="day-story">${textWithBreaks(day.story)}</p>${picture}
                <div class="day-metrics">${renderMetric('DISTANCE', '行车里程', day.distance)}${renderMetric('DURATION', '预计驾驶时间', day.duration)}${renderMetric('ACTIVITY', '体力消耗', day.activity)}${renderMetric('COMFORT', '舒适度', day.comfort)}</div>
                <div class="day-practical"><div><small>BREAKFAST</small><span>${textWithBreaks(day.meals.breakfast)}</span></div><div><small>LUNCH</small><span>${textWithBreaks(day.meals.lunch)}</span></div><div><small>DINNER</small><span>${textWithBreaks(day.meals.dinner)}</span></div><div><small>HOTEL</small><span>${textWithBreaks(day.hotel)}</span></div></div>${footnote}
              </div>
            </article>`;
}

function renderStays(data) {
  return `<section class="itinerary-section" id="kanto-stays">
          ${renderHeading('SELECTED STAYS', data.stays.title, data.stays.copy)}
          <div class="hotel-board">
            ${data.stays.groups.map((group) => `<article class="hotel-group"><small>${escapeHtml(group.eyebrow)}</small><h4>${escapeHtml(group.title)}</h4><ul>${group.hotels.map((hotel) => `<li>${escapeHtml(hotel)}</li>`).join('')}</ul><p>${textWithBreaks(group.copy)}</p></article>`).join('\n            ')}
          </div>
        </section>`;
}

function renderNotes(data) {
  return `<section class="itinerary-section" id="kanto-notes">
          ${renderHeading('JOURNEY NOTES', data.notes.title, data.notes.copy)}
          <div class="notice-list">
            ${data.notes.items.map((item) => `<div class="notice"><strong>${escapeHtml(item.title)}</strong><p>${textWithBreaks(item.copy)}</p></div>`).join('\n            ')}
          </div>
          <p class="photo-disclaimer">${escapeHtml(data.notes.photoDisclaimer)}摄影作者、原始文件及授权方式详见 <a href="images/kanto/ATTRIBUTION.md" target="_blank" rel="noopener">图片来源与授权记录</a>。</p>
        </section>`;
}

function renderJourney(data) {
  const breadcrumb = data.hero.breadcrumb.map((item) => `<span>${escapeHtml(item)}</span>`).join('<i></i>');
  const facts = data.overview.facts.map((item) => `<div class="fact"><small>${escapeHtml(item.label)}</small><strong>${escapeHtml(item.value)}</strong></div>`).join('\n            ');
  return `<section class="overlay itinerary" id="kantoJourney" aria-label="关东地区6日行程">
    <div class="overlay-top journey-topbar">
      <button class="journey-back" type="button" onclick="returnToParent('kantoJourney','kantoProducts')" aria-label="返回关东地区产品列表">
        <span class="journey-back-arrow" aria-hidden="true">←</span>
        <span>返回关东地区</span>
      </button>
      <span class="journey-top-context"><span>日本心旅行</span><i></i><strong>行程详情</strong></span>
      <span class="journey-top-brand">飞鸟旅行 · ASUKA TRAVEL</span>
    </div>

    <div class="itinerary-hero">
      ${renderPicture(data.hero.image, { pictureClass: 'itinerary-hero-media', sizes: '100vw' })}
      <div class="wrap itinerary-hero-inner">
        <div class="journey-breadcrumb">${breadcrumb}</div>
        <p class="itinerary-kicker">${escapeHtml(data.hero.kicker)}</p>
        <h2>${textWithBreaks(data.hero.title)}</h2>
        <p class="itinerary-hero-copy">${textWithBreaks(data.hero.copy)}</p>
        <div class="itinerary-tags">${data.hero.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join('')}</div>
        <div class="journey-status">${escapeHtml(data.hero.status)}</div>
      </div>
    </div>

    <nav class="itinerary-nav" aria-label="行程页导航">
      <div class="wrap itinerary-nav-inner">
        <a href="#kanto-overview">行程概览</a>
        <a href="#kanto-map">行程地图</a>
        <a href="#kanto-highlights">旅行亮点</a>
        <a href="#kanto-days">每日行程</a>
        <a href="#kanto-stays">酒店甄选</a>
        <a href="#kanto-notes">行程说明</a>
      </div>
    </nav>

    <div class="wrap itinerary-prelude">
        <section class="itinerary-section" id="kanto-overview">
          ${renderHeading('JOURNEY OVERVIEW', data.overview.title, data.overview.copy)}
          <div class="fact-grid">
            ${facts}
          </div>
          <div class="route-line"><strong>完整动线</strong><span>${escapeHtml(data.overview.route)}</span></div>
        </section>

        ${renderMap(data)}
    </div>

    <div class="wrap itinerary-layout itinerary-layout--continuation">
      <div class="itinerary-main">

        ${renderHighlights(data)}

        <section class="itinerary-section" id="kanto-days">
          ${renderHeading('DAY BY DAY', '每日行程', '', true)}

          <div class="day-list">
            ${data.days.map(renderDay).join('\n\n            ')}
          </div>
        </section>

        ${renderStays(data)}

        ${renderNotes(data)}
      </div>

      <aside class="itinerary-side">
        <div class="booking-card">
          <small>JOURNEY INFORMATION</small>
          <h3>${textWithBreaks(data.booking.title)}</h3>
          <div class="booking-row"><span>产品归属</span><strong>${escapeHtml(data.booking.productGroup)}</strong></div>
          <div class="booking-row"><span>产品编号</span><strong>${escapeHtml(data.productCode)}</strong></div>
          <div class="booking-row"><span>当前状态</span><strong>${escapeHtml(data.booking.currentStatus)}</strong></div>
          <div class="booking-row"><span>出发日期</span><strong>${escapeHtml(data.booking.departure)}</strong></div>
          <div class="booking-row"><span>参考价格</span><strong>${escapeHtml(data.booking.price)}</strong></div>
          <div class="booking-row"><span>旅行方式</span><strong>${escapeHtml(data.booking.travelStyle)}</strong></div>
          <button onclick="startKantoJourneyInquiry()">咨询此行程 →</button>
        </div>
      </aside>
    </div>
  </section>`;
}

function renderInquiry(data) {
  return `<section class="overlay product-inquiry" id="kantoInquiry" aria-label="${escapeHtml(data.card.title.replaceAll('\n', ''))}产品咨询表">
    <div class="overlay-top journey-topbar">
      <button class="journey-back" type="button" onclick="returnToParent('kantoInquiry','kantoJourney')" aria-label="返回${escapeHtml(data.card.title.replaceAll('\n', ''))}行程详情">
        <span class="journey-back-arrow" aria-hidden="true">←</span>
        <span>返回具体行程</span>
      </button>
      <span class="journey-top-context"><span>关东山海6日</span><i></i><strong>产品咨询</strong></span>
      <span class="journey-top-brand">飞鸟旅行 · ASUKA TRAVEL</span>
    </div>
    <div class="wrap product-inquiry-shell">
      <div class="product-inquiry-hero">
        <p class="eyebrow">JOURNEY ENQUIRY · ${escapeHtml(data.productCode)}</p>
        <div class="rule"></div>
        <h2>咨询此行程</h2>
        <p>这是具体产品的专用咨询表。选择出发日期与同行人数后，旅行顾问将按照本产品的行程内容继续为你服务。</p>
      </div>
      <div class="product-inquiry-layout">
        <aside class="selected-product-card">
          <small>SELECTED JOURNEY</small>
          <h3>${textWithBreaks(data.booking.title)}</h3>
          <div class="selected-product-row"><span>产品编号</span><strong>${escapeHtml(data.productCode)}</strong></div>
          <div class="selected-product-row"><span>旅行方式</span><strong>${escapeHtml(data.booking.travelStyle)}</strong></div>
          <div class="selected-product-row"><span>当前团期</span><strong>${escapeHtml(data.booking.departure)}</strong></div>
        </aside>
        <form class="product-inquiry-form" id="productInquiryForm">
          <h3>选择出行信息</h3>
          <div class="product-field">
            <label for="productDeparture">出发日期 <b class="required">*</b></label>
            <input id="productDeparture" name="departure" type="date" required />
          </div>
          <p class="schedule-note">正式团期公布后，此处将直接显示本产品可选择的出发日期。</p>
          <div class="product-party-grid">
            <div class="product-count-field">
              <label for="productAdults">成人 <b class="required">*</b></label>
              <select id="productAdults" name="adults" required aria-label="成人数量">
                <option value="1">1位</option><option value="2" selected>2位</option><option value="3">3位</option><option value="4">4位</option><option value="5">5位</option><option value="6">6位</option><option value="7">7位</option><option value="8">8位</option>
              </select>
            </div>
            <div class="product-count-field">
              <label for="productChildren">儿童 <b class="required">*</b></label>
              <select id="productChildren" name="children" required aria-label="儿童数量">
                <option value="0" selected>0位</option><option value="1">1位</option><option value="2">2位</option><option value="3">3位</option><option value="4">4位</option><option value="5">5位</option><option value="6">6位</option><option value="7">7位</option>
              </select>
            </div>
          </div>
          <div class="product-child-ages" id="productChildAges">
            <label>请补充每位儿童的年龄 <b class="required">*</b></label>
            <div class="product-age-inputs" id="productAgeInputs"></div>
          </div>
          <p class="product-party-total" id="productPartyTotal" aria-live="polite"></p>
          <button class="product-inquiry-submit" id="productInquirySubmit" type="submit">提交产品咨询 →</button>
          <p class="product-inquiry-note">当前为表单演示。后续接入客服渠道与正式团期后，产品编号、所选日期及人数信息将一并发送给旅行顾问。</p>
        </form>
      </div>
    </div>
  </section>`;
}

function replaceManagedBlock(html, marker, rendered) {
  const startIndex = html.indexOf(marker.start);
  const endIndex = html.indexOf(marker.end);
  if (startIndex < 0 || endIndex < 0 || endIndex <= startIndex) {
    throw new Error(`未找到完整 CMS 标记：${marker.start}`);
  }
  const before = html.slice(0, startIndex + marker.start.length);
  const after = html.slice(endIndex);
  return `${before}\n      ${rendered}\n      ${after}`;
}

function renderSite(html, data) {
  let output = html;
  output = replaceManagedBlock(output, MARKERS.card, renderCard(data));
  output = replaceManagedBlock(output, MARKERS.journey, renderJourney(data));
  output = replaceManagedBlock(output, MARKERS.inquiry, renderInquiry(data));
  return output;
}

module.exports = {
  MARKERS,
  escapeHtml,
  renderCard,
  renderInquiry,
  renderJourney,
  renderSite,
  replaceManagedBlock,
};
