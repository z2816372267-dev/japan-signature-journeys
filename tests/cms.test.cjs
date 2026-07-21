'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { renderSite } = require('../cloudbase/functions/asuka-cms/lib/render-journey.cjs');
const { stripInternal, validateJourney } = require('../cloudbase/functions/asuka-cms/lib/validation');

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

test('官网使用行车里程与预计驾驶时间，并区分羽田和成田', () => {
  const rendered = renderSite(html, data);
  assert.match(rendered, /行车里程：羽田约20—25公里｜成田约65—75公里/);
  assert.match(rendered, /预计驾驶时间：羽田约30—50分钟｜成田约60—90分钟/);
  assert.doesNotMatch(rendered, /参考车程：/);
  assert.doesNotMatch(rendered, /预计耗时：/);
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
