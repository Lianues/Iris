# 核心架构

## 三层结构

```
IrisHost（进程唯一，管所有 Agent 的生死）
├── cores: Map<string, IrisCore>
├── taskBoard: CrossAgentTaskBoard（共享）
├── ipcServers: Map<string, IPCServer>（每个 Agent 一个 IPC 端口）
├── spawnAgent(def) → 运行时创建新 Core（自动注入 agentNetwork）
├── reloadAgent(name) → BackendHandle.swap()，Platform 零感知
├── destroyAgent(name) → 运行时销毁 Core
├── shutdown() → 幂等，关闭所有 Core
│
└── IrisCore（一个 Agent 的完整运行时，可多个）
    ├── state: init → running → stopping → stopped
    ├── start() / shutdown()（幂等）
    ├── backend: Backend              ← 业务核心（内部实例）
    ├── backendHandle: BackendHandle  ← 稳定代理（Platform 持有这个）
    ├── router: LLMRouter       ← 模型路由
    ├── tools: ToolRegistry     ← 工具注册
    ├── mcpManager: MCPManager  ← MCP 连接
    ├── storage: StorageProvider ← 数据库
    ├── pluginManager           ← 插件
    ├── skillWatcherDispose     ← 文件监听（shutdown 时关闭）
    └── irisAPI                 ← 完整 API（供平台和插件使用）

Platform 层（通过能力接口区分，不通过名称硬编码）
├── MultiAgentCapable     → 共享多 Agent（如 Web）
├── RoutableHttpPlatform  → 支持 HTTP 路由注册
├── ForegroundPlatform    → 前台阻塞（如 Console），有 waitForExit()
└── 普通平台              → 启动后在后台运行

index.ts（纯编排层，无硬编码平台名称）
├── const host = new IrisHost()
├── await host.start()
├── 创建平台、启动
├── 等待退出条件
├── await host.shutdown()
└── process.exit(0)
```

不存在"单 Agent 模式"和"多 Agent 模式"的分叉——单 Agent 就是 N=1 的多 Agent。

## 职责划分

| 层 | 职责 | 不管的事 |
|---|---|---|
| **IrisHost** | 管理所有 Core 的生命周期、共享 taskBoard、agentNetwork 构造注入、reloadAgent(swap) | 不知道平台的存在 |
| **IrisCore** | 持有并初始化一个 Agent 的全部资源（Backend + 依赖），提供 shutdown | 不知道其他 Core，不知道平台 |
| **Backend** | 业务逻辑核心（对话、工具循环、会话管理） | 不知道 Core、不管资源生命周期 |
| **index.ts** | 编排：创建 Host → 创建平台 → 信号处理 → 退出 | 不管业务逻辑 |

## 文件结构

```
src/core/
├── iris-host.ts         IrisHost 多 Agent 管理器
├── iris-core.ts         IrisCore 单 Agent 运行时
├── backend/
│   ├── backend.ts       Backend 核心服务（主类）
│   ├── types.ts         BackendConfig / BackendEvents / UndoOperationResult 等类型定义
│   ├── history.ts       会话历史相关逻辑（读取、追加、截断）
│   ├── media.ts         媒体处理（图片/文档输入预处理）
│   ├── plugins.ts       插件钩子调用（onBeforeChat / onAfterChat 等）
│   ├── stream.ts        流式输出处理
│   ├── undo-redo.ts     撤销/重做逻辑
│   └── index.ts         统一导出
├── tool-loop.ts         ToolLoop 工具循环（纯计算，无 I/O）
├── summarizer.ts        自动上下文压缩（auto-compact）
├── turn-lock.ts         回合级并发锁（per-session）
├── message-queue.ts     消息排队（AI 繁忙时暂存用户新消息）
├── history-sanitizer.ts 历史修复（清理孤立 functionCall/functionResponse）
├── agent-task-registry.ts 异步子代理任务注册表
├── cross-agent-task-board.ts 跨 Agent 任务板
└── platform-registry.ts 平台注册表（内置 + extension 注册）
```

```
src/ipc/                  IPC 进程间通信层
├── protocol.ts           协议定义（方法名、事件名、类型守卫、序列化结构）
├── framing.ts            传输层：4 字节长度前缀帧编解码器
├── server.ts             IPC 服务端（每个 IrisCore 一个实例）
├── client.ts             IPC 客户端（连接到 server）
├── remote-backend-handle.ts  客户端侧 Backend 代理（实现 IrisBackendLike）
├── remote-tool-handle.ts     客户端侧 ToolExecutionHandle 代理
├── remote-api-proxy.ts       IrisAPI 子集代理
└── index.ts              统一导出
```

相关入口文件：

```
src/
├── index.ts         平台模式入口（IrisHost → 创建平台 → 启动）
├── cli.ts           CLI 模式入口（IrisCore → backend.chat() → 输出 → shutdown）
├── attach.ts        Attach 模式入口（通过 IPC 连接远端 IrisCore → 启动 Console）
├── paths.ts         路径常量与多 Agent 路径解析（AgentPaths）
└── agents/          多 Agent 注册表（agents.yaml 加载、状态查询）
```

## IrisCore 生命周期

`src/core/iris-core.ts`，原 `bootstrap()` 函数重构为类。

```typescript
interface IrisCoreOptions {
  agentName?: string;
  agentPaths?: AgentPaths;
  inlinePlugins?: InlinePluginEntry[];
  taskBoard?: CrossAgentTaskBoard;  // 外部注入（IrisHost 提供）
  agentNetwork?: AgentNetworkProvider;  // 多 Agent 时由 IrisHost 构造注入
}

const core = new IrisCore({ agentName: 'my-agent' });
await core.start();     // init → running（创建所有资源）
// ... 使用 core.backend, core.router 等
await core.shutdown();  // running → stopping → stopped（幂等）
```

**幂等 shutdown**：多次调用返回同一个 Promise，不会重复关闭资源。SIGINT 和 `/exit` 同时触发也不会冲突。

shutdown 关闭的资源：MCP 连接、Skill 文件监听器、storage.close()（当实现支持时）。

## 架构位置

```
Platform ──通过 BackendHandle──▶ Backend ──发事件──▶ BackendHandle ──▶ Platform
                       │
                       ├──▶ Storage     存储
                       ├──▶ LLMRouter   LLM 调用
                       ├──▶ ToolLoop    工具循环
                       ├──▶ Memory      记忆（可选）
                       └──▶ ModeRegistry 模式

远程 Platform（iris attach）:
RemotePlatform ──通过 RemoteBackendHandle──▶ IPCClient ──TCP──▶ IPCServer ──▶ Backend
```

平台层与 Backend 的关系是**单向依赖**：平台知道 Backend，Backend 不知道平台。

远程模式下，`RemoteBackendHandle` 实现相同的 `IrisBackendLike` 接口，将方法调用序列化为 IPC 请求，将服务端事件转为本地 EventEmitter 事件。对平台层透明。

---

## 构造参数

```typescript
new Backend(
  router: LLMRouter,           // LLM 模型路由器
  storage: StorageProvider,    // 存储层
  tools: ToolRegistry,         // 工具注册中心
  toolState: ToolStateManager, // 工具状态管理器
  prompt: PromptAssembler,     // 提示词组装器
  config?: BackendConfig,      // 配置
  modeRegistry?: ModeRegistry, // 模式注册表（可选）
)
```

### BackendConfig

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `maxToolRounds` | `number` | `200` | 工具执行最大轮次 |
| `retryOnError` | `boolean` | `false` | LLM 调用出错时是否自动重试 |
| `maxRetries` | `number` | `3` | 最大重试次数 |
| `toolsConfig` | `object` | — | 工具执行策略配置（autoApprove 等） |
| `stream` | `boolean` | `false` | 是否启用流式输出 |
| `defaultMode` | `string` | — | 默认模式名称 |
| `currentLLMConfig` | `LLMConfig` | — | 当前活动模型配置（用于 vision 能力判定） |
| `ocrService` | `OCRService` | — | OCR 服务（当主模型不支持 vision 时回退使用） |
| `summaryModelName` | `string` | — | 用于自动压缩的模型名称（不指定时使用当前模型） |
| `summaryConfig` | `object` | — | 自动上下文压缩配置 |
| `skills` | `SkillConfig[]` | `[]` | 技能列表（skill 文件路径和描述） |
| `configDir` | `string` | — | 配置目录路径 |
| `rememberPlatformModel` | `boolean` | `false` | 平台是否记住上次使用的模型 |
| `asyncSubAgents` | `boolean` | `false` | 是否启用异步子代理 |

---

## 公共方法

平台层通过这些方法与 Backend 交互。

### 对话

| 方法 | 签名 | 说明 |
|------|------|------|
| `chat` | `(sessionId: string, text: string, images?: ImageInput[], documents?: DocumentInput[], platformName?: string) => Promise<void>` | 发送消息，触发完整的 LLM + 工具循环。结果通过事件推送。`platformName` 用于记录会话来源平台。 |

### 会话管理

| 方法 | 签名 | 说明 |
|------|------|------|
| `clearSession` | `(sessionId: string) => Promise<void>` | 清空指定会话（历史 + 元数据） |
| `getHistory` | `(sessionId: string) => Promise<Content[]>` | 获取会话历史消息 |
| `getMeta` | `(sessionId: string) => Promise<SessionMeta \| null>` | 获取会话元数据 |
| `listSessionMetas` | `() => Promise<SessionMeta[]>` | 列出所有会话元数据（按更新时间降序） |
| `listSessions` | `() => Promise<string[]>` | 列出所有会话 ID |
| `truncateHistory` | `(sessionId: string, keepCount: number) => Promise<void>` | 截断历史，只保留前 N 条 |
| `undo` | `(sessionId: string, scope?: 'last-turn' \| 'last-visible-message') => Promise<UndoOperationResult \| null>` | 撤销最后一轮对话或最后一条可见消息，结果存入 per-session 的 redo 栈 |
| `redo` | `(sessionId: string) => Promise<RedoOperationResult \| null>` | 从 redo 栈恢复上一轮撤销的精确消息组 |
| `clearRedo` | `(sessionId: string) => void` | 清空指定会话的 redo 栈 |

> **注意**：
> 1. `undo()` 和 `redo()` 的执行会完全在 Backend 内操作会话历史，平台层只需要消费返回的 `userText` 和 `assistantText` 做 UI 上的标记或重发。
> 2. `redo()` 是精确恢复（直接写回上次撤销的历史 Content 组），不会再重新触发大模型推理。
> 3. `chat()` 只要有新的用户消息写入，Backend 就会自动调用 `clearRedo()` 以废除过期的 redo 记录，保证分叉逻辑正确。

### 工作目录

| 方法 | 签名 | 说明 |
|------|------|------|
| `setCwd` | `(dirPath: string) => void` | 切换工作目录（支持相对/绝对路径，含 Windows 盘符，目录不存在时抛错） |
| `getCwd` | `() => string` | 获取当前工作目录 |
| `runCommand` | `(cmd: string) => { output, cwd }` | 执行命令。自动拦截 `cd` 改为 `process.chdir()`，其余命令通过子进程执行。超时 30 秒。 |

### 内部引用

供特殊场景使用（如 Web 平台的热重载、状态查询）。

| 方法 | 签名 | 说明 |
|------|------|------|
| `getToolNames` | `() => string[]` | 获取所有工具名称列表 |
| `getTools` | `() => ToolRegistry` | 获取工具注册表引用 |
| `getStorage` | `() => StorageProvider` | 获取存储引用 |
| `getRouter` | `() => LLMRouter` | 获取 LLM 路由器引用 |
| `getToolState` | `() => ToolStateManager` | 获取工具状态管理器 |
| `isStreamEnabled` | `() => boolean` | 获取当前流式设置 |
| `getCurrentModelName` | `() => string` | 获取当前活动模型名称 |
| `getCurrentModelInfo` | `() => ModelInfo` | 获取当前活动模型信息 |
| `listModels` | `() => ModelInfo[]` | 列出所有可用模型 |
| `switchModel` | `(modelName: string) => ModelInfo` | 切换当前活动模型 |
| `generateChatSuggestions` | `(sessionId?: string) => Promise<ChatSuggestion[]>` | 生成聊天快捷建议 |

### 热重载

| 方法 | 签名 | 说明 |
|------|------|------|
| `reloadLLM` | `(newRouter: LLMRouter) => void` | 替换 LLM 路由器 |
| `reloadConfig` | `(opts) => void` | 更新 stream / maxToolRounds / systemPrompt / currentLLMConfig / ocrService |

---

## 事件

Backend 继承自 `EventEmitter`，平台层通过监听事件接收结果。

所有事件的第一个参数都是 `sessionId`，平台据此判断是否属于自己关心的会话。

| 事件 | 参数 | 触发时机 |
|------|------|----------|
| `response` | `(sessionId, text)` | 非流式模式下，LLM 最终回复完成 |
| `stream:start` | `(sessionId)` | 流式段开始（一次 chat 可能有多段，因为工具循环中每次 LLM 调用都是一段） |
| `stream:parts` | `(sessionId, parts: Part[])` | 流式结构化 part 增量（按顺序，含 thought / text / functionCall 等） |
| `stream:chunk` | `(sessionId, chunk)` | 流式文本块到达 |
| `stream:end` | `(sessionId, usage?: UsageMetadata)` | 流式段结束 |
| `tool:update` | `(sessionId, invocations[])` | 工具状态变更（创建、执行中、完成等） |
| `error` | `(sessionId, errorMessage)` | 消息处理过程中出错 |
| `usage` | `(sessionId, usage: UsageMetadata)` | 每轮 LLM 调用后的 Token 用量 |
| `retry` | `(sessionId, attempt, maxRetries, error)` | LLM 调用重试 |
| `user:token` | `(sessionId, tokenCount)` | 用户输入的估算 token 数 |
| `done` | `(sessionId, durationMs: number)` | 当前用户回合完成（统一耗时来源） |
| `turn:start` | `(sessionId, turnId)` | 回合开始 |
| `assistant:content` | `(sessionId, content: Content)` | 一轮模型输出完成后的完整结构化内容 |
| `auto-compact` | `(sessionId, summaryText)` | 自动上下文压缩完成 |
| `attachments` | `(sessionId, attachments)` | 工具执行产生的附件（截图等） |
| `agent:notification` | `(sessionId, text)` | 异步子代理任务完成通知 |
| `notification:payloads` | `(sessionId, payloads)` | 解析后的结构化通知数据 |

### 事件时序示例

**非流式模式：**
```
chat() 调用
  → tool:update (工具创建)
  → tool:update (工具执行中)
  → tool:update (工具完成)
  → response (最终文本)
```

**流式模式：**
```
chat() 调用
  → stream:start
  → stream:chunk × N
  → stream:end
  → tool:update (工具创建)
  → tool:update (工具完成)
  → stream:start    ← 第二轮 LLM 调用
  → stream:chunk × N
  → stream:end
```

---

## 内部流程

`chat()` 调用后的完整处理流程：

```
1. 设置 activeSessionId（用于工具事件转发）
2. storage.getHistory() 加载历史
3. 追加用户消息到历史
4. 构建额外上下文：
   - workspace mutation 控制（判断用户意图是否涉及写操作，按需过滤写入型工具）
   - 子代理协调指导文本
   - 模式提示词覆盖
5. 立即持久化用户消息（不等工具循环结束，防止中途中断丢失）
6. 构建 LLM 调用函数（注入流式/非流式行为）
7. 执行 ToolLoop.run()（可能多轮，通过 onMessageAppend 回调实时持久化）
8. 将耗时写入最后一条 model 消息
9. 更新会话元数据（新会话创建 meta，旧会话更新时间和工作目录）
10. 非流式模式：emit('response', sessionId, text)
11. emit('done', sessionId, durationMs)
12. 清除 activeSessionId
```

### 流式调用

```
router.chatStream(request) → AsyncGenerator<LLMStreamChunk>
  │
  ├── emit('stream:start')
  ├── 遍历 chunk：
  │   ├── partsDelta / textDelta / functionCalls → 合并累积
  │   ├── emit('stream:parts', deltaParts)  ← 结构化增量
  │   ├── textDelta → emit('stream:chunk')
  │   ├── usageMetadata → 收集
  │   └── thoughtSignature → 收集
  ├── emit('stream:end', usageMetadata)
  ├── emit('usage', usageMetadata)
  │
  └── 组装完整 Content { role:'model', parts, modelName, usageMetadata, streamOutputDurationMs }
```

### 工具事件转发

`ToolStateManager` 的 `created` 和 `stateChange` 事件被转发为 Backend 的 `tool:update` 事件，附带当前 `activeSessionId`。

### 会话元数据

| 场景 | 行为 |
|------|------|
| 新会话（历史为空） | 用用户首条消息前 100 字作为标题，记录当前工作目录，创建元数据 |
| 旧会话 | 更新 `updatedAt`；若当前工作目录与记录不同，同步更新 `cwd` |

---

## ToolLoop

工具循环的纯计算核心，不包含任何 I/O。

```typescript
class ToolLoop {
  async run(
    history: Content[],       // 对话历史（原地修改）
    callLLM: LLMCaller,       // 注入的 LLM 调用函数
    options?: ToolLoopRunOptions,
  ): Promise<ToolLoopResult>
}
```

循环逻辑：
1. 组装 LLM 请求 → 调用 LLM
2. 检查返回的 functionCall
3. 有工具调用 → 执行工具 → 追加结果到历史 → 继续循环
4. 无工具调用 → 返回最终文本
5. 超过 `maxRounds` → 中断并返回提示

---

## 子 Agent 系统

### SubAgentTypeRegistry

管理可用的子 Agent 类型。每种类型包含：

```typescript
interface SubAgentType {
  name: string;              // 类型标识
  description: string;       // 供 LLM 选择时参考
  systemPrompt: string;      // 子 Agent 的系统提示词
  parallel: boolean;         // 当前类型的 sub_agent 调用是否可并行调度，默认 false
  modelName?: string;        // 固定使用的模型名称；不填时跟随当前活动模型
  maxToolRounds: number;     // 最大工具轮次
  allowedTools?: string[];   // 工具白名单
  excludedTools?: string[];  // 工具黑名单
}
```

**默认类型：**

| 类型 | 固定模型 | 轮次 | 并行调度 | 工具过滤 | 用途 |
|------|----------|------|----------|----------|------|
| `general-purpose` | 跟随当前模型 | 200 | false | 排除 `sub_agent` | 多步骤通用任务 |
| `explore` | 跟随当前模型 | 200 | false | 仅 `read_file`、`search_in_files`、`shell` | 只读探索 |

`parallel` 的含义是：当前类型的 `sub_agent` 调用是否作为 parallel 工具参与调度。默认 `false`。不写就是 `false`，只有显式写 `true` 的类型，才会在同一轮里与相邻的 parallel 工具一起进入并行批次。

`modelName` 是可选字段。填写后，该类型的子代理固定使用对应模型名称；不填时，跟随 Backend 当前活动模型。

### subAgentGuidance

根据已注册的 Agent 类型生成指导文本，注入系统提示词，指导 LLM 使用 `sub_agent` 工具。指导文本会显示各类型是”可并行调度”还是”串行调度”。

---

## 修改指南

- 新增公共 API：在 Backend 类中添加公共方法，更新本文档
- 新增事件：在 `BackendEvents` 接口中声明，在对应位置 `emit`，更新本文档
- 新增 Agent 类型：在 `createDefaultSubAgentTypes()` 中添加
- 消息预处理/后处理：在 `handleMessage` 的对应步骤前后插入
