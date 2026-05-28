# 安装指南

Iris 提供 5 种安装方式，按使用场景选择：

| 方式 | 适用人群 | 需要 Bun/Node | 需要构建 |
|---|---|---|---|
| [npm 全局安装](#方式一npm-全局安装推荐) | 终端用户、轻度使用 | 否（自带二进制） | 否 |
| [GitHub Release 解压](#方式二github-release-解压使用) | 离线环境、不想装 npm | 否（自带二进制） | 否 |
| [Linux 一键脚本](#方式三linux-一键脚本) | Linux VPS | 否 | 否 |
| [Docker](#方式四docker) | 服务器部署、需要隔离 | 否 | 否 |
| [源码开发](#方式五源码开发) | 二次开发、贡献代码 | 是 | 是 |

---

## 方式一：npm 全局安装（推荐）

无需安装 Bun 或其他运行时。自动下载当前平台的预编译二进制。

```bash
npm install -g irises
iris onboard
iris start
```

---

## 方式二：GitHub Release 解压使用

GitHub Release 提供的是"解压即用"的二进制包。压缩包内包含：

- `bin/iris` 或 `bin/iris.exe`
- `bin/iris-onboard` 或 `bin/iris-onboard.exe`
- `data/` 默认配置模板
- `extensions/` 随包附带的内嵌 extension（由 `extensions/embedded.json` 白名单控制，例如 `extensions/console/`、`extensions/web/`；`telegram` / `lark` / `discord` / `qq` / `wxwork` / `weixin` 等需单独安装）
- `web-ui/dist/` Web 平台静态资源

### Linux / macOS

```bash
curl -LO https://github.com/Lianues/Iris/releases/latest/download/iris-<platform>-<arch>.tar.gz
mkdir -p iris && tar xzf iris-<platform>-<arch>.tar.gz -C iris
cd iris
./bin/iris onboard
./bin/iris start
```

### Windows

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

---

## 方式三：Linux 一键脚本

脚本会下载 GitHub Release 的二进制包，初始化 `IRIS_DATA_DIR`，并安装 `iris` 命令。

```bash
curl -fsSL https://raw.githubusercontent.com/Lianues/Iris/main/deploy/linux/install.sh | bash
iris onboard
iris start
```

Linux 额外支持 systemd 服务管理（`iris service start/stop/status`）。

支持 Ubuntu、Debian、CentOS、Fedora、Alpine、Arch、Termux (Android)、macOS 以及 Windows x64。

---

## 方式四：Docker

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

从源码构建及更多配置详见 [deploy.md](./deploy.md#docker-部署)。

---

## 方式五：源码开发

```bash
git clone https://github.com/Lianues/Iris.git
cd Iris
```

### 后端开发（Node.js）

适用于 web / telegram，以及已安装的可选 extension 平台。

```bash
npm install
npm run setup          # 安装宿主依赖 + 各 extension 自己目录下的依赖 + Web UI
npm run dev            # 启动（按当前平台配置自动选择运行时）
```

说明：根目录 `npm install` 只安装宿主依赖；各 extension 的第三方依赖与锁文件现在由各自目录维护。需要时可单独执行 `npm run setup:extensions`。

正式分发给用户的 extension 应当已经包含可运行产物（例如 `dist/index.mjs`），用户安装时不再额外执行 `npm install`。

### 全功能开发（Bun，含 Console TUI）

```bash
bun install
npm run setup:extensions
bun run dev            # 启动（直接使用 Bun 运行时）
```

> Console 平台（TUI 界面）依赖 [OpenTUI](https://opentui.com/) 的 Bun FFI，因此仅在 Bun 运行时下可用。其他平台在 Node.js 和 Bun 下均可正常运行。

### Extension 编译

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

### 推送到服务器

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

### 注意事项

- 编辑器中 `@types/react` 相关的类型错误可以忽略，不影响 `bun run build` 打包。
- 如果 `bun install` 报 `irises-extension-sdk` 解析失败，先在项目根目录执行 `bun install`，让 bun 把本地包链接到 extension 的 `node_modules` 中。
- `npm run setup:extensions` 只安装各 extension 目录的依赖，不执行编译。编译需要手动进入对应 extension 目录执行 `bun run build`。

---

## Onboard 交互式配置引导

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

### 配置流程（6 步）

1. **欢迎页** — 介绍 Iris 和配置流程
2. **选择 LLM 提供商** — Gemini / OpenAI / Claude
3. **输入 API Key** — 带遮罩的密码输入
4. **模型配置** — 模型别名、模型 ID、Base URL（提供默认值）
5. **选择平台** — Console / Web / Headless / 当前已检测到的 extension 平台（从 `extensions/*/manifest.json` 动态读取）
6. **确认写入** — 预览配置并写入 `IRIS_DATA_DIR/configs/*.yaml`（默认 `~/.iris/configs/*.yaml`）

### 子命令说明

- `iris platforms` — 单独打开平台配置面板，只修改 `platform.yaml` 中的平台相关配置
- `iris models` — 先列出已配置模型，再进入所选模型的配置面板，只修改 `llm.yaml` 中对应模型条目
- `iris extension` — 显示"下载插件"和"管理插件"两个入口，用于下载安装和管理本地 extension。远程列表会提示本地已有版本；同名 extension 的运行时优先级为 `~/.iris/extensions/` 已安装版本高于安装目录内嵌版本

### 纯命令行模式

也可以用纯命令行管理模型池、MCP 和定时任务，例如：

```bash
iris models list
iris mcp add --transport http exa https://mcp.exa.ai/mcp
iris cron add morning --type cron --value "0 9 * * *" --instruction "生成一条早安问候" --silent
```

不带子命令的 `iris models` 仍会打开 TUI 配置界面。

---

## 手动准备配置目录

如需手动准备配置目录（绕过 onboard），可先复制模板到运行时数据目录：

```bash
# macOS / Linux
mkdir -p ~/.iris/configs && cp data/configs.example/*.yaml ~/.iris/configs/

# Windows PowerShell
New-Item -ItemType Directory -Force "$HOME/.iris/configs" | Out-Null; Copy-Item data/configs.example/*.yaml "$HOME/.iris/configs/"
```

---

## 相关文档

- [configuration-examples.md](./configuration-examples.md) — 配置文件 YAML 模板
- [config.md](./config.md) — 配置字段定义与合并规则
- [deploy.md](./deploy.md) — Linux VPS / Docker 完整部署
- [build.md](./build.md) — 构建与分发流程
