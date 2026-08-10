# 飞鸟旅行 Asuka Travel

飞鸟旅行官网与内部内容后台。官网继续输出纯静态 HTML 和本地响应式图片，后台用于统一维护首页、行程文字、车程、预计驾驶时间和图片，并通过受保护的云函数发布到 GitHub Pages。

电脑与手机使用同一个后台网址、同一套账号和同一份 CloudBase 数据；手机端只是响应式界面，不单独部署后台。

## 项目结构

- `index.html`：官网静态页面
- `content/homepage.json`：首页封面、品牌介绍、飞鸟之选与三种出发方式
- `content/journeys/kanto-6d.json`：关东6日行程结构化内容
- `journeys/`：独立行程静态页面及其共用样式、脚本
- `fonts/`：官网、行程页与后台共用的本地字体及许可文件
- `admin-src/`：后台源代码
- `admin/`：构建后的后台静态文件
- `cloudbase/functions/asuka-cms/`：CloudBase 登录、草稿、图片与发布云函数
- `scripts/`：内容检查及官网静态生成脚本
- `cloudbase/SETUP.md`：腾讯云部署说明

## 本地构建

```bash
npm install
npm run build
```

`npm run build` 会先检查首页与行程数据和图片路径，再生成 `index.html` 中的 CMS 管理区块，最后构建 `admin/`。

## 后台保存与发布

1. “保存后台草稿”只保存编辑进度，不会改变游客看到的官网。
2. 草稿保存成功后，管理员再点击“检查并发布到官网”，系统才会生成独立行程页、更新首页行程目录并提交 GitHub。
3. 新行程首次发布成功前不会显示官网链接，以免打开尚不存在的地址并出现 404。

## 安全原则

- GitHub 发布令牌只配置在 CloudBase 云函数环境变量中。
- 浏览器端只包含公开的 CloudBase 环境 ID，不包含 SecretId、SecretKey 或 GitHub Token。
- 工作人员使用独立邮箱登录；编辑与管理员权限分开。
- 官网访客不依赖 CloudBase 数据库或云函数，后台故障不会拖慢官网。
当前后台版本：V34.3
