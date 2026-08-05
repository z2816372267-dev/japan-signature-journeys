'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { renderJourneyPage, renderSite } = require('../cloudbase/functions/asuka-cms/lib/render-journey.cjs');
const { upsertCatalogJourney } = require('../cloudbase/functions/asuka-cms/lib/journey-model');

const root = path.resolve(__dirname, '..');
const indexPath = path.join(root, 'index.html');
const contentPath = path.join(root, 'content', 'journeys', 'kanto-6d.json');
const catalogPath = path.join(root, 'content', 'journeys', 'index.json');
const homepagePath = path.join(root, 'content', 'homepage.json');
const sitemapPath = path.join(root, 'sitemap.xml');
const siteUrl = 'https://z2816372267-dev.github.io/japan-signature-journeys/';

const html = fs.readFileSync(indexPath, 'utf8');
const data = JSON.parse(fs.readFileSync(contentPath, 'utf8'));
const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
const homepage = JSON.parse(fs.readFileSync(homepagePath, 'utf8'));
const nextCatalog = upsertCatalogJourney(catalog, data);
const rendered = renderSite(html, nextCatalog, homepage);
const journeyPagePath = path.join(root, 'journeys', data.id, 'index.html');
const journeyPage = renderJourneyPage(data);
const nextCatalogJson = `${JSON.stringify(nextCatalog, null, 2)}\n`;
const sitemapEntries = [
  siteUrl,
  ...nextCatalog.journeys
    .filter((item) => item.visibility !== 'hidden')
    .map((item) => `${siteUrl}journeys/${item.id}/`),
];
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapEntries.map((url) => `  <url><loc>${url}</loc></url>`).join('\n')}
</urlset>
`;
let changed = false;

if (rendered !== html) {
  fs.writeFileSync(indexPath, rendered);
  changed = true;
}
if (fs.readFileSync(catalogPath, 'utf8') !== nextCatalogJson) {
  fs.writeFileSync(catalogPath, nextCatalogJson);
  changed = true;
}
if (!fs.existsSync(sitemapPath) || fs.readFileSync(sitemapPath, 'utf8') !== sitemap) {
  fs.writeFileSync(sitemapPath, sitemap);
  changed = true;
}
fs.mkdirSync(path.dirname(journeyPagePath), { recursive: true });
if (!fs.existsSync(journeyPagePath) || fs.readFileSync(journeyPagePath, 'utf8') !== journeyPage) {
  fs.writeFileSync(journeyPagePath, journeyPage);
  changed = true;
}

process.stdout.write(changed
  ? '已从首页、行程目录与关东行程数据生成完整静态网站。\n'
  : '官网首页与行程详情页已是最新，无需重新生成。\n');
