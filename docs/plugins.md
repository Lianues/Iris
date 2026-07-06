# 插件系统

## 职责

统一的第三方扩展入口。插件与 Iris 在同一进程中运行，拥有对内部组件的完整访问权限。

可扩展的能力：

- 在核心对象创建前参与系统装配（PreBootstrap）
- 注册工具、模式
- 拦截和修改工具执行（执行前 / 执行后）
- 拦截和修改 LLM 原始请求与原始响应
- 修改消息流程（用户输入 / LLM 输出）
- 监听会话生命周期（创建 / 清空）
- 直接操作系统提示词
- 注册自定义 LLM / Storage / Memory / OCR Provider
- 注册自定义平台
- 动态注册 / 移除 LLM 模型
- 访问 Backend、LLM Router、Storage 等所有内部对象
- monkey-patch 任意内部方法（patchMethod / patchPrototype）
- 平台创建后回调（onPlatformsReady）——可 patchMethod 修改任意平台行为
- 向 Web 平台注册自定义 HTTP 路由
- 向 Console TUI Settings 注册插件配置 Tab（声明式表单）
- 插件间通信（共享事件总线 + 插件管理器引用）
- 运行时直接注入内联插件（inline plugin）
- 通过 Backend EventEmitter 发射和监听自定义事件

## 公共 SDK 边界

插件与 extension 的公共接口现在统一由 `irises-extension-sdk` 提供。

- 插件 API：`irises-extension-sdk/plugin`
- 配对能力：`irises-extension-sdk/pairing`
- 平台 extension 公共类型与 helper：`irises-extension-sdk`

外部仓库建议直接安装：

```bash
npm install irises-extension-sdk
```

典型导入方式：

```typescript
import { definePlugin, type IrisPlugin, type PluginContext, type PreBootstrapContext } from 'irises-extension-sdk/plugin';
import { PairingGuard, PairingStore, type PairingConfig } from 'irises-extension-sdk/pairing';
```

不要再直接 import 宿主内部源码，例如：

- `src/plugins/**`
- `src/platforms/pairing/**`
- `src/core/**`

## 文件结构

```
src/extension/
├── types.ts                宿主内部类型（LoadedPlugin / 拦截器等，不导出给扩展）
├── context.ts              PluginContextImpl（每个插件获得的独立上下文实例）
├── manager.ts              PluginManager（发现、加载、激活、停用）
├── patch.ts                通用 monkey-patch 工具（patchMethod / patchPrototype）
├── event-bus.ts            插件间共享事件总线
├── prebootstrap-context.ts PreBootstrap 阶段上下文
├── registry.ts             BootstrapExtensionRegistry（Provider / 平台注册表）
├── catalog.ts              远程 extension 目录（下载列表）
├── installer.ts            extension 安装与依赖管理
├── command.ts              CLI 子命令（iris ext install / uninstall）
├── dependencies.ts         extension 依赖检测与安装（detectPackageManager / installDependencies）
├── utils.ts                extension 工具函数
└── index.ts                统一导出
```

---

## 插件目录

当前本地插件来源有两类：

1. 已安装 extension 目录 `~/.iris/extensions/`
2. 源码仓库收录目录 `./extensions/`

其中 extension 可以同时贡献：

- plugin
- platform（原先 channel 的能力）

extension 目录结构示例：

```
~/.iris/extensions/
├── my-extension/
│   ├── manifest.json     extension 清单
│   ├── package.json      extension 自己的依赖声明
│   ├── src/index.ts      源码入口（开发态）
│   ├── dist/index.mjs    运行入口（发行态）
│   ├── config.yaml       插件默认配置（可选）
│   └── README.md         说明文档（可选）
└── another-extension/
    ├── manifest.json
    └── dist/index.mjs
```

说明：

- 开发态可保留源码文件并在仓库内联调
- 正式分发给用户安装的 extension，应当已经带有可运行产物，例如 `dist/index.mjs`
- 用户安装 extension 时不再额外执行依赖安装

### 安装与管理

CLI 支持远程目录、本地目录和 Git 仓库三种安装入口：

```bash
iris extension install <path>                 # 从官方/配置的远程 extension catalog 安装
iris extension install-local <name>           # 从当前仓库 ./extensions/ 安装
iris extension install-git <git-url>          # 从 Git 仓库安装
iris extension install-git <git-url> --ref main --subdir extensions/demo
iris extension update <name>                  # 按 Git 来源升级已安装 extension
```

Git 安装也支持片段写法：

```bash
iris ext install-git https://github.com/user/repo.git#main:extensions/demo
```

Git 安装要求仓库根目录或 `--subdir` 目录就是一个可直接运行的 extension 发行包：必须包含 `manifest.json`，并且 manifest 声明的 plugin/platform 入口文件已经存在（例如 `dist/index.mjs`）。安装时默认不会执行第三方 `install` / `build` 脚本，只会复制文件到 `~/.iris/extensions/<manifest.name>/`，并过滤 `.git/` 与 `node_modules/`。

安装后的 Git 来源会记录到 extension 目录中的 `.iris-extension-install.json`。TUI 的 `iris extension` 界面可以从 Git 地址拉取安装，也可以对已安装 extension 执行开启、关闭、删除；如果 extension 是 Git 安装的，还会显示“升级”操作，按记录的 Git URL / ref / subdir 重新拉取并覆盖本地版本。

---

## 配置

`~/.iris/configs/plugins.yaml`：

```yaml
plugins:
  - name: my-plugin
    enabled: true
    config:
      apiKey: "sk-xxx"

  - name: rag
    type: npm
    priority: 100
    enabled: true

  - name: disabled-plugin
    enabled: false
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | `string` | 是 | 插件名称。本地插件按 `~/.iris/extensions/<name>/` → `./extensions/<name>/` 顺序查找；npm 插件对应 `iris-plugin-<name>` |
| `type` | `'local' \| 'npm'` | 否 | 插件来源类型，默认 `local` |
| `enabled` | `boolean` | 否 | 是否启用，默认 `true` |
| `priority` | `number` | 否 | 插件优先级。数值越大越先执行，默认 `0` |
| `config` | `object` | 否 | 覆盖插件自身 `config.yaml` 中的配置 |

---

配置合并规则：

1. 若 extension 根目录下存在 `config.yaml`，先读取它作为基础配置
2. 再用 `plugins.yaml` 中该插件条目的 `config` 覆盖同名字段
3. 当前实现是**浅合并**，不是深度合并

例如：

```yaml
# ~/.iris/extensions/demo/config.yaml
http:
  timeout: 3000
  headers:
    x-token: a
```

```yaml
# ~/.iris/configs/plugins.yaml
plugins:
  - name: demo
    config:
      http:
        timeout: 5000
```

最终 `http.headers` 不会保留，而是整个 `http` 对象被替换为 `{ timeout: 5000 }`。

### 内联插件（runtime inline plugin）

除 `local` 和 `npm` 外，插件系统还支持**运行时直接注入**的内联插件。它不从 `plugins.yaml` 读取，而是在调用 `bootstrap()` 时通过 `inlinePlugins` 传入。`PluginInfo.type` 中的 `inline` 就表示这种来源。

```typescript
import type { IrisPlugin } from 'irises-extension-sdk/plugin';

const inlinePlugin: IrisPlugin = {
  name: 'runtime-audit',
  version: '1.0.0',
  activate(ctx) {
    ctx.getLogger().info('inline plugin loaded');
  },
};

await bootstrap({
  inlinePlugins: [
    {
      plugin: inlinePlugin,
      priority: 100,
      config: { enabledRules: ['shell-audit'] },
    },
  ],
});
```

---

## 插件接口：IrisPlugin

这些类型由 `irises-extension-sdk/plugin` 提供。

```typescript
interface IrisPlugin {
  name: string;
  version: string;
  description?: string;
  preBootstrap?(context: PreBootstrapContext): Promise<void> | void;
  activate(context: PluginContext): Promise<void> | void;
  deactivate?(): Promise<void> | void;
}
```

- `preBootstrap()` 在 Router / Storage / Memory / OCR / 平台创建前调用
- `activate()` 在 bootstrap 流程中、Backend 创建之前调用
- `deactivate()` 在应用关闭时调用
- `name` 和 `version` 必须是非空字符串，`activate` 必须是函数

---

## 预启动阶段：PreBootstrapContext

这些类型由 `irises-extension-sdk/plugin` 提供。

`preBootstrap()` 用来做真正的“系统装配”。插件可以在这里修改最终生效的配置，并注册新的 Provider 或平台工厂。

```typescript
interface PreBootstrapContext {
  getConfig(): Readonly<AppConfig>;
  mutateConfig(mutator: (config: AppConfig) => void): void;
  registerLLMProvider(name: string, factory: LLMProviderFactory): void;
  registerStorageProvider(type: string, factory: StorageFactory): void;
  registerMemoryProvider(type: string, factory: MemoryFactory): void;  // @deprecated — memory 已迁移为独立扩展插件
  registerOCRProvider(name: string, factory: OCRFactory): void;
  registerPlatform(name: string, factory: PlatformFactory): void;
  getExtensions(): BootstrapExtensionRegistry;
  getLogger(tag?: string): PluginLogger;
  getPluginConfig<T = Record<string, unknown>>(): T | undefined;

  // 配置文件管理
  getConfigDir(): string;                                    // 获取宿主配置目录的绝对路径
  ensureConfigFile(filename: string, content: string): boolean; // 确保配置文件存在，不存在则创建
  readConfigSection(section: string): Record<string, unknown> | undefined; // 从宿主配置目录读取指定 YAML 配置段
}
```

示例：注册自定义 LLM Provider，并把默认模型切到插件提供的 provider：

```typescript
plugin.preBootstrap = (ctx) => {
  ctx.registerLLMProvider('my-provider', (config) => createMyProvider(config));

  ctx.mutateConfig((config) => {
    config.llm.models.push({
      modelName: 'my_model',
      provider: 'my-provider',
      apiKey: 'demo',
      model: 'my-model-id',
      baseUrl: 'https://example.com',
    });
    config.llm.defaultModelName = 'my_model';
  });
};
```

示例：注册自定义平台，并让它出现在 `platform.type` 中：

```typescript
plugin.preBootstrap = (ctx) => {
  ctx.registerPlatform('my-platform', async ({ backend, config }) => {
    return new MyPlatform(backend, config.platform['my-platform']);
  });

  ctx.mutateConfig((config) => {
    config.platform.types = ['my-platform'];
    config.platform['my-platform'] = { token: 'demo' };
  });
};
```

### 获取底层扩展注册表：getExtensions()

如果便捷方法还不够，可以通过 `getExtensions()` 直接拿到完整的 `BootstrapExtensionRegistry`。

```typescript
plugin.preBootstrap = (ctx) => {
  const extensions = ctx.getExtensions();

  // 查看当前已注册的 LLM provider
  const names = extensions.llmProviders.list();

  // 判断某个 provider 是否存在
  if (extensions.llmProviders.has('gemini')) {
    const geminiFactory = extensions.llmProviders.get('gemini');
    // 可以基于旧工厂包装出一个新工厂
  }

  // 移除一个已注册的 provider
  extensions.llmProviders.unregister('legacy-provider');
};
```

几个注册表的通用方法如下：

| 方法 | 说明 |
|------|------|
| `register(name, factory)` | 注册工厂 |
| `unregister(name)` | 移除工厂 |
| `get(name)` | 获取工厂 |
| `has(name)` | 判断是否存在 |
| `list()` | 列出所有已注册名称 |

其中：

- `llmProviders` / `storageProviders` / `memoryProviders` / `ocrProviders` 使用同一套命名工厂注册表
- `platforms` 是 `PlatformRegistry`，也支持 `register / unregister / get / has / list`

### PreBootstrap 阶段的日志与配置

`PreBootstrapContext` 也支持：

- `getLogger(tag?)`：获取插件日志器
- `getPluginConfig()`：读取插件配置（本地 `config.yaml` 与 `plugins.yaml` 中 `config` 的合并结果；内联插件则读取运行时传入的 `config`）

---

## 插件上下文：PluginContext

插件在 `activate()` 中收到一个 `PluginContext`，提供以下能力：

这些类型由 `irises-extension-sdk/plugin` 提供。

```typescript
interface PluginContext {
  // 工具扩展
  registerTool(tool: ToolDefinition): void;
  registerTools(tools: ToolDefinition[]): void;

  // 模式扩展
  registerMode(mode: ModeDefinition): void;

  // 钩子
  addHook(hook: PluginHook): void;

  // 直接访问内部注册表
  getToolRegistry(): ToolRegistry;
  getModeRegistry(): ModeRegistry;
  getRouter(): LLMRouter;

  // 工具拦截
  wrapTool(toolName: string, wrapper: ToolWrapper): void;

  // 提示词操作
  addSystemPromptPart(part: Part): void;
  removeSystemPromptPart(part: Part): void;

  // 平台就绪回调
  onPlatformsReady(callback: (platforms: ReadonlyMap<string, PlatformAdapter>, api: IrisAPI) => void | Promise<void>): void;

  // 延迟初始化
  onReady(callback: (api: IrisAPI) => void | Promise<void>): void;

  // 工具方法
  getConfig(): Readonly<AppConfig>;
  getLogger(tag?: string): PluginLogger;
  getPluginConfig<T = Record<string, unknown>>(): T | undefined;

  // 配置文件管理（与 PreBootstrapContext 共享的便捷方法）
  getExtensionRootDir(): string | undefined;  // 获取当前扩展的根目录绝对路径（内联插件返回 undefined）
  getConfigDir(): string;                     // 获取宿主配置目录的绝对路径
  ensureConfigFile(filename: string, content: string): boolean; // 确保配置文件存在
  readConfigSection(section: string): Record<string, unknown> | undefined; // 读取指定 YAML 配置段

  // 插件间协作
  getEventBus(): PluginEventBusLike;          // 获取插件间事件总线
  getPluginManager(): PluginManagerLike;      // 获取插件管理器（查询其他插件）
  setHookPriority(hookName: string, priority: number): boolean; // 更新已注册 Hook 的优先级
}
```

---

## 工具注册

与内置工具格式完全一致：

```typescript
ctx.registerTool({
  declaration: {
    name: 'get_weather',
    description: '查询指定城市的天气',
    parameters: {
      type: 'object',
      properties: {
        city: { type: 'string', description: '城市名' },
      },
      required: ['city'],
    },
  },
  handler: async (args) => {
    return { temperature: 25, city: args.city };
  },
});
```

## 工具拦截（wrapTool）

`wrapTool` 直接修改工具在 ToolRegistry 中的 handler。wrapper 接收原始 handler、参数和工具名。

```typescript
type ToolWrapper = (
  original: ToolHandler,
  args: Record<string, unknown>,
  toolName: string,
) => Promise<unknown>;
```

示例：给 shell 工具加审计日志：

```typescript
ctx.wrapTool('shell', async (original, args, toolName) => {
  const logger = ctx.getLogger('audit');
  logger.info(`执行命令: ${args.command}`);
  const result = await original(args);
  logger.info(`命令完成`);
  return result;
});
```

示例：给 write_file 工具加备份：

```typescript
ctx.wrapTool('write_file', async (original, args) => {
  // 写入前备份原文件
  const fs = await import('fs');
  const path = args.path as string;
  if (fs.existsSync(path)) {
    fs.copyFileSync(path, path + '.bak');
  }
  return original(args);
});
```

可多次 wrapTool 同一个工具，形成洋葱式调用链。

---

## 钩子系统

通过 `ctx.addHook()` 注册。当前提供九个钩子点。每个 hook 可带 `priority`，数值越大越先执行：

### onBeforeChat

用户消息发给 LLM 前调用。可修改消息文本。

```typescript
ctx.addHook({
  name: 'preprocessor',
  onBeforeChat({ sessionId, text }) {
    return { text: text.replace(/敏感词/g, '***') };
  },
});
```

### onAfterChat

LLM 返回最终文本后、发送给用户前调用。可修改响应内容。

```typescript
ctx.addHook({
  name: 'postprocessor',
  async onAfterChat({ sessionId, content }) {
    return { content: content + '\n\n---\nPowered by MyPlugin' };
  },
});
```

### onBeforeToolExec

工具执行前调用（在 scheduler 中，审批通过后、实际执行前）。可阻止执行或修改参数。

```typescript
ctx.addHook({
  name: 'tool-guard',
  onBeforeToolExec({ toolName, args }) {
    if (toolName === 'shell' && String(args.command).includes('rm -rf')) {
      return { blocked: true, reason: '安全策略：禁止 rm -rf' };
    }
    return undefined; // 不干预
  },
});
```

返回值：

| 返回 | 效果 |
|------|------|
| `undefined` | 不干预 |
| `{ blocked: true, reason }` | 阻止执行，reason 回传给 LLM |
| `{ blocked: false, args }` | 允许执行，替换参数 |

多个插件的钩子按加载顺序链式执行。

### onAfterToolExec

工具执行完成后调用。可修改工具返回值。

```typescript
ctx.addHook({
  name: 'tool-result-redactor',
  onAfterToolExec({ toolName, result }) {
    if (toolName === 'read_file' && typeof result === 'string') {
      return { result: result.replace(/password=.*/g, 'password=***') };
    }
    return undefined;
  },
});
```

### onBeforeLLMCall

LLM 请求发出前调用。可修改完整的 `LLMRequest`，包括历史、系统提示词、工具声明、生成参数。

```typescript
ctx.addHook({
  name: 'llm-request-patcher',
  onBeforeLLMCall({ request, round }) {
    return {
      request: {
        ...request,
        generationConfig: {
          ...(request.generationConfig || {}),
          temperature: 0,
        },
      },
    };
  },
});
```

### onAfterLLMCall

LLM 原始响应返回后、写入历史前调用。可修改模型输出内容。

```typescript
ctx.addHook({
  name: 'llm-response-filter',
  onAfterLLMCall({ content }) {
    return {
      content: {
        ...content,
        parts: content.parts.map(part => 'text' in part && part.text
          ? { ...part, text: part.text.replace(/敏感信息/g, '***') }
          : part),
      },
    };
  },
});
```

### onSessionCreate / onSessionClear

会话创建或清空时调用。

```typescript
ctx.addHook({
  name: 'session-audit',
  onSessionCreate({ sessionId }) {
    console.log('session created:', sessionId);
  },
  onSessionClear({ sessionId }) {
    console.log('session cleared:', sessionId);
  },
});
```

### onConfigReload

配置文件变化时调用（热重载）。插件可在此钩子中读取新配置并重新初始化资源。

```typescript
ctx.addHook({
  name: 'my-plugin-config-reload',
  async onConfigReload({ config, rawMergedConfig }) {
    // config 是重载后的最新 AppConfig
    // rawMergedConfig 是合并后的原始配置数据（未经类型解析）
    const mySection = rawMergedConfig['my-plugin'] as Record<string, unknown> | undefined;
    if (mySection) {
      applyNewConfig(mySection);
    }
  },
});
```


---

## 提示词操作

插件可以直接操作系统提示词：

```typescript
// 注入一个持久的提示词片段，所有请求可见
const part = { text: '你是一个专业的代码审计员。' };
ctx.addSystemPromptPart(part);

// 移除（按引用匹配）
ctx.removeSystemPromptPart(part);
```

这两个方法直接调用 `PromptAssembler.addSystemPart()` / `removeSystemPart()`。添加的片段会出现在每次 LLM 请求的 `systemInstruction` 中。

---

## 直接访问内部注册表

```typescript
// 获取 ToolRegistry 实例——可以调用 register/unregister/get/createSubset 等所有方法
const tools = ctx.getToolRegistry();
tools.unregister('delete_file');  // 移除一个内置工具
const decls = tools.getDeclarations();  // 查看所有工具声明

// 获取 ModeRegistry 实例
const modes = ctx.getModeRegistry();
modes.register({ name: 'my-mode', systemPrompt: '...' });

// 获取 LLMRouter 实例——可以切换模型、动态注册/移除模型
const router = ctx.getRouter();
router.setCurrentModel('gpt4o');
router.registerModel({ modelName: 'my-model', provider, config });
router.unregisterModel('legacy-model');
```

---

## 延迟初始化：onReady + IrisAPI

`activate()` 在 Backend 创建之前执行，因此此时无法访问 Backend。通过 `onReady()` 注册回调，在 Backend 创建完成后获得完整的内部 API：

这些类型由 `irises-extension-sdk/plugin` 提供。

```typescript
interface IrisAPI {
  backend: Backend;          // EventEmitter，可监听所有内部事件
  router: LLMRouter;         // 切换模型、获取模型信息
  storage: StorageProvider;  // 会话历史、元数据
  memory?: unknown;          // 由 memory 插件注入（可选）
  tools: ToolRegistry;       // 工具注册表
  modes: ModeRegistry;       // 模式注册表
  prompt: PromptAssembler;   // 提示词装配器
  config: AppConfig;         // 当前应用配置（只读）
  mcpManager?: MCPManager;   // MCP 管理器
  ocrService?: OCRProvider;  // OCR 服务
  media?: MediaServiceLike;  // 媒体处理服务：图片缩放、文档提取、Office→PDF
  extensions: BootstrapExtensionRegistry; // 启动扩展注册表

  // --- 高级能力 ---
  pluginManager: PluginManager;       // 插件管理器（查询其他插件信息）
  eventBus: PluginEventBus;           // 插件间共享事件总线
  patchMethod: typeof patchMethod;    // 安全替换对象方法
  patchPrototype: typeof patchPrototype; // 安全替换类原型方法
  services: ServiceRegistryLike;      // 通用服务注册中心；Console 扩展点通过它暴露
  registerWebRoute?: (method, path, handler) => void; // 向 Web 平台注册路由；若 Web 尚未创建会先排队，绑定后自动注册
  registerWebPanel?: (panel: WebPanelDefinition) => void; // 向 Web 平台注册扩展面板页面

  // --- 配置与环境 ---
  configManager?: ConfigManagerLike;   // 配置读写与热重载
  toolPreviewUtils?: ToolPreviewUtilsLike; // 工具预览辅助（路径解析、diff 解析等）
  isCompiledBinary?: boolean;          // 当前是否运行在编译后的二进制中
  projectRoot?: string;                // 项目根目录
  dataDir?: string;                    // 运行时数据目录（~/.iris/ 或自定义）

  // --- 日志 ---
  setLogLevel?(level: LogLevel): void;
  getLogLevel?(): LogLevel;

  // --- 模型能力查询 ---
  fetchAvailableModels?(config: { provider, apiKey, baseUrl? }): Promise<ModelCatalogResult>;
  supportsVision?(modelName?: string): boolean;
  supportsNativePDF?(modelName?: string): boolean;
  supportsNativeOffice?(modelName?: string): boolean;
  isDocumentMimeType?(mimeType: string): boolean;

  // --- Agent 管理 ---
  listAgents?(): AgentDefinition[];
  agentManager?: AgentManagerLike;     // Agent CRUD 操作
  extensionManager?: ExtensionManagerLike; // 扩展安装/启用/禁用/删除
  taskBoard?: unknown;                 // 全局任务板（供 cron 等后台插件注册任务）
  agentName?: string;                  // 当前 Agent 名称

  // --- ToolLoop 工厂 ---
  createToolLoop?(options: { tools, systemPrompt, maxRounds? }): ToolLoopRunnerLike; // 创建 ToolLoop 实例供插件后台执行 LLM+工具循环
}
```

示例：监听 Backend 事件、访问存储层：

```typescript
ctx.onReady((api) => {
  // 监听所有会话完成事件
  api.backend.on('done', (sessionId, durationMs) => {
    console.log(`会话 ${sessionId} 完成，耗时 ${durationMs}ms`);
  });

  // 监听所有 LLM 响应
  api.backend.on('assistant:content', (sessionId, content) => {
    // content 是完整的 Content 对象
  });

  // 读取会话历史
  const history = await api.storage.getHistory('some-session-id');

  // 切换模型
  api.router.setCurrentModel('gpt4o');

  // 动态注册模型
  api.router.registerModel({ modelName: 'local-dev', provider, config });

  // 修改系统提示词
  api.prompt.setSystemPrompt('新的系统提示词');

  // 查询 MCP 状态
  const mcp = api.mcpManager?.getServerInfo();
});
```

通过 `IrisAPI`，插件可以做到任何事情：监听事件、调用方法、读写存储、切换模型、注册新模型、修改提示词、访问 MCP / OCR / Computer Use 运行时对象，也可以继续查看和修改启动扩展注册表。

## Backend 事件参考

`api.backend` 继承自 `EventEmitter`。插件可以通过 `on / off / once` 监听内部事件。

| 事件名 | 参数 | 说明 |
|------|------|------|
| `response` | `(sessionId, text)` | 非流式最终回复 |
| `stream:start` | `(sessionId)` | 流式输出开始 |
| `stream:parts` | `(sessionId, parts)` | 流式结构化 part 增量 |
| `stream:chunk` | `(sessionId, chunk)` | 流式文本块 |
| `stream:end` | `(sessionId, usage?)` | 流式输出结束 |
| `tool:execute` | `(sessionId, handle)` | 单个工具执行开始；后续状态、输出、子工具和结果通过 handle 事件获取 |
| `error` | `(sessionId, error)` | 当前回合出错 |
| `usage` | `(sessionId, usage)` | LLM token 用量 |
| `retry` | `(sessionId, attempt, maxRetries, error)` | LLM 调用重试 |
| `user:token` | `(sessionId, tokenCount)` | 用户输入的估算 token 数 |
| `done` | `(sessionId, durationMs)` | 当前回合结束 |
| `assistant:content` | `(sessionId, content)` | 一轮模型输出完成后的完整结构化内容 |
| `auto-compact` | `(sessionId, summaryText)` | 自动上下文压缩完成 |
| `attachments` | `(sessionId, attachments)` | 工具执行产生的附件 |

其中最常用的是：

- `tool:execute`：观察工具执行进度，并通过 `ToolExecutionHandle` 获取单个工具的状态、输出和结果
- `assistant:content`：拿到最终结构化内容
- `usage` / `user:token`：做统计或计费
- `done` / `error`：做回合级审计

---

## 平台修改：onPlatformsReady

插件可通过 `onPlatformsReady` 回调在平台创建完成后获得平台实例引用，配合 `patchMethod` 修改任意平台的行为。

每个平台的指令体系不同（Telegram 用 commandRouter，QQ/企微用 if/else 链），插件可按需针对具体平台做定制：

```typescript
ctx.onPlatformsReady((platforms, api) => {
  // 为 Telegram 平台添加自定义指令
  const tg = platforms.get('telegram');
  if (tg) {
    api.patchMethod(tg, 'handleCommand', async (original, text, cs) => {
      if (text.startsWith('/stats')) {
        // 使用 Telegram 特有的回复方式
        return true;
      }
      return original(text, cs);
    });
  }

  // 为 QQ 平台添加自定义指令（参数签名不同）
  const qq = platforms.get('qq');
  if (qq) {
    api.patchMethod(qq, 'handleCommand', async (original, text, ck, target) => {
      if (text.trim() === '/stats') {
        return true;
      }
      return original(text, ck, target);
    });
  }
});
```

也可以通过 monkey-patch `backend.chat` 实现跨平台的命令拦截（所有未识别的 / 命令最终都会到达 `backend.chat`）：

```typescript
ctx.onReady((api) => {
  api.patchMethod(api.backend, 'chat', async (original, sessionId, text, images, docs) => {
    if (text.trim() === '/stats') {
      const history = await api.storage.getHistory(sessionId);
      api.backend.emit('response', sessionId, `当前会话共 ${history.length} 条消息`);
      api.backend.emit('done', sessionId, 0);
      return;
    }
    return original(sessionId, text, images, docs);
  });
});
```

---

## monkey-patch：patchMethod / patchPrototype

插件可以直接替换任意对象上的方法。`patchMethod` 返回一个 dispose 函数，调用后恢复原始方法。支持链式叠加：多个插件可以对同一方法依次 patch，形成洋葱式调用链。

```typescript
ctx.onReady((api) => {
  // 替换 Backend.chat 方法
  const dispose = api.patchMethod(api.backend, 'chat', async (original, sessionId, text, images, documents) => {
    console.log(`[my-plugin] chat called: session=${sessionId}`);

    // 完全自定义处理
    if (text.startsWith('!echo ')) {
      api.backend.emit('assistant:text', sessionId, text.slice(6));
      return;
    }

    // 或者调用原始方法
    return original(sessionId, text, images, documents);
  });

  // 如果需要恢复原始方法
  // dispose();
});
```

通过 `patchMethod`，插件可以替换任意内部方法，包括但不限于：

- `backend.chat` — 完全接管对话流程
- `backend.getHistory` — 拦截历史读取
- `backend.addMessage` — 拦截消息写入
- `storage.addMessage` / `storage.getHistory` — 拦截存储层
- `router` 上的任意方法 — 拦截 LLM 调用

---

## 自定义 Web HTTP 路由

在 Web 平台运行时，插件可以注册自定义 HTTP 端点。

现在可以直接在 `onReady()` 中调用 `registerWebRoute`。如果 WebPlatform 尚未创建，插件注册的路由会先进入队列，等 Web 平台绑定完成后自动补注册。也可以在 `onPlatformsReady()` 中调用，它会立即生效。

```typescript
ctx.onReady((api) => {
  if (api.registerWebRoute) {
    // 注册一个 GET 端点
    api.registerWebRoute('GET', '/api/plugin/status', async (req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', plugin: 'my-plugin' }));
    });

    // 注册一个 POST 端点，带路径参数
    api.registerWebRoute('POST', '/api/plugin/action/:actionId', async (req, res, params) => {
      const actionId = params.actionId;
      // 处理请求...
    });
  }
});
```

多 Agent 模式下，Web 平台是共享的，自定义路由也处于同一个全局命名空间。建议插件统一使用唯一前缀，例如：

- `/api/plugins/security-guard/...`
- `/api/plugins/acme-rag/...`

---

## Console Settings Tab 服务（`console:settings-tab`）

Console 相关扩展点不再挂在 `IrisAPI` 根接口上，而是通过 `ServiceRegistry` 暴露。插件如果想向 Console TUI 的 Settings 界面注入自定义配置 Tab，需要等待 `console:settings-tab` 服务并注册。

### 数据契约

`console:settings-tab` 的 payload 仍然是声明式表单 schema。常用字段如下：

| 属性 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `key` | `string` | 是 | 字段唯一标识（tab 内唯一） |
| `label` | `string` | 是 | 显示标签 |
| `type` | `'toggle' \| 'number' \| 'text' \| 'select' \| 'readonly'` | 是 | 字段类型 |
| `options` | `{ label: string; value: string }[]` | 否 | select 类型的可选项 |
| `defaultValue` | `unknown` | 否 | 默认值 |
| `description` | `string` | 否 | 字段说明（显示为独立的提示行） |
| `group` | `string` | 否 | 分组标题（非空时在该字段前插入分组头行） |

Tab 定义的核心字段：

| 属性 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | `string` | 是 | Tab 唯一标识 |
| `label` | `string` | 是 | Tab 显示标签 |
| `icon` | `string` | 否 | Tab 序号图标（如 `'04'`），缺省按内置 tab 数量自动递增 |
| `fields` | `Field[]` | 是 | 表单字段列表 |
| `onLoad` | `() => Promise<Record<string, unknown>>` | 是 | 加载当前值（Settings 打开时调用） |
| `onSave` | `(values) => Promise<{ success; error? }>` | 是 | 保存修改（用户按 S 时调用） |
| `onAction` | `(actionKey, values) => Promise<{ success; ... }>` | 否 | 处理 action 行（如测试按钮） |

### 字段类型与 TUI 交互

| type | 渲染方式 | 键盘交互 |
|------|---------|---------|
| `toggle` | 开启 / 关闭 | 空格或 Enter 切换 |
| `number` | 数值文本 | Enter 进入编辑模式 |
| `text` | 字符串文本 | Enter 进入编辑模式 |
| `select` | 当前选项标签 | Enter 循环切换选项 |
| `readonly` | 灰色文本 | 不可编辑 |
| `action` | 操作按钮 | Enter 执行插件提供的动作 |

这些渲染方式与内置 tab 的字段完全一致。

### 注册时机

在 `onReady` 回调中等待 `console:settings-tab` 服务并注册。由于该服务只在 Console 相关场景下出现，插件应当容忍超时或服务缺席。

```typescript
const CONSOLE_SETTINGS_TAB_SERVICE_ID = 'console:settings-tab';

interface ConsoleSettingsTabServiceLike {
  register(tab: {
    id: string;
    label: string;
    icon?: string;
    fields: Array<{
      key: string;
      label: string;
      type: 'toggle' | 'number' | 'text' | 'select' | 'readonly' | 'action';
      options?: { label: string; value: string }[];
      defaultValue?: unknown;
      description?: string;
      group?: string;
    }>;
    onLoad: () => Promise<Record<string, unknown>>;
    onSave: (values: Record<string, unknown>) => Promise<{ success: boolean; error?: string }>;
  }): { dispose(): void };
}

ctx.onReady((api) => {
  void api.services.waitFor<ConsoleSettingsTabServiceLike>(CONSOLE_SETTINGS_TAB_SERVICE_ID, 5000)
    .then((service) => service.register({
      id: 'my-plugin',
      label: '我的插件',
      fields: [
        { key: 'enabled', label: '启用', type: 'toggle', defaultValue: true },
        { key: 'apiUrl', label: 'API 地址', type: 'text', defaultValue: 'https://example.com' },
      ],
      async onLoad() {
        return loadMyConfig();
      },
      async onSave(values) {
        try {
          await saveMyConfig(values);
          return { success: true };
        } catch (err) {
          return { success: false, error: String(err) };
        }
      },
    }))
    .catch(() => {
      // 当前运行场景不是 Console，或 Console 服务尚未出现
    });
});
```

注册后，Console Settings 界面的左栏导航会自动出现新的 Tab，用户可通过数字键快速切换。

### 说明

- `console:settings-tab` 只在启用了 Console 能力的场景下出现
- 插件应通过 `api.services` 等待/发现该服务，而不是依赖 `IrisAPI` 根上的专用方法
- Tab 的数据流仍与内置 Settings（模型、工具、MCP）完全独立：`onLoad` 负责读取，`onSave` 负责写回

## 插件间通信

### 事件总线

`eventBus` 是一个独立的 EventEmitter，供插件之间发送和接收消息：

```typescript
ctx.onReady((api) => {
  // 插件 A：发射事件
  api.eventBus.fire('my-plugin:data-ready', { key: 'value' });

  // 插件 B：监听事件
  api.eventBus.on('my-plugin:data-ready', (data) => {
    console.log('收到数据:', data);
  });
});
```

### 查询其他插件

```typescript
ctx.onReady((api) => {
  const plugins = api.pluginManager.listPlugins();
  console.log('已加载的插件:', plugins.map(p => p.name));
});
```

### 通过 Backend 发射自定义事件

Backend 继承自 EventEmitter，插件可以直接用它发射和监听自定义事件：

```typescript
ctx.onReady((api) => {
  api.backend.emit('custom:my-event', { foo: 'bar' });
  api.backend.on('custom:my-event', (data) => {
    console.log('自定义事件:', data);
  });
});
```

---

## 钩子调用位置

```
用户发送消息
  │
  ▼
Backend.chat()
  │
  ├─→ [onBeforeChat]            ← 插件可修改 text
  │
  ├─→ buildStoredUserParts()
  ├─→ handleMessage()
  │     ├─→ [onSessionCreate]   ← 新会话时触发
  │     │
  │     ├─→ 记忆召回
  │     ├─→ LLM 调用 + 工具循环
  │     │     │
  │     │     ├─→ [onBeforeLLMCall]   ← 插件可修改完整请求
  │     │     ├─→ LLM 原始调用
  │     │     ├─→ [onAfterLLMCall]    ← 插件可修改原始响应
  │     │     ├─→ [onBeforeToolExec]  ← 插件可拦截/修改参数
  │     │     └─→ [onAfterToolExec]   ← 插件可修改工具结果
  │     │
  │     └─→ 最终响应文本
  │
  ├─→ [onAfterChat]             ← 插件可修改响应
  ├─→ [onSessionClear]          ← clearSession 时触发
  │
  ▼
平台输出
```

---

## 插件加载流程

```
bootstrap()
  │
  ├─→ 解析配置
  ├─→ [PluginManager.prepareAll()]    ← 预加载本地 / npm / 内联插件
  ├─→ [plugin.preBootstrap()]         ← 修改配置 / 注册 Provider / 注册平台
  ├─→ 创建 LLM Router
  ├─→ 创建 Storage / Memory / OCR
  ├─→ 注册内置工具
  ├─→ 连接 MCP
  ├─→ 注册模式
  ├─→ 创建 PromptAssembler
  │
  ├─→ [PluginManager.activateAll()]   ← 插件在这里激活
  │     ├─→ 创建 PluginContext（含 tools/modes/prompt/router）
  │     ├─→ plugin.activate(ctx)
  │     └─→ 收集插件注册的自定义命令
  │
  ├─→ 创建 Backend
  ├─→ 创建事件总线
  ├─→ 注入钩子 + LLM/Tool 拦截器
  │
  ├─→ [PluginManager.notifyReady()]   ← 插件 onReady 回调
  │     └─→ callback(IrisAPI)         ← 完整 API 包含 patchMethod / eventBus
  │
  ▼
  返回 BootstrapResult
      │
      ├─→ 创建平台
      │     ├─→ WebPlatform → 绑定 registerWebRoute，并补注册之前排队的路由
      │     └─→ ...
      │
      ├─→ [PluginManager.notifyPlatformsReady()]  ← 插件 onPlatformsReady 回调
      │     └─→ callback(platformMap, IrisAPI)     ← 可 patchMethod 修改任意平台
      │
      ▼
    平台启动
```

---

## 与 MCP 的关系

| 维度 | MCP | 插件系统 |
|------|-----|---------|
| 扩展范围 | 仅工具 | 工具 + 模式 + 钩子 + 内部 API + 方法替换 + 平台修改 + 路由 |
| 运行方式 | 子进程 / 远程 | 同进程 |
| 协议 | MCP 标准协议 | Iris 内部接口 |
| 权限 | 仅工具调用 | 完整访问所有内部对象，可替换任意方法，可修改平台行为和注册路由 |

两者共存。只加工具用 MCP 就够了。要修改消息流程、拦截工具、操作提示词、监听事件、替换内部行为，用插件。

---

## 完整示例

```typescript
// ~/.iris/extensions/security-guard/index.ts
import { definePlugin, type IrisPlugin } from 'irises-extension-sdk/plugin';

const plugin: IrisPlugin = definePlugin({
  name: 'security-guard',
  version: '2.0.0',
  description: '安全策略插件：审计日志 + 命令拦截 + 响应追踪 + 自定义命令',

  activate(ctx) {
    const logger = ctx.getLogger();

    // 1. 包装 shell 工具：记录所有命令
    ctx.wrapTool('shell', async (original, args, toolName) => {
      logger.info(`[audit] shell: ${args.command}`);
      return original(args);
    });

    // 2. 钩子：拦截危险命令
    ctx.addHook({
      name: 'dangerous-command-blocker',
      onBeforeToolExec({ toolName, args }) {
        if (toolName === 'shell') {
          const cmd = String(args.command);
          if (cmd.includes('rm -rf /')) {
            return { blocked: true, reason: '安全策略：禁止删除根目录' };
          }
        }
        return undefined;
      },
    });

    // 3. 注入安全提示词
    ctx.addSystemPromptPart({
      text: '安全规则：禁止执行任何删除系统文件的命令。',
    });

    // 4. 平台就绪后添加自定义指令
    ctx.onPlatformsReady((platforms, api) => {
      const tg = platforms.get('telegram');
      if (tg) {
        api.patchMethod(tg, 'handleCommand', async (original, text, cs) => {
          if (text.startsWith('/audit')) {
            // 返回审计日志（使用 Telegram 平台特有的回复方式）
            return true;
          }
          return original(text, cs);
        });
      }
    });

    // 5. onReady：高级功能
    ctx.onReady((api) => {
      // 监听 Backend 事件
      api.backend.on('done', (sessionId, durationMs) => {
        logger.info(`[audit] session=${sessionId} duration=${durationMs}ms`);
      });

      // monkey-patch chat 方法：加入自定义逻辑
      api.patchMethod(api.backend, 'chat', async (original, sessionId, text, images, docs) => {
        logger.info(`[audit] chat start: session=${sessionId}`);
        const result = await original(sessionId, text, images, docs);
        logger.info(`[audit] chat end: session=${sessionId}`);
        return result;
      });

      // 注册 Web API 端点
      if (api.registerWebRoute) {
        api.registerWebRoute('GET', '/api/audit/logs', async (_req, res) => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ logs: [] }));
        });
      }

      // 插件间通信
      api.eventBus.fire('security-guard:ready', { version: '2.0.0' });
    });

    logger.info('安全策略插件已激活');
  },
});

export default plugin;
```

---

## 开发插件步骤

1. 在 `~/.iris/extensions/` 或仓库根目录 `./extensions/` 下创建 extension 目录
2. 创建 `package.json`，安装 `irises-extension-sdk`
3. 创建 `manifest.json`
4. 创建插件入口文件，导出一个 `IrisPlugin` 对象
5. 在 `activate()` 中使用 `ctx` 注册功能
6. 可选：通过 `ctx.onPlatformsReady()` 修改平台行为
7. 可选：通过 `ctx.onReady()` 获取 Backend 等内部对象
8. 如需平台对码能力，使用 `irises-extension-sdk/pairing`
9. 构建出可运行产物，例如 `dist/index.mjs`
10. 在 `~/.iris/configs/plugins.yaml` 中添加插件条目
11. 重启 Iris

## npm 包插件

```bash
bun add iris-plugin-rag
```

```yaml
plugins:
  - name: rag
    type: npm
    enabled: true
```

## 注意事项

- `preBootstrap` / `activate` / `onReady` / `onPlatformsReady` 抛出的错误都会被捕获并记录，不会让整个系统直接崩溃
- 插件 handler 抛出的错误会被 ToolLoop 捕获，不会崩溃
- 钩子中抛出的错误会被捕获并记录日志，不会中断流程
- `onBeforeToolExec` 拦截器中抛出的错误不会阻止工具执行
- `onAfterToolExec` / `onBeforeLLMCall` / `onAfterLLMCall` 钩子抛错时也不会中断主流程
- 插件注册的工具名不应与内置工具或 MCP 工具重名，否则会覆盖
- 插件优先级对 `prepareAll`、`preBootstrap`、`activate`、`onReady`、`onPlatformsReady` 与 hook 链都生效；数值越大越先执行
- `wrapTool` 是永久修改，不可撤销
- `patchMethod` 返回 dispose 函数，可以恢复原始方法
- `patchPrototype` 影响类的所有实例，请谨慎使用
- `registerWebRoute` 只在启用了 Web 平台时才会真正生效；如果在 `onReady` 时平台尚未创建，系统会先缓存，等 Web 平台创建后自动补注册
- 多 Agent 模式下，自定义 Web 路由共享同一个路由表，请主动使用唯一前缀，避免冲突
- `onReady` 回调在 `activate()` 之后执行，此时所有插件已加载完成
- `PluginInfo.type` 中的 `inline` 表示运行时注入插件，不是 `plugins.yaml` 中可填写的 `type` 值
- `plugins.yaml` 中 `config` 与插件目录 `config.yaml` 之间是浅合并，不是深合并
- 插件通过 `PluginContext` 和 `IrisAPI` 可以做到任何事情，包括替换内部方法、注册命令、注册路由、发射自定义事件。请确保插件代码可信
- `console:settings-tab` 服务只在启用了 Console 能力的场景中出现；Tab id 不能与内置 section（`general` / `tools` / `mcp`）重名
- Console Settings Tab 的 `onLoad` / `onSave` 抛出的错误会被捕获并在状态栏显示，不会导致界面崩溃
