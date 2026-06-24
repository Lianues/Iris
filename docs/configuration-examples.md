# 配置文件示例

> 💡 本文档是「我要怎么配置 Iris」的速查表，重点是 YAML 模板和 CLI 命令。
> 字段类型、模块职责、合并规则请参阅 [config.md](./config.md)。

运行时数据位于 `~/.iris/`（可通过 `IRIS_DATA_DIR` 覆盖）。首次启动时自动从 `data/configs.example/` 初始化全局配置，并创建 `agents.yaml` + 默认 `master` agent。

---

## 配置目录结构

配置分为两类：

**全局独占**（所有 Agent 共享，只在 `~/.iris/configs/` 中存在）：

```
llm.yaml  ocr.yaml  storage.yaml  plugins.yaml  platform.yaml
```

**全局打底 + Agent 可覆盖**（Agent 的 `configs/` 下有同名文件则覆盖或合并）：

```
system.yaml  tools.yaml  summary.yaml  mcp.yaml  modes.yaml  sub_agents.yaml
```

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

详细的合并规则与 Agent 覆盖机制见 [agents.md](./agents.md)。

---

## `agents.yaml`

```yaml
agents:
  master:
    description: "主 AI 助手"
  coder:
    description: "专注代码开发的 AI 助手"
```

---

## `plugins.yaml`

声明哪些 extension 的 plugin 角色需要被激活。platform 类 extension（console、web 等）自动注册，不需要写在这里。plugin 类 extension（cron、memory 等）必须显式声明。

```yaml
plugins:
  - name: cron
    enabled: true
  - name: memory
    enabled: true
```

---

## `llm.yaml`

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

### CLI 添加示例

```bash
# 默认写入 ~/.iris/configs/llm.yaml；设置 IRIS_DATA_DIR 后写入 IRIS_DATA_DIR/configs/llm.yaml
iris models add kimi --provider openai-compatible --model kimi-k2 --api-key sk-xxx --base-url https://api.moonshot.cn/v1 --default

# Agent 覆盖层
iris models add --agent my-agent claude_main -p claude -m claude-sonnet-4-6 -k sk-ant-xxx -d
```

字段类型与高级用法（`requestBody` 透传、DeepSeek 思考模式、`supportsVision` 启发式）见 [config.md#llm-配置](./config.md#llm-配置)。

---

## `platform.yaml`

```yaml
# 单平台
type: console

# 多平台同时启动
type: [console, web]

# Core-only 后台模式：不打开 TUI / Web GUI / Bot 平台，只启动 Core、插件和 IPC
type: headless
```

### 各平台配置块

```yaml
web:
  port: 8192
  host: 127.0.0.1

# wxwork 为可选 extension，使用前先执行 iris ext install wxwork
wxwork:
  botId: your-bot-id
  secret: your-bot-secret
  # showToolStatus: false

# weixin 为可选 extension，使用前先执行 iris ext install weixin
weixin:
  # botToken: your-bot-token
  # baseUrl: https://ilinkai.weixin.qq.com
  # showToolStatus: false

# discord 为可选 extension，使用前先执行 iris ext install discord
discord:
  token: your-discord-bot-token

# telegram 为可选 extension，使用前先执行 iris ext install telegram
telegram:
  token: your-telegram-bot-token
  # outputFormat: rich   # rich | plain；rich 支持表格、折叠 trace（思考/工具过程）
  # streamMode: auto     # auto | draft | edit | off
  # showToolStatus: false # 是否在 rich trace / 流式预览中展示工具执行状态
  # groupMentionRequired: true

# lark 为可选 extension，使用前先执行 iris ext install lark
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

各平台的能力对照、Slash 命令、专属配置项见 [platforms.md](./platforms.md)。

---

## `mcp.yaml`（可选）

### CLI 添加（推荐）

```bash
# 默认写入 ~/.iris/configs/mcp.yaml；设置 IRIS_DATA_DIR 后写入 IRIS_DATA_DIR/configs/mcp.yaml
iris mcp add --transport http exa https://mcp.exa.ai/mcp

# Agent 覆盖层
iris mcp add --agent my-agent --transport http exa https://mcp.exa.ai/mcp
```

写入的是 Iris 自己的运行时配置目录，**不读取 Claude CLI 的配置**。

### 直接编辑示例

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
    url: https://mcp.example.com/mcp

  # 企微官方文档 MCP
  wecom-doc:
    transport: streamable-http
    url: "https://qyapi.weixin.qq.com/mcp/robot-doc?apikey=your-mcp-apikey"
```

MCP 工具的 JSON Schema 会按 Provider 自动降级处理，无需手动适配。详见 [llm.md#mcp-工具-schema-降级](./llm.md#mcp-工具-schema-降级)。

---

## `ocr.yaml`（可选）

当模型不支持图片输入时，配置 OCR 模型可实现图片上传支持：

```yaml
provider: openai-compatible
apiKey: your-api-key-here
baseUrl: https://api.openai.com/v1
model: gpt-4o-mini
```

---

## 相关文档

- [config.md](./config.md) — 模块职责、字段类型、合并规则
- [agents.md](./agents.md) — Agent 覆盖层机制
- [llm.md](./llm.md) — LLM Provider 适配与 MCP Schema 降级
- [platforms.md](./platforms.md) — 各平台能力与配置项
- [cron.md](./cron.md) — Cron 定时任务
