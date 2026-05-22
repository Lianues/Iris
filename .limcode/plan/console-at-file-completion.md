# Console `@` 文件路径补全落地计划

## 目标

在 Console 底部输入框中支持 `@` 文件路径补全：

- 用户在输入框里输入行首或空白后的 `@query` 时，显示当前仓库文件候选。
- 候选支持模糊匹配文件名和相对路径。
- 上下箭头切换候选，Tab 将 `@query` 替换为相对路径，例如 `src/index.ts`。
- Esc 关闭候选浮层，不清空输入。
- 远程连接模式下第一版禁用该功能。

## 已确认决策

- 实现位置改 Console 内嵌 extension 源码，不做外部 extension。
- 搜索根目录使用当前 session cwd，补全结果相对该 cwd。
- 远程连接时禁用 `@` 文件补全。
- 触发规则只接受行首或空白后的 `@query`，避免邮箱等普通文本误触发。
- 路径按 POSIX 风格插入，不自动加引号。
- 候选排序先做稳定、低成本规则：文件名匹配优先，其次路径匹配；不读取 mtime。
- 文件补全维护自己的忽略列表，不复用 `DEFAULT_IGNORED_DIRS`。忽略 `.git`、`node_modules`、`dist`、`build`、`.next`、`.turbo` 等重目录，但不忽略 `.limcode`。

## 当前仓库依据

- 输入框主逻辑在 `extensions/console/src/components/InputBar.tsx`。
- 文本值和光标状态在 `extensions/console/src/hooks/use-text-input.ts`。
- 现有 `/` 命令候选浮层、`selectedIndex`、上下键、Tab、Esc 逻辑已集中在 `InputBar.tsx`。
- Console 现有公开扩展点在 `extensions/console/src/service-contracts.ts`，没有输入补全 provider。
- Backend 已有 per-session cwd：`src/core/backend/session-context.ts` 和 `Backend.getCwd()`。
- 现有 `DEFAULT_IGNORED_DIRS` 在 `packages/extension-sdk/src/tool-utils.ts`，其中包含 `.limcode`，本功能不应直接复用。

## 非目标

- 第一版不设计公共 extension API。
- 第一版不支持远程文件补全。
- 第一版不解析 `.gitignore`。
- 第一版不基于最近编辑时间排序。
- 第一版不把 `@path` 自动转成 `/file path` 附件命令。

## 实施记录（2026-05-22）

- 阶段 1 已完成并提交：`c72eb09 feat(console): add file mention completion core`。
- 阶段 2 已完成并提交：`28caa3b feat(console): support undoable text range replacement`。
- 阶段 3 和阶段 4 已作为一个集成提交完成：`6a18470 feat(console): add at-file completion UI`。这两阶段在 `InputBar` prop、hook 和 UI 交互上互相依赖，合并提交避免留下中间不可编译状态。
- cwd 变化后的候选刷新修正已提交：`beb1b0a fix(console): refresh file mention candidates per cwd`。
- 已新增源码结构回归测试，覆盖 `InputBar` 不直接 import `fs` / `path`、远程模式不传入文件补全回调、文件候选 Tab 使用 `replaceRange`。
- 已用真实当前仓库 cwd 做 smoke check：`@console-at` 的候选包含 `.limcode/plan/console-at-file-completion.md`。
- 未在本非交互式执行环境启动完整 Console TUI；本地交互项用纯逻辑单测、源码结构回归测试和当前 cwd smoke check 替代验证。

### 最终验证结果

```bash
npx vitest run tests/console-file-mention-completion.test.ts tests/text-input-undo.test.ts tests/console-slash-panel-layout.test.ts
```

结果：通过，3 个测试文件、22 个测试用例全部通过。

```bash
npm run build:extensions
```

结果：命令整体失败，原因是既有 `computer-use` extension 的 Bun 构建无法解析 `irises-extension-sdk`（提示 `Could not resolve: "irises-extension-sdk". Maybe you need to "bun install"?`）。同一轮构建中本次修改涉及的 `console` extension 已成功 bundle，并通过 `validate-extension-bundle` runtime import 校验。

```bash
npm --prefix extensions/console run build
```

结果：通过，Console extension bundle 成功，并通过 `validate-extension-bundle` runtime import 校验。

## 阶段 1：补全核心逻辑和文件枚举

### 实现

- 新增 `extensions/console/src/file-mention-completion.ts`，放纯函数和类型：
  - 识别当前光标前最近的 `@query` token。
  - 判断 token 是否满足行首或空白前缀触发。
  - 将匹配项按文件名优先、路径其次排序。
  - 限制返回数量，保证 UI 不被大量候选拖慢。
- 新增 `extensions/console/src/file-mention-files.ts`，放本地文件枚举逻辑：
  - 从传入 root cwd 递归列出文件。
  - 使用本功能自己的忽略目录列表。
  - 输出 POSIX 风格相对路径。
  - 不忽略 `.limcode`。
  - 对读取失败目录跳过，不让补全功能影响输入框。
- 文件枚举 API 保持同步或轻量异步均可，但调用方要能做缓存和 stale 结果保护。

### 测试

- 新增 Vitest 单测覆盖 token 检测：
  - `@foo` 在行首触发。
  - `see @foo` 在空白后触发。
  - `a@b.com` 不触发。
  - 光标不在 token 末尾时按当前光标前内容识别。
- 新增 Vitest 单测覆盖匹配排序：
  - 文件名命中排在仅路径命中前。
  - 返回结果是 POSIX 相对路径。
- 新增 Vitest 单测覆盖忽略列表：
  - 跳过 `node_modules`、`.git`、`dist` 等目录。
  - 保留 `.limcode/plan/*.md`。

### 验证命令

```bash
npx vitest run tests/console-file-mention-completion.test.ts
```

### Commit

```bash
git add extensions/console/src/file-mention-completion.ts extensions/console/src/file-mention-files.ts tests/console-file-mention-completion.test.ts
git commit -m "feat(console): add file mention completion core"
```

## 阶段 2：文本替换能力

### 实现

- 扩展 `extensions/console/src/hooks/use-text-input.ts`：
  - 新增 `replaceRange(start, end, text)` action。
  - 替换操作必须进入 undo history。
  - 替换后 cursor 放在插入文本末尾。
- 不用 `setValue` 做 Tab 补全替换，因为 `setValue` 会重置历史，Ctrl+Z 无法恢复补全前输入。
- 如终端侧共享 hook 有相同维护要求，再同步补充 `terminal/src/shared/hooks/use-text-input.ts`，保持测试中两个实现一致。

### 测试

- 扩展 `tests/text-input-undo.test.ts`：
  - `replaceRange` 可把 `see @inp` 替换为 `see src/input.ts`。
  - Ctrl+Z 能撤回到替换前文本和光标。
  - Ctrl+Y 能恢复替换结果。
- 如果同步了 terminal shared hook，两个实现都要覆盖。

### 验证命令

```bash
npx vitest run tests/text-input-undo.test.ts
```

### Commit

```bash
git add extensions/console/src/hooks/use-text-input.ts terminal/src/shared/hooks/use-text-input.ts tests/text-input-undo.test.ts
git commit -m "feat(console): support undoable text range replacement"
```

如果没有修改 terminal shared hook，提交命令中不要包含该文件。

## 阶段 3：Console 数据通道

### 实现

- 在 `ConsolePlatform` 中新增本地文件候选枚举方法：
  - 根目录取 `backend.getCwd?.()`，兜底为 `process.cwd()`。
  - 远程连接时返回空列表或不提供回调。
  - 可以缓存文件列表，避免每个按键都全量扫描。
- 在 `AppProps`、`App.tsx`、`BottomPanel.tsx`、`InputBar.tsx` 之间传入文件补全回调。
- 回调只暴露 Console 输入框需要的数据，不把 Backend 或文件系统细节塞进 `InputBar`。

### 测试

- 新增轻量单测或源码结构回归测试：
  - `InputBar` 通过 prop 获取候选，不直接 import `fs` 或 `path` 扫描仓库。
  - 远程模式不会启用文件补全回调。
- 手动验证：
  - 本地 Console 中输入 `@console-at` 能看到 `.limcode/plan/console-at-file-completion.md`。
  - 连接远程后输入 `@` 不显示文件候选。

### 验证命令

```bash
npx vitest run tests/console-file-mention-completion.test.ts
```

### Commit

```bash
git add extensions/console/src/app-props.ts extensions/console/src/App.tsx extensions/console/src/components/BottomPanel.tsx extensions/console/src/components/InputBar.tsx extensions/console/src/index.ts tests/console-file-mention-completion.test.ts
git commit -m "feat(console): wire file mention candidates into input"
```

## 阶段 4：InputBar UI 和键盘交互

### 实现

- 在 `InputBar.tsx` 中接入 `use-file-mention-completion` 或等价 hook：
  - 根据 `inputState.value` 和 `inputState.cursor` 计算 active token。
  - token 激活后获取和筛选候选。
  - 文件候选打开时，上下箭头只移动文件候选。
  - 文件候选打开时，Tab 调用 `replaceRange` 替换 `@query`。
  - Esc 关闭文件候选但保留输入。
- 新增 `extensions/console/src/hooks/use-file-mention-completion.ts` 时，只放 React 状态和缓存逻辑；纯匹配逻辑仍放在阶段 1 的纯函数文件。
- 复用现有 slash panel 的视觉样式和窗口裁剪逻辑；如果 JSX 重复明显，再抽一个小型内部候选面板组件。
- 文件候选和 slash 命令候选不能同时控制同一个 `selectedIndex`。优先使用独立 state，避免两个面板互相污染。
- 当 `/` 命令候选处于激活状态时，保持现有 `/` 行为优先；普通文本中的 `@` 才走文件补全。

### 测试

- 扩展或新增源码结构回归测试：
  - 文件候选浮层仍是 absolute overlay，不撑高 BottomPanel。
  - Tab 使用 `replaceRange`，不使用 `setValue` 替换 `@query`。
- 手动验证：
  - 输入 `@Inp`，上下箭头切换候选，Tab 插入路径。
  - 输入 `hello @plan`，Tab 只替换 `@plan`，保留 `hello `。
  - 输入 `a@b.com` 不弹出候选。
  - Esc 关闭候选后输入内容不变。
  - Ctrl+Z 可撤销 Tab 补全。

### 验证命令

```bash
npx vitest run tests/console-slash-panel-layout.test.ts tests/text-input-undo.test.ts tests/console-file-mention-completion.test.ts
```

### Commit

```bash
git add extensions/console/src/components/InputBar.tsx extensions/console/src/hooks/use-file-mention-completion.ts tests/console-slash-panel-layout.test.ts tests/text-input-undo.test.ts tests/console-file-mention-completion.test.ts
git commit -m "feat(console): add at-file completion UI"
```

如果没有新增 hook 或没有修改某个测试文件，提交命令中不要包含对应文件。

## 阶段 5：集成验证和收口

### 实现

- 复查命名、职责边界和注释：
  - `InputBar` 不承担文件系统遍历。
  - 纯匹配逻辑不依赖 React。
  - 文件枚举忽略列表属于本功能，不与工具搜索默认忽略列表耦合。
- 根据实际实现更新本计划的完成状态和验证结果。

### 测试

- 跑 Console 相关单测。
- 跑仓库现有测试中低成本、相关的集合。
- 手动启动 Console 验证本地交互。

### 验证命令

```bash
npx vitest run tests/console-file-mention-completion.test.ts tests/text-input-undo.test.ts tests/console-slash-panel-layout.test.ts
npm run build:extensions
```

如果 `npm run build:extensions` 因环境或依赖问题失败，需要记录失败原因和已完成的替代验证。

### Commit

```bash
git add .limcode/plan/console-at-file-completion.md
git commit -m "docs(console): record file mention completion plan"
```

如果阶段 5 只有验证没有代码变更，可以只提交计划状态更新。
