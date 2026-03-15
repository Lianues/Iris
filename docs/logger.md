# 日志模块

## 职责

提供带模块标签的统一日志输出，替代散落的 `console.log`。全局控制日志级别。

## 文件结构

```
src/logger/
├── index.ts            Logger 类 + createLogger 工厂函数
└── request-logger.ts   LLM 请求日志记录（logRequests 启用时写入文件）
```

## 用法

```typescript
import { createLogger } from '../logger';
const logger = createLogger('MyModule');

logger.debug('调试信息');     // [MyModule] 调试信息
logger.info('已启动');        // [MyModule] 已启动
logger.warn('注意', detail);  // [MyModule] 注意 ...
logger.error('出错', err);    // [MyModule] 出错 ...
```

## 日志级别

```typescript
enum LogLevel {
  DEBUG  = 0,   // 所有日志
  INFO   = 1,   // 默认
  WARN   = 2,
  ERROR  = 3,
  SILENT = 4,   // 静默
}
```

全局日志级别通过 `setGlobalLogLevel(level)` / `getGlobalLogLevel()` 控制，所有 logger 实例共享同一级别。
