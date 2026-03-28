# Iris Onboard

交互式配置引导工具，使用 [OpenTUI](https://opentui.com/) + React 构建 TUI 界面。

## 开发

```bash
# 安装依赖（需要 Bun）
bun install

# 开发运行
bun run dev

# 或指定 Iris 目录
bun run src/index.tsx /path/to/iris
```

## 构建

编译成独立二进制（不需要 Bun/Node.js 运行时）：

```bash
# 构建所有平台
bun run build

# 仅构建 Linux x64
bun run build:linux-x64

# 仅构建 Linux ARM64
bun run build:linux-arm64

# 仅构建 Windows x64
bun run build:windows-x64
```

产物在 `dist/` 目录：
- `iris-onboard-linux-x64`
- `iris-onboard-linux-arm64`
- `iris-onboard-darwin-arm64`
- `iris-onboard-darwin-x64`
- `iris-onboard-windows-x64`

## 用法

```bash
# 安装后通过 iris 命令调用
iris onboard

# 或直接运行二进制
./iris-onboard /path/to/iris
```

Onboard 会从传入的安装目录读取 `data/configs.example/`，并将配置写入 `IRIS_DATA_DIR/configs`；未设置 `IRIS_DATA_DIR` 时，默认写入 `~/.iris/configs`。

## 交互流程

1. **欢迎页** — 介绍 Iris 和配置流程
2. **选择 LLM 提供商** — Gemini / OpenAI / Claude
3. **输入 API Key** — 带遮罩的密码输入
4. **模型配置** — 模型别名、模型 ID、Base URL（提供默认值）
5. **选择平台** — Console (TUI) / Web (HTTP+GUI) / Telegram / 企业微信 / 飞书 / QQ (NapCat)
6. **确认写入** — 预览配置并写入 `IRIS_DATA_DIR/configs/*.yaml`

发行包默认附带 `extensions/lark/`，因此飞书平台可以直接在引导流程中启用。
