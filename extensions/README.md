# Extensions

这个目录用于收录 Iris 自带和第三方 extension。

当前阶段的约定如下：

1. `plugin` 与原先的 `channel` 都统一收敛到 extension 概念下。
2. 平台 extension 的运行时入口应指向自包含产物（例如 `dist/index.mjs`），不应依赖 Iris 内部源码路径。
3. 运行时只扫描本地 extension 目录；安装命令会把远程仓库中的 `extensions/<folder>/` 下载到本地。
4. 源码运行时会扫描仓库根目录 `./extensions/`，也会扫描用户目录 `~/.iris/extensions/`。
5. 不再需要维护 `extensions/registry.json`。
6. 发行包内嵌哪些 extension，由 `extensions/embedded.json` 控制。
7. extension 与宿主之间的公共边界，统一通过 `packages/extension-sdk/` 暴露。
8. extension 自己使用的第三方依赖，必须声明在 extension 自己的 `package.json` 中，并安装到 extension 自己目录下的 `node_modules/`。
9. 外部 extension 建议放在独立仓库维护，并保留自己的锁文件；不要再假设会复用宿主仓库根目录的依赖树。
10. 仓库根目录不再通过 `workspaces` 统一 hoist `extensions/*` 的依赖。

## 仓库内示例

- `extensions/lark/`：飞书平台 extension，当前随发行包内嵌。
- `extensions/telegram/`：Telegram 平台 extension，当前随发行包内嵌。
- `extensions/discord/`：Discord 平台 extension，可选安装。
- `extensions/qq/`：QQ 平台 extension，可选安装。
- `extensions/wxwork/`：企业微信平台 extension，可选安装。
- `extensions/weixin/`：微信平台 extension，可选安装。
- 各 extension 的 `manifest.json` 负责声明自己的平台贡献。
- 运行时入口为 `dist/index.mjs`。
- `src/` 只是维护源码，真正加载的是打包后的入口。
- `embedded.json`：声明哪些 extension 需要在发行包构建时预打包并复制进产物。

## embedded.json

`extensions/embedded.json` 是发行包内嵌 extension 的白名单。只有这个文件里列出的 extension，才会在 `script/build.ts` 中被预先打包，并复制进最终产物的 `extensions/` 目录。当前内嵌的是 `lark` 和 `telegram`；`discord`、`qq`、`wxwork` 和 `weixin` 不在白名单内，属于可选 extension。

## SDK 与依赖边界

extension 开发应遵守下面几条：

- 公共类型、`PlatformAdapter`、`splitText`、logger、pairing 等能力，统一从 `@irises/extension-sdk` 获取。
- 不要再直接 import 宿主内部源码，例如：`../../../src/core/backend`、`../../../src/types`、`../../../src/platforms/pairing`。
- extension 使用到的第三方库，必须写到 extension 自己的 `package.json`。
- extension 的锁文件也应放在 extension 自己目录，例如 `extensions/telegram/package-lock.json`。
- 如果 extension 单独放在外部仓库，应在那个仓库里维护 `package-lock.json` / `bun.lock` / `pnpm-lock.yaml`。
- 正式分发给用户安装的 extension，必须已经包含可运行入口，例如 `dist/index.mjs`。
- 只包含 `src/` 源码、缺少可运行入口的包，不属于可直接安装的发行包。

当前仓库内置的 SDK 源码位于：

- `packages/extension-sdk/`

当前仓库可通过 `npm run setup:extensions` 安装全部 extension 的独立依赖。
这个脚本只服务开发和构建，不属于用户安装 extension 时的运行步骤。

仓库测试会检查两件事：

- extension 源码不能直接 import 宿主 `src/**`
- extension 使用到的第三方依赖必须在自己的 `package.json` 中声明

## manifest.json 结构

```json
{
  "name": "demo-extension",
  "version": "0.1.0",
  "description": "示例 extension",
  "author": "someone",
  "entry": "plugin.mjs",
  "plugin": {
    "entry": "plugin.mjs",
    "configFile": "config.yaml"
  },
  "platforms": [
    {
      "name": "demo-platform",
      "entry": "platform.mjs"
    }
  ]
}
```

说明：

- `plugin`：声明一个 Iris 插件入口。
- `platforms`：声明一个或多个平台工厂。这里对应原先 channel 的能力。
- `entry`：顶层简写。仅在 `plugin.entry` 未填写时作为插件入口使用。

## 当前使用方式

### 0. 安装命令

```bash
iris extension install <path>
iris extension install-local <name>

# 简写
iris ext install <path>
iris ext <path>
```

说明：

- `install <path>`：优先从远程仓库的 `extensions/<path>/` 目录安装；仅当远程不存在该目录时，才回退到本地 `./extensions/` 安装。
- `install-local <name>`：只从本地 `./extensions/` 安装，不访问远程仓库。
- `install` 支持这些写法：`aaa`、`group/aaa`、`extensions/aaa`。
- 最终安装目录统一写入 `~/.iris/extensions/<manifest.name>/`。
- 可通过环境变量 `IRIS_EXTENSION_REMOTE_ARCHIVE_URL` 覆盖远程仓库压缩包地址。远程仓库不可用时会直接报错。
- 用户也可以直接打开远程仓库中的 `extensions/<folder>/` 目录，自行下载后放到本地安装。

### 远程目录约定

当前远程安装不依赖 `registry.json`。安装命令会直接把参数映射到远程仓库目录：

- `iris extension install aaa` → `extensions/aaa/`
- `iris extension install community/demo-extension` → `extensions/community/demo-extension/`

默认远程来源是 Iris 仓库 `main` 分支的压缩包，并从中提取对应目录。

### 1. 插件

在 `plugins.yaml` 中按原方式启用：

```yaml
plugins:
  - name: demo-extension
    enabled: true
```

此时会按顺序查找：

1. `~/.iris/extensions/<name>/`
2. `./extensions/<name>/`

### 2. 平台

在 `platform.yaml` 中直接写平台名：

```yaml
type: [console, demo-platform]
```

平台工厂会在启动时自动从 extension manifest 中注册。

## 说明

远程安装以目录结构为准，不再需要单独维护 extension 列表文件。
