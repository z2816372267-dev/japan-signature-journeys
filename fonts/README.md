# 飞鸟旅行本地字体

`asuka-serif-sc-500.woff2` 是仅保留简体中文常用字符的 500 字重网页子集，用于官网与后台的品牌标题。正文、导航、表单与按钮继续使用设备系统黑体，不会额外下载第二套中文字体。

字体来源为 Noto Serif SC，与 Source Han Serif SC（思源宋体简体）共享泛中日韩字形体系，依据 SIL Open Font License 1.1 使用。完整许可见 `OFL.txt`。

加载策略：

- 字体与网站文件同源，不使用 Google Fonts、Adobe Fonts 或其他境外字体 CDN。
- 仅提供 WOFF2 和一个固定字重，减少请求数与体积。
- 使用 `font-display: swap`，字体下载期间页面文字仍会立即显示。
