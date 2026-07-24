'use strict';

const MARKERS = Object.freeze({
  metaImage: {
    start: '<!-- ASUKA_CMS:HOMEPAGE_META_IMAGE:START -->',
    end: '<!-- ASUKA_CMS:HOMEPAGE_META_IMAGE:END -->',
  },
  preload: {
    start: '<!-- ASUKA_CMS:HOMEPAGE_PRELOAD:START -->',
    end: '<!-- ASUKA_CMS:HOMEPAGE_PRELOAD:END -->',
  },
  hero: {
    start: '<!-- ASUKA_CMS:HOMEPAGE_HERO:START -->',
    end: '<!-- ASUKA_CMS:HOMEPAGE_HERO:END -->',
  },
  intro: {
    start: '<!-- ASUKA_CMS:HOMEPAGE_INTRO:START -->',
    end: '<!-- ASUKA_CMS:HOMEPAGE_INTRO:END -->',
  },
  selection: {
    start: '<!-- ASUKA_CMS:HOMEPAGE_SELECTION:START -->',
    end: '<!-- ASUKA_CMS:HOMEPAGE_SELECTION:END -->',
  },
  ways: {
    start: '<!-- ASUKA_CMS:HOMEPAGE_WAYS:START -->',
    end: '<!-- ASUKA_CMS:HOMEPAGE_WAYS:END -->',
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
  const pictureClass = options.pictureClass ? ` class="${escapeHtml(options.pictureClass)}"` : '';
  const sizes = escapeHtml(options.sizes || '100vw');
  const loading = options.loading === 'eager' ? 'eager' : 'lazy';
  const priority = options.priority === 'high' ? 'high' : 'low';
  const alt = options.decorative ? '' : image.alt;
  return `<picture${pictureClass}><source type="image/webp" srcset="${safeAssetPath(image.webp480)} 480w, ${safeAssetPath(image.webp960)} 960w, ${safeAssetPath(image.webp1600)} 1600w" sizes="${sizes}" /><img src="${safeAssetPath(image.fallback)}" width="${Number(image.width) || 1600}" height="${Number(image.height) || 1200}" alt="${escapeHtml(alt)}" loading="${loading}" decoding="async" fetchpriority="${priority}" /></picture>`;
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

function renderMetaImage(data) {
  const image = data.hero.slides[0].image;
  return `<meta property="og:image" content="https://z2816372267-dev.github.io/japan-signature-journeys/${safeAssetPath(image.fallback)}" />
  <meta property="og:image:alt" content="${escapeHtml(image.alt)}" />`;
}

function renderPreload(data) {
  const image = data.hero.slides[0].image;
  return `<link rel="preload" as="image" href="${safeAssetPath(image.webp960)}" imagesrcset="${safeAssetPath(image.webp480)} 480w, ${safeAssetPath(image.webp960)} 960w, ${safeAssetPath(image.webp1600)} 1600w" imagesizes="100vw" type="image/webp" fetchpriority="high" />`;
}

function renderHero(data) {
  return `<section class="hero">
      <div class="hero-slides" aria-hidden="true">
        ${data.hero.slides.map((slide, index) => `<div class="hero-slide${index === 0 ? ' active' : ''}">
          ${renderPicture(slide.image, {
            loading: index === 0 ? 'eager' : 'lazy',
            priority: index === 0 ? 'high' : 'low',
            decorative: true,
          })}
        </div>`).join('\n        ')}
      </div>
      <div class="hero-inner"><p class="eyebrow" style="color:#eadbc1">${escapeHtml(data.hero.eyebrow)}</p><h1>${textWithBreaks(data.hero.title)}</h1><p class="hero-copy">${textWithBreaks(data.hero.copy)}</p><div class="hero-actions"><button class="primary hero-primary" onclick="openPanel('heart')"><span>${escapeHtml(data.hero.primaryLabel)}</span><span class="hero-cta-arrow" aria-hidden="true">→</span></button><a class="link-light hero-secondary" href="#entry"><span>${escapeHtml(data.hero.secondaryLabel)}</span><span class="hero-cta-arrow" aria-hidden="true">↓</span></a></div></div><p class="hero-side">SEASONAL · INTIMATE · JAPAN</p><p class="credit">${escapeHtml(data.hero.credit)}</p>
    </section>`;
}

function renderIntro(data) {
  return `<section class="wrap section intro reveal"><div><p class="eyebrow">${escapeHtml(data.intro.eyebrow)}</p><div class="rule"></div><h2 class="section-title">${textWithBreaks(data.intro.title)}</h2></div><div class="intro-copy"><p class="lead">${textWithBreaks(data.intro.lead)}</p><p>${textWithBreaks(data.intro.copy)}</p></div></section>`;
}

function renderSelectionItem(item, index, total) {
  const number = String(index + 1).padStart(2, '0');
  const count = String(total).padStart(2, '0');
  const action = index === 0
    ? 'href="#kantoJourney" onclick="openKantoJourney();return false"'
    : 'href="#heart" onclick="openPanel(\'heart\');return false"';
  return `<article class="asuka-selection-slide${index === 0 ? ' is-active' : ''}" data-selection-slide role="group" aria-roledescription="幻灯片" aria-label="第${index + 1}项，共${total}项：${escapeHtml(item.title)}"${index === 0 ? ' aria-current="true"' : ''}>
              <div class="asuka-selection-visual">
                ${renderPicture(item.image, {
                  pictureClass: 'asuka-selection-media',
                  sizes: '(max-width:760px) calc(100vw - 42px), (max-width:1080px) 64vw, (max-width:1607px) 56vw, 900px',
                })}
                <span class="asuka-selection-place">${escapeHtml(item.placeLatin)} · ${escapeHtml(item.placeCn)}</span>
                <span class="asuka-selection-count" aria-hidden="true"><strong>${number}</strong><span></span><small>${count}</small></span>
              </div>
              <div class="asuka-selection-caption">
                <div class="asuka-selection-title"><small>${escapeHtml(item.kicker)}</small><h3>${escapeHtml(item.title)}</h3></div>
                <div class="asuka-selection-copy"><p>${textWithBreaks(item.copy)}</p><a class="asuka-selection-link" ${action}>${escapeHtml(item.ctaLabel)} <span aria-hidden="true">→</span></a></div>
              </div>
            </article>`;
}

function renderSelection(data) {
  const items = data.selection.items;
  return `<section class="asuka-selection section" id="asuka-selection" aria-labelledby="asuka-selection-title">
      <div class="wrap asuka-selection-head reveal">
        <p class="eyebrow">${escapeHtml(data.selection.eyebrow)}</p>
        <div class="rule"></div>
        <h2 class="section-title" id="asuka-selection-title">${escapeHtml(data.selection.title)}</h2>
        <p class="subline">${textWithBreaks(data.selection.copy)}</p>
      </div>
      <div class="asuka-selection-stage">
        <button class="asuka-selection-control asuka-selection-control--prev" id="asukaSelectionPrev" type="button" aria-label="查看上一项飞鸟之选" aria-controls="asukaSelectionViewport">←</button>
        <div class="asuka-selection-viewport" id="asukaSelectionViewport" tabindex="0" role="region" aria-roledescription="轮播" aria-label="飞鸟精选旅行灵感">
          <div class="asuka-selection-track">
            ${items.map((item, index) => renderSelectionItem(item, index, items.length)).join('\n            ')}
          </div>
        </div>
        <button class="asuka-selection-control asuka-selection-control--next" id="asukaSelectionNext" type="button" aria-label="查看下一项飞鸟之选" aria-controls="asukaSelectionViewport">→</button>
        <p class="asuka-selection-status" id="asukaSelectionStatus" aria-live="polite">第1项，共${items.length}项：${escapeHtml(items[0].title)}</p>
      </div>
    </section>`;
}

function renderWays(data) {
  const actions = ['heart', 'custom', 'themes'];
  return `<section class="entry section" id="entry">
      <div class="wrap entry-head reveal"><div><p class="eyebrow">${escapeHtml(data.ways.eyebrow)}</p><div class="rule"></div><h2 class="section-title">${escapeHtml(data.ways.title)}</h2></div><p class="subline">${textWithBreaks(data.ways.copy)}</p></div>
      <div class="wrap entry-grid">
        ${data.ways.items.map((item, index) => `<article class="entry-card reveal"${index ? ` style="transition-delay:.${index}s"` : ''} onclick="openPanel('${actions[index]}')">
          ${renderPicture(item.image, {
            pictureClass: 'entry-bg',
            sizes: '(max-width:760px) calc(100vw - 42px), 390px',
          })}
          <small>${escapeHtml(item.kicker)}</small><h3>${escapeHtml(item.title)}</h3><p>${textWithBreaks(item.copy)}</p><span>${escapeHtml(item.ctaLabel)} →</span>
        </article>`).join('\n        ')}
      </div>
    </section>`;
}

function renderHomepage(html, data) {
  let output = html;
  output = replaceManagedBlock(output, MARKERS.metaImage, renderMetaImage(data));
  output = replaceManagedBlock(output, MARKERS.preload, renderPreload(data));
  output = replaceManagedBlock(output, MARKERS.hero, renderHero(data));
  output = replaceManagedBlock(output, MARKERS.intro, renderIntro(data));
  output = replaceManagedBlock(output, MARKERS.selection, renderSelection(data));
  output = replaceManagedBlock(output, MARKERS.ways, renderWays(data));
  return output;
}

module.exports = {
  MARKERS,
  renderHomepage,
  renderHero,
  renderIntro,
  renderSelection,
  renderWays,
};
