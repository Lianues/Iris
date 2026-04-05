/**
 * TypedEventEmitter — 类型安全的事件发射器
 *
 * 继承 Node.js EventEmitter，通过泛型参数约束事件名和参数类型。
 * 使用方式：
 *
 * ```typescript
 * interface MyEvents {
 *   'data': (payload: Buffer) => void;
 *   'error': (err: Error) => void;
 * }
 * class MyEmitter extends TypedEventEmitter<MyEvents> {}
 *
 * const e = new MyEmitter();
 * e.emit('data', Buffer.from('hello'));  // ✅ 类型检查
 * e.emit('data', 123);                   // ❌ 编译报错
 * ```
 */

import { EventEmitter } from 'events';

export type EventMap = { [K: string]: (...args: any[]) => void };

export class TypedEventEmitter<T extends EventMap> extends EventEmitter {
  override emit<K extends keyof T & string>(event: K, ...args: Parameters<T[K]>): boolean {
    return super.emit(event, ...args);
  }

  override on<K extends keyof T & string>(event: K, listener: T[K]): this {
    return super.on(event, listener);
  }

  override once<K extends keyof T & string>(event: K, listener: T[K]): this {
    return super.once(event, listener);
  }

  override off<K extends keyof T & string>(event: K, listener: T[K]): this {
    return super.off(event, listener);
  }
}
