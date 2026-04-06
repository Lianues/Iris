# 配置模块

## 职责

Iris 通过 `data/configs/` 目录下的分文件 YAML 加载配置，并提供：

- 配置解析（LLM / OCR / Platform / Storage / Tools / System / Memory / MCP / Modes）
- 原始配置目录的读写能力（供 Web 设置与热重载使用）
- 敏感字段脱敏展示（如 API Key / token）

---

## 配置目录结构

Iris 实际读取的是 `data/configs/`，不是单文件 `config.yaml`。

| 文件 | 必选 | 说明 |
|---|---|---|
| `llm.yaml` | 是 | LLM 模型池配置 |
| `plugins.yaml` | 否 | 插件配置（加载顺序、启用开关、插件自定义配置） |
| `ocr.yaml` | 否 | OCR 回退模型配置 |
| `platform.yaml` | 是 | 平台配置（console / discord / telegram / web / qq / lark / wxwork / weixin） |
| `storage.yaml` | 是 | 存储配置 |
| `tools.yaml` | 否 | 工具执行配置 |
| `system.yaml` | 是 | 系统行为配置 |
| `memory.yaml` | 否 | 记忆模块配置 |
| `mcp.yaml` | 否 | MCP 服务器配置 |
| `summary.yaml` | 否 | 自动上下文压缩配置（/compact 指令） |
| `modes.yaml` | 否 | 自定义模式配置 |
| `sub_agents.yaml` | 否 | 子代理类型与调度配置 |
| `computer_use.yaml` | 否 | Computer Use 配置（浏览器操控） |

其中 `telegram`、`lark`、`discord`、`qq`、`wxwork`、`weixin` 都不再是 `src/platforms` 下的内置注册项，而是由 extension 注册；其中 `telegram` 和 `lark` 随仓库和发行包提供，`discord`、`qq`、`wxwork`、`weixin` 为可选 extension。配置键仍然写在 `platform.yaml` 的 `telegram:` / `lark:` / `discord:` / `qq:` / `wxwork:` / `weixin:` 下。

全局配置（非分文件）：

| 文件 | 必选 | 说明 |
|---|---|---|
| `agents.yaml` | 否 | Agent 定义（首次运行自动创建，含默认 master agent）。详见 [agents.md](./agents.md) |

首次使用建议：

```bash
cp -r data/configs.example data/configs
```

Windows PowerShell：

```powershell
Copy-Item -Recurse data/configs.example data/configs
```

---

## 结构总览（关键字段）

```yaml
llm:
  defaultModel: gemini_flash
  models:
    gemini_flash:
      provider: gemini
      apiKey: your-api-key
      model: gemini-2.0-flash
      baseUrl: https://generativelanguage.googleapis.com/v1beta
      supportsVision: true

    # gpt4o_mini:
    #   provider: openai-compatible
    #   apiKey: your-api-key
    #   model: gpt-4o-mini
    #   baseUrl: https://api.openai.com/v1
    #   supportsVision: false

# ocr:
#   provider: openai-compatible
#   apiKey: your-api-key
#   model: gpt-4o-mini
#   baseUrl: https://api.openai.com/v1

platform:
  type: web
  web:
    port: 8192
    host: 127.0.0.1
    # authToken: your-global-api-token
    # managementToken: your-management-token

storage:
  type: json-file
  dir: ./data/sessions

tools:
  read_file:
    autoApprove: true
  search_in_files:
    autoApprove: true
  find_files:
    autoApprove: true
  list_files:
    autoApprove: true
  write_file:
    autoApprove: false
  apply_diff:
    autoApprove: false
  shell:
    autoApprove: false

system:
  systemPrompt: ""
  maxToolRounds: 200
  stream: true
  retryOnError: true
  maxRetries: 3
  maxAgentDepth: 3
  # defaultMode: default
  # asyncSubAgents: false
  # rememberPlatformModel: false

# memory:
#   enabled: true
#   dbPath: ./data/memory.db

# mcp:
#   servers: {}

# sub_agents:
#   types:
#     explore:
#       parallel: false

# summary:
#   systemPrompt: |
#     You are a conversation compressor...
#   userPrompt: "Please summarize the conversation above."

# plugins:
#   - name: my-plugin
#     enabled: true
#     priority: 100
#     config:
#       apiKey: "sk-xxx"

```

---

## LLM 配置

### 模型池

Iris 使用模型池配置，而不是 `primary / secondary / light` 三层路由。

- `defaultModel`：启动时默认使用的模型名称
- `models`：可用模型列表，键名就是模型名称
- Console TUI 可以通过 `/model` 指令切换当前使用的模型

示例：

```yaml
defaultModel: gemini_flash

models:
  gemini_flash:
    provider: gemini
    apiKey: your-api-key
    model: gemini-2.0-flash
    baseUrl: https://generativelanguage.googleapis.com/v1beta
    supportsVision: true

  gpt4o_mini:
    provider: openai-compatible
    apiKey: your-api-key
    model: gpt-4o-mini
    baseUrl: https://api.openai.com/v1
    supportsVision: false
```

### 单个模型字段

`models.<modelName>` 下每个模型都支持以下字段：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `provider` | `gemini \| openai-compatible \| openai-responses \| claude` | 否 | 默认 `gemini` |
| `apiKey` | `string` | 建议填 | 对应 provider 的 API Key |
| `model` | `string` | 否 | 未填时使用 provider 默认模型 |
| `baseUrl` | `string` | 否 | 未填时使用 provider 默认地址 |
| `contextWindow` | `number` | 否 | 仅用于 TUI 上下文占用显示 |
| `supportsVision` | `boolean` | 否 | 显式声明模型是否支持图片输入 |
| `headers` | `Record<string,string>` | 否 | 覆盖/追加请求头 |
| `requestBody` | `Record<string,unknown>` | 否 | 深合并到最终请求体 |

说明：

- `defaultModel` 必须指向 `models` 中已定义的模型名称
- `/model` 切换的是运行时当前活动模型，不会自动改写 `llm.yaml`
- 子代理类型可以通过 `modelName` 固定使用某个模型；不写时跟随当前活动模型

### `supportsVision` 的作用

当前活动模型的 `supportsVision` 决定 Backend 如何处理上传的图片：

- `true`：直接把图片发给主模型
- `false`：不直接发图片；若配置了 `ocr.yaml`，则先 OCR 再发文本
- 未填写：Iris 会根据模型名做启发式判断（如 `gpt-4o` / `gemini` / `claude-3` / `qwen-vl` 等）

推荐：

- 使用标准官方模型名时，可以省略
- 使用代理网关、自定义模型别名、私有部署模型时，**建议显式填写**

### `baseUrl` 规则

- Gemini：以 `/v1beta` 结尾，例如 `https://generativelanguage.googleapis.com/v1beta`
- OpenAI 兼容 / OpenAI Responses / Claude：以 `/v1` 结尾
- 程序会在此基础上继续补全具体接口路径

### 自定义请求体示例

```yaml
models:
  gemini_thinking:
    provider: gemini
    apiKey: your-api-key
    model: gemini-2.5-flash
    requestBody:
      generationConfig:
        temperature: 0.7
        maxOutputTokens: 8192
        thinkingConfig:
          includeThoughts: true
```

`requestBody` 会深合并到 provider 编码后的最终请求体，适合透传渠道特有参数。

---

## 工具配置

`tools.yaml` 用于控制工具执行策略。

按工具名称配置。未在文件中配置的工具，默认不允许执行。

```yaml
read_file:
  autoApprove: true

write_file:
  autoApprove: false
  showApprovalView: true

apply_diff:
  autoApprove: false
  showApprovalView: true

search_in_files:
  autoApprove: false
  showApprovalView: true
```

目前支持：

| 字段 | 类型 | 说明 |
|---|---|---|
| `<toolName>.autoApprove` | `boolean` | 当前工具是否自动批准执行。`true` 表示工具输出后立即执行；`false` 表示工具在执行前进入等待确认状态 |
| `<toolName>.showApprovalView` | `boolean` | Console TUI 中是否打开 diff 审批视图。用于 `apply_diff`、`write_file`、`insert_code`、`delete_code`、`search_in_files`（replace 模式）。默认 `true`。设为 `false` 时，退回到底部 `Y/N` 确认提示 |

示例说明：

- `read_file.autoApprove: true`：允许 `read_file`，并且直接执行
- `write_file.autoApprove: false`：允许 `write_file`，但执行前需要确认
- `write_file.showApprovalView: true`：在 Console TUI 中打开写入 diff 审批页
- `shell` 未填写：`shell` 不允许执行

当某个工具配置为 `autoApprove: false` 时：

- Console TUI 会在工具运行到该步骤时显示确认提示
- 普通工具按 `Y` 批准执行，按 `N` 拒绝执行
- `apply_diff`、`write_file`、`insert_code`、`delete_code` 会在 `showApprovalView: true` 时打开 diff 审批页
- `search_in_files` 仅在 `mode: replace` 且 `showApprovalView: true` 时打开 diff 审批页
- diff 审批页中可按 `Y` / `N`，也可在查看后按 `Enter` 确认当前选项
- diff 审批页右侧有滚动条，可用鼠标滚轮查看全部内容

建议：

- 只读工具可设为 `true`
- 写入、删除、命令执行类工具建议设为 `false`
- 不希望模型使用的工具，直接不要写入 `tools.yaml`

---

## OCR 配置

`ocr.yaml` 是可选配置，用于“主模型不支持图片输入”时的回退链路。

```yaml
provider: openai-compatible
apiKey: your-api-key
baseUrl: https://api.openai.com/v1
model: gpt-4o-mini
```

目前支持：

| 字段 | 类型 | 说明 |
|---|---|---|
| `provider` | `openai-compatible` | 当前仅支持 OpenAI 兼容接口 |
| `apiKey` | `string` | OCR 模型 API Key |
| `baseUrl` | `string` | OCR 模型服务地址 |
| `model` | `string` | OCR / vision 模型名称 |

建议：

- 如果主模型本身支持图片输入，通常不需要配置 OCR
- 如果主模型是纯文本模型，但 Web 端又需要上传图片，建议配置 OCR

运行行为：

1. 用户在 Web 端上传图片
2. Backend 判断当前活动模型的 `supportsVision`
3. 若不支持 vision 且存在 `ocr.yaml`：
   - 调用 OCR 模型提取图片内容
   - 将提取结果作为文本注入当前活动模型请求
   - 会话历史仍保留原始图片，便于前端回显与后续切换模型
4. 若既不支持 vision 又未配置 OCR：
   - 图片仍保存在历史中
   - 当前模型仅收到“无法查看图片内容”的占位提示

---

## Web 平台认证字段

`platform.web` 下有两套令牌：

### 1) `authToken`（全局 API）

启用后，所有 `/api/*` 请求需要：

```http
Authorization: Bearer <authToken>
```

### 2) `managementToken`（管理面，推荐）

启用后，以下接口需要：

- `/api/config`
- `/api/deploy/*`
- `/api/cloudflare/*`

请求头：

```http
X-Management-Token: <managementToken>
```

Web UI 已支持在“管理令牌”面板中保存本地令牌，并自动附加到管理接口请求头。

---

## 默认值（节选）

| 配置项 | 默认值 |
|---|---|
| `llm.defaultModel` | `default` |
| `llm.models.default.provider` | `gemini` |
| `llm.models.default.model` | `gemini-2.0-flash` |
| `llm.models.default.baseUrl` | `https://generativelanguage.googleapis.com/v1beta` |
| `ocr.model` | `gpt-4o-mini` |
| `ocr.baseUrl` | `https://api.openai.com/v1` |
| `platform.web.port` | `8192` |
| `platform.web.host` | `127.0.0.1` |
| `system.maxToolRounds` | `200` |
| `system.retryOnError` | `true` |
| `system.maxRetries` | `3` |
| `system.stream` | `true` |
| `system.maxAgentDepth` | `3` |
| `system.asyncSubAgents` | `false` |
| `memory.enabled` | `false` |
| `memory.dbPath` | `./data/memory.db` |
| `mcp.servers.*.timeout` | `30000` |
| `mcp.servers.*.enabled` | `true` |

---

## 子代理配置

`sub_agents.yaml` 是可选配置。未提供时，Iris 使用内置默认子代理类型。

```yaml
types:
  general-purpose:
    description: "执行需要多步工具操作的复杂子任务。适合承接相对独立的子任务。"
    systemPrompt: "你是一个通用子代理，负责独立完成委派给你的子任务。请专注于完成任务并返回清晰的结果。"
    excludedTools:
      - sub_agent
    parallel: false
    # modelName: gemini_flash
    maxToolRounds: 200

  explore:
    description: "只读搜索和阅读文件、执行查询命令。不做修改，只返回发现的信息。"
    systemPrompt: "你是一个只读探索代理，负责搜索和阅读信息。不要修改任何文件，只返回你发现的内容。"
    allowedTools:
      - read_file
      - search_in_files
      - shell
    parallel: false
    # modelName: gpt4o_mini
    maxToolRounds: 200
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `description` | `string` | 否 | 面向主模型的用途说明 |
| `systemPrompt` | `string` | 否 | 子代理的系统提示词 |
| `allowedTools` | `string[]` | 否 | 工具白名单，优先于 `excludedTools` |
| `excludedTools` | `string[]` | 否 | 工具黑名单 |
| `modelName` | `string` | 否 | 固定使用的模型名称；不写时跟随当前活动模型 |
| `parallel` | `boolean` | 否 | 当前类型的 `sub_agent` 调用是否按 parallel 工具参与调度。默认 `false`，不写就是 `false` |
| `maxToolRounds` | `number` | 否 | 最大工具轮次，默认 `200` |

说明：

- `types` 一旦提供，会完全替代内置默认类型
- `parallel` 表示的是 `sub_agent` 工具的调度语义，不表示模型是否能够一次输出多个子代理调用
- `modelName` 写了就固定使用该模型名称；不写时跟随当前活动模型
- 只有显式写 `parallel: true` 的类型，才会在同一轮里与相邻的 parallel 工具一起进入并行批次

---

## MCP 配置

`mcp.servers` 定义要连接的外部 MCP 服务器，启动时后台异步连接（不阻塞启动）。

```yaml
mcp:
  servers:
    filesystem:
      transport: stdio
      command: npx
      args:
        - "-y"
        - "@modelcontextprotocol/server-filesystem"
        - "/path/to/dir"
      timeout: 30000
      enabled: true

    remote_tools:
      transport: streamable-http
      url: https://mcp.example.com/mcp
      headers:
        Authorization: Bearer your-token
      timeout: 30000
```

| 字段 | `stdio` | `sse` / `streamable-http` | 说明 |
|------|-------|------|------|
| `transport` | 必填 | 必填 | `stdio` / `sse` / `streamable-http` |
| `command` | 必填 | — | 要执行的命令 |
| `args` | 可选 | — | 命令参数数组 |
| `env` | 可选 | — | 额外环境变量 |
| `cwd` | 可选 | — | 工作目录 |
| `url` | — | 必填 | MCP 服务器 URL |
| `headers` | — | 可选 | HTTP 请求头 |
| `timeout` | 通用 | 通用 | 连接/listTools 超时，默认 30000ms |
| `enabled` | 通用 | 通用 | 是否启用，默认 true |

MCP 工具注册到 `ToolRegistry` 后，名称格式为 `mcp__<服务器名>__<工具名>`（非法字符会替换为下划线）。

---

## 修改配置后如何生效

- Web GUI 设置中心的变更会自动保存并尝试热重载
- 通过 `/api/config` API 更新后也会自动尝试热重载
- 热重载范围包括：
  - LLM 路由器
  - `stream` / `maxToolRounds` / `systemPrompt`
  - OCR 服务
  - MCP 连接
- 若返回 `restartRequired: true`，需手动重启服务
