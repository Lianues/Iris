# 用户交互层

## 职责

平台适配器负责：

- 将用户输入转换为 `Backend.chat()` 调用
- 监听 Backend 事件，并转换成平台特定输出
- 维护平台自己的会话标识、连接对象、UI 状态

平台与 Backend 的关系是单向依赖：

```text
Platform ──调方法──▶ Backend
Platform ◀──听事件── Backend
```

Backend 不知道具体平台存在。

---

## 文件结构

```text
src/platforms/
├── base.ts              # PlatformAdapter 抽象基类
├── console/             # 控制台 TUI（Ink / React）
├── discord/             # Discord Bot
├── telegram/            # Telegram Bot
└── web/                 # Web GUI（HTTP + SSE + Vue）
```

---

## 基类：PlatformAdapter

```ts
abstract class PlatformAdapter {
  abstract start(): Promise<void>
  abstract stop(): Promise<void>
  get name(): string
}
```

基类只约束生命周期，不关心消息格式。

---

## 平台适配模式

所有平台适配器都遵循同一模式：

```ts
class XxxPlatform extends PlatformAdapter {
  constructor(private backend: Backend, ...) {}

  async start() {
    this.backend.on('response', (sid, text) => { /* 输出 */ })
    this.backend.on('stream:chunk', (sid, chunk) => { /* 流式输出 */ })

    // 某处收到用户输入后：
    await this.backend.chat(sessionId, text)
  }
}
```

如果平台支持图片和文档输入，则调用会扩展为：

```ts
await this.backend.chat(sessionId, text, images, documents)
```

其中：

```ts
images: Array<{ mimeType: string; data: string }>
documents: Array<{ fileName: string; mimeType: string; data: string }>
```

---

## 各平台说明

### Console

基于 Ink 5+ / React 18 的 TUI 界面。

| 项目 | 说明 |
|------|------|
| 构造参数 | `(backend, { modeName?, contextWindow?, configDir, getMCPManager, setMCPManager })` |
| sessionId | 启动时生成时间戳 ID，如 `20250715_143052_a7x2` |
| 流式支持 | 支持 |
| 工具状态 | 通过 `tool:update` 事件实时显示 |
| 指令 | `/new`、`/load`、`/sh <命令>`、`/exit` 等 |
| 图片输入 | 当前未实现终端内图片上传 |

### Discord

基于 discord.js 官方 SDK。

| 项目 | 说明 |
|------|------|
| 构造参数 | `(backend, { token })` |
| sessionId | `discord-{channelId}` |
| 流式支持 | 不支持，仅监听 `response` |
| 消息限制 | 自动分段，每段最多 2000 字符 |
| 图片输入 | 当前未接入 |

### Telegram

基于 grammY 官方 SDK。

| 项目 | 说明 |
|------|------|
| 构造参数 | `(backend, { token })` |
| sessionId | `telegram-{chatId}` |
| 流式支持 | 不支持，仅监听 `response` |
| 消息限制 | 自动分段，每段最多 4096 字符 |
| 图片输入 | 当前未接入 |

### Web

基于 Node.js 原生 `http` 模块，零额外后端 Web 框架；前端为 Vue 3 + Vite。

| 项目 | 说明 |
|------|------|
| 构造参数 | `(backend, { port, host, authToken?, managementToken?, configPath, ... })` |
| sessionId | 客户端传入，或自动生成 `web-{uuid}` |
| 流式支持 | 支持，通过 SSE 推送 `delta` / `stream_end` |
| 图片输入 | 支持文件选择、拖拽上传、剪贴板粘贴 |
| 历史回显 | 支持图片消息回显 |
| 热重载 | 通过 `backend.reloadLLM()` / `backend.reloadConfig()` 实现 |

#### Web 前端上传约束

- 最多 4 张图片，单张不超过 4MB
- 最多 3 个文档（PDF / DOCX / PPTX / XLSX 等），单个不超过 10MB
- 附件总上限 20MB
- 同时支持 `application/json` 和 `multipart/form-data` 两种请求格式

#### Web 平台事件映射

| Backend 事件 | SSE 数据 |
|---|---|
| `response` | `{ type: 'message', text }` |
| `stream:start` | `{ type: 'stream_start' }` |
| `stream:chunk` | `{ type: 'delta', text }` |
| `stream:end` | `{ type: 'stream_end' }` |
| `error` | `{ type: 'error', message }` |
| `assistant:content` | `{ type: 'assistant_content', message }` |
| `done` | `{ type: 'done_meta', durationMs }` |
| （chat handler） | `{ type: 'done' }` — 整个请求处理完毕 |

#### Web API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/chat` | 发送消息（SSE 响应），支持 JSON 和 multipart/form-data |
| GET | `/api/chat/suggestions` | 获取聊天快捷建议 |
| GET | `/api/sessions` | 列出会话 |
| GET | `/api/sessions/:id/messages` | 获取会话消息 |
| DELETE | `/api/sessions/:id` | 删除会话 |
| DELETE | `/api/sessions/:id/messages?keepCount=N` | 截断历史 |
| GET | `/api/config` | 获取配置（敏感字段脱敏）🔒 管理令牌 |
| PUT | `/api/config` | 更新配置（触发热重载）🔒 管理令牌 |
| POST | `/api/config/models` | 列出可用模型 🔒 管理令牌 |
| GET | `/api/status` | 服务器状态 |
| GET | `/api/deploy/state` | 获取部署状态 🔒 管理令牌 |
| GET | `/api/deploy/detect` | 检测部署环境 🔒 管理令牌 |
| POST | `/api/deploy/preview` | 预览部署配置 🔒 管理令牌 |
| POST | `/api/deploy/nginx` | 部署 Nginx 配置 🔒 管理令牌 |
| POST | `/api/deploy/service` | 部署 systemd 服务 🔒 管理令牌 |
| POST | `/api/deploy/sync-cloudflare` | 同步 Cloudflare SSL 设置 🔒 管理令牌 |
| GET | `/api/cloudflare/status` | Cloudflare 连接状态 🔒 管理令牌 |
| POST | `/api/cloudflare/setup` | 配置 Cloudflare 连接 🔒 管理令牌 |
| GET | `/api/cloudflare/dns` | 列出 DNS 记录 🔒 管理令牌 |
| POST | `/api/cloudflare/dns` | 添加 DNS 记录 🔒 管理令牌 |
| DELETE | `/api/cloudflare/dns/:id` | 删除 DNS 记录 🔒 管理令牌 |
| GET | `/api/cloudflare/ssl` | 获取 SSL 模式 🔒 管理令牌 |
| PUT | `/api/cloudflare/ssl` | 设置 SSL 模式 🔒 管理令牌 |

#### `POST /api/chat` 请求体

支持两种 Content-Type：

**JSON 格式（`application/json`）：**

```json
{
  "sessionId": "web-optional-id",
  "message": "请帮我看一下这张图",
  "images": [
    {
      "mimeType": "image/png",
      "data": "iVBORw0KGgoAAA..."
    }
  ],
  "documents": [
    {
      "fileName": "report.pdf",
      "mimeType": "application/pdf",
      "data": "JVBERi0xLjQ..."
    }
  ]
}
```

**Multipart 格式（`multipart/form-data`）：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `message` | text | 消息文本 |
| `sessionId` | text | 可选会话 ID |
| `images` | file（可多个） | 图片文件 |
| `documents` | file（可多个） | 文档文件 |

说明：

- `message`、`images`、`documents` 不能同时为空
- JSON 格式中 `images[].data` 为 **不带前缀** 的 base64 字符串，也兼容 `data:image/png;base64,...` 形式
- 支持的文档类型：PDF、DOCX、PPTX、XLSX 等（详见 `media/document-extract.ts`）

#### 会话历史返回的图片 part

`GET /api/sessions/:id/messages` 中，图片会以如下形式返回给前端：

```json
{
  "role": "user",
  "parts": [
    {
      "type": "image",
      "mimeType": "image/png",
      "data": "iVBORw0KGgoAAA..."
    },
    {
      "type": "text",
      "text": "请描述这张图"
    }
  ]
}
```

#### Web 平台内部方法

供 `handlers/` 等内部模块调用：

| 方法 | 说明 |
|------|------|
| `hasPending(sessionId)` | 检查是否已有进行中的 SSE 连接 |
| `registerPending(sessionId, res)` | 注册 SSE 响应 |
| `removePending(sessionId)` | 移除 SSE 响应 |
| `dispatchMessage(sessionId, message, images?, documents?)` | 调用 `backend.chat()` |
| `setMCPManager(mgr)` | 注入 MCP 管理器 |
| `getMCPManager()` | 获取 MCP 管理器 |

---

## 工具函数

`splitText(text, maxLen)`：按最大长度分段，优先在换行处切分。供 Discord / Telegram 等受消息长度限制的平台使用。

---

## 新增平台步骤

1. 创建 `src/platforms/新平台名/index.ts`
2. 继承 `PlatformAdapter`
3. 构造函数接收 `backend: Backend`
4. 在 `start()` 中监听需要的 Backend 事件（`response` / `stream:*` / `tool:update` / `error`）
5. 监听用户输入并调用 `backend.chat(sessionId, text)`
6. 若平台要支持图片和文档输入，则改为 `backend.chat(sessionId, text, images, documents)`
7. 在 `src/index.ts` 中添加 import 和 switch case
