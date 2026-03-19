# Backend 核心服务

## 职责

`Backend` 是整个应用的核心服务层，封装全部业务逻辑。

它通过**公共方法**接收平台层的调用，通过**事件**将结果推送给平台层。Backend 不知道任何平台的存在，不持有任何平台引用。

##文件结构

```
src/core/
├── backend.ts       Backend 核心服务
└── tool-loop.ts     ToolLoop 工具循环（纯计算，无 I/O）
```

相关入口文件：

```
src/
├── bootstrap.ts     核心初始化（创建 Backend 及所有依赖模块）
├── index.ts         平台模式入口（bootstrap → 创建平台 → 启动）
└── cli.ts           CLI 模式入口（bootstrap → backend.chat() → 输出 → 退出）
```

## bootstrap()

`src/bootstrap.ts` 提供 `bootstrap()` 函数，封装从配置加载到 Backend 创建的全部初始化逻辑。

```typescript
interface BootstrapResult {
  backend: Backend;
  config: AppConfig;
  configDir: string;
  router: LLMRouter;
  tools: ToolRegistry;
  mcpManager: MCPManager | undefined;
  setMCPManager: (manager?: MCPManager) => void;
  getMCPManager: () => MCPManager | undefined;
}
```

`index.ts` 和 `cli.ts` 都调用 `bootstrap()` 获取 Backend 实例，再各自执行不同的后续逻辑。

## 架构位置

```
Platform ──调方法──▶ Backend ──发事件──▶ Platform
                       │
                       ├──▶ Storage     存储
                       ├──▶ LLMRouter   LLM 调用
                       ├──▶ ToolLoop    工具循环
                       ├──▶ Memory      记忆（可选）
                       └──▶ ModeRegistry 模式
```

平台层与 Backend 的关系是**单向依赖**：平台知道 Backend，Backend 不知道平台。

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
  memory?: MemoryProvider,     // 记忆层（可选）
  modeRegistry?: ModeRegistry, // 模式注册表（可选）
)
```

### BackendConfig

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `maxToolRounds` | `number` | `200` | 工具执行最大轮次 |
| `stream` | `boolean` | `false` | 是否启用流式输出 |
| `autoRecall` | `boolean` | `true` | 是否自动召回记忆 |
| `subAgentGuidance` | `string` | — | 子代理协调指导文本 |
| `defaultMode` | `string` | — | 默认模式名称 |
| `currentLLMConfig` | `LLMConfig` | — | 当前活动模型配置（用于 vision 能力判定） |
| `ocrService` | `OCRService` | — | OCR 服务（当主模型不支持 vision 时回退使用） |

---

## 公共方法

平台层通过这些方法与 Backend 交互。

### 对话

| 方法 | 签名 | 说明 |
|------|------|------|
| `chat` | `(sessionId: string, text: string, images?: ImageInput[], documents?: DocumentInput[]) => Promise<void>` | 发送消息，触发完整的 LLM + 工具循环。结果通过事件推送。 |

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
| `done` | `(sessionId, durationMs: number)` | 当前用户回合完成（统一耗时来源） |
| `assistant:content` | `(sessionId, content: Content)` | 一轮模型输出完成后的完整结构化内容 |

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
   - 记忆自动召回（autoRecall=true 时）
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
| `recall` | 跟随当前模型 | 3 | false | 仅 `memory_search` | 记忆搜索 |

`parallel` 的含义是：当前类型的 `sub_agent` 调用是否作为 parallel 工具参与调度。默认 `false`。不写就是 `false`，只有显式写 `true` 的类型，才会在同一轮里与相邻的 parallel 工具一起进入并行批次。

`modelName` 是可选字段。填写后，该类型的子代理固定使用对应模型名称；不填时，跟随 Backend 当前活动模型。

### subAgentGuidance

根据已注册的 Agent 类型生成指导文本，注入系统提示词，指导 LLM 使用 `sub_agent` 工具。指导文本会显示各类型是”可并行调度”还是”串行调度”。

### autoRecall

当记忆模块和 Agent 系统同时启用时，`autoRecall` 设为 `false`，由 `recall` 子 Agent按需搜索。

---

## 修改指南

- 新增公共 API：在 Backend 类中添加公共方法，更新本文档
- 新增事件：在 `BackendEvents` 接口中声明，在对应位置 `emit`，更新本文档
- 新增 Agent 类型：在 `createDefaultSubAgentTypes()` 中添加
- 消息预处理/后处理：在 `handleMessage` 的对应步骤前后插入
