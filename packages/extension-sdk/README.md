# irises-extension-sdk

Iris extension / plugin 公共 SDK。

目标：

1. 给平台 extension 和插件提供稳定的公共接口。
2. 避免 extension / plugin 直接 import 宿主仓库内部的 `src/**`。
3. 让 extension / plugin 可以在独立仓库中维护自己的 `package.json`、锁文件和第三方依赖。
4. 作为独立 npm 包发布，供外部 extension / plugin 仓库以版本依赖方式使用。

## 安装

```bash
npm install irises-extension-sdk
```

外部 extension / plugin 仓库中，建议使用正常版本依赖，例如：

```json
{
  "dependencies": {
    "irises-extension-sdk": "^0.1.0"
  }
}
```

当前 Iris 仓库内部的 extension，为了本地联调方便，仍可使用本地路径或独立安装脚本；但对外发布时，应以 npm 版本依赖为准。

## 导入路径

| 导入路径 | 用途 |
|---------|------|
| `irises-extension-sdk` | 主入口：平台适配器、消息类型、工具类型、日志、平台通用工具、工具摘要 formatter |
| `irises-extension-sdk/plugin` | 插件 API：`definePlugin`, `IrisPlugin`, `PluginContext` |
| `irises-extension-sdk/pairing` | 配对模块：`PairingGuard`, `PairingStore` |
| `irises-extension-sdk/utils` | 内部工具：路径处理、manifest 解析、远程操作 |
| `irises-extension-sdk/tool-utils` | 工具辅助：diff 解析、文件遍历、参数归一化 |

## 平台 Extension 开发指南

### 基本用法

```ts
import {
  PlatformAdapter,
  createExtensionLogger,
  definePlatformFactory,
  splitText,
  autoApproveHandle,
  formatToolStatusLine,
  summarizeToolCall,
  summarizeToolResult,
  detectImageMime,
  type IrisBackendLike,
  type IrisPlatformFactoryContextLike,
  type ImageInput,
  type ToolAttachment,
  type ToolExecutionHandleLike,
} from 'irises-extension-sdk';
```

### 定义平台

平台 extension 需要：
1. 定义一个继承 `PlatformAdapter` 的类，实现 `start()` 和 `stop()` 方法
2. 使用 `definePlatformFactory()` 创建工厂函数
3. 默认导出该工厂函数

```ts
interface MyConfig {
  token: string;
}

class MyPlatform extends PlatformAdapter {
  constructor(private backend: IrisBackendLike, private config: MyConfig) {
    super();
  }

  async start(): Promise<void> {
    // 设置 backend 事件监听
    this.backend.on('response', (sid, text) => { /* 发送回复 */ });
    this.backend.on('error', (sid, error) => { /* 处理错误 */ });
    this.backend.on('done', (sid) => { /* 回合完成，释放并发锁 */ });

    // 流式输出（可选）
    this.backend.on('stream:start', (sid) => { /* 创建占位消息 */ });
    this.backend.on('stream:chunk', (sid, chunk) => { /* 更新消息 */ });

    // 工具执行（可选）
    this.backend.on('tool:execute', (sid, handle: ToolExecutionHandleLike) => {
      autoApproveHandle(handle);

      const snapshot = handle.getSnapshot();
      const call = summarizeToolCall(handle.toolName, snapshot.args)?.text;
      // 可选：用 formatToolStatusLine(handle) + call 展示工具开始状态

      handle.on('state', (status) => {
        // 可选：用 formatToolStatusLine({ toolName: handle.toolName, status }) 更新状态
      });
      handle.on('done', (result, error) => {
        const summary = error
          ? error
          : summarizeToolResult(handle.toolName, snapshot.args, result)?.text;
        // 可选：展示 summary
      });
    });

    // 附件（可选）
    this.backend.on('attachments', (sid, attachments) => { /* 发送图片等 */ });

    // 启动平台连接...
  }

  async stop(): Promise<void> {
    // 清理资源...
  }
}

export const createMyPlatform = definePlatformFactory<MyConfig, MyPlatform>({
  platformName: 'my-platform',
  resolveConfig: (raw, context) => ({
    token: raw.token ?? '',
  }),
  create: (backend, config) => new MyPlatform(backend, config),
});

export default createMyPlatform;
```

### Backend 事件列表

平台通过 `backend.on()` 监听以下事件：

| 事件名 | 参数 | 说明 |
|--------|------|------|
| `response` | `(sessionId, text)` | 最终回复文本（非流式模式 / 流式结束） |
| `error` | `(sessionId, errorMsg)` | 错误消息 |
| `done` | `(sessionId)` | 回合完成，释放并发锁、处理缓冲消息 |
| `stream:start` | `(sessionId)` | 流式输出开始 |
| `stream:chunk` | `(sessionId, chunk)` | 流式文本片段 |
| `tool:execute` | `(sessionId, handle)` | 单个工具执行开始；后续状态、输出、子工具和结果通过 `ToolExecutionHandleLike` 事件获取 |
| `attachments` | `(sessionId, attachments)` | 工具产生的附件（图片等） |
| `assistant:content` | `(sessionId, content)` | 完整的 assistant 消息内容 |

### Backend 可选方法

`IrisBackendLike` 中部分方法是可选的（带 `?` 标记）。调用前应检查是否存在：

```ts
// ✅ 正确做法
if (typeof this.backend.undo === 'function') {
  const result = await this.backend.undo(sessionId, 'last-turn');
}

// ✅ 简写
const modes = this.backend.listModes?.() ?? [];
const ok = this.backend.switchMode?.(modeName);

// ❌ 错误做法（可选方法直接调用）
const result = await this.backend.undo(sessionId);  // 可能 TypeError
```

### 平台通用工具函数

| 函数 | 说明 |
|------|------|
| `splitText(text, maxLen)` | 将文本按最大长度分段，优先在换行处切分 |
| `autoApproveHandle(handle)` | 自动批准单个 awaiting_approval 状态的工具执行 |
| `formatToolStatusLine(inv, options?)` | 格式化工具状态行（如 "🔧 read_file 执行中"） |
| `summarizeToolCall(toolName, args?)` | 生成平台无关的工具调用参数摘要 |
| `summarizeToolResult(toolName, args, result)` | 生成平台无关的工具结果摘要 |
| `summarizeToolProgress(toolName, args, progress)` | 生成平台无关的工具进度摘要 |
| `detectImageMime(buffer)` | 根据文件头魔术字节检测图片 MIME 类型 |
| `getPlatformConfig(context, name)` | 从上下文中提取指定平台的配置 |

## 插件 Plugin 开发指南

### 基本用法

```ts
import {
  definePlugin,
  createPluginLogger,
  type IrisPlugin,
  type PluginContext,
  type PreBootstrapContext,
  type IrisAPI,
} from 'irises-extension-sdk';
```

### 定义插件

插件使用 `definePlugin()` 定义，支持以下生命周期：

```ts
export default definePlugin({
  name: 'my-plugin',
  version: '1.0.0',
  description: '插件描述',

  // 可选：预引导阶段（注册 Provider）
  async preBootstrap(ctx: PreBootstrapContext) {
    ctx.registerLLMProvider('my-llm', factory);
    ctx.registerStorageProvider('my-storage', factory);
  },

  // 必需：激活阶段（注册工具、钩子）
  async activate(ctx: PluginContext) {
    // 1. 释放默认配置
    ctx.ensureConfigFile('my_plugin.yaml', defaultConfigContent);

    // 2. 读取配置
    const config = ctx.readConfigSection('my_plugin');

    // 3. 延迟初始化（等待 Backend 就绪）
    ctx.onReady(async (api: IrisAPI) => {
      api.tools.registerAll([...]);
    });

    // 4. 注册钩子
    ctx.addHook({
      name: 'my-hook',
      priority: 100,
      onBeforeChat(params) { /* 拦截/修改用户输入 */ },
      onBeforeLLMCall(params) { /* 拦截/修改 LLM 请求 */ },
      onConfigReload(params) { /* 热重载配置 */ },
    });
  },

  // 可选：停用阶段（清理资源）
  async deactivate() {
    // 释放数据库连接等
  },
});
```

### 生命周期执行顺序

```
1. preBootstrap(ctx)           ← 可注册 LLM/Storage/OCR/Platform Provider
     ↓
2. activate(ctx)               ← 可注册 Tool/Hook/Mode
     ↓
3. ctx.onReady(api => ...)     ← Backend 初始化完成后回调
     ↓
4. ctx.onPlatformsReady(...)   ← 所有平台启动完成后回调
     ↓
5. 运行中...                   ← 钩子被触发（onBeforeChat 等）
     ↓
6. deactivate()                ← 应用关闭时清理
```

### PreBootstrapContext vs PluginContext

| 能力 | PreBootstrapContext | PluginContext |
|------|:-------------------:|:-------------:|
| 注册 LLM Provider | ✅ | ❌ |
| 注册 Storage Provider | ✅ | ❌ |
| 注册 OCR Provider | ✅ | ❌ |
| 注册 Platform | ✅ | ❌ |
| 修改全局配置 | ✅ (`mutateConfig`) | ❌ |
| 注册 Tool | ❌ | ✅ |
| 注册 Hook | ❌ | ✅ |
| 注册 Mode | ❌ | ✅ |
| 访问 IrisAPI | ❌ | ✅ (`onReady`) |
| 读取配置 | ✅ | ✅ |
| 日志 | ✅ | ✅ |

### PluginHook 钩子类型

| 钩子 | 时机 | 用途 |
|------|------|------|
| `onBeforeChat` | 用户消息进入 Backend 前 | 预处理/过滤用户输入 |
| `onAfterChat` | Backend 生成回复后 | 后处理回复内容 |
| `onBeforeToolExec` | 工具执行前 | 拦截/修改工具参数 |
| `onAfterToolExec` | 工具执行后 | 后处理工具结果 |
| `onBeforeLLMCall` | LLM 请求发送前 | 修改 prompt/注入上下文 |
| `onAfterLLMCall` | LLM 响应返回后 | 后处理 LLM 输出 |
| `onSessionCreate` | 会话创建时 | 初始化会话资源 |
| `onSessionClear` | 会话清空时 | 清理会话资源 |
| `onConfigReload` | 配置文件变化时 | 热重载插件配置 |

## 对码系统 Pairing

用于平台层的用户访问控制（与 Backend 无关）：

```ts
import { PairingGuard, PairingStore, type PairingConfig } from 'irises-extension-sdk';

const store = new PairingStore();
const guard = new PairingGuard('telegram', config.pairing, store);

// 检查用户权限
const result = guard.check(userId, messageText, userName);
if (!result.allowed) {
  // 回复 result.replyText
  return;
}
```

## 依赖边界

extension / plugin 自己使用的第三方库，应当写在它自己的 `package.json` 中。

例如：

- Telegram extension 依赖 `grammy`
- Discord extension 依赖 `discord.js`
- Lark extension 依赖 `@larksuiteoapi/node-sdk`

这些依赖不应再由宿主根 `package.json` 代替声明。

## node_modules 与锁文件

推荐做法是：

- extension / plugin 在自己的仓库里维护自己的锁文件
- 开发时在 extension / plugin 自己目录执行 `npm install` 或其他包管理器安装
- 正式分发给用户的 extension 应当是已经构建好的发行包，不要求用户在安装 extension 时再安装依赖

## 约束

extension / plugin 不应再直接依赖宿主仓库内部路径，例如：

- `../../../src/core/backend`
- `../../../src/types`
- `../../../src/platforms/pairing`
- `../../logger`
- `../base`
