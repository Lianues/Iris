# Iris 架构文档

## 概述

模块化、可解耦的 AI 聊天框架。各层通过接口通信，内部统一使用 **Gemini Content 格式**。

## 架构分层

```
src/
├── cli.ts          CLI 入口（headless 模式，外部传 prompt 执行）
├── bootstrap.ts    核心初始化（创建 Backend 及所有依赖，供 index.ts 和 cli.ts 共享）
├── types/          公共类型定义
├── core/           Backend 核心服务 + ToolLoop 工具循环
├── platforms/      用户交互层：接收输入、展示输出
├── llm/            LLM API 调用层
├── storage/        聊天记录存储层
├── memory/         长期记忆层
├── mcp/            MCP 客户端层
├── tools/          工具注册层
├── prompt/         提示词组装层
├── modes/          模式系统
├── media/          媒体处理（图片缩放、文档提取、Office 转 PDF）
├── ocr/            OCR 服务（非 vision 模型的图片回退）
├── logger/         日志模块
└── config/         配置加载
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

## 入口文件

| 文件 | 作用 | 启动方式 |
|------|------|----------|
| `src/bootstrap.ts` | 核心初始化：创建 LLM、存储、工具、MCP、Backend 等全部模块 | 不直接运行，被下面两个入口调用 |
| `src/index.ts` | 平台模式：`bootstrap()` → 创建平台适配器 → 启动长驻服务 | `npm run dev` / `bun run dev` |
| `src/cli.ts` | CLI 模式：`bootstrap()` → `backend.chat()` → 输出 → 退出 | `npm run cli -- -p "prompt"` |

`bootstrap()` 返回 `{ backend, config, router, tools, mcpManager, ... }`，两种入口共享同一套初始化逻辑。

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
| [platforms.md](./platforms.md) | 用户交互层 |
| [llm.md](./llm.md) | LLM API 调用层 |
| [storage.md](./storage.md) | 聊天记录存储层 |
| [memory.md](./memory.md) | 长期记忆系统 |
| [tools.md](./tools.md) | 工具注册层 |
| [media.md](./media.md) | 媒体处理层（图片缩放、文档提取） |
| [prompt.md](./prompt.md) | 提示词组装层 |
| [logger.md](./logger.md) | 日志模块 |
| [config.md](./config.md) | 配置模块 |
| [deploy.md](./deploy.md) | 部署指南 |

## 自我升级指南（供 AI 阅读）

如果你是 AI 并且需要修改此项目：

1. 先读本文件了解整体架构
2. 再读 `docs/` 下目标模块的文档了解接口约定
3. 读 `src/types/` 了解数据格式
4. 修改或新增模块时，遵循现有的基类和类型约束
5. 核心流程参见 `docs/core.md`
