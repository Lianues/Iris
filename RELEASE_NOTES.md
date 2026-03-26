## Iris v1.0.0

首个正式发布版本。Iris 是一个模块化、可解耦的 AI 聊天框架，支持多平台、多模型、工具调用。

### 多平台支持

- Console 终端（基于 OpenTUI 的 TUI 界面）
- Web 平台（内置 React 聊天界面）
- Telegram
- Discord
- 飞书
- 企业微信
- 微信
- QQ（通过 NapCat）

### 多模型集成

- 支持 Gemini、OpenAI 兼容接口、Claude
- 模型池管理，运行时动态切换模型
- 模型路由与负载分配

### 工具系统

- 内置文件操作、Shell 命令、定时计划、搜索等工具
- 子代理（Sub-Agent）支持
- MCP（Model Context Protocol）协议支持，可连接外部 MCP 服务器
- Schema 自动降级适配

### 多模态与媒体

- 图片输入：Vision 模型直连，非 Vision 模型自动 OCR 回退
- 文档处理：支持 PDF、Word、Excel 等多种格式提取
- Office 文档转 PDF

### 记忆与存储

- 长期记忆（Memory）
- 会话摘要
- 支持 JSON 文件和 SQLite 两种存储后端

### Computer Use

- 浏览器环境控制（基于 Playwright）
- 屏幕环境控制

### 开发与部署

- 交互式配置引导工具（iris-onboard）
- 兼容 Node.js 和 Bun 双运行时
- CLI 模式，支持 Headless 执行
- 插件系统
- 预编译二进制分发，支持 Linux/macOS/Windows
- 提供 systemd 服务和 Nginx 反向代理部署模板
