# Iris 架构文档

## 概述

模块化、可解耦的 AI 聊天框架。各层通过接口通信，内部统一使用 **Gemini Content 格式**。

## 架构分层

```
src/
├── cli.ts          CLI 入口（headless 模式，外部传 prompt 执行）
├── main.ts         统一入口（编译后的二进制路由到各模式）
├── terminal.ts     Terminal TUI 入口（onboard / models / platforms / extension 界面）
├── types/          公共类型定义
├── core/           核心服务
│   ├── iris-host.ts    多 Agent 管理器（进程唯一，管理所有 IrisCore 实例的生命周期）
│   ├── iris-core.ts    单 Agent 运行时（持有 Backend 及全部依赖，提供 start/shutdown 生命周期）
│   └── ...             Backend / ToolLoop / Summarizer / TurnLock / MessageQueue 等
├── ipc/            IPC 进程间通信层（JSON-RPC 2.0 over TCP）
│   ├── protocol.ts     协议定义（方法名、事件名、类型守卫、序列化结构）
│   ├── framing.ts      传输层：4 字节长度前缀帧编解码器
│   ├── server.ts       IPC 服务端（每个 IrisCore 一个实例）
│   ├── client.ts       IPC 客户端（连接到 server）
│   └── remote-*.ts     客户端侧代理（BackendHandle / ToolHandle / API）
├── platforms/      用户交互层：接收输入、展示输出
├── llm/            LLM API 调用层
├── storage/        聊天记录存储层
├── extension/      Extension / Plugin 管理（加载、激活、钩子、事件总线）
├── mcp/            MCP 客户端层
├── tools/          工具注册层
├── prompt/         提示词组装层
├── agents/         多 Agent 系统（注册表、路径隔离）
├── bootstrap/      Bootstrap 辅助模块（extensions.ts）
├── modes/          模式系统
├── media/          媒体处理（图片缩放、文档提取、Office 转 PDF）
├── ocr/            OCR 服务（非 vision 模型的图片回退）
├── attach.ts       Attach 模式入口（通过 IPC 连接远端 IrisCore）
├── logger/         日志模块
├── paths.ts        路径常量与多 Agent 路径解析
└── config/         配置加载
```

```
extensions/          各平台与功能 extension（lark / telegram / web / console / cron / memory / ...）
packages/
└── extension-sdk/   公共 SDK（@irises/extension-sdk），为 extension 和 plugin 提供类型与工具
terminal/            独立 TUI 应用（onboard / models / platforms / extension 管理界面）
```

## 数据流向

```
用户输入（两种入口）
  │                              │
  ▼                              ▼
[Platform]                     [CLI]
  │                              │
  └──── backend.chat(sid, text) ──┘
  │
  │
  ▼
[Backend]
  │
  ├─▶ [Storage]    ── 存储消息，读取历史
  ├─▶ [Media]      ── 图片缩放、文档提取、Office 转 PDF
  ├─▶ [OCR]        ── 非 vision 模型的图片文字提取（可选）
  ├─▶ [Memory]     ── 搜索相关记忆，注入系统提示词（可选）
  ├─▶ [Prompt]     ── 组装 LLMRequest
  ├─▶ [LLM]        ── 发送请求，获取回复
  ├─▶ [ToolLoop]   ── LLM + 工具的多轮循环
  │     │
  │     ├─▶ [MCPManager]      MCP 工具
  │     └─▶ [SubAgent]        子代理工具
  │
  │  emit 事件
  ▼
[Platform]  ── 将回复展示给用户
```

## IPC 层（进程间通信）

IPC 层允许外部进程（如 `iris attach`）连接到已运行的 IrisCore，通过 JSON-RPC 2.0 over TCP 协议与 Backend 交互。

### 架构位置

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

### 组件说明

| 文件 | 说明 |
|------|------|
| `src/ipc/protocol.ts` | 协议定义：方法名枚举、事件名枚举、类型守卫、序列化结构 |
| `src/ipc/framing.ts` | 传输层：4 字节长度前缀帧编解码，解决 TCP 粘包/拆包 |
| `src/ipc/server.ts` | IPC 服务端：每个 IrisCore 一个实例，管理客户端连接和事件转发 |
| `src/ipc/client.ts` | IPC 客户端：请求-响应匹配、事件通知监听 |
| `src/ipc/remote-backend-handle.ts` | 客户端侧的 Backend 代理，实现 `IrisBackendLike` 接口 |
| `src/ipc/remote-tool-handle.ts` | 客户端侧的 ToolExecutionHandle 代理 |
| `src/ipc/remote-api-proxy.ts` | IrisAPI 子集代理（setLogLevel/agentNetwork/configManager/router） |
| `src/attach.ts` | `iris attach` 入口：连接 → 创建代理 → 启动 Console |

### 设计原则

- **同进程不走 IPC**：同进程平台仍使用 BackendHandle 直接引用，IPC 是可选的远程访问通道
- **接口一致**：`RemoteBackendHandle` 和 `BackendHandle` 都实现 `IrisBackendLike` 接口
- **安全性**：绑定 127.0.0.1，仅限本机访问



## 入口文件

| 文件 | 作用 | 启动方式 |
|------|------|----------|
| `src/core/iris-core.ts` | 单 Agent 运行时：创建 LLM、存储、工具、MCP、Backend 等全部模块，提供 start/shutdown 生命周期 | 由 IrisHost 或 cli.ts 创建 |
| `src/core/iris-host.ts` | 多 Agent 管理器：管理所有 IrisCore 实例、共享 taskBoard、agentNetwork 注入 | 由 index.ts 创建 |
| `src/index.ts` | 平台模式：`IrisHost.start()` → 创建平台适配器 → 启动长驻服务 | `npm run dev` / `bun run dev` |
| `src/cli.ts` | CLI 模式：`IrisCore.start()` → `backend.chat()` → 输出 → `core.shutdown()` | `npm run cli -- -p "prompt"` |
| `src/attach.ts` | Attach 模式：通过 IPC 连接已运行的 IrisCore → 创建 RemoteBackendHandle → 启动 Console | `iris attach [--agent name]` |

`IrisCore` 接受可选的 `IrisCoreOptions`（含 `agentName` / `agentPaths` / `taskBoard`）。多 Agent 模式下由 `IrisHost` 为每个 Agent 创建独立的 `IrisCore` 实例。

---

## 核心交互模式（平台模式）

平台层与 Backend 的交互基于两个机制：

| 方向 | 机制 | 示例 |
|------|------|------|
| 平台 → Backend | 方法调用 | `backend.chat()`, `backend.listSessionMetas()` |
| Backend → 平台 | 事件发射 | `response`, `stream:chunk`, `tool:update` |

Backend 不持有任何平台引用，多个平台可共用同一个 Backend 实例。

## 内部数据格式（Gemini Content）

所有模块之间传递的消息均使用此格式：

```typescript
interface Content {
  role: 'user' | 'model';
  parts: Part[];  // TextPart | InlineDataPart | FunctionCallPart | FunctionResponsePart
  usageMetadata?: UsageMetadata;
}
```

工具调用循环在存储中的样子：

```json
[
  { "role": "user",  "parts": [{ "text": "现在几点？" }] },
  { "role": "model", "parts": [{ "functionCall": { "name": "get_current_time", "args": {} } }] },
  { "role": "user",  "parts": [{ "functionResponse": { "name": "get_current_time", "response": { "result": { "local": "2024/12/1 14:30:00" } } } }] },
  { "role": "model", "parts": [{ "text": "现在是 14:30。" }] }
]
```

## 模块通信规则

1. 模块之间通过抽象基类与类型接口通信，不直接依赖具体实现
2. 新增实现时，只需继承基类并在 `src/index.ts` 中注册
3. 各模块接口详见 `docs/` 目录下的对应文档

## 快速开始

```bash
npm run setup    # 安装依赖
cp -r data/configs.example data/configs
# 编辑 data/configs/llm.yaml 填入 API Key
npm run dev      # 开发模式

# CLI 模式（外部调用）
npm run cli -- -p "分析这个项目"
```

## 文档索引

| 文档 | 说明 |
|------|------|
| [architecture.md](./architecture.md) | 全局架构（本文件） |
| [core.md](./core.md) | Backend 核心服务与子 Agent 系统 |
| [ipc.md](./ipc.md) | IPC 进程间通信与 `iris attach` |
| [platforms.md](./platforms.md) | 用户交互层 |
| [llm.md](./llm.md) | LLM API 调用层 |
| [storage.md](./storage.md) | 聊天记录存储层 |
| [memory.md](./memory.md) | 长期记忆系统（Memory Extension 插件） |
| [tools.md](./tools.md) | 工具注册层 |
| [media.md](./media.md) | 媒体处理层（图片缩放、文档提取） |
| [prompt.md](./prompt.md) | 提示词组装层 |
| [logger.md](./logger.md) | 日志模块 |
| [config.md](./config.md) | 配置模块 |
| [plugins.md](./plugins.md) | 插件系统（Extension / Plugin API） |
| [build.md](./build.md) | 构建与分发 |
| [deploy.md](./deploy.md) | 部署指南 |
| [agents.md](./agents.md) | 多 Agent 系统 |
| [computer-use.md](./computer-use.md) | Computer Use（浏览器操控） |

## 自我升级指南（供 AI 阅读）

如果你是 AI 并且需要修改此项目：

1. 先读本文件了解整体架构
2. 再读 `docs/` 下目标模块的文档了解接口约定
3. 读 `src/types/` 了解数据格式
4. 修改或新增模块时，遵循现有的基类和类型约束
5. 核心流程参见 `docs/core.md`
