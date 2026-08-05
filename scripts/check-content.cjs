'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { renderJourneyPage, renderSite } = require('../cloudbase/functions/asuka-cms/lib/render-journey.cjs');
const { validateHomepage, validateJourney } = require('../cloudbase/functions/asuka-cms/lib/validation');

const root = path.resolve(__dirname, '..');
const indexPath = path.join(root, 'index.html');
const contentPath = path.join(root, 'content', 'journeys', 'kanto-6d.json');
const catalogPath = path.join(root, 'content', 'journeys', 'index.json');
const homepagePath = path.join(root, 'content', 'homepage.json');
const errors = [];

function required(value, label, max = 1000) {
  if (typeof value !== 'string' || !value.trim()) errors.push(`${label} 不能为空`);
  if (typeof value === 'string' && value.length > max) errors.push(`${label} 超过 ${max} 字`);
}

function checkImage(image, label) {
  if (!image) return;
  for (const key of ['webp480', 'webp960', 'webp1600', 'fallback', 'alt']) {
    required(image[key], `${label}.${key}`, key === 'alt' ? 120 : 240);
  }
  for (const key of ['webp480', 'webp960', 'webp1600', 'fallback']) {
    if (typeof image[key] === 'string' && !image[key].includes('/cms-')) {
      const asset = path.join(root, image[key]);
      if (!fs.existsSync(asset)) errors.push(`${label}.${key} 指向的文件不存在：${image[key]}`);
    }
  }
}

const data = JSON.parse(fs.readFileSync(contentPath, 'utf8'));
const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
const homepage = JSON.parse(fs.readFileSync(homepagePath, 'utf8'));
try {
  validateJourney(data);
} catch (error) {
  errors.push(`后台发布校验失败：${error.message}`);
}
try {
  validateHomepage(homepage);
} catch (error) {
  errors.push(`首页发布校验失败：${error.message}`);
}
if (data.schemaVersion !== 2) errors.push('行程 schemaVersion 必须为 2');
if (catalog.schemaVersion !== 1 || !catalog.journeys?.some((item) => item.id === data.id)) {
  errors.push('行程目录缺少当前关东行程');
}
required(data.id, 'id', 64);
required(data.productCode, 'productCode', 32);
required(data.card?.title, 'card.title', 80);
required(data.hero?.copy, 'hero.copy', 400);
checkImage(data.hero?.image, 'hero.image');

if (!Array.isArray(data.days) || data.days.length !== 6) {
  errors.push('关东行程必须包含 6 天');
} else {
  data.days.forEach((day, index) => {
    const label = `days[${index}]`;
    required(day.title, `${label}.title`, 80);
    required(day.route, `${label}.route`, 120);
    required(day.story, `${label}.story`, 1200);
    required(day.distance?.value, `${label}.distance.value`, 120);
    required(day.duration?.value, `${label}.duration.value`, 120);
    required(day.hotel, `${label}.hotel`, 300);
    checkImage(day.image, `${label}.image`);
  });
}

for (const [index, item] of (data.highlights?.items || []).entries()) {
  required(item.title, `highlights.items[${index}].title`, 80);
  checkImage(item.image, `highlights.items[${index}].image`);
}

homepage.hero?.slides?.forEach((slide, index) => checkImage(slide.image, `homepage.hero.slides[${index}].image`));
homepage.selection?.items?.forEach((item, index) => checkImage(item.image, `homepage.selection.items[${index}].image`));
homepage.ways?.items?.forEach((item, index) => checkImage(item.image, `homepage.ways.items[${index}].image`));

try {
  renderSite(fs.readFileSync(indexPath, 'utf8'), catalog, homepage);
  renderJourneyPage(data);
} catch (error) {
  errors.push(`静态生成失败：${error.message}`);
}

for (const asset of ['journeys/journey.css', 'journeys/journey.js']) {
  if (!fs.existsSync(path.join(root, asset))) errors.push(`动态行程公共文件不存在：${asset}`);
}

if (errors.length) {
  process.stderr.write(`内容检查失败：\n- ${errors.join('\n- ')}\n`);
  process.exit(1);
}

process.stdout.write('内容结构、图片路径与静态生成检查通过。\n');
