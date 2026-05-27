/**
 * Backend 模块公共入口
 *
 * 外部通过 `import { Backend } from '../core/backend'` 引用，
 * Node/TS 会自动解析到此 index.ts，保持向后兼容。
 */

export { MessageQueue } from '../message-queue';
export type { QueuedMessage, QueuePriority } from '../message-queue';
export { TurnLock } from '../turn-lock';
export { Backend } from './backend';

export type {
  UndoScope,
  UndoOperationResult,
  RedoOperationResult,
  ImageInput,
  DocumentInput,
  BackendConfig,
  BackendEvents,
  RewindCheckpoint,
  RewindTargetMode,
  RewindOperationResult,
} from './types';
