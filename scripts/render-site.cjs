'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { renderSite } = require('../cloudbase/functions/asuka-cms/lib/render-journey.cjs');

const root = path.resolve(__dirname, '..');
const indexPath = path.join(root, 'index.html');
const contentPath = path.join(root, 'content', 'journeys', 'kanto-6d.json');
const homepagePath = path.join(root, 'content', 'homepage.json');

const html = fs.readFileSync(indexPath, 'utf8');
const data = JSON.parse(fs.readFileSync(contentPath, 'utf8'));
const homepage = JSON.parse(fs.readFileSync(homepagePath, 'utf8'));
const rendered = renderSite(html, data, homepage);

if (rendered === html) {
  process.stdout.write('官网内容已是最新，无需重新生成。\n');
} else {
  fs.writeFileSync(indexPath, rendered);
  process.stdout.write('已从关东行程与首页内容数据生成官网静态内容。\n');
}
