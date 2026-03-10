# Iris

模块化、可解耦的 AI 聊天框架。

## 快速上手

如果你是把整个项目目录导出到另一台机器，或发给别人直接使用，可以按下面步骤操作。

### 1. 环境要求

- Node.js 18 或更高版本
- npm
- 可用的 LLM API Key

### 2. 安装依赖

在项目根目录执行：

```bash
npm run setup
```

如果你不想用一键安装，也可以分开执行：

```bash
npm install
cd src/platforms/web/web-ui && npm install && cd ../../../..
```

### 3. 准备配置文件

项目实际读取的是 `data/configs/` 目录下的分文件配置。

如果你是第一次使用，请先复制示例配置：

#### Windows PowerShell

```powershell
Copy-Item -Recurse data/configs.example data/configs
```

#### macOS / Linux

```bash
cp -r data/configs.example data/configs
```

然后至少检查这两个文件：

#### `data/configs/llm.yaml`

填入你的模型配置，例如：

```yaml
primary:
  provider: gemini
  apiKey: your-api-key-here
  model: gemini-2.0-flash
  baseUrl: https://generativelanguage.googleapis.com
```

#### `data/configs/platform.yaml`

如果你要启用 Web 端，请改成：

```yaml
type: web

web:
  port: 8192
  host: 127.0.0.1
```

说明：

- `127.0.0.1`：只允许本机访问，适合本地使用或配合 Nginx 反代
- `0.0.0.0`：允许局域网或外部设备访问，适合本地开发联调

### 4. 启动方式

后端启动入口是根目录的 `src/index.ts`。

### 方式一：Web 成品页面方式

这种方式适合“导出后直接使用”。

先构建前端：

```bash
npm run build:ui
```

再启动后端：

```bash
npm run dev
```

浏览器访问：

```text
http://127.0.0.1:8192
```

如果你在 `platform.yaml` 中把 `host` 设为 `0.0.0.0`，也可以用本机 IP 访问。

### 方式二：前后端分开开发

这种方式适合开发和调试 Web 界面。

终端 1：启动后端

```bash
npm run dev
```

终端 2：启动前端开发服务器

```bash
npm run dev:ui
```

浏览器访问：

```text
http://localhost:5173
```

前端开发服务器会自动把 `/api/*` 请求转发到后端 `8192` 端口。

### 方式三：控制台模式

如果你不需要 Web，只想在终端里使用，把 `data/configs/platform.yaml` 改成：

```yaml
type: console
```

然后启动：

```bash
npm run dev
```

## 最短使用路径

如果你只是想把项目导出后快速跑起来，推荐按这个顺序：

```bash
npm run setup
```

复制示例配置到 `data/configs/`，填好 `data/configs/llm.yaml`，再把 `data/configs/platform.yaml` 改成 Web：

```yaml
type: web

web:
  port: 8192
  host: 127.0.0.1
```

然后执行：

```bash
npm run build:ui
npm run dev
```

最后打开：

```text
http://127.0.0.1:8192
```

## 常用目录

- `data/configs/`：运行配置
- `data/configs.example/`：示例配置
- `data/sessions/`：会话数据
- `src/index.ts`：后端启动入口
- `src/platforms/web/`：Web 后端
- `src/platforms/web/web-ui/`：Web 前端

## 文档

所有架构和模块文档均在 [`docs/`](./docs) 目录下：

| 文档 | 说明 |
|------|------|
| [architecture.md](./docs/architecture.md) | 全局架构总览、数据流向、AI 自升级指南 |
| [platforms.md](./docs/platforms.md) | 用户交互层 |
| [llm.md](./docs/llm.md) | LLM API 调用层 |
| [storage.md](./docs/storage.md) | 聊天记录存储层 |
| [tools.md](./docs/tools.md) | 工具注册层 |
| [prompt.md](./docs/prompt.md) | 提示词组装层 |
| [core.md](./docs/core.md) | 核心协调器 |
| [deploy.md](./docs/deploy.md) | VPS 部署与 Nginx/Cloudflare 联动指南 |
| [config.md](./docs/config.md) | 配置项说明（含管理令牌与 Cloudflare token 来源） |
