# 工具执行实时进度反馈架构重构

日期：2025-07-10

## 背景

同步子代理（`sub_agent`）执行时，ToolCall 框内只有一个静态定时器 spinner，没有任何实时反馈（token 计数、数据流动状态）。而异步子代理通过 `AgentTaskRegistry` 在 StatusBar 中展示了实时 spinner + token 计数。两者视觉效果不统一。

初始方案（方案 C）通过旁路回调实现：handler 执行时通过 `ToolStateManager.updateProgress()` 反向修改自己的 ToolInvocation 实例。这个方案有三个问题：

1. handler 需要通过 toolName + status 反向查找自己的 invocation ID，并发时可能找错
2. `progressTokens` 和 `progressFrame` 作为专用字段塞进 ToolInvocation 全局类型，只有 sub_agent 一个工具用
3. `updateProgress` 用 `(this as any)[key]` 做节流计时器，不干净

## 新架构

参考 Vercel AI SDK 5.0 的 Preliminary Tool Results 模式，改为 **AsyncIterable/generator** 方案。

核心思想：工具的 `handler` 函数可以返回 `AsyncIterable`（通过 async generator），`yield` 中间值作为进度更新，最后一个 yield 的值作为最终结果。scheduler 自动检测并迭代消费，中间值写入 ToolStateManager，并通过 `ToolExecutionHandle` 的 progress/state 事件推送到平台。

```
普通工具（现有行为，完全不变）：
  handler(args) → Promise<result>
  scheduler: await result → 终态

generator 工具（新能力）：
  handler(args) → AsyncIterable<progress | result>
  scheduler: for await (value of iterable) {
    每 4 个 yield 推送一次 progress 到 ToolStateManager
  }
  最后一个 value 作为最终 result
```

## 为什么不能在回调里直接 yield

同步子代理的 LLM 调用发生在 `ToolLoop.run()` 内部，而不是在 generator 的控制流中。JavaScript 的 generator 只能在自己的函数体内 yield，不能从回调函数中 yield。

因此采用「回调更新共享状态 + 定时 yield」模式：

1. `createStreamingLLMCaller` 的 `onChunk` / `onTokens` 回调更新闭包中的 `frame` / `tokens` 计数器
2. generator 每 500ms yield 一次进度快照 `{ tokens, frame }`
3. `ToolLoop.run()` 完成后 yield 最终结果 `{ result: text }`

## 改动文件清单

### 类型层

| 文件 | 改动 |
|------|------|
| `src/types/tool.ts` | `ToolHandler` 返回类型扩展为 `Promise<unknown> \| AsyncIterable<unknown>`；ToolInvocation 用通用 `progress?: Record<string, unknown>` 替代专用字段 |
| `packages/extension-sdk/src/tool.ts` | 同上（保持两份类型定义同步） |

### 执行管线

| 文件 | 改动 |
|------|------|
| `src/tools/scheduler.ts` | `executeSingle`: await handler 返回值后检测 `Symbol.asyncIterator`，是则 `for await...of` 迭代，每 4 个 yield 推送一次 `transition(executing, {progress})` |
| `src/tools/registry.ts` | `execute` 返回类型同步更新 |

### 状态管理

| 文件 | 改动 |
|------|------|
| `src/tools/state.ts` | 删除 `updateProgress` 方法；`transition` 的 payload 新增 `progress` 字段 |

### 子代理

| 文件 | 改动 |
|------|------|
| `src/tools/internal/sub-agent/index.ts` | 同步路径返回 async generator；删除 `getToolState` 依赖和旁路查找逻辑 |
| `src/bootstrap.ts` | 删除 `getToolState` 注入 |

### 前端

| 文件 | 改动 |
|------|------|
| `extensions/console/src/components/ToolCall.tsx` | 从通用 `invocation.progress` 读取 `tokens` 和 `frame`，渲染数据驱动 spinner 和 token 计数 |

## 同步子代理 vs 异步子代理的路径差异

| | 同步子代理 | 异步子代理 |
|---|---|---|
| 进度通道 | handler 返回 AsyncIterable → scheduler 迭代 → ToolStateManager.progress → ToolExecutionHandle.progress → ToolCall 框内 | AgentTaskRegistry 事件 → agent:notification → StatusBar |
| 视觉位置 | ToolCall 卡片（tools block）内部 | 底部 StatusBar |
| 注册位置 | 不注册到 AgentTaskRegistry | 注册到 AgentTaskRegistry |
| 完成后 | 工具结果直接返回给主 LLM | enqueueNotification 触发新 turn |
| handler 返回类型 | AsyncIterable（generator） | Promise（立即返回 async_launched） |
| LLM 调用回调 | onChunk/onTokens 更新闭包计数器 | onChunk/onTokens 调用 AgentTaskRegistry |

异步子代理不走新的 generator 路径。它仍然使用原来的 AgentTaskRegistry 事件机制，因为：

1. 异步子代理的 handler 立即返回 `{ status: 'async_launched' }`，不阻塞等待完成，无法用 generator 的迭代模式
2. 异步子代理的进度显示在 StatusBar（全局区域），而不是 ToolCall 框内，因为工具已经返回了
3. 异步子代理需要任务注册表管理生命周期（abort、clearSession），这不是 handler 返回值能表达的

## 向后兼容性

现有所有工具的 handler 返回 `Promise<unknown>`，scheduler 检测到没有 `Symbol.asyncIterator` 后直接 `await`，走原来的路径。零改动、零影响。

## 如何让其他工具也获得实时进度

只需把 handler 改为 async generator，yield 中间值即可。不需要知道 ToolStateManager、invocation ID、或任何基础设施细节。

示例：假设要给 `shell` 工具增加实时输出进度：

```typescript
// 改造前
async function shellHandler(args) {
  const output = await runCommand(args.command);
  return { output };
}

// 改造后
async function* shellHandler(args) {
  for await (const line of streamCommand(args.command)) {
    yield { status: 'running', lines: lineCount++ }; // 中间进度
  }
  yield { output: fullOutput }; // 最终结果
}
```

前端 ToolCall 组件从 `invocation.progress` 读取进度数据，根据工具名称渲染不同的 UI。

## 架构演进：从 Generator 到 ToolExecutionContext

日期：2025-07-10（第二次迭代）

### 问题

Generator + 轮询方案有两个固有瓶颈：

1. **500ms 轮询延迟**：onChunk/onTokens 回调只能更新闭包计数器，generator 每 500ms 才轮询一次
2. **scheduler 4x 节流叠加**：scheduler 每 4 个 yield 才推送一次 progress，总延迟约 2000ms
3. **代码复杂度高**：done 标志、runPromise.then hack、定时器循环，约 80 行样板代码

异步子代理不受此限制——它的 onChunk/onTokens 回调直接调用 AgentTaskRegistry.emit，每个 chunk 即时更新。

### 新方案：ToolExecutionContext

参考 FastMCP 的 `Context.report_progress` 模式和 LangChain PR #10102 的回调错误隔离设计。

核心思想：scheduler 创建一个 `ToolExecutionContext` 对象（含带节流的 `reportProgress` 回调），通过 `registry.execute(name, args, context)` 传入 handler。handler 在 onChunk/onTokens 回调中直接调用 `reportProgress`，无需 generator。

```
scheduler.executeSingle
  → 创建 context = { reportProgress: 150ms 节流闭包, signal }
  → registry.execute(name, args, context)
    → handler(args, context)
      → onChunk 回调: context.reportProgress({ tokens, frame })
  → handler 完成 → dispose() 刷新最后值 → transition(success)
```

同步子代理的 onChunk/onTokens 回调与异步子代理调用 `AgentTaskRegistry.emitChunkHeartbeat` / `updateTokens` 的时机完全对齐，都是每收到一个 LLM chunk 立即触发。

### 节流策略

scheduler 层 150ms leading+trailing 节流（`createThrottledReportProgress`）：
- 首次调用立即推送（leading edge）
- 150ms 窗口内后续调用合并，窗口结束推送最新值（trailing edge）
- `dispose()` 时刷新最后的待推送值，确保终态前进度数据完整
- 自写实现，不引入外部依赖（规避 lodash throttle leading/trailing 交互 bug #4471）

### 错误隔离

`reportProgress` 内部 try-catch 包裹 `toolState.transition()`。transition 失败不冒泡到 onChunk 回调，不中断 LLM 流式读取循环。`dispose()` 中的 flush 同样有 try-catch 保护。

### 向后兼容

- `ToolHandler` 第二个参数 `context?` 可选，现有工具忽略即可，零改动
- generator 迭代路径在 scheduler 中保留，两种进度机制共存
- generator 适合控制流线性的工具（如逐行输出的 shell），reportProgress 适合回调驱动的工具（如子代理）

### 改动文件清单

| 文件 | 改动 |
|------|------|
| `src/types/tool.ts` | 新增 `ToolExecutionContext` 接口；`ToolHandler` 签名加第二参数 |
| `packages/extension-sdk/src/tool.ts` | 同步类型定义 |
| `src/tools/registry.ts` | `execute()` 透传 context |
| `src/tools/scheduler.ts` | 新增 `createThrottledReportProgress`；`executeSingle` 创建 context 并在终态前 dispose |
| `src/tools/internal/sub-agent/index.ts` | 同步路径从 generator 改为普通 async 函数 + reportProgress |
