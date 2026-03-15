# 聊天记录存储层

## 职责

按会话（sessionId）存取聊天记录。数据格式为 Gemini Content[] 数组。
存储内容包括用户消息、模型回复、工具调用记录、工具执行结果。

## 文件结构

```
src/storage/
├── base.ts              StorageProvider 抽象基类
├── json-file/index.ts   JSON 文件存储实现
└── sqlite/index.ts      SQLite 存储实现
```

## 基类接口：StorageProvider

```typescript
abstract class StorageProvider {
  abstract getHistory(sessionId: string): Promise<Content[]>;
  abstract addMessage(sessionId: string, content: Content): Promise<void>;
  abstract clearHistory(sessionId: string): Promise<void>;
  abstract updateLastMessage(sessionId: string, updater: (content: Content) => Content): Promise<void>;
  abstract truncateHistory(sessionId: string, keepCount: number): Promise<void>;
  abstract listSessions(): Promise<string[]>;

  // 会话元数据
  abstract getMeta(sessionId: string): Promise<SessionMeta | null>;
  abstract saveMeta(meta: SessionMeta): Promise<void>;
  abstract listSessionMetas(): Promise<SessionMeta[]>;

  get name(): string;   // 提供商名称

  // 统一 Content 字段顺序：role → parts → usageMetadata → durationMs → streamOutputDurationMs → modelName → 其余
  // 保留可能附加的未知字段
  protected normalize(content: Content): Content;
}
```

### SessionMeta

```typescript
interface SessionMeta {
  id: string;
  title: string;       // 默认取用户首条消息前 100 字
  cwd: string;         // 对话所在的工作目录
  createdAt: string;   // ISO 8601
  updatedAt: string;   // ISO 8601
}
```

## 实现对比

| 特性 | JSON 文件 | SQLite |
|------|-----------|--------|
| 存储路径 | `./data/sessions/` 每会话一个 `.json` 文件 | `./data/iris.db` 单文件 |
| 并发控制 | per-session 写锁（Promise 链串行化） | WAL 模式，天然支持 |
| 可读性 | 可直接阅读/编辑 JSON 文件 | 需要 SQLite 工具 |
| 性能 | 小规模适用 | 大量会话更优 |
| sessionId 安全 | 正则过滤非法字符防路径穿越 | 参数化查询，无注入风险 |

## 存储的数据结构

每个 session 存储为一个 `Content[]` 数组：

```json
[
  { "role": "user",  "parts": [{ "text": "你好" }] },
  { "role": "model", "parts": [{ "text": "你好！有什么可以帮你的？" }] },
  { "role": "model", "parts": [{ "functionCall": { "name": "read_file", "args": { "path": "src/index.ts" } } }] },
  { "role": "user",  "parts": [{ "functionResponse": { "name": "read_file", "response": { "content": "..." } } }] },
  { "role": "model", "parts": [{ "text": "这是文件的内容..." }] }
]
```

## 新增存储实现步骤

1. 创建 `src/storage/实现名/index.ts`
2. 继承 `StorageProvider`
3. 实现抽象方法，在 `addMessage` 中调用 `this.normalize(content)` 统一字段顺序
4. 在 `src/config/types.ts` 和 `src/index.ts` 中注册
