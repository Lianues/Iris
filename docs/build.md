# 构建与分发

本文档说明 Iris 的双运行时开发模式、编译流程和 npm 分发机制。

## 运行时架构

Iris 的代码按运行时需求分为两部分：

| 部分 | 运行时 | 说明 |
|------|--------|------|
| 后端主体（LLM、存储、工具、MCP、web/discord/telegram/wxwork 平台） | Node.js / Bun 均可 | 纯 TypeScript，无 Bun 专有 API |
| Console 平台（TUI 界面） | 仅 Bun | 依赖 [OpenTUI](https://opentui.com/) 的 Bun FFI 原生绑定 |

后端代码不使用任何 `Bun.` API 或 `bun:` 模块。Console 平台通过动态 `import()` 加载，非 console 模式下不会触及 opentui 依赖。

## 开发

### Node.js 模式（后端开发）

适用于 web、discord、telegram、wxwork 等平台的开发，不需要安装 Bun。

```bash
npm install
npm run setup          # 安装全部依赖（含 Web UI）
npm run dev            # 启动（按当前平台配置自动选择运行时）
```

此模式下 `@opentui/core` 和 `@opentui/react` 作为 `optionalDependencies`，安装失败不影响运行。若配置文件中选择了 console 平台，启动脚本会自动切换到 Bun 运行时；若系统中未安装 Bun，则给出提示。

如果当前是 `web`、`discord`、`telegram`、`wxwork` 等平台，`npm run dev` 仍会继续使用 Node.js + tsx。

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

### 编译命令

```bash
# 编译所有平台（CI 使用）
bun run build:compile

# 仅编译当前平台（本地调试）
bun run build:compile -- --single
```

### 编译脚本 `script/build.ts`

脚本执行以下步骤：

1. 通过 `bun install --os="*" --cpu="*"` 安装所有平台的 opentui 原生依赖
2. 对每个目标平台调用 `Bun.build()` 并指定 `compile` 选项
3. 在 `dist/bin/<平台名>/` 下生成二进制和平台包 `package.json`

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
│   └── package.json          ← npm 平台包元数据（os/cpu 字段）
├── iris-darwin-arm64/
│   ├── bin/iris
│   └── package.json
├── iris-windows-x64/
│   ├── bin/iris.exe
│   └── package.json
└── ...
```

## npm 分发

采用与 esbuild、OpenCode 相同的分发模式：一个包装器包 + 多个平台二进制包。

### 包结构

```
iris-ai (包装器包，npm install -g iris-ai)
├── bin/iris                  ← Node.js 启动器脚本
├── postinstall.mjs           ← 安装后自动链接平台二进制
└── optionalDependencies:
     ├── iris-linux-x64       ← npm 按当前 os/cpu 只安装匹配的包
     ├── iris-linux-arm64
     ├── iris-darwin-arm64
     ├── iris-darwin-x64
     └── iris-windows-x64
```

### 启动器 `bin/iris`

纯 Node.js 脚本（`#!/usr/bin/env node`），不依赖 Bun。按以下优先级查找二进制：

1. `IRIS_BIN_PATH` 环境变量
2. `bin/.iris` 硬链接（postinstall 创建）
3. 遍历 `node_modules` 搜索平台包中的二进制

找到后通过 `child_process.spawnSync()` 执行，透传所有命令行参数和标准 IO。

### postinstall `script/postinstall.mjs`

npm 安装完成后自动执行。根据当前系统的 `os.platform()` 和 `os.arch()` 定位平台包中的二进制文件，将其硬链接（或复制）到 `bin/.iris`，使启动器可以直接调用。

### 发布流程 `script/publish.ts`

```bash
bun run script/publish.ts              # 发布到 npm（latest 标签）
bun run script/publish.ts --tag preview  # 发布到 preview 标签
```

脚本执行以下步骤：

1. 扫描 `dist/bin/` 收集所有已构建的平台包
2. 生成 `iris-ai` 包装器包（含启动器、postinstall、`optionalDependencies` 指向各平台包）
3. `npm publish` 所有平台包
4. `npm publish` 包装器包

## CI/CD

GitHub Actions 工作流 `.github/workflows/release.yml` 在推送 `v*` 标签时触发：

### 构建阶段

在每个平台的原生 runner 上执行 `bun run build:compile -- --single`：

| 平台 | Runner |
|------|--------|
| linux-x64 | `ubuntu-latest` |
| linux-arm64 | `ubuntu-24.04-arm` |
| darwin-arm64 | `macos-latest` |
| darwin-x64 | `macos-13` |
| windows-x64 | `windows-latest` |

每个 job 上传两类产物：
- GitHub Release 用的 `.tar.gz` / `.zip`
- npm 发布用的平台包目录

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
npm install -g iris-ai
iris start
```

npm 根据当前系统自动安装对应的平台二进制包。启动器定位二进制并执行，用户无需安装 Bun 或 Node.js 运行时（npm 自带 Node.js）。

### 直接下载

从 [GitHub Release](https://github.com/Lianues/Iris/releases) 下载平台对应的压缩包，解压后直接执行 `bin/iris`（或 `bin/iris.exe`）。单文件，无外部依赖。

### 一键安装脚本

```bash
# Linux / macOS
curl -fsSL https://raw.githubusercontent.com/Lianues/Iris/main/deploy/linux/install.sh | bash
iris start
```
