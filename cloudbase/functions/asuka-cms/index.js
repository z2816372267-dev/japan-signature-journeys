'use strict';

const crypto = require('node:crypto');
const tcb = require('@cloudbase/node-sdk');
const { GitHubPublisher } = require('./lib/github');
const { renderSite } = require('./lib/render-journey.cjs');
const { cmsError, normalizeEmail, stripInternal, validateJourney } = require('./lib/validation');

const app = tcb.init({ env: tcb.SYMBOL_CURRENT_ENV });
const auth = app.auth();
const db = app.database();

const COLLECTIONS = Object.freeze({
  staff: 'cms_staff',
  invites: 'cms_invites',
  drafts: 'cms_drafts',
  assets: 'cms_assets',
  publishes: 'cms_publishes',
  audit: 'cms_audit',
});

const SITE = Object.freeze({
  owner: process.env.CMS_GITHUB_OWNER || 'z2816372267-dev',
  repo: process.env.CMS_GITHUB_REPO || 'japan-signature-journeys',
  branch: process.env.CMS_GITHUB_BRANCH || 'main',
  url: process.env.CMS_SITE_URL || 'https://z2816372267-dev.github.io/japan-signature-journeys/',
});

function github() {
  return new GitHubPublisher({
    ...SITE,
    token: process.env.CMS_GITHUB_TOKEN || '',
  });
}

function firstDocument(response) {
  if (Array.isArray(response?.data)) return response.data[0] || null;
  return response?.data || null;
}

function documentList(response) {
  if (Array.isArray(response?.data)) return response.data;
  return response?.data ? [response.data] : [];
}

function now() {
  return new Date().toISOString();
}

function emailId(email) {
  return crypto.createHash('sha256').update(email).digest('hex');
}

function configuredAdmins() {
  return new Set(
    String(process.env.CMS_ADMIN_EMAILS || '')
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

async function readDoc(collection, id) {
  try {
    return firstDocument(await db.collection(collection).doc(id).get());
  } catch (error) {
    if (/not exist|不存在|DATABASE_COLLECTION_NOT_EXIST/i.test(error.message || '')) return null;
    throw error;
  }
}

async function writeDoc(collection, id, data) {
  return db.collection(collection).doc(id).set({ data });
}

async function getCaller() {
  const session = auth.getUserInfo();
  if (!session?.uid) throw cmsError('AUTH_REQUIRED', '请先登录飞鸟旅行后台', 401);
  const result = await auth.getEndUserInfo(session.uid);
  const user = result?.userInfo || {};
  if (!user.email) throw cmsError('EMAIL_REQUIRED', '当前账号没有已验证邮箱', 403);
  return {
    uid: session.uid,
    email: normalizeEmail(user.email),
    name: user.nickName || user.username || user.email.split('@')[0],
  };
}

async function authorize(requiredRole = 'editor') {
  const user = await getCaller();
  let staff = await readDoc(COLLECTIONS.staff, user.uid);

  if (configuredAdmins().has(user.email)) {
    staff = {
      uid: user.uid,
      email: user.email,
      name: user.name,
      role: 'admin',
      active: true,
      source: 'bootstrap',
      updatedAt: now(),
    };
    await writeDoc(COLLECTIONS.staff, user.uid, staff);
  } else if (!staff) {
    const invite = await readDoc(COLLECTIONS.invites, emailId(user.email));
    if (invite?.active) {
      staff = {
        uid: user.uid,
        email: user.email,
        name: user.name,
        role: invite.role === 'admin' ? 'admin' : 'editor',
        active: true,
        source: 'invite',
        invitedBy: invite.invitedBy || '',
        updatedAt: now(),
      };
      await writeDoc(COLLECTIONS.staff, user.uid, staff);
    }
  }

  if (!staff?.active) throw cmsError('NOT_ALLOWED', '此邮箱尚未获准使用飞鸟旅行后台', 403);
  if (requiredRole === 'admin' && staff.role !== 'admin') {
    throw cmsError('ADMIN_REQUIRED', '只有管理员可以执行此操作', 403);
  }
  return { ...user, role: staff.role === 'admin' ? 'admin' : 'editor' };
}

async function audit(actor, action, detail = {}) {
  try {
    await db.collection(COLLECTIONS.audit).add({
      data: {
        action,
        actorUid: actor.uid,
        actorEmail: actor.email,
        detail,
        createdAt: now(),
      },
    });
  } catch (error) {
    console.warn('audit-log-failed', error.message);
  }
}

async function readPublishedContent() {
  const text = await github().getTextFile('content/journeys/kanto-6d.json');
  return validateJourney(JSON.parse(text));
}

async function getContent(actor) {
  const draft = await readDoc(COLLECTIONS.drafts, 'kanto-6d');
  let published = null;
  try {
    published = await readPublishedContent();
  } catch (error) {
    if (!draft?.content) throw error;
  }
  return {
    content: draft?.content || published,
    published,
    draftInfo: draft
      ? { updatedAt: draft.updatedAt, updatedBy: draft.updatedBy, updatedByName: draft.updatedByName }
      : null,
    actor,
  };
}

async function saveDraft(actor, event) {
  const content = validateJourney(event.content);
  const savedAt = now();
  await writeDoc(COLLECTIONS.drafts, content.id, {
    journeyId: content.id,
    content,
    updatedAt: savedAt,
    updatedBy: actor.email,
    updatedByUid: actor.uid,
    updatedByName: actor.name,
  });
  await audit(actor, 'save-draft', { journeyId: content.id });
  return { savedAt };
}

function decodeVariant(variant, expectedMime) {
  if (!variant || variant.mime !== expectedMime || typeof variant.base64 !== 'string') {
    throw cmsError('INVALID_IMAGE', '图片格式不符合要求');
  }
  const buffer = Buffer.from(variant.base64, 'base64');
  if (!buffer.length || buffer.length > 2 * 1024 * 1024) {
    throw cmsError('INVALID_IMAGE', '单张图片处理结果必须小于2MB');
  }
  if (expectedMime === 'image/webp') {
    if (buffer.slice(0, 4).toString('ascii') !== 'RIFF' || buffer.slice(8, 12).toString('ascii') !== 'WEBP') {
      throw cmsError('INVALID_IMAGE', 'WebP 图片校验失败');
    }
  } else if (!(buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff)) {
    throw cmsError('INVALID_IMAGE', 'JPEG 图片校验失败');
  }
  return buffer;
}

function safeSlug(value) {
  const slug = String(value || 'journey-photo')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || 'journey-photo';
}

async function stageAsset(actor, event) {
  if (event.journeyId !== 'kanto-6d') throw cmsError('INVALID_IMAGE', '行程编号不正确');
  const alt = String(event.alt || '').trim();
  if (!alt || alt.length > 120) throw cmsError('INVALID_IMAGE', '请填写120字以内的图片说明');
  const input = Object.fromEntries((event.variants || []).map((variant) => [variant.key, variant]));
  const specs = {
    webp480: { mime: 'image/webp', suffix: '480.webp' },
    webp960: { mime: 'image/webp', suffix: '960.webp' },
    webp1600: { mime: 'image/webp', suffix: '1600.webp' },
    fallback: { mime: 'image/jpeg', suffix: '960.jpg' },
  };
  const decoded = {};
  let total = 0;
  for (const [key, spec] of Object.entries(specs)) {
    decoded[key] = decodeVariant(input[key], spec.mime);
    total += decoded[key].length;
  }
  if (total > 5 * 1024 * 1024) throw cmsError('INVALID_IMAGE', '整组响应式图片必须小于5MB');

  const assetId = crypto.randomUUID().replaceAll('-', '');
  const slug = safeSlug(event.slug);
  const month = new Date().toISOString().slice(0, 7).replace('-', '');
  const variants = [];

  for (const [key, spec] of Object.entries(specs)) {
    const filename = `${slug}-${assetId}-${spec.suffix}`;
    const cloudPath = `cms-assets/${actor.uid}/${assetId}/${filename}`;
    const repoPath = `images/cms/kanto-6d/${month}/${filename}`;
    const uploaded = await app.uploadFile({ cloudPath, fileContent: decoded[key] });
    variants.push({
      key,
      fileID: uploaded.fileID,
      repoPath,
      mime: spec.mime,
      bytes: decoded[key].length,
    });
  }

  const largest = input.webp1600;
  const asset = {
    assetId,
    journeyId: event.journeyId,
    ownerUid: actor.uid,
    ownerEmail: actor.email,
    alt,
    variants,
    width: Number(largest.width) || 1600,
    height: Number(largest.height) || 1200,
    status: 'staged',
    createdAt: now(),
  };
  await writeDoc(COLLECTIONS.assets, assetId, asset);
  await audit(actor, 'stage-asset', { journeyId: event.journeyId, assetId });

  const paths = Object.fromEntries(variants.map((variant) => [variant.key, variant.repoPath]));
  const fallback = variants.find((variant) => variant.key === 'fallback');
  const temporary = await app.getTempFileURL({ fileList: [{ fileID: fallback.fileID, maxAge: 3600 }] });
  return {
    image: {
      ...paths,
      width: asset.width,
      height: asset.height,
      alt,
      _assetId: assetId,
    },
    previewUrl: temporary.fileList?.[0]?.tempFileURL || '',
  };
}

function collectAssetIds(value, result = new Set()) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectAssetIds(item, result));
  } else if (value && typeof value === 'object') {
    if (typeof value._assetId === 'string') result.add(value._assetId);
    Object.values(value).forEach((item) => collectAssetIds(item, result));
  }
  return result;
}

async function stagedAssetFiles(content) {
  const files = [];
  for (const assetId of collectAssetIds(content)) {
    const asset = await readDoc(COLLECTIONS.assets, assetId);
    if (!asset || asset.status !== 'staged') {
      throw cmsError('ASSET_MISSING', '有一张新图片尚未成功暂存，请重新上传', 409);
    }
    for (const variant of asset.variants) {
      const downloaded = await app.downloadFile({ fileID: variant.fileID });
      if (!downloaded.fileContent) throw cmsError('ASSET_MISSING', '无法读取暂存图片', 500);
      files.push({ path: variant.repoPath, content: downloaded.fileContent });
    }
  }
  return files;
}

async function publish(actor, event) {
  const draft = event.content || (await readDoc(COLLECTIONS.drafts, 'kanto-6d'))?.content;
  const content = validateJourney(draft);
  const cleanContent = stripInternal(content);
  const publisher = github();
  const currentIndex = await publisher.getTextFile('index.html');
  const renderedIndex = renderSite(currentIndex, cleanContent);
  const assets = await stagedAssetFiles(content);
  const messageInput = String(event.message || '').trim().replace(/[\r\n]+/g, ' ').slice(0, 100);
  const message = messageInput || 'Update Kanto journey via Asuka CMS';
  const files = [
    { path: 'index.html', content: renderedIndex },
    { path: 'content/journeys/kanto-6d.json', content: `${JSON.stringify(cleanContent, null, 2)}\n` },
    ...assets,
  ];
  const result = await publisher.publish(files, message);
  const publishedAt = now();

  await writeDoc(COLLECTIONS.drafts, cleanContent.id, {
    journeyId: cleanContent.id,
    content: cleanContent,
    updatedAt: publishedAt,
    updatedBy: actor.email,
    updatedByUid: actor.uid,
    updatedByName: actor.name,
  });
  await db.collection(COLLECTIONS.publishes).add({
    data: {
      journeyId: cleanContent.id,
      commitSha: result.sha,
      commitUrl: result.commitUrl,
      message,
      publishedAt,
      publishedBy: actor.email,
      publishedByUid: actor.uid,
      publishedByName: actor.name,
    },
  });
  await audit(actor, 'publish', { journeyId: cleanContent.id, commitSha: result.sha });

  return {
    ...result,
    publishedAt,
    siteUrl: `${SITE.url}?v=${result.sha.slice(0, 7)}`,
  };
}

async function history() {
  try {
    const response = await db.collection(COLLECTIONS.publishes).orderBy('publishedAt', 'desc').limit(20).get();
    return documentList(response);
  } catch (error) {
    if (/not exist|不存在|DATABASE_COLLECTION_NOT_EXIST/i.test(error.message || '')) return [];
    throw error;
  }
}

async function listStaff() {
  const [staffResponse, inviteResponse] = await Promise.all([
    db.collection(COLLECTIONS.staff).limit(50).get(),
    db.collection(COLLECTIONS.invites).limit(50).get(),
  ]);
  return {
    staff: documentList(staffResponse),
    invites: documentList(inviteResponse),
  };
}

async function inviteStaff(actor, event) {
  const email = normalizeEmail(event.email);
  const role = event.role === 'admin' ? 'admin' : 'editor';
  const invitation = {
    email,
    role,
    active: true,
    invitedBy: actor.email,
    createdAt: now(),
  };
  await writeDoc(COLLECTIONS.invites, emailId(email), invitation);
  await audit(actor, 'invite-staff', { email, role });
  return invitation;
}

async function updateStaff(actor, event) {
  const uid = String(event.uid || '').trim();
  if (!uid) throw cmsError('INVALID_STAFF', '工作人员编号不能为空');
  if (uid === actor.uid && event.active === false) {
    throw cmsError('INVALID_STAFF', '不能停用当前登录的管理员账号');
  }
  const staff = await readDoc(COLLECTIONS.staff, uid);
  if (!staff) throw cmsError('INVALID_STAFF', '未找到该工作人员', 404);
  const updated = {
    ...staff,
    role: event.role === 'admin' ? 'admin' : 'editor',
    active: event.active !== false,
    updatedAt: now(),
    updatedBy: actor.email,
  };
  await writeDoc(COLLECTIONS.staff, uid, updated);
  await audit(actor, 'update-staff', { uid, role: updated.role, active: updated.active });
  return updated;
}

const ACTIONS = {
  me: { role: 'editor', handler: async (actor) => ({ actor }) },
  getContent: { role: 'editor', handler: getContent },
  saveDraft: { role: 'editor', handler: saveDraft },
  stageAsset: { role: 'editor', handler: stageAsset },
  publish: { role: 'admin', handler: publish },
  history: { role: 'editor', handler: async () => ({ items: await history() }) },
  listStaff: { role: 'admin', handler: async () => listStaff() },
  inviteStaff: { role: 'admin', handler: inviteStaff },
  updateStaff: { role: 'admin', handler: updateStaff },
};

exports.main = async (event = {}) => {
  const action = String(event.action || '');
  const route = ACTIONS[action];
  if (!route) return { ok: false, error: { code: 'UNKNOWN_ACTION', message: '未知的后台操作' } };
  try {
    const actor = await authorize(route.role);
    const data = await route.handler(actor, event);
    return { ok: true, data };
  } catch (error) {
    console.error('cms-action-failed', action, error.code || '', error.message);
    return {
      ok: false,
      error: {
        code: error.code || 'INTERNAL_ERROR',
        message: error.code ? error.message : '后台暂时无法完成此操作，请稍后重试',
      },
    };
  }
};
