# 多 Agent 系统

## 概述

Iris 支持运行多个独立的 AI Agent，每个 Agent 拥有完全隔离的配置、会话存储、记忆数据库和日志。

**多 Agent vs 子代理（Sub-Agent）：**

| | 多 Agent | 子代理 |
|---|---|---|
| 层级 | 顶层路由，用户选择 | 工具循环内部委派 |
| 配置 | 独立的 llm.yaml / tools.yaml 等 | 在 sub_agents.yaml 中定义 |
| 会话 | 独立会话存储 | 共享父 Agent 的会话 |
| 记忆 | 独立 memory.db | 共享父 Agent 的记忆 |
| 使用场景 | 不同人格/用途的独立 AI | 当前对话中的任务分解 |

---

## 配置

### agents.yaml

位于 `~/.iris/agents.yaml`（或 `IRIS_DATA_DIR/agents.yaml`），首次运行时从 `data/agents.yaml.example` 自动初始化。

```yaml
# 全局开关
enabled: true

# Agent 定义
agents:
  my-agent:
    description: "我的 AI 助手"

  code-helper:
    description: "专注代码开发的 AI 助手"
    # 自定义数据根目录（可选，默认 ~/.iris/agents/<name>/）
    # dataDir: /custom/path/code-helper
```

每个 Agent 的配置文件位于 `~/.iris/agents/<name>/configs/`，结构与全局 `~/.iris/configs/` 完全一致（llm.yaml、tools.yaml 等）。首次启动时从 `data/agents.example/` 模板自动初始化。

### Agent 路径隔离

```
~/.iris/
├── configs/                    # 全局配置（单 Agent / 全局 AI）
├── agents.yaml                 # 多 Agent 定义
└── agents/
    └── my-agent/
        ├── configs/            # Agent 独立配置
        │   ├── llm.yaml
        │   ├── tools.yaml
        │   └── ...
        ├── sessions/           # Agent 独立会话
        ├── logs/               # Agent 独立日志
        ├── iris.db             # Agent 独立会话数据库
        └── memory.db           # Agent 独立记忆数据库
```

路径解析由 `src/paths.ts` 的 `getAgentPaths()` 函数提供，返回 `AgentPaths` 接口：

```typescript
interface AgentPaths {
  dataDir: string;
  configDir: string;
  sessionsDir: string;
  logsDir: string;
  sessionDbPath: string;
  memoryDbPath: string;
}
```

---

## 源码结构

```
src/agents/
├── index.ts        模块入口（导出公共 API）
├── types.ts        AgentDefinition / AgentManifest 类型
└── registry.ts     Agent 注册表（加载 agents.yaml、状态查询、启用切换）
```

### 主要 API

| 函数 | 说明 |
|---|---|
| `isMultiAgentEnabled()` | 检查 agents.yaml 是否存在且 enabled: true |
| `loadAgentDefinitions()` | 加载所有已定义的 Agent 列表 |
| `resolveAgentPaths(agent)` | 解析 Agent 的完整路径集 |
| `getAgentStatus()` | 获取完整状态（是否存在、是否启用、Agent 列表） |
| `setAgentEnabled(enabled)` | 切换 agents.yaml 的 enabled 开关 |

---

## 平台集成

### Web GUI

**后端（`src/platforms/web/index.ts`）：**

`WebPlatform` 通过 `AgentContext` Map 支持多 Agent。每个 Agent 有独立的 Backend、配置和 MCP Manager。

- `addAgent(name, backend, config, ...)` — 注册 Agent
- `resolveAgent(req)` — 根据 `X-Agent-Name` 请求头解析 Agent 上下文
- 所有路由通过 `resolveAgent(req)` 获取对应 Agent 的 Backend

**API 端点：**

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/agents` | 获取运行时可用的 Agent 列表（单 Agent 模式返回空数组） |
| GET | `/api/agents/status` | 获取 agents.yaml 完整状态（含未启用的 Agent） |
| POST | `/api/agents/toggle` | 切换多 Agent 模式的 enabled 开关 |

**前端：**

- `useAgents` composable — Agent 状态管理（加载、切换、localStorage 持久化）
- `AgentSelector.vue` — 模态选择面板（仅多 Agent 模式下显示）
- API Client 自动注入 `X-Agent-Name` 请求头
- 设置面板中提供 Agent 管理区域（查看已定义 Agent、启用/禁用开关）

### Console TUI

- 启动时显示全屏 Agent 选择界面（`src/platforms/console/agent-selector.ts`）
- `/agent` 命令切换当前 Agent
- 状态栏显示当前 Agent 名称

### CLI

```bash
# 指定 Agent 运行
iris-cli --agent my-agent -p "你好"

# 多 Agent 模式下不指定 --agent，默认使用第一个 Agent
iris-cli -p "你好"
```

---

## 启动流程

### 单 Agent 模式（默认）

```
main() → runSingleAgent() → bootstrap() → createPlatforms() → start()
```

与改造前行为完全一致。

### 多 Agent 模式

```
main() → runMultiAgent()
  ├── bootstrap() × N（每个 Agent 独立初始化）
  ├── 创建共享 WebPlatform，注册所有 Agent
  ├── 启动非 Console 平台
  ├── 注册 SIGINT/SIGTERM 清理
  └── Console Agent 选择循环
```

多 Agent 模式下，所有 Agent 共享一个 WebPlatform HTTP 端口，通过 `X-Agent-Name` 请求头路由到不同 Agent 的 Backend。
