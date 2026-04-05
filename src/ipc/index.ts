/**
 * IPC 模块公共入口
 *
 * 提供跨进程通信能力，允许外部进程连接已运行的 IrisCore。
 */

export { IPCServer, readLockFile } from './server';
export type { IPCServerOptions } from './server';
export { IPCClient } from './client';
export type { IPCClientOptions } from './client';
export { RemoteBackendHandle } from './remote-backend-handle';
export { RemoteToolHandle } from './remote-tool-handle';
export { createRemoteApiProxy } from './remote-api-proxy';
export * from './protocol';
export { encodeFrame, FrameDecoder } from './framing';
