# 飞鸟旅行后台：CloudBase 部署清单

环境 ID：`asuka-travel-admin-d6cef3d2ad7da`  
地域：上海 `ap-shanghai`

## 1. 开启工作人员邮箱登录

进入 CloudBase 控制台 → 身份认证 → 登录方式 → 邮箱验证码：

1. 点击“配置发件邮箱”。
2. 选择“开启邮件代发”。
3. 保存配置。

后台使用邮箱验证码登录，不要求工作人员共用密码。

## 2. 创建数据库集合

进入数据库，按下列名称创建空集合：

- `cms_staff`
- `cms_invites`
- `cms_drafts`
- `cms_assets`
- `cms_publishes`
- `cms_audit`

这些集合只能由云函数读写，不要开放匿名写入权限。

## 3. 部署云函数

函数名称：`asuka-cms`  
运行环境：Node.js 20  
入口：`index.main`  
超时：60 秒  
内存：256 MB

使用 CloudBase CLI 时，在仓库根目录执行：

```bash
tcb login
tcb fn deploy asuka-cms
```

也可以在控制台新建同名云函数，上传 `cloudbase/functions/asuka-cms` 目录，并选择自动安装 `package.json` 依赖。

## 4. 配置云函数环境变量

在 `asuka-cms` 的环境变量中填写：

| 名称 | 填写内容 |
|---|---|
| `CMS_ADMIN_EMAILS` | 首位管理员邮箱；多个邮箱用英文逗号分隔 |
| `CMS_GITHUB_OWNER` | `z2816372267-dev` |
| `CMS_GITHUB_REPO` | `japan-signature-journeys` |
| `CMS_GITHUB_BRANCH` | `main` |
| `CMS_SITE_URL` | `https://z2816372267-dev.github.io/japan-signature-journeys/` |
| `CMS_GITHUB_TOKEN` | 仅授权此仓库 Contents 读写的 GitHub fine-grained token |

`CMS_GITHUB_TOKEN` 是密钥，只能直接填入腾讯云控制台，不得发到聊天、写进网页或提交到 GitHub。

## 5. GitHub 发布令牌的最小权限

在 GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens 创建令牌：

1. Repository access 只选择 `japan-signature-journeys`。
2. Repository permissions 中只开启 `Contents: Read and write`；Metadata 保持默认只读。
3. 设置有效期并记录到期日，到期前更换云函数环境变量。

## 6. 配置安全域名

进入 CloudBase → 环境配置 → 安全配置，将后台实际访问域名加入安全域名。首版至少加入：

- `z2816372267-dev.github.io`
- CloudBase 静态托管分配的默认域名

保存后通常需要数分钟生效。

## 7. 部署后台静态文件

将构建后的 `admin/` 目录上传到 CloudBase 静态网站托管根目录。也可使用 CLI：

```bash
tcb hosting deploy admin -e asuka-travel-admin-d6cef3d2ad7da
```

首次打开后台时，使用 `CMS_ADMIN_EMAILS` 中的邮箱收取验证码。管理员可在“工作人员”页邀请其他编辑或管理员。
