/**
 * iris attach —— 跨进程连接已运行的 IrisCore
 *
 * 用法：
 *   iris attach                   → 连接默认 agent（master）
 *   iris attach --agent my-agent  → 连接指定 agent
 *   iris attach --cwd /project    → 连接并设置工作目录
 *
 * 启动一个独立的 Console 平台，通过 IPC 连接到目标 Backend。
 */

import * as path from 'node:path';
import { RemoteBackendHandle } from './ipc/remote-backend-handle';
import { createRemoteApiProxy } from './ipc/remote-api-proxy';
import { Methods } from './ipc/protocol';
import type { HandshakeResult } from './ipc/protocol';

// ============ 参数解析 ============

interface AttachArgs {
  agentName: string;
  cwd?: string;
}

function parseAttachArgs(argv: string[]): AttachArgs {
  // 多 Agent 配置分层重构：默认 agent 改为 master
  let agentName = 'master';
  let cwd: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    if ((argv[i] === '--agent' || argv[i] === '-a') && argv[i + 1]) {
      agentName = argv[++i];
    } else if (argv[i] === '--cwd' && argv[i + 1]) {
      cwd = path.resolve(argv[++i]);
    } else if (argv[i] === '--help' || argv[i] === '-h') {
      console.log(`
iris attach — 跨进程连接已运行的 Iris 实例

选项:
  --agent, -a <name>   要连接的 Agent 名称（默认: master）
  --cwd <path>         设置工作目录（默认: 当前目录）
  -h, --help           显示帮助
`);
      process.exit(0);
    }
  }

  return { agentName, cwd };
}

// ============ 主流程 ============

export async function runAttach(argv: string[]): Promise<void> {
  const args = parseAttachArgs(argv);

  // ── 本地 IPC 模式 ──
  const { IPCClient } = await import('./ipc/client');
  const { readLockFile } = await import('./ipc/server');
  const { dataDir } = await import('./paths');

  const lockInfo = readLockFile(dataDir, args.agentName);
  if (!lockInfo) {
    console.error(
      `未找到运行中的 Iris 实例 (agent=${args.agentName})。\n` +
      `请先在另一个终端执行: bun run dev`
    );
    process.exit(1);
  }

  console.log(`正在连接到 Iris 实例 (PID=${lockInfo.pid}, port=${lockInfo.port}, agent=${lockInfo.agentName})...`);

  const ipcClient = new IPCClient();
  let handshake: HandshakeResult;
  try {
    handshake = await ipcClient.connect(lockInfo.port);
  } catch (err) {
    console.error(`连接失败: ${(err as Error).message}`);
    process.exit(1);
  }
  const client = ipcClient;
  console.log(`已连接 (version=${handshake.version}, agent=${handshake.agentName})`);

  // ── 以下逻辑统一 ──

  // 3. 创建远程 BackendHandle
  const backend = new RemoteBackendHandle(client);
  backend._streamEnabled = handshake.streamEnabled;
  await backend.initCaches();

  // 3.5 通过 IPC 获取服务端配置信息
  const remoteConfig = await client.call(Methods.GET_CONFIG).catch(() => ({})) as Record<string, unknown>;
  const remoteConfigDir = await client.call(Methods.GET_CONFIG_DIR).catch(() => '') as string;

  // 4. 创建远程 API 代理并预加载缓存
  const api = createRemoteApiProxy(client, handshake.agentName);
  if (typeof api.initCaches === 'function') {
    await api.initCaches();
  }

  // 5. 加载 Console 平台
  if (typeof (globalThis as any).Bun === 'undefined') {
    console.error('Console 平台需要 Bun 运行时。请使用 bun 启动。');
    client.disconnect();
    process.exit(1);
  }

  let consoleFactory: (ctx: Record<string, unknown>) => Promise<any>;
  try {
    const mod = await import('../extensions/console/src/index');
    consoleFactory = mod.default;
    if (typeof consoleFactory !== 'function') {
      throw new Error('Console 扩展未导出工厂函数');
    }
  } catch (err) {
    console.error(`加载 Console 平台失败: ${(err as Error).message}`);
    client.disconnect();
    process.exit(1);
  }

  // 6. 订阅所有事件
  await client.subscribe('*');

  // 7. 通过工厂函数创建 Console 平台
  //    模拟 PlatformFactoryContext 结构，传入远程代理对象
  const consolePlatform = await consoleFactory({
    backend,
    config: remoteConfig,
    configDir: remoteConfigDir,
    router: api.router,
    agentName: handshake.agentName,
    initWarnings: [],
    extensions: {},
    api,
    isCompiledBinary: false,
  });

  if (!consolePlatform) {
    console.error('Console 平台创建失败');
    client.disconnect();
    process.exit(1);
  }

  // 8. 如果指定了 cwd，在服务端初始化 session cwd
  if (args.cwd && consolePlatform.sessionId) {
    await client.call(Methods.INIT_SESSION_CWD, [consolePlatform.sessionId, args.cwd]);
  }

  await consolePlatform.start();

  // 9. 等待退出
  if (typeof consolePlatform.waitForExit === 'function') {
    await consolePlatform.waitForExit();
  }

  // 10. 清理
  client.disconnect();
  process.exit(0);
}
