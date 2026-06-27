# Iris 插件系统（Extension / Plugin System）设计分析

> 基于 Iris v1.0.3 源码的完整架构分析

---

## 一、概述

Iris 是一个模块化、可解耦的 AI 聊天框架，支持多平台（Web / Telegram / 飞书 / QQ / Discord / 微信等）、多 LLM（Gemini / Claude / OpenAI Compatible）和工具调用。其扩展体系是整个框架最核心的设计之一，它将原本分散的"插件"和"平台渠道"两个概念统一收敛到了一个叫 **Extension** 的顶层抽象下。

### 1.1 核心设计理念

| 设计原则 | 具体体现 |
|---------|--------|
| **统一抽象** | Plugin（逻辑扩展）和 Platform（平台渠道）都是 Extension 的"贡献点"，共享同一套发现、安装、分发机制 |
| **SDK 边界隔离** | 所有公共接口通过独立的 `irises-extension-sdk` 包暴露，扩展禁止直接 import 宿主内部源码 |
| **同进程高权限** | 插件与宿主运行在同一个 Node.js 进程中，拥有对所有内部对象的完整访问权限 |
| **多阶段生命周期** | 分为 PreBootstrap → Activate → Ready → PlatformsReady → Deactivate 五个阶段，精确控制插件介入时机 |
| **优雅降级** | 所有阶段的错误都被捕获并记录日志，单个插件的失败不会导致整个系统崩溃 |

### 1.2 两层体系：Extension vs Plugin

这是理解整个系统的关键：

```
┌─────────────────────────────────────────────────────────┐
│                    Extension（扩展包）                    │
│                                                         │
│   manifest.json 声明了这个扩展包能贡献什么：              │
│                                                         │
│   ┌─────────────────┐    ┌──────────────────────────┐   │
│   │   Plugin 贡献    │    │    Platform 贡献          │   │
│   │                 │    │                          │   │
│   │  逻辑层扩展：    │    │  平台层扩展：             │   │
│   │  · 注册工具      │    │  · Web GUI               │   │
│   │  · 注册钩子      │    │  · Telegram Bot          │   │
│   │  · 注册模式      │    │  · 飞书 / QQ / Discord   │   │
│   │  · 拦截 LLM     │    │                          │   │
│   │  · 修改提示词    │    │  每个 Platform 是一个     │   │
│   │  · monkey-patch │    │  PlatformAdapter 工厂     │   │
│   └─────────────────┘    └──────────────────────────┘   │
│                                                         │
│   一个 Extension 可以同时贡献 Plugin + Platform，        │
│   也可以只贡献其中之一。                                  │
└─────────────────────────────────────────────────────────┘
```

**举例**：
- `extensions/memory/`：只贡献 Plugin（长期记忆系统，注册工具 + 钩子）
- `extensions/web/`：只贡献 Platform（Web GUI 平台工厂）
- `extensions/computer-use/`：只贡献 Plugin（浏览器/桌面自动化工具 + Web 面板）
- 一个扩展也可以同时贡献两者（manifest 中同时声明 `plugin` 和 `platforms`）

---

## 二、目录结构与模块职责

### 2.1 宿主侧核心模块（`src/extension/`）

```
src/extension/
├── index.ts                 统一导出入口
├── types.ts                 宿主内部类型（LoadedPlugin / 拦截器类型等）
├── registry.ts              本地 Extension 扫描与解析（发现 manifest、解析入口）
├── manager.ts               PluginManager —— 插件的发现、预加载、激活、停用
├── context.ts               PluginContextImpl —— 每个插件激活时获得的独立上下文
├── prebootstrap-context.ts  PreBootstrapContextImpl —— PreBootstrap 阶段上下文
├── event-bus.ts             PluginEventBus —— 插件间共享事件总线
├── patch.ts                 通用 monkey-patch 工具（patchMethod / patchPrototype）
├── installer.ts             Extension 安装器（远程下载 / 本地复制）
├── catalog.ts               Extension 元数据同步（index.json / distribution.files）
├── command.ts               CLI 命令处理（iris extension install ...）
├── dependencies.ts          依赖管理（包管理器检测、分发包校验）
└── utils.ts                 通用工具（manifest 读取、路径安全检查）
```

### 2.2 公共 SDK（`packages/extension-sdk/`）

```
packages/extension-sdk/src/
├── index.ts            主入口，re-export 所有公共类型
├── manifest.ts         ExtensionManifest / ExtensionPackage 等类型定义
├── platform.ts         PlatformAdapter 基类 + definePlatformFactory 辅助函数
├── plugin/
│   ├── types.ts        工厂注册表接口、Provider 工厂类型
│   ├── context.ts      PluginContext / PreBootstrapContext / IrisPlugin / PluginHook
│   ├── api.ts          IrisAPI 接口（插件 onReady 获得的完整内部 API）
│   ├── registry.ts     ToolRegistryLike / ModeRegistryLike 等 "Like" 接口
│   ├── storage.ts      StorageLike 接口
│   └── tool-preview.ts 工具预览工具集接口
├── message.ts          Content / Part 消息类型
├── llm.ts              LLMRequest / LLMResponse 类型
├── tool.ts             ToolDefinition / ToolHandler 类型
├── tool-summary.ts     平台无关的工具调用/进度/结果摘要 formatter
├── mode.ts             ModeDefinition 类型
├── logger.ts           扩展日志器
├── pairing/            对码系统（平台用户认证）
└── utils/              共享工具（manifest 解析、路径处理、远程下载）
```

**SDK 的 "Like" 接口设计**：SDK 中大量使用 `XxxLike` 后缀的接口（`ToolRegistryLike`、`LLMRouterLike`、`PluginEventBusLike` 等），这些接口只声明插件可能用到的方法子集，避免了 SDK 对宿主内部具体实现的依赖，实现了类型层面的**依赖倒置**。

### 2.3 引导层

```
src/bootstrap.ts                 核心初始化入口，协调启动流程中各阶段的衔接
src/bootstrap/extensions.ts      BootstrapExtensionRegistry —— 内置 Provider 工厂注册表
```

`BootstrapExtensionRegistry` 包含四个命名工厂注册表，每个都是 `NamedFactoryRegistry<T>`：

| 注册表 | 类型 | 内置项 |
|--------|------|--------|
| `llmProviders` | `LLMProviderFactory` | deepseek, gemini, openai-compatible, claude, openai-responses |
| `storageProviders` | `StorageFactory` | json-file, sqlite |
| `ocrProviders` | `OCRFactory` | openai-compatible |
| `platforms` | `PlatformRegistry` | （由 Extension manifest 中的 platforms 动态注册） |

---

## 三、Extension Manifest 规范

每个 Extension 的根目录必须包含一个 `manifest.json`：

```typescript
interface ExtensionManifest {
  name: string;                              // 唯一名称（须与目录名一致）
  version: string;                           // 版本号
  description?: string;
  author?: string;
  iris?: string;                             // 兼容的 Iris 版本范围（预留）
  entry?: string;                            // 顶层插件入口简写
  plugin?: {                                 // 插件贡献声明
    entry?: string;                          //   入口文件（相对根目录）
    configFile?: string;                     //   默认配置文件，默认 config.yaml
  };
  platforms?: Array<{                        // 平台贡献声明（数组，可注册多个）
    name: string;                            //   平台注册名称
    entry: string;                           //   工厂入口文件
    exportName?: string;                     //   命名导出名
    label?: string;                          //   显示名称
    description?: string;
    panel?: {                                //   终端引导面板声明
      fields: Array<{
        key: string;
        type?: 'text' | 'password' | 'number';
        label: string;
        required?: boolean;
      }>;
    };
  }>;
  distribution?: {                           // 发行包元数据
    files?: string[];                        //   分发文件列表
  };
}
```

入口文件解析优先级：`manifest.plugin.entry` > `manifest.entry` > 自动探测 `index.ts / index.js / index.mjs`。

---

## 四、Plugin 生命周期（五阶段模型）

这是整个插件系统最精妙的设计。插件的生命周期被精确划分为五个阶段，每个阶段都有不同的能力边界和设计意图：

```
bootstrap()
  │
  ├─→ 解析配置 (loadConfig)
  ├─→ 创建 BootstrapExtensionRegistry（注册内置 Provider）
  ├─→ 扫描 Extension 目录，注册 Platform 工厂
  │
  │   ══════════ 阶段 1: PreBootstrap ══════════
  ├─→ PluginManager.prepareAll()          // 按优先级排序，逐一加载插件模块
  ├─→ PluginManager.runPreBootstrap()     // 调用 plugin.preBootstrap(ctx)
  │     │  能力：修改配置、注册 LLM/Storage/OCR/Platform Provider
  │     │  上下文：PreBootstrapContextImpl
  │     │  时机：核心对象（Router/Storage/Tools）尚未创建
  │
  ├─→ 创建 LLM Router
  ├─→ 创建 Storage / OCR
  ├─→ 注册内置工具
  ├─→ 连接 MCP 服务器
  ├─→ 注册用户自定义模式
  ├─→ 创建 PromptAssembler
  │
  │   ══════════ 阶段 2: Activate ══════════
  ├─→ PluginManager.activateAll()         // 调用 plugin.activate(ctx)
  │     │  能力：注册工具/模式/钩子、包装工具、操作提示词
  │     │  上下文：PluginContextImpl（含 tools/modes/prompt/router）
  │     │  时机：核心注册表已创建，但 Backend 尚未创建
  │
  ├─→ 创建 Backend
  ├─→ 创建 PluginEventBus
  ├─→ 注入插件钩子到 Backend（setPluginHooks）
  ├─→ 构建完整 IrisAPI 对象
  │
  │   ══════════ 阶段 3: Ready ══════════
  ├─→ PluginManager.notifyReady(irisAPI)  // 调用 ctx.onReady() 注册的回调
  │     │  能力：访问 Backend、Storage、所有内部对象
  │     │  参数：完整的 IrisAPI
  │     │  时机：Backend 已创建，可以 patchMethod / 注册 Web 路由
  │
  ├─→ 返回 BootstrapResult
  ├─→ 创建平台（Web / Telegram / Console 等）
  │
  │   ══════════ 阶段 4: PlatformsReady ══════════
  ├─→ PluginManager.notifyPlatformsReady() // 调用 ctx.onPlatformsReady() 注册的回调
  │     │  能力：获取平台实例引用，patchMethod 修改平台行为
  │     │  参数：ReadonlyMap<string, PlatformAdapter> + IrisAPI
  │     │  时机：所有平台已创建完成
  │
  ├─→ 启动所有平台
  │
  │   ══════════ 阶段 5: Deactivate ══════════
  └─→ PluginManager.unloadAll()           // 应用关闭时调用 plugin.deactivate()
        │  能力：清理资源、关闭连接
```

### 4.1 阶段设计意图分析

**为什么需要 PreBootstrap？**

这是最特殊的阶段。它在所有核心对象创建之前执行，让插件有机会从根本上改变系统的行为——比如注册一个全新的 LLM Provider，或者注册一个自定义的存储后端。这种"系统装配"能力必须在工厂注册表冻结之前完成。

**为什么 Activate 在 Backend 创建之前？**

因为插件在 Activate 阶段注册的工具和钩子需要在 Backend 构造函数中就被纳入。工具注册到 ToolRegistry 后，会被 ToolLoop 使用；钩子注册后，会被 `setPluginHooks()` 转换为 ToolLoopConfig 中的拦截器。

**为什么需要 onReady 延迟回调？**

Activate 阶段无法访问 Backend（因为还没创建）。但很多高级功能需要 Backend 引用——监听事件、monkey-patch 方法、注册 Web 路由等。`onReady` 解决了这个鸡生蛋蛋生鸡的问题。

**为什么需要 onPlatformsReady？**

平台在 Backend 之后创建，且不同平台的命令系统各不相同。插件要修改 Telegram 的命令路由或 Web 的 HTTP 服务器，必须等平台实例就绪。

### 4.2 优先级系统

```typescript
interface PluginEntry {
  name: string;
  type?: 'local' | 'npm' | 'inline';
  enabled?: boolean;
  priority?: number;    // 数值越大越先执行，默认 0
  config?: Record<string, unknown>;
}
```

优先级影响所有阶段的执行顺序：`prepareAll`、`preBootstrap`、`activate`、`onReady`、`onPlatformsReady` 以及 Hook 链。排序算法是降序（`(b.priority ?? 0) - (a.priority ?? 0)`），所以 priority=100 的插件比 priority=0 的先执行。

---

## 五、IrisPlugin 接口与三种加载方式

### 5.1 IrisPlugin 接口

```typescript
interface IrisPlugin {
  name: string;           // 必须非空
  version: string;        // 必须非空
  description?: string;
  preBootstrap?(context: PreBootstrapContext): Promise<void> | void;
  activate(context: PluginContext): Promise<void> | void;  // 必须实现
  deactivate?(): Promise<void> | void;
}
```

SDK 提供了 `definePlugin()` 辅助函数，提供类型推断：

```typescript
import { definePlugin } from 'irises-extension-sdk';

export default definePlugin({
  name: 'my-plugin',
  version: '1.0.0',
  activate(ctx) { /* ... */ },
});
```

### 5.2 三种加载方式

| 类型 | 来源 | 发现机制 | 配置方式 |
|------|------|---------|---------|
| **local** | `~/.iris/extensions/<name>/` 或 `./extensions/<name>/` | manifest.json 扫描 | plugins.yaml |
| **npm** | `iris-plugin-<name>` npm 包 | `import()` 动态导入 | plugins.yaml |
| **inline** | 运行时代码注入 | `bootstrap({ inlinePlugins: [...] })` | 代码传参 |

加载流程（`PluginManager.resolvePlugin()`）：

```typescript
// local 类型
resolveLocalPluginSource(name)   // 从 Extension 目录查找
  → importLocalExtensionModule() // pathToFileURL + dynamic import
  → validatePlugin()             // 校验 name/version/activate

// npm 类型
import(`iris-plugin-${name}`)    // Node.js 标准 import
  → validatePlugin()

// inline 类型
直接使用传入的 IrisPlugin 对象
  → validatePlugin()
```

校验规则（`validatePlugin()`）：
- 必须是对象
- 必须有非空 `name` 字段
- 必须有非空 `version` 字段
- 必须有 `activate` 函数

---

## 六、PluginContext 能力全景

每个插件在 `activate()` 时获得一个独立的 `PluginContextImpl` 实例。它是插件与宿主交互的**唯一通道**：

### 6.1 能力清单

| 分类 | 方法 | 说明 |
|------|------|------|
| **工具** | `registerTool(tool)` | 注册一个工具（与内置工具格式一致） |
| | `registerTools(tools)` | 批量注册 |
| | `wrapTool(name, wrapper)` | 包装已有工具的 handler（洋葱式调用链） |
| **模式** | `registerMode(mode)` | 注册自定义工作模式 |
| **钩子** | `addHook(hook)` | 注册 PluginHook（8 个钩子点） |
| **提示词** | `addSystemPromptPart(part)` | 注入持久提示词片段 |
| | `removeSystemPromptPart(part)` | 移除提示词片段（按引用匹配） |
| **注册表** | `getToolRegistry()` | 直接访问 ToolRegistry（可 unregister 等） |
| | `getModeRegistry()` | 直接访问 ModeRegistry |
| | `getRouter()` | 直接访问 LLMRouter（切换/注册模型） |
| **延迟回调** | `onReady(cb)` | Backend 创建后回调，获得完整 IrisAPI |
| | `onPlatformsReady(cb)` | 平台创建后回调，获得平台实例 Map |
| **配置** | `getConfig()` | 获取全局 AppConfig（只读） |
| | `getPluginConfig<T>()` | 获取插件专属配置 |
| | `getConfigDir()` | 宿主配置目录绝对路径 |
| | `ensureConfigFile(name, content)` | 首次运行时释放默认配置模板 |
| | `readConfigSection(section)` | 读取宿主配置目录中的 YAML 段 |
| **日志** | `getLogger(tag?)` | 获取带插件前缀的日志器 |
| **扩展信息** | `getExtensionRootDir()` | 获取当前扩展的根目录路径 |
| **插件协作** | `getEventBus()` | 获取插件间事件总线（onReady 后可用） |
| | `getPluginManager()` | 查询其他已加载插件 |
| | `setHookPriority(name, priority)` | 动态调整已注册 Hook 的优先级 |

### 6.2 wrapTool 的洋葱模型

```typescript
type ToolWrapper = (
  original: ToolHandler,      // 原始（或上一层包装的）handler
  args: Record<string, unknown>,
  toolName: string,
) => Promise<unknown>;
```

可多次 wrapTool 同一个工具，形成调用链：

```
wrapTool('shell', wrapperA)  →  wrapTool('shell', wrapperB)

调用时：wrapperB → wrapperA → originalHandler
```

实现原理：直接替换 ToolRegistry 中工具对象的 `handler` 属性，每次包装都将当前 handler 作为 `original` 传给 wrapper。

---

## 七、Hook 系统（8 个拦截点）

### 7.1 PluginHook 接口

```typescript
interface PluginHook {
  name: string;
  priority?: number;  // 数值越大越先执行

  // 消息流程
  onBeforeChat?(params: { sessionId, text }): { text } | undefined;
  onAfterChat?(params: { sessionId, content }): { content } | undefined;

  // 工具执行
  onBeforeToolExec?(params: { toolName, args }): ToolExecInterception | undefined;
  onAfterToolExec?(params: { toolName, args, result, durationMs }): { result } | undefined;

  // LLM 调用
  onBeforeLLMCall?(params: { request: LLMRequest, round }): { request } | undefined;
  onAfterLLMCall?(params: { content: Content, round }): { content } | undefined;

  // 会话生命周期
  onSessionCreate?(params: { sessionId }): void;
  onSessionClear?(params: { sessionId }): void;

  // 配置热重载
  onConfigReload?(params: { config, rawMergedConfig }): void;
}
```

### 7.2 Hook 在数据流中的位置

```
用户消息 ──→ [onBeforeChat] ──→ buildUserParts ──→ handleMessage
                                                       │
                    ┌──────────── Tool Loop ────────────┤
                    │                                   │
                    │  [onBeforeLLMCall] ──→ LLM 调用 ──→ [onAfterLLMCall]
                    │                                   │
                    │  如果 LLM 返回 FunctionCall：      │
                    │  [onBeforeToolExec] ──→ 执行工具 ──→ [onAfterToolExec]
                    │       │                           │
                    │       │ 可返回 blocked=true 阻止   │
                    │       │ 可返回 args 替换参数        │
                    │                                   │
                    └───── 循环直到无 FunctionCall ──────┘
                                                       │
                                               最终响应文本
                                                       │
                                              [onAfterChat]
                                                       │
                                                  平台输出
```

### 7.3 Hook 到 ToolLoop 的装配过程

`buildPluginHookConfig()` 函数（`src/core/backend/plugins.ts`）将 PluginHook 数组转换为 ToolLoopConfig 中的四个拦截器函数。以 `beforeToolExec` 为例：

```typescript
// 筛选出所有注册了 onBeforeToolExec 的 hook
const beforeToolExecHooks = hooks.filter(h => h.onBeforeToolExec);

// 生成一个闭包，遍历所有 hook 链式执行
config.beforeToolExec = async (toolName, args) => {
  let currentArgs = args;
  for (const hook of beforeToolExecHooks) {
    const result = await hook.onBeforeToolExec!({ toolName, args: currentArgs });
    if (result) {
      if (result.blocked) return result;  // 直接阻止
      if (result.args) currentArgs = result.args;  // 替换参数
    }
  }
  if (currentArgs !== args) return { blocked: false, args: currentArgs };
  return undefined;  // 不干预
};
```

关键设计：
- **链式执行**：多个 Hook 按优先级依次执行，前一个 Hook 的修改结果传给下一个
- **短路机制**：`onBeforeToolExec` 返回 `blocked: true` 时立即终止链
- **容错隔离**：每个 Hook 的执行都包裹在 try/catch 中，单个 Hook 的错误不会中断链

---

## 八、IrisAPI —— 完整的内部 API

`onReady` 回调获得的 IrisAPI 是插件最强大的能力入口：

```typescript
interface IrisAPI {
  // ── 核心对象 ──
  backend: IrisBackendLike;          // EventEmitter，可监听所有内部事件
  router: LLMRouterLike;             // 模型路由（切换/注册/移除模型）
  storage: StorageLike;              // 会话存储（历史/元数据）
  tools: ToolRegistryLike;           // 工具注册表
  modes: ModeRegistryLike;           // 模式注册表
  prompt: PromptAssemblerLike;       // 提示词装配器
  config: Readonly<Record<string, unknown>>;  // 全局配置

  // ── 可选服务 ──
  mcpManager?: MCPManagerLike;       // MCP 服务器管理
  ocrService?: OCRProviderLike;      // OCR 服务
  media?: MediaServiceLike;          // 媒体处理（图片缩放/文档提取）
  memory?: unknown;                  // 由 memory 插件注入

  // ── 扩展能力 ──
  extensions: BootstrapExtensionRegistryLike;  // Provider 注册表
  pluginManager: PluginManagerLike;   // 查询其他插件
  eventBus: PluginEventBusLike;       // 插件间事件总线
  patchMethod: PatchMethod;           // monkey-patch 对象方法
  patchPrototype: PatchPrototype;     // monkey-patch 类原型方法

  // ── Web 集成 ──
  registerWebRoute?: (method, path, handler) => void;  // 注册 HTTP 路由
  registerWebPanel?: (panel: WebPanelDefinition) => void; // 注册 Web UI 面板

  // ── 管理接口 ──
  configManager?: ConfigManagerLike;  // 配置管理（读写/热重载）
  agentManager?: AgentManagerLike;    // Agent 管理（CRUD）
  extensionManager?: ExtensionManagerLike; // 扩展管理（安装/启用/禁用）

  // ── 工具集 ──
  toolPreviewUtils?: ToolPreviewUtilsLike;  // diff/write/insert 解析工具
  fetchAvailableModels?(config): Promise<ModelCatalogResultLike>;
  supportsVision?(modelName?): boolean;
  setLogLevel?(level: LogLevel): void;
  // ... 更多
}
```

**延迟注册机制**（Web 路由）：`registerWebRoute` 在 bootstrap 阶段就创建，但如果 WebPlatform 尚未启动，注册的路由会先进入队列。等 WebPlatform 创建并调用 `bindWebRouteRegistration()` 后，队列中的路由自动补注册。这保证了插件无论在哪个阶段注册路由都能生效。

---

## 九、Platform 扩展机制

### 9.1 PlatformAdapter 抽象基类

```typescript
// packages/extension-sdk/src/platform.ts
abstract class PlatformAdapter {
  abstract start(): Promise<void>;
  abstract stop(): Promise<void>;
  get name(): string { return this.constructor.name; }
}
```

所有平台（Web / Telegram / 飞书 / QQ 等）都继承此基类，实现 `start()` 和 `stop()` 方法。

### 9.2 definePlatformFactory 辅助函数

SDK 提供了标准化的平台工厂创建方式：

```typescript
function definePlatformFactory<TConfig, TPlatform>(options: {
  platformName: string;
  resolveConfig: (raw: Partial<TConfig>, context) => TConfig;
  create: (backend, config, context) => Promise<TPlatform> | TPlatform;
}): (context) => Promise<TPlatform>;
```

实际使用（以 Telegram 为例）：

```typescript
export default definePlatformFactory<TelegramConfig, TelegramPlatform>({
  platformName: 'telegram',
  resolveConfig: (raw) => ({
    token: raw.token ?? '',
    showToolStatus: raw.showToolStatus,
  }),
  create: (backend, config) => new TelegramPlatform(backend, config),
});
```

### 9.3 Platform 注册流程

```
bootstrap()
  │
  ├─→ discoverLocalExtensions()        // 扫描 extensions/ 目录
  ├─→ registerExtensionPlatforms()     // 遍历所有 manifest.platforms
  │     │
  │     │  对于每个 PlatformContribution：
  │     ├─→ 解析入口文件路径
  │     ├─→ 注册懒加载工厂到 PlatformRegistry
  │     │     registry.register(name, async (context) => {
  │     │       const mod = await import(entryFile);
  │     │       const factory = mod.default ?? mod.factory ?? mod.platform;
  │     │       return await factory(context);
  │     │     });
  │     │
  │     └─→ 返回注册的平台名列表
  │
  │  （后续 platform.yaml 中 type: [web, telegram] 时）
  └─→ PlatformRegistry.create(name, context)  // 按需创建平台实例
```

**懒加载设计**：平台工厂使用 lazy import——只有在 `platform.yaml` 中配置了某平台时，才会动态 `import()` 对应的入口文件。未使用的平台扩展不会被加载。

---

## 十、monkey-patch 系统

### 10.1 patchMethod

```typescript
function patchMethod(target, methodName, wrapper): PatchDisposer;
```

实现要点：
- 用 `Function.bind(target)` 绑定原始方法的 `this` 上下文
- 创建新函数，调用 `wrapper(bound, ...args)`
- 用 `Object.defineProperty` 设置 `name` 为 `patched_${methodName}`，方便调试
- 返回 dispose 函数，调用后仅当当前 patch 仍在位时恢复（避免覆盖后续 patch）

```typescript
// 多层 patch 形成洋葱调用链
const d1 = patchMethod(backend, 'chat', wrapperA);
const d2 = patchMethod(backend, 'chat', wrapperB);
// 调用 backend.chat() 时：wrapperB → wrapperA → original
d2(); // 恢复到 wrapperA
d1(); // 恢复到 original
```

### 10.2 patchPrototype

```typescript
function patchPrototype(targetClass, methodName, wrapper): PatchDisposer;
```

等价于 `patchMethod(targetClass.prototype, methodName, wrapper)`，影响该类的所有实例。

---

## 十一、插件间通信

### 11.1 PluginEventBus

```typescript
// src/extension/event-bus.ts
class PluginEventBus extends EventEmitter {
  fire(event: string, ...args: unknown[]): boolean {
    return this.emit(event, ...args);
  }
}
```

独立于 Backend EventEmitter，提供干净的插件间隔离通道。用法：

```typescript
// 插件 A（发射）
api.eventBus.fire('memory:data-ready', { count: 42 });

// 插件 B（监听）
api.eventBus.on('memory:data-ready', (data) => { ... });
```

### 11.2 通过 Backend 发射自定义事件

Backend 本身也是 EventEmitter，插件也可以用它来通信（跨插件和跨平台都可见）：

```typescript
api.backend.emit('custom:my-event', { foo: 'bar' });
api.backend.on('custom:my-event', (data) => { ... });
```

---

## 十二、Extension 发现、安装与分发

### 12.1 Extension 发现

运行时扫描两个目录（按优先级）：

| 目录 | 来源标识 | 说明 |
|------|---------|------|
| `~/.iris/extensions/` | `installed` | 用户安装目录 |
| `./extensions/` | `workspace` | 源码仓库目录 |

扫描逻辑（`discoverLocalExtensions()`）：
- 遍历目录下的所有子目录
- 读取 `manifest.json`，校验 `name` 和 `version` 必填
- 检查 `.disabled` 标记文件（禁用机制）
- 同名 Extension 只保留先发现的（installed 优先于 workspace）

### 12.2 Extension 安装

```bash
iris extension install <path>          # 远程优先，本地回退
iris extension install-git <url>       # 从 Git 仓库安装 extension 发行包
iris extension install-local <name>    # 仅本地
iris extension update <name>           # 按已记录 Git 来源升级
iris ext <path>                        # 简写
```

安装流程（远程目录）：
1. 从远程 `extensions/index.json` 读取扩展路径列表
2. 下载目标扩展的 `manifest.json`
3. 按 `distribution.files` 下载所有分发文件
4. 校验是否为可直接运行的发行包（必须有 `dist/` 产物）
5. 写入 `~/.iris/extensions/<name>/`

回退机制：远程不存在时，自动尝试从本地 `./extensions/` 复制安装。

安装流程（Git）：
1. 解析 Git 地址，可选 `--ref <branch/tag/commit>` 与 `--subdir <repo/path>`
2. 克隆仓库到临时目录；指定 ref 时会 fetch/checkout 对应 ref
3. 从仓库根目录或 subdir 读取 `manifest.json`
4. 校验是否为可直接运行的发行包；默认不执行第三方 `install/build` 脚本
5. 复制 extension 文件到 `~/.iris/extensions/<manifest.name>/`，过滤 `.git/` 与 `node_modules/`
6. 写入 `.iris-extension-install.json` 记录 Git URL、ref、commit、subdir，供后续管理/更新使用

Git 片段写法示例：`iris ext install-git https://github.com/user/repo.git#main:extensions/demo`。

### 12.3 分发形态校验

Git 升级流程：
1. 从已安装 extension 目录读取 `.iris-extension-install.json`
2. 复用记录的 Git URL / ref / subdir 拉取仓库；也允许命令行临时覆盖 ref/subdir
3. 校验新包的 `manifest.name` 必须与当前 extension 一致，避免升级时变更包名造成残留
4. 覆盖安装后更新 commit 记录，并保留原来的禁用标记；TUI 升级还会尽量保留启用/未启用状态

`assertInstallableExtensionPackage()` 确保扩展包已包含可运行入口：
- 分析 manifest 中声明的所有入口文件（plugin.entry + platforms[].entry）
- 检查对应文件是否存在
- 如果只有 `src/` 源码而无 `dist/` 产物，直接报错："这不是可直接安装的发行包"

### 12.4 内嵌与可选

`embedded.json` 声明了发行包内嵌的扩展（构建时复制）：

```json
{ "extensions": [{ "name": "web" }, { "name": "lark" }, { "name": "console" }, { "name": "telegram" }] }
```

`index.json` 列出远程仓库中所有可安装的扩展路径：

```json
{ "extensions": ["computer-use", "discord", "memory", "lark", "qq", "telegram", "web", "weixin", "wxwork"] }
```

---

## 十三、实际扩展案例分析

### 13.1 memory 扩展（纯 Plugin，功能型）

**核心模式**：Plugin 贡献 + 钩子 + 工具注册 + 配置自管理

```typescript
export default definePlugin({
  name: 'memory', version: '0.1.0',

  activate(ctx) {
    // 1. 首次运行释放默认配置模板
    ctx.ensureConfigFile('memory.yaml', DEFAULT_CONFIG_TEMPLATE);

    // 2. 读取配置决定是否启用
    const config = resolveConfig(ctx.readConfigSection('memory'), ctx.getPluginConfig());
    if (!config.enabled) return;

    // 3. onReady：创建 Provider、注册 3 个记忆工具
    ctx.onReady(async (api) => {
      activeProvider = new SqliteMemory(dbPath, logger);
      api.tools.registerAll(createMemoryTools(activeProvider));
      (api as any).memory = activeProvider;  // 挂载到 API 供其他插件访问
    });

    // 4. 钩子：捕获用户输入（不修改）
    ctx.addHook({ name: 'memory:capture-user-text', priority: 200,
      onBeforeChat({ text }) { lastUserText = text; return undefined; }
    });

    // 5. 钩子：autoRecall —— 在首次 LLM 调用前注入记忆上下文
    ctx.addHook({ name: 'memory:auto-recall', priority: 100,
      async onBeforeLLMCall({ request }) {
        const context = await activeProvider.buildContext(lastUserText);
        // 将记忆追加到 systemInstruction.parts
        return { request: { ...request, systemInstruction: { parts: [...existing, { text: context }] } } };
      }
    });

    // 6. 钩子：配置热重载
    ctx.addHook({ name: 'memory:config-reload',
      async onConfigReload() { /* 重新初始化 Provider 和工具 */ }
    });
  },
});
```

### 13.2 computer-use 扩展（Plugin + Web 面板）

**核心模式**：Plugin + registerWebPanel + registerWebRoute

```typescript
export default definePlugin({
  name: 'computer-use', version: '0.1.0',

  activate(ctx) {
    ctx.ensureConfigFile('computer_use.yaml', DEFAULT_CONFIG_TEMPLATE);

    ctx.onReady(async (api) => {
      // 注册 Web UI 侧边栏面板
      api.registerWebPanel?.({
        id: 'computer-use', title: 'Computer Use', icon: 'mouse',
        contentPath: '/api/ext/computer-use/panel',
      });

      // 注册面板内容路由 + 配置 CRUD 路由
      api.registerWebRoute?.('GET', '/api/ext/computer-use/panel', async (req, res) => { ... });
      api.registerWebRoute?.('GET', '/api/ext/computer-use/config', async (req, res) => { ... });
      api.registerWebRoute?.('POST', '/api/ext/computer-use/config', async (req, res) => { ... });
    });
  },
});
```

### 13.3 web 扩展（纯 Platform）

**核心模式**：Platform 贡献 + definePlatformFactory

```typescript
export default definePlatformFactory<Record<string, unknown>, WebPlatform>({
  platformName: 'web',
  resolveConfig(raw) {
    return { port: raw.port ?? 8192, host: raw.host ?? '127.0.0.1', ... };
  },
  async create(backend, config, context) {
    const api = context.api as IrisAPI;
    return new WebPlatform(backend, { ...config }, { api, projectRoot, ... });
  },
});
```

---

## 十四、架构设计总结

### 14.1 设计优势

| 维度 | 评价 |
|------|------|
| **统一性** | Plugin 和 Platform 统一到 Extension 概念下，一套机制管理所有扩展 |
| **渐进式能力** | 5 个生命周期阶段从浅到深，简单插件只需 activate，复杂插件可以层层深入 |
| **类型安全** | SDK 的 Like 接口 + TypeScript 全覆盖，编译期发现大部分错误 |
| **容错性** | 每个阶段、每个 Hook、每个回调都有 try/catch 隔离 |
| **灵活性** | patchMethod 可以替换任意内部行为，几乎没有做不到的事 |
| **解耦性** | 扩展通过 SDK 包与宿主通信，不依赖内部源码路径 |
| **分发友好** | 远程安装 + 本地回退 + 分发包校验，完整的生态链路 |

### 14.2 核心设计模式

| 模式 | 应用 |
|------|------|
| **依赖倒置** | SDK 定义 Like 接口 → 宿主实现具体类 → 插件依赖抽象接口 |
| **工厂模式** | NamedFactoryRegistry 统一管理所有类型的工厂（LLM/Storage/OCR/Platform） |
| **观察者模式** | EventBus + Backend EventEmitter 提供松耦合的事件通信 |
| **装饰器模式** | wrapTool + patchMethod 实现洋葱式方法包装 |
| **中间件模式** | PluginHook 链式执行，类似 Express 中间件 |
| **策略模式** | Provider 工厂注册表允许运行时替换 LLM/Storage 等策略 |
| **延迟初始化** | onReady / onPlatformsReady 解决循环依赖 |
| **命令模式** | CLI 命令系统（iris extension install ...）封装安装操作 |

### 14.3 与 MCP 的对比

| 维度 | MCP | Plugin 系统 |
|------|-----|------------|
| 扩展范围 | 仅工具 | 工具 + 模式 + 钩子 + 内部 API + 方法替换 + 平台 + 路由 |
| 运行方式 | 子进程 / 远程 | 同进程 |
| 协议 | MCP 标准协议 | Iris 内部接口 |
| 权限 | 沙箱隔离 | 完整访问所有内部对象 |
| 适用场景 | 只加工具 | 需要深度定制系统行为 |

两者共存互补。
