'use strict';

const crypto = require('node:crypto');
const tcb = require('@cloudbase/node-sdk');
const { GitHubPublisher } = require('./lib/github');
const { renderSite } = require('./lib/render-journey.cjs');
const {
  cmsError,
  normalizeEmail,
  stripInternal,
  validateHomepage,
  validateJourney,
} = require('./lib/validation');

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

const CONTENT_RESOURCES = Object.freeze({
  homepage: {
    id: 'homepage',
    label: '官网首页',
    path: 'content/homepage.json',
    defaultMessage: 'Update Asuka homepage via CMS',
    validate: validateHomepage,
  },
  'kanto-6d': {
    id: 'kanto-6d',
    label: '关东山海6日',
    path: 'content/journeys/kanto-6d.json',
    defaultMessage: 'Update Kanto journey via Asuka CMS',
    validate: validateJourney,
  },
});

function contentResource(value) {
  const id = String(value || 'kanto-6d').trim();
  const resource = CONTENT_RESOURCES[id];
  if (!resource) throw cmsError('INVALID_RESOURCE', '后台内容类型不受支持');
  return resource;
}

function resourceFromEvent(event = {}) {
  return contentResource(event.resourceId || event.content?.id || event.journeyId || 'kanto-6d');
}

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
  const safeData = Object.fromEntries(
    Object.entries(data || {}).filter(([key]) => key !== '_id' && key !== '_openid'),
  );
  return db.collection(collection).doc(id).set({ data: safeData });
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
      await writeDoc(COLLECTIONS.invites, emailId(user.email), {
        ...invite,
        active: false,
        acceptedAt: now(),
        acceptedByUid: user.uid,
      });
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

async function readPublishedContent(resource) {
  const text = await github().getTextFile(resource.path);
  return resource.validate(JSON.parse(text));
}

async function getContent(actor, event) {
  const resource = resourceFromEvent(event);
  const draft = await readDoc(COLLECTIONS.drafts, resource.id);
  const draftContent = draft?.content ? resource.validate(structuredClone(draft.content)) : null;
  let published = null;
  try {
    published = await readPublishedContent(resource);
  } catch (error) {
    if (!draft?.content) throw error;
  }
  return {
    content: draftContent || published,
    published,
    draftInfo: draft
      ? {
          updatedAt: draft.updatedAt,
          updatedBy: draft.updatedBy,
          updatedByName: draft.updatedByName,
          revision: Number(draft.revision) || 0,
        }
      : null,
    actor,
    resourceId: resource.id,
  };
}

async function saveDraft(actor, event) {
  const resource = resourceFromEvent(event);
  const content = resource.validate(event.content);
  if (content.id !== resource.id) throw cmsError('INVALID_RESOURCE', '内容编号与当前编辑栏目不一致');
  const current = await readDoc(COLLECTIONS.drafts, resource.id);
  const currentRevision = Number(current?.revision) || 0;
  const expectedRevision = Number(event.revision) || 0;
  if (currentRevision !== expectedRevision) {
    const editor = current?.updatedByName || current?.updatedBy || '另一位工作人员';
    throw cmsError(
      'DRAFT_CONFLICT',
      `${editor} 已保存了较新的内容。为避免覆盖，系统没有保存你当前的修改，请重新读取最新草稿。`,
      409,
    );
  }
  const savedAt = now();
  const revision = currentRevision + 1;
  await writeDoc(COLLECTIONS.drafts, resource.id, {
    resourceId: resource.id,
    ...(resource.id === 'kanto-6d' ? { journeyId: resource.id } : {}),
    content,
    revision,
    updatedAt: savedAt,
    updatedBy: actor.email,
    updatedByUid: actor.uid,
    updatedByName: actor.name,
  });
  await audit(actor, 'save-draft', { resourceId: resource.id, revision });
  return { savedAt, revision, resourceId: resource.id };
}

function decodeVariant(variant, expectedMime) {
  if (!variant || variant.mime !== expectedMime || typeof variant.base64 !== 'string') {
    throw cmsError('INVALID_IMAGE', '图片格式不符合要求');
  }
  const buffer = Buffer.from(variant.base64, 'base64');
  if (!buffer.length || buffer.length > 1400 * 1024) {
    throw cmsError('INVALID_IMAGE', '单张图片处理结果必须小于1.4MB');
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
  const resource = resourceFromEvent(event);
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
  if (total > 3 * 1024 * 1024) throw cmsError('INVALID_IMAGE', '整组响应式图片必须小于3MB');

  const assetId = crypto.randomUUID().replaceAll('-', '');
  const slug = safeSlug(event.slug);
  const month = new Date().toISOString().slice(0, 7).replace('-', '');
  const variants = await Promise.all(Object.entries(specs).map(async ([key, spec]) => {
    const filename = `${slug}-${assetId}-${spec.suffix}`;
    const cloudPath = `cms-assets/${actor.uid}/${assetId}/${filename}`;
    const repoPath = `images/cms/${resource.id}/${month}/${filename}`;
    const uploaded = await app.uploadFile({ cloudPath, fileContent: decoded[key] });
    return {
      key,
      fileID: uploaded.fileID,
      repoPath,
      mime: spec.mime,
      bytes: decoded[key].length,
    };
  }));

  const largest = input.webp1600;
  const asset = {
    assetId,
    resourceId: resource.id,
    ...(resource.id === 'kanto-6d' ? { journeyId: resource.id } : {}),
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
  const replacesAssetId = String(event.replacesAssetId || '').trim();
  if (/^[a-f0-9]{32}$/.test(replacesAssetId) && replacesAssetId !== assetId) {
    const replaced = await readDoc(COLLECTIONS.assets, replacesAssetId);
    if (replaced?.status === 'staged' && replaced.ownerUid === actor.uid) {
      await writeDoc(COLLECTIONS.assets, replacesAssetId, {
        ...replaced,
        status: 'replaced',
        replacedAt: now(),
        replacedByAssetId: assetId,
      });
    }
  }
  await audit(actor, 'stage-asset', { resourceId: resource.id, assetId });

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
  const assetIds = [...collectAssetIds(content)];
  const assets = await Promise.all(assetIds.map((assetId) => readDoc(COLLECTIONS.assets, assetId)));
  assets.forEach((asset) => {
    if (!asset || !['staged', 'published'].includes(asset.status)) {
      throw cmsError('ASSET_MISSING', '有一张新图片尚未成功暂存，请重新上传', 409);
    }
  });
  const files = (await Promise.all(assets.flatMap((asset) => asset.variants.map(async (variant) => {
      const downloaded = await app.downloadFile({ fileID: variant.fileID });
      if (!downloaded.fileContent) throw cmsError('ASSET_MISSING', '无法读取暂存图片', 500);
      return { path: variant.repoPath, content: downloaded.fileContent };
    })))).flat();
  return { files, assets };
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function publishJobId(event, cleanContent, message) {
  const requestId = String(event.requestId || '').trim().toLowerCase();
  if (/^[a-z0-9-]{8,80}$/.test(requestId)) return `job-${requestId}`;
  return `job-${crypto.createHash('sha256').update(`${canonicalJson(cleanContent)}\n${message}`).digest('hex').slice(0, 32)}`;
}

async function markAssetsPublished(assets, actor, result, publishedAt) {
  await Promise.all(assets.map((asset) => writeDoc(COLLECTIONS.assets, asset.assetId, {
    ...asset,
    status: 'published',
    publishedAt,
    publishedBy: actor.email,
    commitSha: result.sha,
  })));
}

async function publish(actor, event) {
  const resource = resourceFromEvent(event);
  const currentDraft = await readDoc(COLLECTIONS.drafts, resource.id);
  const currentRevision = Number(currentDraft?.revision) || 0;
  const expectedRevision = Number(event.revision) || 0;
  if (event.content && currentRevision !== expectedRevision) {
    const editor = currentDraft?.updatedByName || currentDraft?.updatedBy || '另一位工作人员';
    throw cmsError('DRAFT_CONFLICT', `${editor} 已保存了较新的草稿，请重新读取后再发布。`, 409);
  }
  const draft = event.content || currentDraft?.content;
  const content = resource.validate(draft);
  if (content.id !== resource.id) throw cmsError('INVALID_RESOURCE', '内容编号与当前发布栏目不一致');
  const cleanContent = stripInternal(content);
  const messageInput = String(event.message || '').trim().replace(/[\r\n]+/g, ' ').slice(0, 100);
  const message = messageInput || resource.defaultMessage;
  const jobId = publishJobId(event, cleanContent, message);
  const previousJob = await readDoc(COLLECTIONS.publishes, jobId);
  if (previousJob?.status === 'completed' && previousJob.result) return previousJob.result;
  if (previousJob?.status === 'running' && Date.now() - new Date(previousJob.startedAt).getTime() < 30_000) {
    throw cmsError('PUBLISH_IN_PROGRESS', '同一次发布仍在处理中，请等待约30秒后再查看或重试。', 409);
  }
  await writeDoc(COLLECTIONS.publishes, jobId, {
    status: 'running',
    resourceId: resource.id,
    ...(resource.id === 'kanto-6d' ? { journeyId: resource.id } : {}),
    message,
    startedAt: now(),
    startedBy: actor.email,
  });

  try {
    const publisher = github();
    const [currentIndex, journeyText, homepageText, staged] = await Promise.all([
      publisher.getTextFile('index.html'),
      publisher.getTextFile('content/journeys/kanto-6d.json').catch(() => ''),
      publisher.getTextFile('content/homepage.json').catch(() => ''),
      stagedAssetFiles(content),
    ]);
    let result;
    let alreadyCurrent = false;
    const activeText = resource.id === 'homepage' ? homepageText : journeyText;
    try {
      const publishedContent = activeText ? stripInternal(resource.validate(JSON.parse(activeText))) : null;
      alreadyCurrent = Boolean(publishedContent && canonicalJson(publishedContent) === canonicalJson(cleanContent));
    } catch {
      alreadyCurrent = false;
    }
    if (alreadyCurrent) {
      const head = await publisher.getHead();
      result = {
        sha: head.commitSha,
        commitUrl: `https://github.com/${SITE.owner}/${SITE.repo}/commit/${head.commitSha}`,
        alreadyCurrent: true,
      };
    } else {
      let journeyContent;
      let homepageContent;
      try {
        journeyContent = resource.id === 'kanto-6d'
          ? cleanContent
          : stripInternal(validateJourney(JSON.parse(journeyText)));
        homepageContent = resource.id === 'homepage'
          ? cleanContent
          : stripInternal(validateHomepage(JSON.parse(homepageText)));
      } catch {
        throw cmsError('PUBLISHED_CONTENT_MISSING', 'GitHub 中缺少 V32 所需的首页或行程数据文件，请先上传 V32 官网上传包', 409);
      }
      const renderedIndex = renderSite(currentIndex, journeyContent, homepageContent);
      const files = [
        { path: 'index.html', content: renderedIndex },
        { path: resource.path, content: `${JSON.stringify(cleanContent, null, 2)}\n` },
        ...staged.files,
      ];
      result = await publisher.publish(files, message);
    }
    const publishedAt = now();
    const latestDraft = await readDoc(COLLECTIONS.drafts, cleanContent.id);
    const latestRevision = Number(latestDraft?.revision) || 0;
    const draftAdvanced = latestRevision !== currentRevision;
    const revision = draftAdvanced ? latestRevision : currentRevision + 1;
    const response = {
      ...result,
      revision,
      draftAdvanced,
      publishedAt,
      siteUrl: `${SITE.url}?v=${result.sha.slice(0, 7)}`,
    };

    const completionTasks = [
      markAssetsPublished(staged.assets, actor, result, publishedAt),
      writeDoc(COLLECTIONS.publishes, jobId, {
        status: 'completed',
        result: response,
        resourceId: resource.id,
        ...(resource.id === 'kanto-6d' ? { journeyId: resource.id } : {}),
        commitSha: result.sha,
        commitUrl: result.commitUrl,
        message,
        publishedAt,
        publishedBy: actor.email,
        publishedByUid: actor.uid,
        publishedByName: actor.name,
      }),
      audit(actor, 'publish', { resourceId: resource.id, commitSha: result.sha, alreadyCurrent, draftAdvanced }),
    ];
    if (!draftAdvanced) {
      completionTasks.push(writeDoc(COLLECTIONS.drafts, resource.id, {
        resourceId: resource.id,
        ...(resource.id === 'kanto-6d' ? { journeyId: resource.id } : {}),
        content: cleanContent,
        revision,
        updatedAt: publishedAt,
        updatedBy: actor.email,
        updatedByUid: actor.uid,
        updatedByName: actor.name,
      }));
    }
    await Promise.all(completionTasks);
    return response;
  } catch (error) {
    const latestJob = await readDoc(COLLECTIONS.publishes, jobId).catch(() => null);
    if (latestJob?.status === 'completed' && latestJob.result) return latestJob.result;
    await writeDoc(COLLECTIONS.publishes, jobId, {
      status: 'failed',
      resourceId: resource.id,
      ...(resource.id === 'kanto-6d' ? { journeyId: resource.id } : {}),
      message,
      failedAt: now(),
      failedBy: actor.email,
      errorCode: error.code || 'INTERNAL_ERROR',
    }).catch(() => {});
    throw error;
  }
}

async function history(resourceId) {
  const resource = contentResource(resourceId);
  try {
    const response = await db.collection(COLLECTIONS.publishes).orderBy('publishedAt', 'desc').limit(20).get();
    return documentList(response).filter((item) => {
      if (item.status === 'running' || item.status === 'failed') return false;
      const itemResourceId = item.resourceId || item.journeyId || 'kanto-6d';
      return itemResourceId === resource.id;
    });
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

async function revokeInvite(actor, event) {
  const email = normalizeEmail(event.email);
  const id = emailId(email);
  const invitation = await readDoc(COLLECTIONS.invites, id);
  if (!invitation) throw cmsError('INVALID_STAFF', '未找到该邀请邮箱', 404);
  const updated = {
    ...invitation,
    active: false,
    revokedAt: now(),
    revokedBy: actor.email,
  };
  await writeDoc(COLLECTIONS.invites, id, updated);
  await audit(actor, 'revoke-invite', { email });
  return updated;
}

async function updateStaff(actor, event) {
  const uid = String(event.uid || '').trim();
  if (!uid) throw cmsError('INVALID_STAFF', '工作人员编号不能为空');
  if (uid === actor.uid && event.active === false) {
    throw cmsError('INVALID_STAFF', '不能停用当前登录的管理员账号');
  }
  const staff = await readDoc(COLLECTIONS.staff, uid);
  if (!staff) throw cmsError('INVALID_STAFF', '未找到该工作人员', 404);
  const nextRole = event.role === 'admin' ? 'admin' : 'editor';
  const nextActive = event.active !== false;
  if (staff.role === 'admin' && staff.active !== false && (nextRole !== 'admin' || !nextActive)) {
    const response = await db.collection(COLLECTIONS.staff).where({ role: 'admin', active: true }).limit(2).get();
    if (documentList(response).filter((person) => person.uid !== uid).length === 0) {
      throw cmsError('LAST_ADMIN', '后台必须至少保留一位正常使用的管理员', 409);
    }
  }
  const updated = {
    ...staff,
    role: nextRole,
    active: nextActive,
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
  history: { role: 'editor', handler: async (actor, event) => ({ items: await history(event.resourceId || 'kanto-6d') }) },
  listStaff: { role: 'admin', handler: async () => listStaff() },
  inviteStaff: { role: 'admin', handler: inviteStaff },
  revokeInvite: { role: 'admin', handler: revokeInvite },
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
