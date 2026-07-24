'use strict';

const { renderHomepage } = require('./render-homepage.cjs');
const {
  emptyCatalog,
  normalizeCatalog,
  upsertCatalogJourney,
} = require('./journey-model');
const {
  escapeHtml,
  renderJourneyPage,
  renderPicture,
  textWithBreaks,
} = require('./render-journey-page.cjs');

const MARKERS = Object.freeze({
  catalog: {
    start: '<!-- ASUKA_CMS:JOURNEY_CATALOG:START -->',
    end: '<!-- ASUKA_CMS:JOURNEY_CATALOG:END -->',
  },
  legacyCard: {
    start: '<!-- ASUKA_CMS:KANTO_CARD:START -->',
    end: '<!-- ASUKA_CMS:KANTO_CARD:END -->',
  },
  legacyJourney: {
    start: '<!-- ASUKA_CMS:KANTO_JOURNEY:START -->',
    end: '<!-- ASUKA_CMS:KANTO_JOURNEY:END -->',
  },
  legacyInquiry: {
    start: '<!-- ASUKA_CMS:KANTO_INQUIRY:START -->',
    end: '<!-- ASUKA_CMS:KANTO_INQUIRY:END -->',
  },
});

function renderCatalogCard(item) {
  const image = renderPicture(item.image, {
    sizes: '(max-width:760px) calc(100vw - 42px), 520px',
  });
  const nights = Number(item.nightsCount || 0);
  const duration = nights > 0 ? `${item.daysCount}日${nights}晚` : `${item.daysCount}日`;
  const meta = item.meta.filter((value) => value !== duration).slice(0, 3);
  return `<a class="journey-product-card" href="${escapeHtml(item.href)}" data-region="${escapeHtml(item.regionId)}" data-season="${escapeHtml(item.season)}">
        <div class="journey-product-visual">${image}</div>
        <div class="journey-product-copy">
          <small>${escapeHtml(item.regionLatin)} · ${escapeHtml(item.seasonVariant)}</small>
          <h3>${textWithBreaks(item.title)}</h3>
          <p>${textWithBreaks(item.summary)}</p>
          <span class="journey-product-meta">
            <span>${escapeHtml(duration)}</span>
            ${meta.map((value) => `<span>${escapeHtml(value)}</span>`).join('')}
          </span>
          <span class="journey-product-arrow" aria-hidden="true">→</span>
        </div>
      </a>`;
}

function renderCatalog(catalogInput) {
  const catalog = normalizeCatalog(catalogInput);
  const published = catalog.journeys.filter((item) => item.visibility !== 'hidden');
  return `<section class="overlay journey-collection" id="regionProducts" aria-label="地区行程产品列表">
    <div class="overlay-top journey-topbar">
      <button class="journey-back" type="button" onclick="returnToParent('regionProducts','heart')" aria-label="返回日本心旅行地区列表">
        <span class="journey-back-arrow" aria-hidden="true">←</span>
        <span>返回地区列表</span>
      </button>
      <span class="journey-top-context"><span>日本心旅行</span><i></i><strong id="regionProductContext">地区行程</strong></span>
      <span class="journey-top-brand">飞鸟旅行 · ASUKA TRAVEL</span>
    </div>
    <div class="wrap collection-hero">
      <p class="eyebrow" id="regionProductEyebrow">ASUKA SIGNATURE JOURNEYS</p>
      <div class="rule"></div>
      <h2 id="regionProductTitle">地区行程</h2>
      <p id="regionProductIntro">从当地风土出发，以小团方式连接真正值得停留的风景。</p>
    </div>
    <div class="wrap collection-list">
      <div class="collection-list-head">
        <h3>可选行程</h3>
        <span id="regionProductCount">${published.length} JOURNEYS</span>
      </div>
      <div id="regionJourneyList">
        ${published.map(renderCatalogCard).join('\n        ')}
      </div>
      <div class="journey-empty" id="regionJourneyEmpty" hidden>
        <small>COMING SOON</small>
        <h3>该地区的精选行程正在准备中</h3>
        <p>你仍可通过首页的“开始定制”告诉我们想去的季节与地点。</p>
        <button type="button" onclick="returnToParent('regionProducts','heart')">返回选择其他地区</button>
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

function hasMarker(html, marker) {
  return html.includes(marker.start) && html.includes(marker.end);
}

function normalizeRenderCatalog(input) {
  if (input?.journeys) return normalizeCatalog(input);
  if (input?.id && input.id !== 'homepage') return upsertCatalogJourney(emptyCatalog(), input);
  return emptyCatalog();
}

function removeCssRange(html, startComment, endComment) {
  const start = html.indexOf(startComment);
  const end = html.indexOf(endComment, start + startComment.length);
  if (start < 0 || end < 0) return html;
  return `${html.slice(0, start)}${html.slice(end)}`;
}

function pruneLegacyHomepageCss(html) {
  let output = html;
  output = removeCssRange(
    output,
    '/* Itinerary detail prototype: editorial storytelling with practical sales information. */',
    '/* v15: clear parent-child navigation for journey detail pages. */',
  );
  output = removeCssRange(
    output,
    '/* v16: precise product wording and aligned journey facts. */',
    '/* v22: same-origin responsive images with JPEG fallbacks for older mobile browsers. */',
  );
  output = removeCssRange(
    output,
    '/* v24: full-width calibrated journey map with a readable mobile composition. */',
    '/* v29: usable first-level navigation on phones without a separate mobile site. */',
  );
  output = removeCssRange(
    output,
    '/* v29.1: keep airport transfer routes and values on clear independent lines. */',
    '/* v30: lightweight entry screen; the existing hero image loads behind it. */',
  );
  return output;
}

function renderSite(html, catalogInput, homepage) {
  const catalog = normalizeRenderCatalog(catalogInput);
  let output = html;
  if (hasMarker(output, MARKERS.catalog)) {
    output = replaceManagedBlock(output, MARKERS.catalog, renderCatalog(catalog));
  } else if (hasMarker(output, MARKERS.legacyCard)) {
    const collectionStart = output.indexOf('<section class="overlay journey-collection" id="kantoProducts"');
    const legacyEndStart = output.indexOf(MARKERS.legacyInquiry.end);
    if (collectionStart < 0 || legacyEndStart < collectionStart) {
      throw new Error('旧版关东产品区结构不完整，无法升级为通用行程目录');
    }
    const legacyEnd = legacyEndStart + MARKERS.legacyInquiry.end.length;
    output = `${output.slice(0, collectionStart)}${MARKERS.catalog.start}
      ${renderCatalog(catalog)}
      ${MARKERS.catalog.end}${output.slice(legacyEnd)}`;
  } else {
    throw new Error(`未找到完整 CMS 标记：${MARKERS.catalog.start}`);
  }
  if (homepage) output = renderHomepage(output, homepage);
  return pruneLegacyHomepageCss(output);
}

module.exports = {
  MARKERS,
  escapeHtml,
  renderCatalog,
  renderCatalogCard,
  renderJourneyPage,
  renderSite,
  replaceManagedBlock,
  pruneLegacyHomepageCss,
};
