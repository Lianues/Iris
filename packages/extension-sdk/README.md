# @irises/extension-sdk

Iris extension / plugin 公共 SDK。

目标：

1. 给平台 extension 和插件提供稳定的公共接口。
2. 避免 extension / plugin 直接 import 宿主仓库内部的 `src/**`。
3. 让 extension / plugin 可以在独立仓库中维护自己的 `package.json`、锁文件和第三方依赖。
4. 作为独立 npm 包发布，供外部 extension / plugin 仓库以版本依赖方式使用。

## 安装

```bash
npm install @irises/extension-sdk
```

外部 extension / plugin 仓库中，建议使用正常版本依赖，例如：

```json
{
  "dependencies": {
    "@irises/extension-sdk": "^0.1.0"
  }
}
```

当前 Iris 仓库内部的 extension，为了本地联调方便，仍可使用本地路径或独立安装脚本；但对外发布时，应以 npm 版本依赖为准。

## 当前导出内容

### 平台 extension API

- extension manifest 类型
- 平台工厂上下文类型
- Backend 公共接口类型
- `PlatformAdapter`
- `splitText`
- `createExtensionLogger`
- `definePlatformFactory`
- `pairing` 公共模块

### 插件 API

- `IrisPlugin`
- `PluginContext`
- `PreBootstrapContext`
- `IrisAPI`
- `PluginHook`
- `PluginLogger`
- `createPluginLogger`
- `definePlugin`
- `ToolDefinition`
- `ModeDefinition`
- `Part` / `Content` / `LLMRequest`

## 建议用法

```ts
import {
  PlatformAdapter,
  createExtensionLogger,
  definePlatformFactory,
  type IrisBackendLike,
  type IrisPlatformFactoryContextLike,
  type ToolAttachment,
} from '@irises/extension-sdk';

import {
  definePlugin,
  createPluginLogger,
  type IrisPlugin,
  type PluginContext,
  type PreBootstrapContext,
} from '@irises/extension-sdk/plugin';

import { PairingGuard, PairingStore, type PairingConfig } from '@irises/extension-sdk/pairing';
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
