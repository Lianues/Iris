# Iris

**English** | [简体中文](./README.md)

A cross-platform intelligent agent program. Supports Console, Web, Discord, Telegram, WeChat, WeCom (Enterprise WeChat), Lark/Feishu, QQ and more, with tool calling, conversation storage, image input, OCR fallback, Computer Use, MCP and memory capabilities. The Telegram, Lark/Feishu, Discord, QQ, WeChat and WeCom platforms are shipped as optional extensions (source code is included under `extensions/` in this repository; release builds require installation via `iris ext install`).

![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-0078D6?style=flat-square)
![npm](https://img.shields.io/npm/v/irises?style=flat-square&label=npm&color=CB3837)
![Release](https://img.shields.io/github/v/release/Lianues/Iris?style=flat-square&label=release&color=success)
![License](https://img.shields.io/badge/License-GPL--3.0-blue?style=flat-square)
![Docker](https://img.shields.io/badge/Docker-Supported-2496ED?style=flat-square&logo=docker&logoColor=white)
![Runtime](https://img.shields.io/badge/Runtime-Bun%20%7C%20Node.js-F9F1A1?style=flat-square&logo=bun&logoColor=black)

## Features

- Multi-platform: Console / Web / Headless Core / Discord / Telegram / WeChat / WeCom / Lark (Feishu) / QQ (all IM platforms are optional extensions)
- Multi-provider: Gemini / OpenAI-compatible / OpenAI Responses / Claude / DeepSeek
- Model pool: manage multiple models via `llm.models.<modelName>` and switch at runtime
- Multi-Agent: multiple independent agents, each with its own conversations, memory and overridable configuration
- Layered configuration: global defaults with per-agent overrides (system / tools / mcp / modes, etc.)
- Tool system: built-in file, command, plan, search, memory, sub-agent and other tools
- MCP: connect to external MCP servers to extend tool capabilities, with automatic per-provider schema downgrading
- Conversation storage: JSON files or SQLite
- Image input: direct support for vision models, with OCR fallback
- Mode system: customizable modes and system-prompt overrides
- Plugin system: PreBootstrap composition, custom providers / platforms, hooks and full internal API
- TUI: based on [OpenTUI](https://opentui.com/) + React, with Markdown rendering, tool status display, undo/redo

## Quick Start

### npm install (recommended)

No need to install Bun or any other runtime. The matching pre-built binary for your platform is downloaded automatically.

```bash
npm install -g irises
iris onboard
iris start
```

### Linux one-line installer

```bash
curl -fsSL https://raw.githubusercontent.com/Lianues/Iris/main/deploy/linux/install.sh | bash
iris onboard
iris start
```

The script downloads the GitHub Release binary, initializes `IRIS_DATA_DIR` and installs the `iris` command. On Linux it also provides `iris service start/stop/status` for systemd management. Supports Ubuntu / Debian / CentOS / Fedora / Alpine / Arch / Termux (Android) / macOS / Windows x64.

> Other installation methods (GitHub Release / Docker / building from source) are documented in [docs/install.md](docs/install.md).

## First-time Setup

Iris provides a TUI configuration wizard that walks you through setting up your LLM provider, API key, models and platforms:

```bash
iris onboard        # Full configuration wizard
iris platforms      # Configure platforms only
iris models         # Manage the model pool only
iris extension      # Download / manage extensions
```

Configuration is written to `~/.iris/configs/` (can be overridden via `IRIS_DATA_DIR`). The full flow and CLI-only mode are documented in [docs/install.md#onboard-交互式配置引导](docs/install.md#onboard-交互式配置引导).

## Common Commands

### Console (TUI)

| Command | Description |
|---------|-------------|
| `/new` | Start a new conversation |
| `/load` | Load a previous conversation |
| `/undo` | Undo the last message |
| `/redo` | Redo a previously undone message |
| `/model` | List available models |
| `/model <name>` | Switch the current model |
| `/agent` | Switch agent (multi-agent mode) |
| `/sh <cmd>` | Run a shell command |
| `/settings` | Open the settings center (LLM / System / MCP) |
| `/mcp` | Open the MCP management page directly |
| `/headless` | Close the current TUI and switch to Core-only background mode |
| `/detach` | Alias of `/headless`, detaches the current TUI |
| `/exit` | Quit the application |

### IM Platforms (WeCom / Lark / QQ / Telegram / WeChat)

Slash commands across IM platforms (`/new`, `/clear`, `/model`, `/session`, `/stop`, `/flush`, `/undo`, `/redo`, `/help`, …) are largely identical. See [docs/platforms.md](docs/platforms.md) for details.

### Background Mode and Cross-process Attach

- `iris daemon` / `iris start --headless` — Core-only background mode, starts only Core / plugins / IPC without any frontend
- `iris attach` — Attach a separate Console TUI to a running Iris instance from another terminal

See [docs/platforms.md#headless--core-only](docs/platforms.md#headless--core-only) and [docs/ipc.md](docs/ipc.md).

## Configuration

Runtime data lives in `~/.iris/` (overridable via `IRIS_DATA_DIR`). Configuration is split into two categories:

- **Global only** (shared by all agents): `llm.yaml`, `ocr.yaml`, `storage.yaml`, `plugins.yaml`, `platform.yaml`
- **Global default + per-agent overrides**: `system.yaml`, `tools.yaml`, `summary.yaml`, `mcp.yaml`, `modes.yaml`, `sub_agents.yaml`

Full YAML templates and CLI commands are in [docs/configuration-examples.md](docs/configuration-examples.md). Field types and merge rules are documented in [docs/config.md](docs/config.md).

## Documentation

**Getting Started / Configuration**

- [docs/configuration-examples.md](docs/configuration-examples.md) — Quick reference for YAML config templates
- [docs/cron.md](docs/cron.md) — Cron / scheduled tasks
- [docs/deploy.md](docs/deploy.md) — Full Linux VPS / Docker deployment
- [docs/install.md](docs/install.md) — Installation guide (5 methods + onboard flow)

**Advanced / Architecture**

- [docs/agents.md](docs/agents.md) — Multi-agent system and layered configuration
- [docs/build.md](docs/build.md) — Build and distribution
- [docs/config.md](docs/config.md) — Configuration fields and merge rules
- [docs/core.md](docs/core.md) — Core backend logic
- [docs/ipc.md](docs/ipc.md) — IPC inter-process communication and `iris attach`
- [docs/llm.md](docs/llm.md) — LLM format adaptation and MCP schema downgrading
- [docs/media.md](docs/media.md) — Document / image processing
- [docs/platforms.md](docs/platforms.md) — Per-platform adapters and slash commands
- [docs/plugins.md](docs/plugins.md) — Plugin system (Extension / Plugin API)
- [docs/tools.md](docs/tools.md) — Tool registration and dispatching

> Documentation is currently primarily in Chinese; English versions are in progress.

## Development

```bash
# Node.js (backend development)
npm run dev              # Start (auto-select runtime based on current platform config)
npm run build            # Build
npm run build:extensions # Compile all extension sources
npm run test             # Run tests (Vitest)

# Bun (full-feature development)
bun run dev              # Start (with console TUI)
bun run build:compile    # Compile into a standalone binary
```

The complete source-development guide (extension compilation, pushing to a server, caveats) is in [docs/install.md#方式五源码开发](docs/install.md#方式五源码开发).

## Community

- [LinuxDO](https://linux.do)

## Star History

<a href="https://star-history.com/#Lianues/Iris&Date">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=Lianues/Iris&type=Date&theme=dark" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=Lianues/Iris&type=Date" />
   <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=Lianues/Iris&type=Date" />
 </picture>
</a>

## License

This project is released under the GNU General Public License v3.0 (SPDX identifier: `GPL-3.0-only`).

See [LICENSE](LICENSE) for the full text.
