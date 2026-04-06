# 多 Agent 系统

## 概述

Iris 支持运行多个独立的 AI Agent，每个 Agent 拥有独立的会话存储、记忆数据库和日志。

系统永远以 agent 为单位运行。即使只有一个 agent（`master`），它也是一个有名字、有独立会话和记忆的 agent。首次运行时自动创建 `agents.yaml` 和 `master` agent。

**多 Agent vs 子代理（Sub-Agent）：**

| | 多 Agent | 子代理 |
|---|---|---|
| 层级 | 顶层路由，用户选择 | 工具循环内部委派 |
| 配置 | 全局打底 + Agent 可覆盖 | 在 sub_agents.yaml 中定义 |
| 会话 | 独立会话存储 | 共享父 Agent 的会话 |
| 记忆 | 独立 memory.db | 共享父 Agent 的记忆 |
| 使用场景 | 不同人格/用途的独立 AI | 当前对话中的任务分解 |

---

## 配置分层

### 配置分类

配置文件分为两类：

**第一类：全局独占** — 进程级基础设施，所有 Agent 共享，只在 `~/.iris/configs/` 中存在。Agent 的 `configs/` 目录下不应出现这些文件。

| 文件 | 理由 |
|------|------|
| `llm.yaml` | API Key + 模型池是统一的渠道资源 |
| `ocr.yaml` | 功能性基础设施，与具体 Agent 无关 |
| `storage.yaml` | 存储引擎类型选择是进程级决策 |
| `plugins.yaml` | PluginManager 在进程级运行，所有 agent 共享同一组已激活插件 |

**第二类：全局打底 + Agent 可覆盖** — 全局 `~/.iris/configs/` 中的配置作为默认值，Agent 的 `configs/` 如果存在同名文件则覆盖或合并。

字段级覆盖（Agent 层有的字段覆盖全局同名字段）：

| 文件 | 说明 |
|------|------|
| `system.yaml` | Agent 可覆盖 systemPrompt、maxToolRounds 等 |
| `tools.yaml` | Agent 可覆盖工具权限 |
| `summary.yaml` | Agent 可覆盖压缩提示词 |

条目级合并（Agent 层同名条目覆盖全局定义，新增条目追加）：

| 文件 | 合并策略 |
|------|----------|
| `mcp.yaml` | `servers` 对象按 key 合并 |
| `modes.yaml` | 按模式名合并 |
| `sub_agents.yaml` | `types` 对象按 key 合并 |

### agents.yaml

位于 `~/.iris/agents.yaml`，首次运行时自动创建。

```yaml
# Agent 定义（无需 enabled 开关，存在即生效）
agents:
  master:
    description: "主 AI 助手"

  code-helper:
    description: "专注代码开发的 AI 助手"
    # 自定义数据根目录（可选，默认 ~/.iris/agents/<name>/）
    # dataDir: /custom/path/code-helper
```

### 目录结构

```
~/.iris/
├── configs/                    # 全局配置
│   ├── llm.yaml                # 第一类：全局独占
│   ├── ocr.yaml                # 第一类
│   ├── storage.yaml            # 第一类
│   ├── plugins.yaml            # 第一类
│   ├── platform.yaml           # 全局平台配置
│   ├── system.yaml             # 第二类：全局默认值
│   ├── tools.yaml              # 第二类
│   ├── mcp.yaml                # 第二类
│   ├── modes.yaml              # 第二类
│   ├── sub_agents.yaml         # 第二类
│   └── summary.yaml            # 第二类
├── agents.yaml                 # Agent 定义
└── agents/
    ├── master/                 # 默认 agent（首次初始化自动创建）
    │   ├── configs/            # 空目录 = 完全继承全局配置
    │   ├── sessions/
    │   ├── logs/
    │   ├── iris.db
    │   └── memory.db
    └── coder/                  # 用户自定义 agent 示例
        ├── configs/            # 全部可选，缺失的文件继承全局
        │   ├── system.yaml     # 可选：覆盖全局 system 的部分/全部字段
        │   └── tools.yaml      # 可选：覆盖全局 tools 的部分/全部权限
        ├── sessions/
        ├── logs/
        ├── iris.db
        └── memory.db
```

Agent 的 configs/ 下不再包含 llm.yaml、ocr.yaml、storage.yaml、plugins.yaml。
Agent 的 configs/ 目录可以完全为空——此时完全继承全局配置。
创建新 Agent 时不自动生成任何配置文件。

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
└── registry.ts     Agent 注册表（加载 agents.yaml、状态查询、创建/删除）

src/config/
├── merge.ts        配置分层合并工具（fieldOverride + entryMerge）
└── index.ts        loadGlobalConfig / loadAgentConfig 分层加载逻辑
```

### 主要 API

| 函数 | 说明 |
|---|---|
| `loadAgentDefinitions()` | 加载所有已定义的 Agent 列表 |
| `resolveAgentPaths(agent)` | 解析 Agent 的完整路径集 |
| `getAgentStatus()` | 获取 Agent 列表和 manifest 路径 |
| `ensureDefaultAgent()` | 确保 agents.yaml 存在且包含 master agent |
| `loadGlobalConfig()` | 加载全局配置（进程级，一次） |
| `loadAgentConfig(globalResult, agentPaths)` | 分层合并全局配置 + Agent 覆盖 |

---

## 平台集成

### Web GUI

**API 端点：**

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/agents` | 获取运行时可用的 Agent 列表 |
| GET | `/api/agents/status` | 获取 agents.yaml 完整状态 |

**前端：**

- `useAgents` composable — Agent 状态管理（加载、切换、localStorage 持久化）
- `AgentSelector.vue` — 模态选择面板（多 Agent 时显示）
- API Client 自动注入 `X-Agent-Name` 请求头

### Console TUI

- 启动时显示全屏 Agent 选择界面（`extensions/console/src/agent-selector.ts`）
- `/agent` 命令切换当前 Agent
- 状态栏显示当前 Agent 名称

### CLI

```bash
# 指定 Agent 运行
iris --agent my-agent -p "你好"

# 未指定 --agent，默认使用第一个 Agent（通常是 master）
iris -p "你好"
```

---

## 启动流程

```
main() → IrisHost.start()
  ├── loadGlobalConfig()（全局配置只加载一次）
  ├── ensureDefaultAgent()（确保 agents.yaml + master 存在）
  ├── loadAgentDefinitions()（加载所有 agent 定义）
  ├── 对每个 agent：
  │   ├── loadAgentConfig()（分层合并全局 + agent 覆盖）
  │   └── IrisCore.start()（传入 resolvedConfig）
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
 │   master    │    │     coder       │    │   writer    │
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
master 调用 delegate_to_agent(agent="coder", prompt="写个文件")
  │
  ├── 1. 校验目标 Agent 存在
  ├── 2. 在 taskBoard 注册任务（type=delegate）
  ├── 3. 构建 targetSessionId = "cross-agent:master:taskId"
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
         │                └── 推送到 master 的 backend
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
