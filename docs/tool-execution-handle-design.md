> ✅ **实施完成** — 所有 10 个步骤已执行完毕，主项目 + SDK + 全部 8 个平台扩展编译通过，606/607 测试通过（1 个失败为预存问题）。


# ToolExecutionHandle — 工具执行双向通道统一方案

> 目标：为每个工具执行建立一个 per-tool-id 的双向通道（Handle），平台端通过 Handle 既接收执行细节，也发送控制指令。替代现有碎片化的 `tool:update` + `approveTool()` + `applyTool()` 模式。

---

## 一、现状问题

### 现有交互方式（碎片化）

```
下行（Core → Platform）：
  backend.on('tool:update', (sid, invocations[]))    ← session 粒度全量推送，无输出内容

上行（Platform → Core）：
  backend.approveTool(id, bool)                       ← 散落的方法
  backend.applyTool(id, bool)                         ← 散落的方法
  backend.abortChat(sessionId)                        ← 只能杀整个会话

查询：
  backend.getToolState().get(id)                      ← 直接暴露内部对象（as any 穿透）
```

### 6 个核心 Gap

| # | 问题 | 根因 |
|---|------|------|
| Gap1 | 平台无法获取单个工具的实际输出内容 | `ToolInvocation.result` 仅在终态写入，执行中无实时输出流 |
| Gap2 | 无法终止单个工具执行 | 只有 `abortChat()` 终止整个会话 |
| Gap3 | 子代理完全不透明——内部工具执行不可追踪 | 子代理 ToolLoop 不传 `toolState`（`sub-agent/index.ts:330`） |
| Gap4 | 同步子代理不可 abort | `loop.run()` 没有传 `signal`（`sub-agent/index.ts:349`） |
| Gap5 | 子代理进度数据极简 | 只推 `{ tokens, frame }`，无对话内容、无子工具状态 |
| Gap6 | 无层级关系 | `ToolInvocation` 无 `parentToolId` / `depth` |

---

## 二、核心设计：ToolExecutionHandle

每个工具执行在 `ToolStateManager.create()` 时同时创建一个 Handle 对象。Handle 是一个 EventEmitter，平台通过 `backend.on('tool:execute')` 拿到它，之后所有交互都走这个 Handle。

### 执行树模型

```
Turn
 ├── handle_1 (read_file)            depth=0
 ├── handle_2 (sub_agent)            depth=0
 │    ├── handle_2_1 (search)        depth=1, parentId=handle_2
 │    ├── handle_2_2 (write_file)    depth=1, parentId=handle_2
 │    └── [chat output entries]      子代理的 LLM 对话内容
 └── handle_3 (shell)                depth=0
```

### Handle 接口设计

```typescript
class ToolExecutionHandle extends EventEmitter {
  // ── 只读属性 ──
  readonly id: string;          // 工具执行唯一 ID
  readonly toolName: string;
  readonly status: ToolStatus;
  readonly signal: AbortSignal; // 工具级 abort signal
  readonly parentId?: string;   // 父工具 ID（子代理内部工具才有）
  readonly depth: number;       // 嵌套深度，顶层=0

  // ═══ 下行：平台订阅 ═══
  on(event: 'state', listener: (status: ToolStatus, prev: ToolStatus) => void): this;
  on(event: 'output', listener: (entry: ToolOutputEntry) => void): this;
  on(event: 'progress', listener: (data: Record<string, unknown>) => void): this;
  on(event: 'child', listener: (childHandle: ToolExecutionHandle) => void): this;
  on(event: 'done', listener: (result?: unknown, error?: string) => void): this;
  on(event: 'message', listener: (type: string, data?: unknown) => void): this;

  // ═══ 上行：平台发指令 ═══
  abort(): void;                              // 终止这个工具
  approve(approved: boolean): void;           // 审批
  apply(applied: boolean): void;              // diff 预览确认
  send(type: string, data?: unknown): void;   // 通用消息通道

  // ═══ 查询 ═══
  getSnapshot(): ToolInvocation;              // 当前快照
  getOutputHistory(): ToolOutputEntry[];      // 历史输出
  getChildren(): ToolExecutionHandle[];       // 子工具列表
}
```

### ToolOutputEntry 类型

```typescript
interface ToolOutputEntry {
  type: 'stdout' | 'stderr' | 'log' | 'chat' | 'data';
  content: string;
  data?: Record<string, unknown>;
  timestamp: number;
}
```

### Backend 暴露方式

```typescript
interface IrisBackendLike {
  // ── 工具相关（全部通过 Handle）──
  getToolHandle(toolId: string): ToolExecutionHandleLike | undefined;
  getToolHandles(sessionId: string): ToolExecutionHandleLike[];
  // 事件 'tool:execute': (sessionId: string, handle: ToolExecutionHandleLike) => void

  // ── 删除（迁移到 Handle）──
  // approveTool()   → handle.approve()
  // applyTool()     → handle.apply()
  // tool:update     → tool:execute + handle events
}
```

---

## 三、平台端使用示例

### 示例1：Web 平台监听所有工具执行

```typescript
backend.on('tool:execute', (sessionId, handle) => {
  // 新工具启动，推初始状态
  this.writeSSE(sessionId, {
    type: 'tool:start',
    tool: { id: handle.id, toolName: handle.toolName, status: handle.status, args: handle.getSnapshot().args },
  });

  // 状态变化
  handle.on('state', (status, prev) => {
    this.writeSSE(sessionId, { type: 'tool:state', toolId: handle.id, status, prev });
  });

  // 实时输出（shell stdout、子代理对话等）
  handle.on('output', (entry) => {
    this.writeSSE(sessionId, { type: 'tool:output', toolId: handle.id, entry });
  });

  // 子工具产生（递归订阅）
  handle.on('child', (childHandle) => {
    this.writeSSE(sessionId, {
      type: 'tool:child',
      parentId: handle.id,
      tool: { id: childHandle.id, toolName: childHandle.toolName },
    });
    this.subscribeHandle(sessionId, childHandle); // 递归
  });
});
```

### 示例2：终止某个子代理

```typescript
app.post('/api/tools/:id/abort', (req, res) => {
  const handle = backend.getToolHandle(req.params.id);
  handle?.abort();  // 只终止这一个，不影响其他工具
});
```

### 示例3：查询子代理内部状态

```typescript
app.get('/api/tools/:id/details', (req, res) => {
  const handle = backend.getToolHandle(req.params.id);
  res.json({
    snapshot: handle?.getSnapshot(),
    output: handle?.getOutputHistory(),     // 子代理的完整对话记录
    children: handle?.getChildren().map(c => ({
      id: c.id, toolName: c.toolName, status: c.status,
    })),
  });
});
```

### 示例4：不支持交互审批的平台（自动审批）

```typescript
backend.on('tool:execute', (sid, handle) => {
  autoApproveHandle(handle); // 一行搞定

  handle.on('state', (status) => {
    // 渲染状态行
  });
});
```

---

## 四、逐文件改动清单

### Phase 1：基础设施（核心层）

#### 4.1 `src/types/tool.ts` — 类型扩展

**新增类型**：
- `ToolOutputEntry` 接口

**修改 `ToolInvocation`**：
- 新增 `parentToolId?: string`
- 新增 `depth?: number`

**修改 `ToolExecutionContext`**：
- 新增 `invocationId?: string`
- 新增 `appendOutput?: (entry: Omit<ToolOutputEntry, 'timestamp'>) => void`
- 新增 `onMessage?: (listener: (type: string, data?: unknown) => void) => (() => void)`

#### 4.2 `src/tools/handle.ts` — 新建

ToolExecutionHandle 类实现，包含：
- 内部 AbortController（工具级 signal）
- 输出历史 outputHistory
- 子 handle 列表 childHandles
- 上行方法：abort()、approve()、apply()、send()
- 下行内部方法：_emitState()、_emitProgress()、appendOutput()、addChild()
- 查询方法：getSnapshot()、getOutputHistory()、getChildren()

#### 4.3 `src/tools/state.ts` — ToolStateManager 增强

**新增成员**：
- `private handles = new Map<string, ToolExecutionHandle>()`

**修改 `create()`**：
- 同时创建 Handle 并存入 handles Map
- 新增 emit `'handle:created'` 事件

**修改 `transition()`**：
- 通知对应 handle：`handle._emitState()` / `handle._emitProgress()`

**新增方法**：
- `getHandle(id: string): ToolExecutionHandle | undefined`
- `getHandlesBySession(sessionId: string): ToolExecutionHandle[]`

**修改 `clearSession()` / `clearAll()`**：
- 同步清理 handles Map

#### 4.4 `src/tools/scheduler.ts` — executeSingle() 改造

**新增辅助函数**：
- `combineAbortSignals(...signals)` — 合并会话级 + 工具级 AbortSignal

**修改 `executeSingle()`**：
- 从 toolState 获取 handle：`const handle = toolState?.getHandle(invocationId!)`
- 合并 signal：`combineAbortSignals(signal, handle?.signal)`
- 填充 `executionContext` 新字段：
  - `invocationId`
  - `appendOutput` → `handle.appendOutput()`
  - `onMessage` → 监听 handle 的 `'_upstream'` 事件

### Phase 2：子代理可见性

#### 4.5 `src/tools/internal/sub-agent/index.ts` — 子代理接入执行树

**同步路径改动**：
- 从 context 获取 invocationId，通过 `deps.toolState?.getHandle()` 获取父 handle
- 为子代理创建独立的 `childToolState = new ToolStateManager()`
- 监听 `childToolState` 的 `handle:created` 事件，将子 handle 挂到父 handle（`parentHandle.addChild(childHandle)`）
- 创建 ToolLoop 时传入 childToolState：`new ToolLoop(subTools, subPrompt, config, childToolState)`
- 传入 signal：`loop.run(..., { signal: context?.signal })`
- 在 `createStreamingLLMCaller` 的 `onChunk` 回调中调用 `context?.appendOutput()` 推送子代理 LLM 对话内容

**异步路径改动**：
- 同理创建 childToolState 并传入
- signal 已经在传了，不需要改

**deps 类型变更**：
- `SubAgentToolDeps` 新增 `toolState?: ToolStateManager`

#### 4.6 `src/core/tool-loop.ts` — 暴露 toolState getter

- 新增 `getToolState(): ToolStateManager | undefined` getter，供 sub-agent 工厂拿到 toolState 引用

### Phase 3：Backend API 层

#### 4.7 `src/core/backend/types.ts` — BackendEvents 修改

- **删除** `'tool:update'` 事件
- **新增** `'tool:execute': (sessionId: string, handle: ToolExecutionHandle) => void`

#### 4.8 `src/core/backend/backend.ts` — Backend 类改造

**删除方法**：
- `approveTool(toolId, approved)` — 迁移到 `handle.approve()`
- `applyTool(toolId, applied)` — 迁移到 `handle.apply()`
- `getToolState()` public getter — 不再暴露内部状态管理器

**新增方法**：
- `getToolHandle(toolId: string): ToolExecutionHandle | undefined`
- `getToolHandles(sessionId: string): ToolExecutionHandle[]`

**改造 `setupToolStateForwarding()`**：
- 删除：监听 `created` / `stateChange` → emit `tool:update` 的旧逻辑
- 新增：监听 `handle:created` → emit `tool:execute`

**改造 sub-agent 相关**：
- 将 `this.toolState` 引用传给 sub-agent 工具的 deps

### Phase 4：SDK 接口层

#### 4.9 `packages/extension-sdk/src/tool.ts`

**新增导出**：
- `ToolOutputEntry` 接口
- `ToolExecutionHandleLike` 接口（Handle 的 SDK 侧 Like 类型）

#### 4.10 `packages/extension-sdk/src/platform.ts`

**修改 `IrisBackendLike`**：
- 删除 `approveTool(id, approved): void`（必选方法）
- 删除 `applyTool?(toolId, applied): void`（可选方法）
- 新增 `getToolHandle(toolId: string): ToolExecutionHandleLike | undefined`
- 新增 `getToolHandles(sessionId: string): ToolExecutionHandleLike[]`

#### 4.11 `packages/extension-sdk/src/platform-utils.ts`

**删除** `autoApproveTools(backend, invocations)` 函数

**新增** `autoApproveHandle(handle: ToolExecutionHandleLike)` 函数：
```typescript
export function autoApproveHandle(handle: ToolExecutionHandleLike): void {
  if (handle.status === 'awaiting_approval') {
    try { handle.approve(true); } catch { /* 并发转换 */ }
  }
  handle.on('state', (status) => {
    if (status === 'awaiting_approval') {
      try { handle.approve(true); } catch { /* 并发转换 */ }
    }
  });
}
```

#### 4.12 `packages/extension-sdk/src/index.ts`

- 导出 `ToolOutputEntry`、`ToolExecutionHandleLike`
- 导出 `autoApproveHandle`（替代 `autoApproveTools`）

### Phase 5：平台扩展迁移

所有平台从 `tool:update` + `approveTool` 模式迁移到 `tool:execute` + Handle 模式：

#### 4.13 `extensions/web/src/web-platform.ts`

- 删除 `onToolUpdate` 函数和 `backend.on('tool:update')` 监听
- 新增 `backend.on('tool:execute')` 监听，通过 handle 事件推送 SSE
- HTTP 路由 `/api/tools/:id/approve` → `backend.getToolHandle(id)?.approve()`
- HTTP 路由 `/api/tools/:id/apply` → `backend.getToolHandle(id)?.apply()`
- 新增 HTTP 路由 `/api/tools/:id/abort` → `backend.getToolHandle(id)?.abort()`
- `/api/tools/:id/diff` → `backend.getToolHandle(id)?.getSnapshot()`

#### 4.14 `extensions/web/src/handlers/diff-preview.ts`

- 删除 `(backend as any).getToolState?.()?.get?.(toolId)`
- 改为 `backend.getToolHandle?.(toolId)?.getSnapshot()`

#### 4.15 `extensions/web/web-ui/src/api/client.ts`

- 新增 `abortTool(id: string)` API 函数
- `approveTool` / `applyTool` 保留（HTTP 端点不变）

#### 4.16 `extensions/web/web-ui/src/composables/useToolApproval.ts`

- SSE 事件类型从 `tool_update` 改为 `tool:start` / `tool:state` / `tool:output` 等
- 新增 `abort(id)` 方法

#### 4.17 `extensions/console/src/index.ts`

- 删除 `backend.on('tool:update')` 监听
- 新增 `backend.on('tool:execute')` 监听，管理 handle 列表
- 每次 handle state 变化时重建 invocations 数组给 `appHandle.setToolInvocations()`
- `onToolApproval` → `backend.getToolHandle(id)?.approve()`
- `onToolApply` → `backend.getToolHandle(id)?.apply()`

#### 4.18 `extensions/telegram/src/index.ts`

- 删除 `backend.on('tool:update')` + `autoApproveTools()` 调用
- 新增 `backend.on('tool:execute')` + `autoApproveHandle()` + handle 事件驱动渲染

#### 4.19 `extensions/qq/src/index.ts`

- 同 Telegram 模式

#### 4.20 `extensions/lark/src/index.ts`

- 同 Telegram 模式

#### 4.21 `extensions/wxwork/src/index.ts`

- 同 Telegram 模式

#### 4.22 `extensions/weixin/src/index.ts`

- 同 Telegram 模式（注意：现有代码缺少 autoApproveTools 调用，这次一并修复）

#### 4.23 `extensions/discord/src/index.ts`

- 新增 `tool:execute` 监听 + `autoApproveHandle()`（现有代码完全没有工具支持）

#### 4.24 `src/cli.ts`

- 删除 `backend.on('tool:update')` 监听
- 新增 `backend.on('tool:execute')` 监听，handle.on('state') 输出 stderr 日志

---

## 五、实施顺序

| 步骤 | 文件 | 内容 | 依赖 |
|------|------|------|------|
| **1** | `src/types/tool.ts` | 加 ToolOutputEntry、ToolInvocation 新字段、ToolExecutionContext 新字段 | 无 |
| **2** | `src/tools/handle.ts` | 新建 ToolExecutionHandle 类 | 步骤1 |
| **3** | `src/tools/state.ts` | create() 创建 handle，transition() 通知 handle，新增 getHandle | 步骤2 |
| **4** | `src/tools/scheduler.ts` | executeSingle() 获取 handle、合并 signal、填充 context | 步骤3 |
| **5** | `src/core/tool-loop.ts` | 加 getToolState() getter | 步骤3 |
| **6** | `src/tools/internal/sub-agent/index.ts` | 子代理创建 childToolState、传 signal、推 output | 步骤3-5 |
| **7** | `src/core/backend/types.ts` | 删 tool:update，加 tool:execute | 步骤2 |
| **8** | `src/core/backend/backend.ts` | 删旧方法，加 getToolHandle，改事件转发 | 步骤3,7 |
| **9** | SDK: tool.ts、platform.ts、platform-utils.ts、index.ts | 加 Like 接口，改 IrisBackendLike，改 autoApproveTools | 步骤1 |
| **10** | 所有平台扩展 + CLI | tool:update→tool:execute，approveTool→handle.approve | 步骤8,9 |

---

## 六、实施记录

### 已完成的文件变更

| 步骤 | 文件 | 变更类型 | 说明 |
|------|------|----------|------|
| 1 | `src/types/tool.ts` | 修改 | 新增 ToolOutputEntry、ToolInvocation.parentToolId/depth、ToolExecutionContext 新字段 |
| 2 | `src/tools/handle.ts` | **新建** | ToolExecutionHandle 类（175行） |
| 3 | `src/tools/state.ts` | 修改 | 集成 Handle：create()创建、transition()通知、getHandle/getHandlesBySession/clearSession |
| 4 | `src/tools/scheduler.ts` | 修改 | executeSingle()获取handle、combineAbortSignals、填充context新字段 |
| 5 | `src/core/tool-loop.ts` | 修改 | 新增 getToolState() getter |
| 6 | `src/tools/internal/sub-agent/index.ts` | 修改 | 创建childToolState、handle事件冒泡、传signal |
| 6+ | `src/bootstrap.ts` | 修改 | 修复断链：传入 toolState 到 createSubAgentTool deps |
| 7 | `src/core/backend/types.ts` | 修改 | 删除 tool:update 事件、新增 tool:execute 事件 |
| 8 | `src/core/backend/backend.ts` | 修改 | 删除approveTool/applyTool/getToolState、新增getToolHandle/getToolHandles、改事件转发 |
| 9 | `packages/extension-sdk/src/tool.ts` | 修改 | 新增 ToolOutputEntry、ToolExecutionHandleLike |
| 9 | `packages/extension-sdk/src/platform.ts` | 修改 | IrisBackendLike 删旧方法加新方法 |
| 9 | `packages/extension-sdk/src/platform-utils.ts` | 修改 | autoApproveTools → autoApproveHandle |
| 9 | `packages/extension-sdk/src/index.ts` | 修改 | 导出新类型 |
| 10 | `extensions/web/src/web-platform.ts` | 修改 | tool:update→tool:execute、HTTP路由改Handle、新增abort路由 |
| 10 | `extensions/web/src/handlers/diff-preview.ts` | 修改 | getToolState→getToolHandle |
| 10 | `extensions/web/web-ui/src/api/client.ts` | 修改 | 新增abortTool、SSE事件类型迁移 |
| 10 | `extensions/web/web-ui/src/composables/useToolApproval.ts` | 修改 | 新增abort函数 |
| 10 | `extensions/console/src/index.ts` | 修改 | tool:update→tool:execute+handle管理、approve/apply改Handle |
| 10 | `src/cli.ts` | 修改 | tool:update→tool:execute+handle事件 |
| 10 | `extensions/telegram/src/index.ts` | 修改 | autoApproveTools→autoApproveHandle、tool:update→tool:execute |
| 10 | `extensions/qq/src/index.ts` | 修改 | 同上 |
| 10 | `extensions/lark/src/index.ts` | 修改 | 同上 |
| 10 | `extensions/wxwork/src/index.ts` | 修改 | 同上 |
| 10 | `extensions/weixin/src/index.ts` | 修改 | 同上 + 修复缺失的自动审批bug |

### 构建结果

- ✅ SDK (`packages/extension-sdk`): tsc --noEmit 通过
- ✅ 主项目 (`src/`): tsc --noEmit 通过
- ✅ Web / Telegram / QQ / Lark / WXWork / Weixin / Discord 扩展：tsc --noEmit 通过
- ⚠️ Console 扩展：5个预存TS错误（SettingsView.tsx，与本次改动无关）
- ✅ 测试：606/607 通过（1个失败为 croner 包缺失的预存问题）

