# Iris

一个面向多平台的智能代理程序。支持 Console、Web、Discord、Telegram、微信、企业微信、飞书、QQ 等平台，支持工具调用、会话存储、图片输入、OCR 回退、Computer Use、MCP 和记忆能力。Telegram、飞书、Discord、QQ、微信与企业微信平台以可选 extension 提供（源码仓库 `extensions/` 目录已含源码，发行包需通过 `iris ext install` 安装）。

![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-0078D6?style=flat-square)
![npm](https://img.shields.io/npm/v/irises?style=flat-square&label=npm&color=CB3837)
![Release](https://img.shields.io/github/v/release/Lianues/Iris?style=flat-square&label=release&color=success)
![License](https://img.shields.io/badge/License-GPL--3.0-blue?style=flat-square)
![Docker](https://img.shields.io/badge/Docker-Supported-2496ED?style=flat-square&logo=docker&logoColor=white)
![Runtime](https://img.shields.io/badge/Runtime-Bun%20%7C%20Node.js-F9F1A1?style=flat-square&logo=bun&logoColor=black)

## 特性

- 多平台：Console / Web / Headless Core / Discord / Telegram / 微信 / 企业微信 / 飞书 / QQ（IM 平台均为可选 extension）
- 多模型提供商：Gemini / OpenAI 兼容 / OpenAI Responses / Claude / DeepSeek
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

### npm 安装（推荐）

无需安装 Bun 或其他运行时。自动下载当前平台的预编译二进制。

```bash
npm install -g irises
iris onboard
iris start
```

### Linux 一键脚本

```bash
curl -fsSL https://raw.githubusercontent.com/Lianues/Iris/main/deploy/linux/install.sh | bash
iris onboard
iris start
```

脚本会下载 GitHub Release 二进制、初始化 `IRIS_DATA_DIR` 并安装 `iris` 命令；Linux 还额外提供 `iris service start/stop/status` 用于 systemd 管理。支持 Ubuntu / Debian / CentOS / Fedora / Alpine / Arch / Termux (Android) / macOS / Windows x64。

> 其他安装方式（GitHub Release / Docker / 源码开发）见 [docs/install.md](docs/install.md)。

## 首次配置

Iris 提供 TUI 配置引导工具，引导你完成 LLM Provider、API Key、模型与平台的初始化：

```bash
iris onboard        # 完整配置引导
iris platforms      # 只配置平台
iris models         # 只管理模型池
iris extension      # 下载/管理 extension
```

配置写入 `~/.iris/configs/`（可通过 `IRIS_DATA_DIR` 覆盖）。完整流程与命令行模式见 [docs/install.md#onboard-交互式配置引导](docs/install.md#onboard-交互式配置引导)。

## 常用命令

### Console（TUI）

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

### IM 平台（企微 / 飞书 / QQ / Telegram / 微信）

各 IM 平台的 Slash 命令（`/new` `/clear` `/model` `/session` `/stop` `/flush` `/undo` `/redo` `/help` 等）大同小异，详见 [docs/platforms.md](docs/platforms.md)。

### 后台模式与跨进程连接

- `iris daemon` / `iris start --headless` — Core-only 后台模式，只启动 Core / 插件 / IPC，不打开任何前端
- `iris attach` — 从另一个终端连接到运行中的 Iris，附加一个独立的 Console TUI

详见 [docs/platforms.md#headless--core-only](docs/platforms.md#headless--core-only) 和 [docs/ipc.md](docs/ipc.md)。

## 配置

运行时数据位于 `~/.iris/`（可通过 `IRIS_DATA_DIR` 覆盖）。配置分两类：

- **全局独占**（所有 Agent 共享）：`llm.yaml`、`ocr.yaml`、`storage.yaml`、`plugins.yaml`、`platform.yaml`
- **全局打底 + Agent 可覆盖**：`system.yaml`、`tools.yaml`、`summary.yaml`、`mcp.yaml`、`modes.yaml`、`sub_agents.yaml`

完整的 YAML 模板和 CLI 命令见 [docs/configuration-examples.md](docs/configuration-examples.md)，字段类型与合并规则见 [docs/config.md](docs/config.md)。

## 文档

**入门 / 配置**

- [docs/install.md](docs/install.md) — 安装指南（5 种方式 + Onboard 流程）
- [docs/configuration-examples.md](docs/configuration-examples.md) — 配置文件 YAML 模板速查
- [docs/cron.md](docs/cron.md) — Cron 定时任务
- [docs/deploy.md](docs/deploy.md) — Linux VPS / Docker 完整部署

**进阶 / 架构**

- [docs/agents.md](docs/agents.md) — 多 Agent 系统与配置分层
- [docs/config.md](docs/config.md) — 配置字段与合并规则
- [docs/llm.md](docs/llm.md) — LLM 格式适配与 MCP Schema 降级
- [docs/platforms.md](docs/platforms.md) — 各平台适配与 Slash 命令
- [docs/plugins.md](docs/plugins.md) — 插件系统（Extension / Plugin API）
- [docs/tools.md](docs/tools.md) — 工具注册与调度
- [docs/core.md](docs/core.md) — 核心 Backend 逻辑
- [docs/ipc.md](docs/ipc.md) — IPC 进程间通信与 `iris attach`
- [docs/media.md](docs/media.md) — 文档 / 图片处理
- [docs/build.md](docs/build.md) — 构建与分发

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

源码开发的完整说明（extension 编译、推送到服务器、注意事项）见 [docs/install.md#方式五源码开发](docs/install.md#方式五源码开发)。

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
