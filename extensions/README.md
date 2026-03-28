# Extensions

这个目录用于收录 Iris 自带和第三方 extension。

当前阶段的约定如下：

1. `plugin` 与原先的 `channel` 都统一收敛到 extension 概念下。
2. 平台 extension 的运行时入口应指向自包含产物（例如 `dist/index.mjs`），不应依赖 Iris 内部源码路径，也不应依赖项目根目录 `node_modules`。
3. 运行时只扫描本地 extension 目录；安装命令会把远程仓库中的 `extensions/<folder>/` 下载到本地。
4. 源码运行时会扫描仓库根目录 `./extensions/`，也会扫描用户目录 `~/.iris/extensions/`。
5. 不再需要维护 `extensions/registry.json`。
6. 发行包内嵌哪些 extension，由 `extensions/embedded.json` 控制。

## 仓库内示例

- `extensions/lark/`：飞书平台 extension，当前随发行包内嵌。
- `extensions/discord/`：Discord 平台 extension，可选安装。
- `extensions/qq/`：QQ 平台 extension，可选安装。
- `extensions/wxwork/`：企业微信平台 extension，可选安装。
- `extensions/weixin/`：微信平台 extension，可选安装。
- 各 extension 的 `manifest.json` 负责声明自己的平台贡献。
- 运行时入口为 `dist/index.mjs`。
- `src/` 只是维护源码，真正加载的是打包后的入口。
- `embedded.json`：声明哪些 extension 需要在发行包构建时预打包并复制进产物。

## embedded.json

`extensions/embedded.json` 是发行包内嵌 extension 的白名单。只有这个文件里列出的 extension，才会在 `script/build.ts` 中被预先打包，并复制进最终产物的 `extensions/` 目录。当前内嵌的是 `lark`；`discord`、`qq`、`wxwork` 和 `weixin` 不在白名单内，属于可选 extension。

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
