# IPC 进程间通信

## 概述

IPC 层允许外部进程（如 `iris attach`）通过 JSON-RPC 2.0 over TCP 连接到已运行的 IrisCore，与 Backend 进行完整交互。

**设计原则**：同进程不走 IPC。同进程平台（Console / Web / Telegram 等）仍使用 `BackendHandle` 直接引用，IPC 是可选的远程访问通道。

## 架构位置

```
┌──────────────────────────────────────────────────┐
│            主进程 (bun run dev)                     │
│  IrisHost                                         │
│  ├── Core A ─── BackendHandle ─── ConsolePlatform │ ← 同进程直接引用
│  │   └─ Backend A                                 │
│  │   └─ IPCServer A (:port) ◄═══════╗            │
│  └── Core B ─── BackendHandle ─── Telegram        │
│      └─ Backend B                                 │
│      └─ IPCServer B (:port)                       │
└────────────────────────────────╨───────────────────┘
                                 ║
           ┌─────────────────────╨──────┐
           │  独立进程 (iris attach)      │ ← 跨进程 IPC 代理
           │  ├── IPCClient              │
           │  │   └── RemoteBackendHandle│
           │  └── ConsolePlatform        │
           └────────────────────────────┘
```

## 文件结构

```
src/ipc/
├── protocol.ts               协议定义（方法名、事件名、类型守卫、序列化结构）
├── framing.ts                传输层：4 字节长度前缀帧编解码器
├── server.ts                 IPC 服务端（每个 IrisCore 一个实例）
├── client.ts                 IPC 客户端（连接到 server）
├── remote-backend-handle.ts  客户端侧 Backend 代理（实现 IrisBackendLike）
├── remote-tool-handle.ts     客户端侧 ToolExecutionHandle 代理
├── remote-api-proxy.ts       IrisAPI 子集代理（Console 使用）
└── index.ts                  统一导出

src/attach.ts                 iris attach 入口
```

## 协议格式

基于 JSON-RPC 2.0 变体，三种消息类型：

### Request（客户端 → 服务端）

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "backend.chat",
  "params": ["session-id", "你好"]
}
```

### Response（服务端 → 客户端）

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": null
}
```

错误响应：

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": { "code": -32000, "message": "错误描述" }
}
```

### Notification（服务端 → 客户端，无 id）

```json
{
  "jsonrpc": "2.0",
  "method": "event:stream:chunk",
  "params": ["session-id", "你好"]
}
```

## 传输层：帧编解码

使用长度前缀帧（Length-Prefixed Framing）在 TCP 流上传输 JSON 消息：

```
[4 字节 BigEndian 长度][JSON payload]
```

- 帧头：4 字节无符号大端整数，表示 payload 字节数
- 最大消息大小：16 MB
- 解决 TCP 粘包/拆包问题

## 连接流程

### 1. 主进程启动 IPC 服务

`IrisHost.start()` → 为每个 Agent 创建 `IPCServer` → 绑定 `127.0.0.1:0`（OS 自动分配端口）→ 写入 Lock 文件。

### 2. Lock 文件

路径：`~/.iris/iris-{agentName}.lock`

```json
{
  "pid": 12345,
  "port": 54321,
  "agentName": "__global__",
  "startedAt": "2025-01-01T00:00:00.000Z"
}
```

- 启动时检查已有 Lock 文件：验证 PID 是否存活，存活则报错，不存活则清理残留文件
- 关闭时自动删除 Lock 文件

### 3. 客户端连接

```
iris attach
  → 读取 Lock 文件获取端口
  → TCP 连接到 127.0.0.1:{port}
  → 发送 Handshake 请求
  → 收到 { version, agentName, pid, streamEnabled }
  → 创建 RemoteBackendHandle + RemoteApiProxy
  → 初始化缓存（initCaches）
  → 订阅所有事件（subscribe '*'）
  → 启动 Console 平台
```

### 4. Handshake 响应

```json
{
  "version": "1.0.0",
  "agentName": "__global__",
  "pid": 12345,
  "streamEnabled": true
}
```

## 方法列表

### Backend 核心方法

| 方法 | 说明 | 超时策略 |
|------|------|----------|
| `backend.chat` | 发送消息（完整工具循环） | 无超时 |
| `backend.clearSession` | 清空会话 | 默认 30s |
| `backend.switchModel` | 切换模型 | 默认 30s |
| `backend.listModels` | 列出模型 | 默认 30s |
| `backend.listSessionMetas` | 列出会话 | 默认 30s |
| `backend.abortChat` | 中止生成 | 默认 30s |
| `backend.isStreamEnabled` | 查询流式状态 | 默认 30s |
| `backend.undo` | 撤销 | 默认 30s |
| `backend.redo` | 重做 | 默认 30s |
| `backend.clearRedo` | 清空重做栈 | 默认 30s |
| `backend.getHistory` | 获取历史 | 默认 30s |
| `backend.listSkills` | 列出技能 | 默认 30s |
| `backend.listModes` | 列出模式 | 默认 30s |
| `backend.switchMode` | 切换模式 | 默认 30s |
| `backend.summarize` | 压缩上下文 | 无超时 |
| `backend.getToolNames` | 列出工具 | 默认 30s |
| `backend.getCurrentModelInfo` | 当前模型信息 | 默认 30s |
| `backend.runCommand` | 执行 shell 命令 | 60s |
| `backend.getCwd` / `setCwd` | 工作目录 | 默认 30s |

### 工具 Handle 操作

| 方法 | 说明 |
|------|------|
| `backend.getToolHandle` | 获取工具 Handle |
| `backend.getToolHandles` | 获取会话所有 Handle |
| `handle.approve` | 审批工具执行 |
| `handle.reject` | 拒绝工具执行 |
| `handle.apply` | 确认 diff 应用 |
| `handle.abort` | 中止工具执行 |

### API 子集（Console 使用）

| 方法 | 说明 |
|------|------|
| `api.setLogLevel` | 设置日志级别 |
| `api.getConsoleSettingsTabs` | 获取设置面板 |
| `api.listAgents` | 列出 Agent |
| `api.agentNetwork.*` | Agent 网络操作 |
| `api.configManager.*` | 配置读写 |
| `api.router.*` | 模型路由操作 |

### 客户端控制

| 方法 | 说明 |
|------|------|
| `client.handshake` | 握手 |
| `client.subscribe` | 订阅事件（session ID 或 `'*'`） |
| `client.unsubscribe` | 取消订阅 |
| `client.initSessionCwd` | 初始化 session 工作目录 |

## 事件通知

Backend 事件通过 IPC 转为 Notification 推送给已订阅的客户端。

| Backend 事件 | IPC 事件 |
|-------------|----------|
| `response` | `event:response` |
| `stream:start` | `event:stream:start` |
| `stream:chunk` | `event:stream:chunk` |
| `stream:end` | `event:stream:end` |
| `stream:parts` | `event:stream:parts` |
| `tool:execute` | `event:tool:execute`（自动序列化 Handle） |
| `error` | `event:error` |
| `usage` | `event:usage` |
| `done` | `event:done` |
| `turn:start` | `event:turn:start` |
| `assistant:content` | `event:assistant:content` |
| `auto-compact` | `event:auto-compact` |
| `retry` | `event:retry` |
| `user:token` | `event:user:token` |
| `agent:notification` | `event:agent:notification` |
| `task:result` | `event:task:result` |
| `notification:payloads` | `event:notification:payloads` |

Handle 子事件（按 handleId 路由）：

| 事件 | IPC 事件 |
|------|----------|
| state 变化 | `event:handle:state` |
| 输出更新 | `event:handle:output` |
| 进度更新 | `event:handle:progress` |
| 流消息 | `event:handle:stream` |

## 同步/异步阻抗匹配

IPC 天然是异步的，但 `IrisBackendLike` 接口中有同步方法（`listModels()`、`switchModel()` 等）。

`RemoteBackendHandle` 的策略：

1. **`initCaches()`**：连接后调用一次，并行预加载所有同步方法需要的数据
2. **同步方法**：直接返回缓存值
3. **突变操作后**：异步调用 `refreshCaches()` 后台刷新，下次调用拿到新值

## 超时策略

| 方法类型 | 超时 | 理由 |
|---------|------|------|
| `chat()` | 无超时（`timeout: 0`） | 工具循环可达 200 轮，时间不可预估 |
| `summarize()` | 无超时（`timeout: 0`） | 遍历全量历史 + LLM 调用 |
| `runCommand()` | 60 秒 | 服务端 spawnSync 自带 30s 超时 + 序列化开销余量 |
| 其他方法 | 默认 30 秒 | 本地查询或轻量操作 |

`IPCClient.call()` 支持 per-call 超时覆盖：

```typescript
client.call('backend.chat', [sid, text], { timeout: 0 });  // 无超时
client.call('backend.runCommand', [cmd], { timeout: 60_000 });  // 60s
client.call('backend.listModels');  // 默认 30s
```

## `iris attach` 用法

```bash
# 连接默认 Agent
iris attach

# 连接指定 Agent
iris attach --agent my-agent
iris attach -a my-agent

# 连接并设置工作目录
iris attach --cwd /path/to/project

# 显示帮助
iris attach --help
```

### 源码开发模式

```bash
# 终端 1：启动主进程
bun run dev

# 终端 2：附加 Console
bun run src/main.ts attach
```

两个 Console 共享同一个 Backend，但各自有独立的 session ID。

## 安全性

- TCP 绑定 `127.0.0.1`，仅本机可访问
- Lock 文件含 PID 验证，自动清理僵尸文件
- Lock 文件路径固定在数据目录下，不可被外部指定

## 错误码

| 码 | 含义 |
|----|------|
| -32700 | JSON 解析错误 |
| -32600 | 无效请求 |
| -32601 | 方法不存在 |
| -32602 | 参数无效 |
| -32603 | 内部错误 |
| -32000 | Backend 业务错误 |
| -32001 | Handle 不存在或已过期 |
