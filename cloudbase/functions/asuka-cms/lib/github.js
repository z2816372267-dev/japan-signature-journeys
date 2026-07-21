'use strict';

const { cmsError } = require('./validation');

const API_ROOT = 'https://api.github.com';

class GitHubPublisher {
  constructor({ owner, repo, branch, token }) {
    this.owner = owner;
    this.repo = repo;
    this.branch = branch;
    this.token = token;
  }

  async request(path, options = {}) {
    const headers = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'Asuka-Travel-CMS',
      ...options.headers,
    };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    const response = await fetch(`${API_ROOT}${path}`, {
      ...options,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const text = await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = { message: text };
    }
    if (!response.ok) {
      const message = payload?.message || `GitHub API ${response.status}`;
      throw cmsError('GITHUB_API_ERROR', `GitHub 返回错误：${message}`, response.status);
    }
    return payload;
  }

  repoPath(path) {
    return `/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}${path}`;
  }

  async getTextFile(path) {
    const payload = await this.request(
      this.repoPath(`/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(this.branch)}`),
    );
    if (!payload?.content) throw cmsError('GITHUB_FILE_MISSING', `GitHub 文件不存在：${path}`, 404);
    return Buffer.from(payload.content.replaceAll('\n', ''), 'base64').toString('utf8');
  }

  async getHead() {
    const ref = await this.request(this.repoPath(`/git/ref/heads/${encodeURIComponent(this.branch)}`));
    const commit = await this.request(this.repoPath(`/git/commits/${ref.object.sha}`));
    return { commitSha: ref.object.sha, treeSha: commit.tree.sha };
  }

  async createBlob(file) {
    const binary = Buffer.isBuffer(file.content);
    const payload = await this.request(this.repoPath('/git/blobs'), {
      method: 'POST',
      body: {
        content: binary ? file.content.toString('base64') : String(file.content),
        encoding: binary ? 'base64' : 'utf-8',
      },
    });
    return { path: file.path, mode: '100644', type: 'blob', sha: payload.sha };
  }

  async publish(files, message) {
    if (!this.token) throw cmsError('GITHUB_NOT_CONFIGURED', '尚未配置官网发布密钥', 503);
    const head = await this.getHead();
    const treeElements = await Promise.all(files.map((file) => this.createBlob(file)));
    const tree = await this.request(this.repoPath('/git/trees'), {
      method: 'POST',
      body: { base_tree: head.treeSha, tree: treeElements },
    });
    const commit = await this.request(this.repoPath('/git/commits'), {
      method: 'POST',
      body: { message, tree: tree.sha, parents: [head.commitSha] },
    });
    try {
      await this.request(this.repoPath(`/git/refs/heads/${encodeURIComponent(this.branch)}`), {
        method: 'PATCH',
        body: { sha: commit.sha, force: false },
      });
    } catch (error) {
      if (error.status === 422 || error.status === 409) {
        throw cmsError('PUBLISH_CONFLICT', '官网刚刚有新的修改，请刷新后台后再发布', 409);
      }
      throw error;
    }
    return {
      sha: commit.sha,
      commitUrl: `https://github.com/${this.owner}/${this.repo}/commit/${commit.sha}`,
    };
  }
}

module.exports = { GitHubPublisher };
