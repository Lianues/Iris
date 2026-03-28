# 构建与分发

本文档说明 Iris 的双运行时开发模式、编译流程和 npm 分发机制。

## 运行时架构

Iris 的代码按运行时需求分为两部分：

| 部分 | 运行时 | 说明 |
|------|--------|------|
| 后端主体（LLM、存储、工具、MCP、web 与各 extension 平台） | Node.js / Bun 均可 | 纯 TypeScript，无 Bun 专有 API |
| Console 平台（TUI 界面） | 仅 Bun | 依赖 [OpenTUI](https://opentui.com/) 的 Bun FFI 原生绑定 |

后端代码不使用任何 `Bun.` API 或 `bun:` 模块。Console 平台通过动态 `import()` 加载，非 console 模式下不会触及 opentui 依赖。

## 开发

### Node.js 模式（后端开发）

适用于 web、telegram 以及已安装 extension 平台的开发，不需要安装 Bun。

```bash
npm install
npm run setup          # 安装全部依赖（含 Web UI）
npm run dev            # 启动（按当前平台配置自动选择运行时）
```

此模式下 `@opentui/core` 和 `@opentui/react` 作为 `optionalDependencies`，安装失败不影响运行。若配置文件中选择了 console 平台，启动脚本会自动切换到 Bun 运行时；若系统中未安装 Bun，则给出提示。

如果当前是 `web`、`telegram` 或其他 extension 平台，`npm run dev` 仍会继续使用 Node.js + tsx。

### Bun 模式（全功能开发）

包含 Console TUI 在内的所有平台。

```bash
bun install
bun run dev            # 启动（直接使用 Bun 运行时）
```

### npm 脚本一览

| 脚本 | 说明 |
|------|------|
| `npm run dev` | 开发启动；默认走 Node.js，遇到 console 平台时自动切到 Bun |
| `bun run dev` | 开发启动；直接走 Bun 运行时 |
| `npm run cli -- -p "prompt"` | CLI 模式；传入 prompt 执行后退出（Node.js + tsx） |
| `bun src/cli.ts -p "prompt"` | CLI 模式；Bun 运行时 |
| `npm run build` | TypeScript 编译（排除 console 目录） |
| `bun run build:compile` | 编译为独立二进制（见下文） |
| `npm run build:ui` | 构建 Web UI 前端 |
| `npm run test` | 运行测试（Vitest） |

## TypeScript 配置

Console 平台的 JSX 需要 `@opentui/react` 作为 JSX 运行时，而其他代码不依赖它。配置方式如下：

### 根 `tsconfig.json`

```jsonc
{
  "compilerOptions": {
    "jsx": "react-jsx"
    // 不指定 jsxImportSource
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "src/platforms/web/web-ui"]
}
```

### `src/platforms/console/tsconfig.json`

Console 目录有独立的 tsconfig，指定 opentui 的 JSX 运行时：

```jsonc
{
  "extends": "../../../tsconfig.json",
  "compilerOptions": {
    "jsxImportSource": "@opentui/react"
  }
}
```

### `tsconfig.build.json`

Node.js 构建产物排除 console 目录（console 在 Bun 下直接运行 TS 源码，不需要预编译）：

```jsonc
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "allowImportingTsExtensions": false
  },
  "exclude": ["node_modules", "dist", "src/platforms/web/web-ui", "src/platforms/console"]
}
```

### JSX pragma

`src/platforms/console/` 下的每个 `.tsx` 文件首行都有 pragma 注释：

```typescript
/** @jsxImportSource @opentui/react */
```

这使得 Bun 在执行这些文件时使用 opentui 的 JSX 工厂，而不影响项目其他部分。

## 编译为独立二进制

使用 `bun build --compile` 将整个项目编译为单个可执行文件。产物内嵌 Bun 运行时、opentui 原生库和所有依赖，用户无需安装任何运行时。

### 编译入口

编译入口为 `src/main.ts`。该文件是统一入口，根据命令行参数路由到不同模式：

```
iris                       → 启动平台服务（默认）
iris serve                 → 启动平台服务
iris start                 → 启动平台服务（serve 别名）
iris onboard               → 启动交互式配置引导
iris -p "prompt"           → CLI 模式
iris "prompt"              → CLI 模式（位置参数）
iris --help                → 显示帮助
iris --version             → 显示版本
iris --sidecar screen      → 内部：运行 screen sidecar
iris --sidecar browser     → 内部：运行 browser sidecar
```

路由逻辑：`onboard` 单独转到配置引导；`serve` / `start` 进入平台服务模式；存在 `-p`、`--prompt`、`--session`、`--model` 等 CLI 特征参数，或存在其他非 `-` 开头的位置参数时，进入 CLI 模式（`src/cli.ts`）；否则进入平台服务模式（`src/index.ts`）。

`--sidecar` 是内部参数，用户不会直接使用。详见下文「Sidecar 自举」。

### 编译命令

```bash
# 先构建 Web UI 静态资源
npm run build:ui

# 使用 Bun 编译所有平台（CI 使用）
npm run build:compile

# 使用 Bun 仅编译当前平台（本地调试）
npm run build:compile -- --single
```

`build:compile` 的实际打包器仍然是 **Bun**（`bun run script/build.ts` + `Bun.build()`）。在执行 Bun 编译前，脚本会先通过 npm 安装 `react-devtools-core`。这是因为该依赖在当前环境下使用 Bun 安装时，包内容可能不完整，导致 `@opentui/react` 在 `Bun.build()` 阶段解析失败；改为在编译前由 npm 补齐后即可正常打包。

由于 Web 平台需要静态前端资源，编译发布包前还需要先生成 `src/platforms/web/web-ui/dist/`。CI 会显式执行 `npm run build:ui`，本地打包时也应先执行这一步。

### 编译脚本 `script/build.ts`

脚本执行以下步骤：

1. 通过 npm 补齐 `react-devtools-core` 依赖
2. 通过 `bun install --os="*" --cpu="*"` 安装所有平台的 opentui 原生依赖
3. 对每个目标平台调用 **`Bun.build()`** 并指定 `compile` 选项，入口为 `src/main.ts`
4. 为每个平台额外编译 `onboard/src/index.tsx`，生成 `bin/iris-onboard(.exe)`
5. 在 `dist/bin/<平台名>/` 下复制 `data/`、`web-ui/dist/`、LICENSE，并生成平台包 `package.json`

编译时 `chromium-bidi` 和 `electron` 标记为 `external`。这两个是 Playwright 内部的可选依赖（BiDi 协议和 Electron 自动化），Iris 不使用，Playwright 内部有 try/catch 保护，运行时不影响正常的浏览器操作。

支持的目标平台：

| 目标 | 产物路径 |
|------|----------|
| `linux-x64` | `dist/bin/iris-linux-x64/bin/iris` |
| `linux-arm64` | `dist/bin/iris-linux-arm64/bin/iris` |
| `darwin-arm64` | `dist/bin/iris-darwin-arm64/bin/iris` |
| `darwin-x64` | `dist/bin/iris-darwin-x64/bin/iris` |
| `win32-x64` | `dist/bin/iris-windows-x64/bin/iris.exe` |

### 产物结构

```
dist/bin/
├── iris-linux-x64/
│   ├── bin/iris              ← 单文件可执行二进制
│   ├── bin/iris-onboard      ← 交互式配置引导
│   ├── data/                 ← 配置模板和示例文件
│   │   ├── configs.example/  ← 首次运行时复制到 ~/.iris/configs/
│   │   ├── agents.example/   ← 首次运行时复制到 ~/.iris/agents/
│   │   └── agents.yaml.example
│   ├── web-ui/
│   │   └── dist/             ← Web 平台静态资源
│   └── package.json          ← npm 平台包元数据（bin/os/cpu 字段）
├── iris-darwin-arm64/
│   ├── bin/iris
│   ├── bin/iris-onboard
│   ├── data/
│   ├── web-ui/dist/
│   └── package.json
├── iris-windows-x64/
│   ├── bin/iris.exe
│   ├── bin/iris-onboard.exe
│   ├── data/
│   ├── web-ui/dist/
│   └── package.json
└── ...
```

`data/` 目录包含配置模板。二进制通过 `process.execPath` 推导安装根目录，在用户首次运行时将 `data/configs.example/` 复制到 `IRIS_DATA_DIR/configs/`（默认 `~/.iris/configs/`）完成初始化。`web-ui/dist/` 随二进制一起分发，因此 Release 和 npm 安装版都可以直接启用 Web 平台。`iris-onboard` 会读取同一安装目录下的模板，并写入运行时配置目录。

### 平台包 `package.json`

每个平台包的 `package.json` 包含 `bin` 字段，直接安装即可注册 `iris` 命令：

```json
{
  "name": "irises-windows-x64",
  "version": "1.0.0",
  "bin": {
    "iris": "./bin/iris.exe"
  },
  "os": ["win32"],
  "cpu": ["x64"]
}
```

### Sidecar 自举

Computer Use 的屏幕控制（screen sidecar）和浏览器控制（browser sidecar）在开发模式下作为独立的 `.ts` 子进程运行。编译后 `.ts` 源文件不存在，需要一种机制让 sidecar 代码仍能在独立子进程中执行。

解决方案：编译后的二进制通过 `--sidecar` 参数自举运行 sidecar 逻辑。

```
主进程                                  sidecar 子进程
┌──────────────┐                       ┌──────────────────────────┐
│  iris.exe    │  spawn                │  iris.exe --sidecar screen│
│  (main.ts)   │ ───────────────────> │  → import screen-sidecar  │
│              │  stdin/stdout NDJSON  │                           │
│              │ <──────────────────> │                           │
└──────────────┘                       └──────────────────────────┘
```

启动策略（`screen-env.ts` 和 `browser-env.ts` 中的 `resolveSidecarCommand()`）：

| 环境 | 启动命令 |
|------|----------|
| 编译模式（`.ts` 不存在） | `process.execPath --sidecar screen` |
| 开发模式（Bun 运行时） | `bun screen-sidecar.ts` |
| 开发模式（Node.js） | `node --import tsx screen-sidecar.ts` |

判断依据是检查 sidecar `.ts` 源文件是否存在于磁盘上（`fs.existsSync()`）。

### 编译注意事项

以下依赖在编译时需要特殊处理：

| 包 | 问题 | 处理方式 |
|----|------|----------|
| `pdf-parse` | 内含 pdfjs-dist，模块加载时立即执行浏览器代码（`DOMMatrix`） | 改为动态 `await import('pdf-parse')`，仅在解析 PDF 时加载 |
| `dereference-json-schema` | 原通过 `createRequire` + `require()` 加载，Bun 编译器无法追踪 | 改为 ESM `import` |
| `chromium-bidi` | Playwright 内部可选依赖，编译器无法解析 | 标记为 `external` |
| `electron` | Playwright 内部可选依赖，Iris 不使用 | 标记为 `external` |

原则：

- 所有依赖应使用 ESM 静态 `import`，Bun 编译器才能正确追踪并打包
- `createRequire` + `require()` 这种动态加载方式不会被编译器打包
- 体积过大或含原生浏览器代码的包，如果只在特定功能中使用，应改为动态 `import()` 延迟加载
- 编译器无法解析的可选依赖，通过 `external` 跳过

## npm 分发

采用与 esbuild、OpenCode 相同的分发模式：一个包装器包 + 多个平台二进制包。

npm 包名为 **`irises`**，注册的命令为 **`iris`**。

### 包结构

```
irises (包装器包，npm install -g irises)
├── bin/iris                  ← Node.js 启动器脚本
├── data/                     ← 配置模板和示例文件
├── web-ui/dist/              ← Web 平台静态资源（供缓存二进制使用）
├── postinstall.mjs           ← 安装后自动链接平台二进制
└── optionalDependencies:
     ├── irises-linux-x64       ← npm 按当前 os/cpu 只安装匹配的包
     ├── irises-linux-arm64
     ├── irises-darwin-arm64
     ├── irises-darwin-x64
     └── irises-windows-x64
```

### 启动器 `bin/iris`

纯 Node.js 脚本（`#!/usr/bin/env node`），不依赖 Bun。按以下优先级查找二进制：

1. `IRIS_BIN_PATH` 环境变量
2. `bin/.iris` 缓存二进制（postinstall 创建）
3. 遍历 `node_modules` 搜索平台包中的二进制

找到后通过 `child_process.spawnSync()` 执行，透传所有命令行参数和标准 IO。

### postinstall `script/postinstall.mjs`

npm 安装完成后自动执行。根据当前系统的 `os.platform()` 和 `os.arch()` 定位平台包中的主程序与 onboard 二进制，并将其硬链接（或复制）到 `bin/.iris` 与 `bin/.iris-onboard`，使统一入口在 npm 环境下也能支持 `iris start` 和 `iris onboard`。

### 发布流程 `script/publish.ts`

```bash
bun run script/publish.ts              # 发布到 npm（latest 标签）
bun run script/publish.ts --tag preview  # 发布到 preview 标签
```

脚本执行以下步骤：

1. 扫描 `dist/bin/` 收集所有已构建的平台包
2. 生成 `irises` 包装器包（含启动器、postinstall、`data/`、`web-ui/dist/`、`optionalDependencies` 指向各平台包）
3. `npm publish` 所有平台包
4. `npm publish` 包装器包

## 本地安装测试

编译完成后，可直接安装当前平台的包进行测试：

```bash
# 编译当前平台
bun run build:compile -- --single

# 打包并全局安装
cd dist/bin/iris-windows-x64      # 或对应的平台目录
npm pack
npm install -g ./irises-windows-x64-1.0.0.tgz

# 测试
iris --help
iris onboard
iris -p "你好"
iris                              # 启动平台服务
```

卸载：

```bash
npm uninstall -g irises-windows-x64
```

## CI/CD

GitHub Actions 工作流 `.github/workflows/release.yml` 在推送 `v*` 标签时触发：

### 构建阶段

在每个平台的原生 runner 上先执行 `npm run build:ui`，再执行 `bun run build:compile -- --single`：

| 平台 | Runner |
|------|--------|
| linux-x64 | `ubuntu-latest` |
| linux-arm64 | `ubuntu-24.04-arm` |
| darwin-arm64 | `macos-latest` |
| darwin-x64 | `macos-13` |
| windows-x64 | `windows-latest` |

每个 job 上传两类产物：
- GitHub Release 用的 `.tar.gz` / `.zip`（包含 `bin/iris`、`bin/iris-onboard`、`data/`、`web-ui/dist/`）
- npm 发布用的平台包目录（与 Release 使用同一份平台包内容）

### 发布阶段

两个并行 job（均依赖构建阶段完成）：

1. **GitHub Release**：下载所有 `.tar.gz` / `.zip`，创建 Release
2. **npm publish**：下载所有平台包目录，执行 `script/publish.ts`

### 所需 Secrets

| Secret | 用途 |
|--------|------|
| `NPM_TOKEN` | npm 发布令牌（`NODE_AUTH_TOKEN`） |

## 用户安装方式

### npm

```bash
npm install -g irises
iris
```

npm 根据当前系统自动安装对应的平台二进制包。启动器定位二进制并执行，用户无需安装 Bun 或 Node.js 运行时（npm 自带 Node.js）。

### 直接下载

从 [GitHub Release](https://github.com/Lianues/Iris/releases) 下载平台对应的压缩包，解压后可直接运行：

- `bin/iris onboard`：启动交互式配置引导
- `bin/iris start`：启动主程序

### 一键安装脚本

```bash
# Linux / Termux
curl -fsSL https://raw.githubusercontent.com/Lianues/Iris/main/deploy/linux/install.sh | bash
iris
```
