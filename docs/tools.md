# 工具注册层

## 职责

管理 LLM 可调用的工具。提供注册、执行、查询接口。

## 文件结构

```
src/tools/
├── registry.ts          ToolRegistry 工具注册中心
├── state.ts             ToolStateManager 工具状态跟踪
├── scheduler.ts         工具调度（并行/串行）
├── utils.ts             公共工具函数（路径安全校验等）
└── internal/
    ├── read_file.ts     读取文件内容（带行号）
    ├── write_file.ts    写入文件内容
    ├── search_in_files.ts 在文件中搜索/替换（支持正则）
    ├── find_files.ts    基于 glob 模式查找文件
    ├── list_files.ts    列出目录中的文件
    ├── apply_diff/      应用 unified diff 补丁
    │   ├── index.ts
    │   └── unified_diff.ts
    ├── insert_code.ts   在指定位置插入代码
    ├── delete_code.ts   删除指定行范围的代码
    ├── create_directory.ts 创建目录
    ├── delete_file.ts   删除文件
    ├── shell.ts         执行 Shell 命令
    └── sub-agent/
        ├── index.ts     子 Agent 委派工具（工厂函数）
        └── types.ts     SubAgentTypeRegistry / SubAgentTypeConfig
```

## ToolRegistry 接口

```typescript
class ToolRegistry {
  register(tool: ToolDefinition): void;
  registerAll(tools: ToolDefinition[]): void;
  unregister(name: string): boolean;
  get(name: string): ToolDefinition | undefined;
  execute(name: string, args: Record<string, unknown>): Promise<unknown>;
  getDeclarations(): FunctionDeclaration[];   // 获取所有声明（供 LLM）
  listTools(): string[];
  size: number;

  // 子集/过滤
  createSubset(names: string[]): ToolRegistry;     // 仅包含指定工具的子注册表
  createFiltered(excludeNames: string[]): ToolRegistry; // 排除指定工具的子注册表
}
```

## ToolDefinition 格式

```typescript
interface ToolDefinition {
  declaration: FunctionDeclaration;  // 工具声明（供 LLM 识别）
  handler: ToolHandler;              // 执行器函数
}

interface FunctionDeclaration {
  name: string;
  description: string;
  parameters?: {
    type: 'object';
    properties: Record<string, ParameterSchema>;
    required?: string[];
  };
}

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;
```

## 内置工具

| 工具名 | 文件 | 功能 |
|--------|------|------|
| `read_file` | `read_file.ts` | 读取文本文件，返回带行号内容，支持指定行范围 |
| `write_file` | `write_file.ts` | 写入文件内容 |
| `search_in_files` | `search_in_files.ts` | 在目录或文件中搜索/替换内容，支持正则表达式 |
| `find_files` | `find_files.ts` | 基于 glob 模式查找文件 |
| `list_files` | `list_files.ts` | 列出目录中的文件 |
| `apply_diff` | `apply_diff/index.ts` | 应用 unified diff 补丁，支持多 hunk |
| `insert_code` | `insert_code.ts` | 在指定位置插入代码 |
| `delete_code` | `delete_code.ts` | 删除指定行范围的代码 |
| `create_directory` | `create_directory.ts` | 创建目录 |
| `delete_file` | `delete_file.ts` | 删除文件 |
| `shell` | `shell.ts` | 执行 Shell 命令，支持超时和工作目录 |
| `memory_search` | 由 `memory/tools.ts` 动态创建 | 搜索长期记忆 |
| `memory_add` | 同上 | 保存记忆 |
| `memory_delete` | 同上 | 删除记忆 |
| `sub_agent` | `sub-agent/index.ts`（工厂函数动态创建） | 委派子任务给独立子代理 |
| `mcp__*` | 由 `MCPManager` 动态创建 | MCP 外部服务器提供的工具 |

## sub_agent 工具

`sub_agent` 工具由 `createSubAgentTool()` 工厂函数创建，允许 LLM 将子任务委派给独立子代理。

**参数：**
- `prompt`（必填）：子任务描述
- `type`（可选）：Agent 类型名，默认 `general-purpose`

**行为：**
- 创建独立编排循环（无持久化、无流式、独立历史）
- 子代理可按类型固定 `modelName`，或跟随当前活动模型
- 深度限制由 `maxAgentDepth` 配置控制（默认 3），子代理的工具列表默认排除 `sub_agent` 工具防止递归
- 工具过滤：白名单模式（`allowedTools`）或黑名单模式（`excludedTools`）

详见 [core.md](./core.md) 中的子代理系统说明。

## MCP 工具

MCP（Model Context Protocol）服务器提供的工具由 `MCPManager` 自动转换为 `ToolDefinition` 并注册到 `ToolRegistry`。

**命名规则：** `mcp__<服务器名>__<工具名>`（非 `[a-zA-Z0-9_]` 字符替换为下划线）

**转换逻辑：** MCP 的 JSON Schema `inputSchema` 递归转换为 Iris `ParameterSchema`，保留 type、description、enum、items、properties、required 字段。

**生命周期：**
- 启动时后台异步连接，不阻塞应用启动
- 热重载时先完成新连接再卸载旧工具，确保 reload 失败不丢失已有工具
- 通过 `tools.unregister()` 移除旧工具，`tools.registerAll()` 注册新工具

详见 [config.md](./config.md) 中的 MCP 配置说明。

## 路径安全

内置的文件操作工具共用 `resolveProjectPath()` 函数（`src/tools/utils.ts`）进行路径校验，防止路径穿越攻击：

```typescript
// 解析路径并校验是否在项目目录内
function resolveProjectPath(inputPath: string): string;
```

## 新增工具步骤

1. 创建 `src/tools/internal/工具名.ts`
2. 导出 `ToolDefinition` 对象
3. 在 `src/index.ts` 中 import 并调用 `tools.register()` 或 `tools.registerAll()`

## 注意事项

- `handler` 必须是 async 函数
- `handler` 抛出的错误会被 ToolLoop 捕获，转为错误消息回传给 LLM
- 工具的返回值会被包装为 `{ result: 返回值 }` 放入 functionResponse.response
