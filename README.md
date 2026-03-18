# Iris

一个面向多平台的智能代理程序。支持 Console、Web、Discord、Telegram、企业微信、飞书等平台，支持工具调用、会话存储、图片输入、OCR 回退、MCP 和记忆能力。

## 特性

- 多平台：Console / Web / Discord / Telegram / 企业微信（WXWork）/ 飞书（Lark）
- 多模型提供商：Gemini / OpenAI 兼容 / OpenAI Responses / Claude
- 模型池：通过 `llm.models.<modelName>` 管理多个模型，运行时可切换
- 工具系统：内置文件、命令、计划、搜索、记忆、子代理等工具
- MCP：连接外部 MCP 服务器扩展工具能力，支持按 Provider 自动降级 Schema
- 会话存储：JSON 文件或 SQLite
- 图片输入：支持 vision 模型直连，也支持 OCR 回退
- 模式系统：支持自定义模式和系统提示词覆盖
- TUI 界面：基于 [OpenTUI](https://opentui.com/) + React，支持 Markdown 渲染、工具状态展示、撤销/恢复

## 快速开始

### 方式一：npm 安装（推荐）

无需安装 Bun 或其他运行时。自动下载当前平台的预编译二进制。

```bash
npm install -g iris-ai
iris start
```

### 方式二：一键安装脚本

**Linux / macOS**

```bash
curl -fsSL https://raw.githubusercontent.com/Lianues/Iris/main/deploy/linux/install.sh | bash
iris start
```

**Windows**

从 [GitHub Release](https://github.com/Lianues/Iris/releases) 下载 `iris-windows-x64.zip`，解压后双击 `deploy\windows\install.bat`。

```bat
REM 启动
iris start
```

**安装流程（Windows / Linux 统一）：**

1. 从 GitHub Release 下载预编译二进制
2. 运行 **onboard 交互式配置引导**（选择 LLM 提供商、填写 API Key、选择平台）
3. 生成 `iris` CLI 命令

安装完成后只需 `iris start` 启动，`iris onboard` 可随时重新配置。

Linux 额外支持 systemd 服务管理（`iris service start/stop/status`）。

支持 Ubuntu、Debian、CentOS、Fedora、Alpine、Arch、Termux (Android)、macOS 以及 Windows x64。

### 方式三：源码开发

```bash
git clone https://github.com/Lianues/Iris.git
cd Iris
```

**后端开发（Node.js，适用于 web/discord/telegram/wxwork 平台）：**

```bash
npm install
npm run setup          # 安装全部依赖（含 Web UI）
npm run dev            # 启动（按当前平台配置自动选择运行时）
```

**全功能开发（含 Console TUI，需要 Bun）：**

```bash
bun install
bun run dev            # 启动（直接使用 Bun 运行时）
```

> Console 平台（TUI 界面）依赖 [OpenTUI](https://opentui.com/) 的 Bun FFI，因此仅在 Bun 运行时下可用。其他平台在 Node.js 和 Bun 下均可正常运行。

复制配置模板并编辑：

```bash
# macOS / Linux
cp -r data/configs.example data/configs

# Windows PowerShell
Copy-Item -Recurse data/configs.example data/configs
```

### Onboard 交互式配置引导

Iris 提供 TUI 配置引导工具，基于 [OpenTUI](https://opentui.com/) + React 构建：

```bash
# 一键安装时自动运行，也可手动启动
iris onboard
# 或直接运行二进制
./bin/iris-onboard /path/to/iris
```

配置流程：

1. **欢迎页** — 介绍 Iris 和配置流程
2. **选择 LLM 提供商** — Gemini / OpenAI / Claude
3. **输入 API Key** — 带遮罩的密码输入
4. **模型配置** — 模型别名、模型 ID、Base URL（提供默认值）
5. **选择平台** — Console / Web / Telegram / 企业微信 / 飞书
6. **确认写入** — 预览配置并写入 `data/configs/*.yaml`

## 配置文件

### `data/configs/llm.yaml`

```yaml
defaultModel: gemini_flash

models:
  gemini_flash:
    provider: gemini
    apiKey: your-api-key-here
    model: gemini-2.0-flash
    baseUrl: https://generativelanguage.googleapis.com/v1beta
    supportsVision: true
```

- `defaultModel`：`models` 下的键名
- `model`：提供商真实模型 ID
- `baseUrl`：Gemini 以 `/v1beta` 结尾，OpenAI/Claude 以 `/v1` 结尾
- `supportsVision`：可选，推荐显式填写，不填写时按模型名启发式判断

### `data/configs/platform.yaml`

```yaml
# 单平台
type: console

# 多平台同时启动
type: [console, web]
```

各平台配置：

```yaml
web:
  port: 8192
  host: 127.0.0.1

wxwork:
  botId: your-bot-id
  secret: your-boret
  # showToolStatus: false

discord:
  token: your-discord-bot-token

telegram:
  token: your-telegram-bot-token

lark:
  appId: your-app-id
  appSecret: your-app-secret
  # showToolStatus: false
```

### `data/configs/mcp.yaml`（可选）

```yaml
servers:
  # 本地进程（stdio）
  filesystem:
    transport: stdio
    command: npx
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/dir"]

  # 远程服务器（HTTP）
  remote_tools:
    transport: streamable-http
    url: https://mcp.example.com/sse

  # 企微官方文档 MCP
  wecom-doc:
    transport: streamable-http
    url: "https://qyapi.weixin.qq.com/mcp/robot-doc?apikey=your-mcp-apikey"
```

MCP 工具的 JSON Schema 会按 Provider 自动降级处理，无需手动适配。详见 [docs/llm.md](docs/llm.md#mcp-工具-schema-降级)。

### `data/configs/ocr.yaml`（可选）

当模型不支持图片输入时，配置 OCR 模型可实现图片上传支持：

```yaml
provider: openai-compatible
apiKey: your-api-key-here
baseUrl: https://api.openai.com/v1
model: gpt-4o-mini
```

## 常用命令

### Console

| 命令 | 说明 |
|------|------|
| `/new` | 新建对话 |
| `/load` | 加载历史对话 |
| `/undo` | 撤销最后一条消息 |
| `/redo` | 恢复已撤销的消息 |
| `/model` | 查看可用模型 |
| `/model <name>` | 切换当前模型 |
| `/sh <cmd>` | 执行 Shell 命令 |
| `/settings` | 打开设置中心（LLM / System / MCP） |
| `/mcp` | 直接打开 MCP 管理页 |
| `/exit` | 退出应用 |

### 企业微信

| 命令 | 说明 |
|------|------|
| `/new` | 新建对话（清空上下文） |
| `/clear` | 清空当前对话历史 |
| `/model` | 查看可用模型 |
| `/model <name>` | 切换模型 |
| `/session` | 查看历史会话 |
| `/session <n>` | 切换到第 n 个会话 |
| `/stop` | 中止当前 AI 回复 |
| `/flush` | 中止当前回复并立即处理缓冲消息 |
| `/help` | 显示帮助 |

### 飞书

| 命令 | 说明 |
|------|------|
| `/new` | 新建对话（清空上下文） |
| `/clear` | 清空当前对话历史 |
| `/model` | 查看可用模型 |
| `/model <name>` | 切换模型 |
| `/session` | 查看历史会话 |
| `/session <n>` | 切换到第 n 个会话 |
| `/stop` | 中止当前 AI 回复 |
| `/flush` | 中止当前回复并立即处理缓冲消息 |
| `/undo` | 撤销上一轮对话 |
| `/redo` | 恢复撤销的对话 |
| `/help` | 显示帮助 |

### Telegram

| 命令 | 说明 |
|------|------|
| `/new` | 新建对话（清空上下文） |
| `/clear` | 清空当前对话历史 |
| `/model` | 查看可用模型 |
| `/model <name>` | 切换模型 |
| `/session` | 查看历史会话 |
| `/session <n>` | 切换到第 n 个会话 |
| `/stop` | 中止当前 AI 回复 |
| `/flush` | 中止当前回复并立即处理缓冲消息 |
| `/undo` | 撤销上一轮对话 |
| `/redo` | 恢复撤销的对话 |
| `/help` | 显示帮助 |

## 文档

- [docs/config.md](docs/config.md) — 配置文件总览
- [docs/llm.md](docs/llm.md) — LLM 格式适配与 MCP Schema 降级
- [docs/platforms.md](docs/platforms.md) — 各平台适配说明
- [docs/tools.md](docs/tools.md) — 工具注册与调度
- [docs/core.md](docs/core.md) — 核心 Backend 逻辑
- [docs/media.md](docs/media.md) — 文档/图片处理
- [docs/deploy.md](docs/deploy.md) — Linux 部署指南

## 开发

```bash
# Node.js（后端开发）
npm run dev              # 启动（按当前平台配置自动选择运行时）
npm run build            # 构建
npm run test             # 测试（Vitest）

# Bun（全功能开发）
bun run dev              # 启动（含 console TUI）
bun run build:compile    # 编译为独立二进制
```
