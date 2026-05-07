# Iris

一个面向多平台的智能代理程序。支持 Console、Web、Discord、Telegram、微信、企业微信、飞书、QQ 等平台，支持工具调用、会话存储、图片输入、OCR 回退、Computer Use、MCP 和记忆能力。飞书与 Telegram 平台当前由随仓库提供的 `extensions/lark/`、`extensions/telegram/` extension 加载；Discord、QQ、微信与企业微信平台以可选 extension 提供。

## 特性

- 多平台：Console / Web / Headless Core / Discord（可选 extension） / Telegram（内嵌 extension） / 微信（WeChat，可选 extension） / 企业微信（WXWork，可选 extension） / 飞书（Lark，内嵌 extension） / QQ（NapCat，可选 extension）
- 多模型提供商：Gemini / OpenAI 兼容 / OpenAI Responses / Claude
- 模型池：通过 `llm.models.<modelName>` 管理多个模型，运行时可切换
- 多 Agent：支持多个独立 Agent，每个 Agent 拥有独立的会话、记忆和可覆盖的配置
- 配置分层：全局配置打底，Agent 可选覆盖（system / tools / mcp / modes 等）
- 工具系统：内置文件、命令、计划、搜索、记忆、子代理等工具
- MCP：连接外部 MCP 服务器扩展工具能力，支持按 Provider 自动降级 Schema
- 会话存储：JSON 文件或 SQLite
- 图片输入：支持 vision 模型直连，也支持 OCR 回退
- 模式系统：支持自定义模式和系统提示词覆盖
- 插件系统：支持 PreBootstrap 装配、自定义 Provider / 平台、钩子与完整内部 API
- TUI 界面：基于 [OpenTUI](https://opentui.com/) + React，支持 Markdown 渲染、工具状态展示、撤销/恢复

## 快速开始

### 方式一：npm 安装（推荐）

无需安装 Bun 或其他运行时。自动下载当前平台的预编译二进制。

```bash
npm install -g irises
iris onboard
iris start
```

### 方式二：直接下载 GitHub Release

GitHub Release 提供的是“解压即用”的二进制包。压缩包内包含：

- `bin/iris` 或 `bin/iris.exe`
- `bin/iris-onboard` 或 `bin/iris-onboard.exe`
- `data/` 默认配置模板
- `extensions/` 随包附带的内嵌 extension（由 `extensions/embedded.json` 白名单控制，例如 `extensions/lark/`、`extensions/telegram/`；`discord` / `qq` / `wxwork` / `weixin` 需单独安装）
- `web-ui/dist/` Web 平台静态资源

```bash
# Linux / macOS
curl -LO https://github.com/Lianues/Iris/releases/latest/download/iris-<platform>-<arch>.tar.gz
mkdir -p iris && tar xzf iris-<platform>-<arch>.tar.gz -C iris
cd iris
./bin/iris onboard
./bin/iris start
```

**Windows**

从 [GitHub Release](https://github.com/Lianues/Iris/releases) 下载 `iris-windows-x64.zip`，解压后运行：

```bat
.\install.bat
```

安装脚本会自动初始化配置、启动引导，并询问是否将 `iris` 加入当前用户 PATH。完成后重开终端即可直接使用：

```bat
iris onboard
iris start
```

如不运行安装脚本，也可直接通过完整路径使用：`bin\iris.exe onboard` / `bin\iris.exe start`。

### 方式三：Linux 一键安装脚本（可选）

脚本会下载 GitHub Release 的二进制包，初始化 `IRIS_DATA_DIR`，并安装 `iris` 命令。

```bash
curl -fsSL https://raw.githubusercontent.com/Lianues/Iris/main/deploy/linux/install.sh | bash
iris onboard
iris start
```

Linux 额外支持 systemd 服务管理（`iris service start/stop/status`）。

支持 Ubuntu、Debian、CentOS、Fedora、Alpine、Arch、Termux (Android)、macOS 以及 Windows x64。

### 方式四：Docker

提供两个预构建镜像，发布在 GitHub Container Registry：

| 镜像 | 说明 |
|------|------|
| `ghcr.io/lianues/iris:latest` | 生产镜像，含 Web GUI + TUI（~400 MB） |
| `ghcr.io/lianues/iris:computer-use` | 额外含 Playwright + Chromium，支持 AI 操控浏览器（~900 MB） |

```bash
# 下载 compose 文件
mkdir iris && cd iris
curl -O https://raw.githubusercontent.com/Lianues/Iris/main/deploy/docker/iris-compose.yml

# 启动（自动拉取镜像）
docker compose -f iris-compose.yml up -d

# 配置 LLM API Key（首次启动后）
nano ~/.iris/configs/llm.yaml
docker compose -f iris-compose.yml restart
```

启动后：
- **Web GUI**：浏览器访问 `http://localhost:8192`
- **TUI**：终端直接输入 `iris`（二进制已自动部署到宿主机）

如需 Computer Use 镜像：

```bash
docker compose -f iris-compose.yml --profile computer-use up -d iris-computer-use
```

从源码构建及更多配置详见 [docs/deploy.md](docs/deploy.md#docker-部署)。

### 方式五：源码开发

```bash
git clone https://github.com/Lianues/Iris.git
cd Iris
```

**后端开发（Node.js，适用于 web / telegram，以及已安装的可选 extension 平台）：**

```bash
npm install
npm run setup          # 安装宿主依赖 + 各 extension 自己目录下的依赖 + Web UI
npm run dev            # 启动（按当前平台配置自动选择运行时）
```

说明：根目录 `npm install` 只安装宿主依赖；各 extension 的第三方依赖与锁文件现在由各自目录维护。需要时可单独执行 `npm run setup:extensions`。
正式分发给用户的 extension 应当已经包含可运行产物（例如 `dist/index.mjs`），用户安装时不再额外执行 `npm install`。

**全功能开发（含 Console TUI，需要 Bun）：**

```bash
bun install
npm run setup:extensions
bun run dev            # 启动（直接使用 Bun 运行时）
```

#### Extension 编译

Extension 的源码在各自目录的 `src/` 下，运行时入口是编译后的 `dist/index.mjs`。修改源码后需要重新编译才能生效：

```bash
# 一键编译所有 extension（自动先编译 irises-extension-sdk）
npm run build:extensions

# 只编译指定的 extension
npm run build:extensions -- --filter console --filter web

# 只编译内嵌 extension
npm run build:extensions -- --embedded-only
```

`bun install` 只需要在首次或依赖变化时执行。日常改代码只需 `bun run build` + `bun start`。

**推送到服务器：**

`dist/index.mjs` 已纳入 git 版本管理。修改源码并编译后，将 dist 一并提交：

```bash
cd extensions/console && bun run build
cd ../..
git add -A && git commit -m "feat: ..." && git push
```

服务器上直接拉取即可运行，不需要在服务器上编译：

```bash
git pull && bun start
```

**注意事项：**

- 编辑器中 `@types/react` 相关的类型错误可以忽略，不影响 `bun run build` 打包。
- 如果 `bun install` 报 `irises-extension-sdk` 解析失败，先在项目根目录执行 `bun install`，让 bun 把本地包链接到 extension 的 `node_modules` 中。
- `npm run setup:extensions` 只安装各 extension 目录的依赖，不执行编译。编译需要手动进入对应 extension 目录执行 `bun run build`。

> Console 平台（TUI 界面）依赖 [OpenTUI](https://opentui.com/) 的 Bun FFI，因此仅在 Bun 运行时下可用。其他平台在 Node.js 和 Bun 下均可正常运行。

如需手动准备配置目录，可先复制模板到运行时数据目录：

```bash
# macOS / Linux
mkdir -p ~/.iris/configs && cp data/configs.example/*.yaml ~/.iris/configs/

# Windows PowerShell
New-Item -ItemType Directory -Force "$HOME/.iris/configs" | Out-Null; Copy-Item data/configs.example/*.yaml "$HOME/.iris/configs/"
```

### Onboard 交互式配置引导

Iris 提供 TUI 配置引导工具，基于 [OpenTUI](https://opentui.com/) + React 构建：

```bash
# npm 安装或已加入 PATH 时
iris onboard
iris platforms
iris models
iris extension

# 直接运行发行包中的二进制
./bin/iris onboard
./bin/iris platforms
./bin/iris models
./bin/iris extension
# 或 ./bin/iris-onboard
```

Onboard 会从当前安装目录读取 `data/configs.example/` 模板，并将配置写入 `IRIS_DATA_DIR/configs`；未设置 `IRIS_DATA_DIR` 时，默认写入 `~/.iris/configs`。

配置流程：

1. **欢迎页** — 介绍 Iris 和配置流程
2. **选择 LLM 提供商** — Gemini / OpenAI / Claude
3. **输入 API Key** — 带遮罩的密码输入
4. **模型配置** — 模型别名、模型 ID、Base URL（提供默认值）
5. **选择平台** — Console / Web / Headless / 当前已检测到的 extension 平台（从 `extensions/*/manifest.json` 动态读取）
6. **确认写入** — 预览配置并写入 `IRIS_DATA_DIR/configs/*.yaml`（默认 `~/.iris/configs/*.yaml`）

另外，`iris platforms` 可单独打开平台配置面板，只修改 `platform.yaml` 中的平台相关配置；`iris models` 会先列出已配置模型，再进入所选模型的配置面板，并只修改 `llm.yaml` 中对应模型条目；`iris extension` 会先显示“下载插件”和“管理插件”两个入口，用于下载安装和管理本地 extension。远程列表会提示本地已有版本；同名 extension 的运行时优先级为 `~/.iris/extensions/` 已安装版本高于安装目录内嵌版本。

## 配置文件

运行时数据位于 `~/.iris/`（可通过 `IRIS_DATA_DIR` 覆盖）。首次启动时自动从 `data/configs.example/` 初始化全局配置，并创建 `agents.yaml` + 默认 `master` agent。

### 配置分层

配置分为两类：

**全局独占**（所有 Agent 共享，只在 `~/.iris/configs/` 中存在）：`llm.yaml`、`ocr.yaml`、`storage.yaml`、`plugins.yaml`、`platform.yaml`

**全局打底 + Agent 可覆盖**（Agent 的 `configs/` 下有同名文件则覆盖或合并）：`system.yaml`、`tools.yaml`、`summary.yaml`、`mcp.yaml`、`modes.yaml`、`sub_agents.yaml`

Agent 的 `configs/` 目录可以完全为空，此时完全继承全局配置。创建新 Agent 时不自动生成任何配置文件。

```
~/.iris/
├── configs/                    # 全局配置
│   ├── llm.yaml                # 全局独占
│   ├── system.yaml             # 全局默认
│   └── ...
├── agents.yaml                 # Agent 定义（存在即生效，无需 enabled 开关）
└── agents/
    ├── master/                 # 默认 agent
    │   └── configs/            # 空 = 完全继承；有文件 = 覆盖对应配置
    └── coder/
        └── configs/
            ├── system.yaml     # 覆盖全局 system 的部分字段
            └── tools.yaml      # 覆盖全局 tools 的部分权限
```

### `agents.yaml`

```yaml
agents:
  master:
    description: "主 AI 助手"
  coder:
    description: "专注代码开发的 AI 助手"
```

### `plugins.yaml`

声明哪些 extension 的 plugin 角色需要被激活。platform 类 extension（console、web 等）自动注册，不需要写在这里。plugin 类 extension（cron、memory 等）必须显式声明。

```yaml
plugins:
  - name: cron
    enabled: true
  - name: memory
    enabled: true
```

### `llm.yaml`

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

### `platform.yaml`

```yaml
# 单平台
type: console

# 多平台同时启动
type: [console, web]

# Core-only 后台模式：不打开 TUI / Web GUI / Bot 平台，只启动 Core、插件和 IPC
type: headless
```

各平台配置：

```yaml
web:
  port: 8192
  host: 127.0.0.1

# wxwork 为可选 extension，使用前先执行 iris ext install wxwork
wxwork:
  botId: your-bot-id
  secret: your-boret
  # showToolStatus: false

# weixin 为可选 extension，使用前先执行 iris ext install weixin
weixin:
  # botToken: your-bot-token
  # baseUrl: https://ilinkai.weixin.qq.com
  # showToolStatus: false

# discord 为可选 extension，使用前先执行 iris ext install discord
discord:
  token: your-discord-bot-token

# telegram 由发行包或仓库中的 extensions/telegram 提供
telegram:
  token: your-telegram-bot-token

# lark 由发行包或仓库中的 extensions/lark 提供
lark:
  appId: your-app-id
  appSecret: your-app-secret
  # showToolStatus: false

# qq 为可选 extension，使用前先执行 iris ext install qq
qq:
  wsUrl: ws://127.0.0.1:3001
  selfId: your-qq-number
  # accessToken: your-napcat-token
  # groupMode: at
  # showToolStatus: true
```

### `mcp.yaml`（可选）

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

### `ocr.yaml`（可选）

当模型不支持图片输入时，配置 OCR 模型可实现图片上传支持：

```yaml
provider: openai-compatible
apiKey: your-api-key-here
baseUrl: https://api.openai.com/v1
model: gpt-4o-mini
```

## 常用命令

### iris daemon / iris start --headless — Core-only 后台模式

只启动 Core、插件和 IPC，不打开 TUI / Web GUI / Bot 平台：

```bash
iris daemon
# 等价：iris start --headless
```

如果已经在 Console TUI 里，也可以直接输入 `/headless` 或 `/detach`：Iris 会关闭当前 TUI，停止已启动的平台适配器，并保留 Core / IPC 继续运行。

进入 Core-only 前台状态后，当前终端会出现 `[Iris headless] >` 提示符：输入 `tui` / `attach` / `reconnect` 可重新打开 Console TUI；输入 `exit` / `shutdown` 可关闭后台 Core。另一个终端也可用 `iris attach` 连接；退出 attach TUI 只断开客户端，不会关闭后台 Core。

### iris attach — 跨进程连接

当 Iris 以平台服务模式或 Core-only 后台模式运行时（`iris start` / `iris daemon` / `bun run dev -- --headless`），可以从另一个终端附加一个独立的 Console TUI：

```bash
# 连接默认 Agent（master）
iris attach

# 连接指定 Agent
iris attach --agent coder

# 连接并设置工作目录
iris attach --cwd /path/to/project
```

源码开发模式下：

```bash
bun run dev -- --headless      # 终端 1：启动 Core-only 主进程
bun run src/main.ts attach     # 终端 2：附加 Console
```

### Console

| 命令 | 说明 |
|------|------|
| `/new` | 新建对话 |
| `/load` | 加载历史对话 |
| `/undo` | 撤销最后一条消息 |
| `/redo` | 恢复已撤销的消息 |
| `/model` | 查看可用模型 |
| `/model <name>` | 切换当前模型 |
| `/agent` | 切换 Agent（多 Agent 模式） |
| `/sh <cmd>` | 执行 Shell 命令 |
| `/settings` | 打开设置中心（LLM / System / MCP） |
| `/mcp` | 直接打开 MCP 管理页 |
| `/headless` | 关闭当前 TUI，切换为 Core-only 后台模式 |
| `/detach` | `/headless` 的别名，分离当前 TUI |
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

### QQ

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

### Telegram

Telegram 由 `extensions/telegram/manifest.json` 在启动时自动注册，运行时入口为 `extensions/telegram/dist/index.mjs`。发行包和仓库默认会附带该 extension。

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

- [docs/agents.md](docs/agents.md) — 多 Agent 系统与配置分层
- [docs/config.md](docs/config.md) — 配置文件总览
- [docs/llm.md](docs/llm.md) — LLM 格式适配与 MCP Schema 降级
- [docs/platforms.md](docs/platforms.md) — 各平台适配说明
- [docs/plugins.md](docs/plugins.md) — 插件系统（Extension / Plugin API）
- [docs/build.md](docs/build.md) — 构建与分发
- [docs/tools.md](docs/tools.md) — 工具注册与调度
- [docs/core.md](docs/core.md) — 核心 Backend 逻辑
- [docs/ipc.md](docs/ipc.md) — IPC 进程间通信与 `iris attach`
- [docs/media.md](docs/media.md) — 文档/图片处理
- [docs/deploy.md](docs/deploy.md) — 部署指南（Linux VPS / Docker）

## 开发

```bash
# Node.js（后端开发）
npm run dev              # 启动（按当前平台配置自动选择运行时）
npm run build            # 构建
npm run build:extensions # 编译所有 extension 源码
npm run test             # 测试（Vitest）

# Bun（全功能开发）
bun run dev              # 启动（含 console TUI）
bun run build:compile    # 编译为独立二进制
```

## 社区支持
- [LinuxDO](https://linux.do)

## Star History

<a href="https://star-history.com/#Lianues/Iris&Date">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=Lianues/Iris&type=Date&theme=dark" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=Lianues/Iris&type=Date" />
   <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=Lianues/Iris&type=Date" />
 </picture>
</a>

## 许可证

本项目采用 GNU General Public License v3.0 发布，对应 SPDX 标识为 `GPL-3.0-only`。

完整条款见 [LICENSE](LICENSE)。
