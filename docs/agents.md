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
iris --agent my-agent -p "你好"

# 多 Agent 模式下不指定 --agent，默认使用第一个 Agent
iris -p "你好"
```

---

## 启动流程

### 单 Agent 模式（默认）

```
main() → IrisHost.start() → IrisCore.start() → createPlatforms() → start()
```

单 Agent 是多 Agent 的子集（N=1），IrisHost 自动创建一个名为 `__global__` 的默认 Core。

### 多 Agent 模式

```
main() → IrisHost.start()
  ├── IrisCore.start() × N（每个 Agent 独立初始化）
  ├── 创建共享 WebPlatform，注册所有 Agent
  ├── 启动非 Console 平台
  ├── 注册 SIGINT/SIGTERM 清理
  └── Console Agent 选择循环
```

多 Agent 模式下，所有 Agent 共享一个 WebPlatform HTTP 端口，通过 `X-Agent-Name` 请求头路由到不同 Agent 的 Backend。


## 跨 Agent 通信与任务板

### 架构概览

多 Agent 模式下，Agent 之间可以通过 `delegate_to_agent` 工具进行跨 Agent 委派。
所有异步任务（sub_agent 异步子代理 + delegate 跨 Agent 委派）统一由 `CrossAgentTaskBoard` 管理。

```
┌─────────────────────────────────────────────────────────────┐
│                   CrossAgentTaskBoard                       │
│                     （全局单例）                              │
│                                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                   │
│  │ TaskRecord│  │ TaskRecord│  │ TaskRecord│  ...             │
│  │ sub_agent│  │ delegate │  │ sub_agent│                   │
│  └──────────┘  └──────────┘  └──────────┘                   │
│                                                             │
│  事件: registered / completed / failed / killed              │
│        token-update / chunk-heartbeat                       │
│                                                             │
│  通知路由: 完成时自动构建 XML → 推送到 sourceAgent 的 backend  │
└─────────────────────────────────────────────────────────────┘
        ▲                    ▲                    ▲
        │                    │                    │
   setTaskBoard()       setTaskBoard()       setTaskBoard()
        │                    │                    │
 ┌──────┴──────┐    ┌────────┴────────┐    ┌──────┴──────┐
 │  __global__ │    │     coder       │    │   writer    │
 │   Backend   │    │    Backend      │    │   Backend   │
 └─────────────┘    └─────────────────┘    └─────────────┘
```

### 任务类型与职责分离

| | sub_agent | delegate |
|---|---|---|
| 执行位置 | 发起方 Agent 内部 | 目标 Agent 的独立 Backend |
| 工具集 | 继承父级工具集（可过滤） | 使用目标 Agent 自己的工具集 |
| 配置 | 继承父级 toolsConfig | 使用目标 Agent 的 tools.yaml |
| 心跳/token | 有（驱动 StatusBar spinner） | 无（不传递心跳） |
| 通知合并 | 参与（等全部完成后合并） | 不参与（不阻塞子代理通知） |
| 前端显示 | 「N 个后台任务 ↑Ntk」（带 spinner） | 「⇢ N 个委派任务」（无 spinner） |

### 源码结构

```
src/core/
├── cross-agent-task-board.ts    全局任务板（生命周期、事件、通知路由）

src/tools/internal/
├── delegate-agent/
│   └── index.ts                delegate_to_agent + query_delegated_task 工具
├── sub-agent/
│   └── index.ts                sub_agent 工具（同步/异步）
```

### 关键流程

#### delegate_to_agent 委派流程

```
__global__ 调用 delegate_to_agent(agent="coder", prompt="写个文件")
  │
  ├── 1. 校验目标 Agent 存在
  ├── 2. 在 taskBoard 注册任务（type=delegate）
  ├── 3. 构建 targetSessionId = "cross-agent:__global__:taskId"
  ├── 4. 立即返回 { status: "dispatched", taskId }
  │
  └── 5. fire-and-forget: runDelegatedTask()
         │
         ├── targetBackend.chat(targetSessionId, prompt)
         │     └── coder 的 Backend 执行 ToolLoop
         │         └── 使用 coder 自己的 tools.yaml 配置
         │
         ├── 监听 done → taskBoard.complete()
         │                └── 自动构建通知 XML
         │                └── 推送到 __global__ 的 backend
         │
         └── 监听 error → taskBoard.fail()
```

#### 通知合并逻辑（仅 sub_agent）

当同一 session 有多个并行异步子代理时，先完成的通知被暂存，
等该 session 所有 **sub_agent 类型**的 running 任务都完成后，
将所有通知合并为一条 user 消息统一交给 LLM。

delegate 类型的任务不参与此合并——因为 delegate 的完成通知
推送到另一个 Agent 的 backend，不会回到本 session 的队列。

### 工具审批与非交互上下文

跨 Agent 委派和异步子代理运行在后台 session 中，没有前端审批 UI。
调度层通过 `canUseInteractiveApproval()` 检测当前上下文是否可交互：

- `cross-agent:*` 开头的 sessionId → 非交互（delegate 后台会话）
- 无 ToolStateManager → 非交互（CLI / headless 场景）

非交互上下文中：
- `autoApprove: true` 的工具直接执行
- `autoApprove: false` 的工具直接返回错误（不会卡死等待审批）
- `showApprovalView: true` 被忽略（这是 Console TUI 专用的 diff 预览）

因此，**目标 Agent 的 `tools.yaml` 必须为所有需要执行的工具设置 `autoApprove: true`**，
或者使用全局 `autoApproveAll: true`。

### agent:notification 事件格式

Backend 转发 taskBoard 事件时携带 `taskType` 字段：

```typescript
this.emit('agent:notification',
  task.sourceSessionId,  // 路由目标 session
  task.taskId,           // 任务 ID
  status,                // 'registered' | 'completed' | 'failed' | 'killed' | 'token-update' | 'chunk-heartbeat'
  summary,               // 描述文本或 token 数值字符串
  task.type,             // 'sub_agent' | 'delegate'（第 6 个参数）
);
```

前端据此将两种任务类型分开计数和渲染，互不干扰。
