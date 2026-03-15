# 记忆系统

## 职责

可选的长期记忆模块。跨会话持久化用户偏好、事实、笔记等信息。
每次请求自动搜索相关记忆注入系统提示词，同时提供工具让 LLM 自主读写记忆。

## 文件结构

```
src/memory/
├── base.ts              MemoryProvider 抽象基类
├── types.ts             MemoryEntry 类型定义
├── sqlite/index.ts      SQLite + FTS5 实现
├── tools.ts             LLM 记忆工具（search / add / delete）
└── index.ts             导出 + 工厂函数
```

## 基类接口：MemoryProvider

```typescript
abstract class MemoryProvider {
  abstract add(content: string, category?: string): Promise<number>;
  abstract search(query: string, limit?: number): Promise<MemoryEntry[]>;
  abstract list(category?: string, limit?: number): Promise<MemoryEntry[]>;
  abstract delete(id: number): Promise<boolean>;
  abstract clear(): Promise<void>;

  // 可覆写：根据用户输入构建记忆上下文，返回 undefined 表示无相关记忆
  async buildContext(userText: string, limit?: number): Promise<string | undefined>;
}
```

## MemoryEntry 类型

```typescript
interface MemoryEntry {
  id: number;
  content: string;
  category: string;         // user / fact / preference / note
  createdAt: number;         // UNIX 时间戳（秒）
  updatedAt: number;
}
```

## SQLite 实现细节

- 使用 better-sqlite3（同步 API），开启 WAL 模式
- FTS5 全文检索虚拟表，通过触发器自动同步主表变更
- 查询清洗：剥离 FTS5 特殊字符，限制最多 10 个 token，使用 `OR` 连接 + BM25 排序
- 默认数据库路径：`./data/memory.db`

**数据库 Schema：**

```sql
CREATE TABLE memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'note',
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE VIRTUAL TABLE memories_fts USING fts5(content, content=memories, content_rowid=id);
-- 自动同步触发器：INSERT / DELETE / UPDATE
```

## 记忆注入流程

```
用户发送消息
  │
  ▼
Backend.handleMessage()
  │
  ├─→ memory.buildContext(userText)   ← 搜索相关记忆
  │     返回格式化文本（或 undefined）
  │
  ├─→ prompt.assemble(history, toolDecls, undefined, extraParts)
  │     extraParts = [{ text: 记忆上下文 }]
  │     合并到 systemInstruction（不修改共享 systemParts）
  │
  ▼
LLM 收到包含记忆上下文的系统提示词
```

**并发安全**：记忆通过 `extraParts` 参数按请求注入，不修改共享的 `systemParts`，多会话并发时不会泄漏。

## LLM 记忆工具

通过 `createMemoryTools(provider)` 创建三个工具，让 LLM 自主管理记忆：

| 工具名 | 功能 | 必需参数 |
|--------|------|----------|
| `memory_search` | 搜索相关记忆 | `query` |
| `memory_add` | 保存新记忆 | `content`（可选 `category`） |
| `memory_delete` | 删除记忆 | `id` |

## 配置

```yaml
memory:
  enabled: true              # 默认 false
  dbPath: ./data/memory.db   # 默认值
```

## 新增记忆提供商步骤

1. 在 `src/memory/` 下创建新目录，继承 `MemoryProvider`
2. 实现 `add` / `search` / `list` / `delete` / `clear` 五个抽象方法
3. 可选覆写 `buildContext()` 自定义注入格式
4. 在 `src/memory/index.ts` 和 `src/index.ts` 中注册
