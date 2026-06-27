import {
  createPluginLogger,
  definePlugin,
  type IrisAPI,
  type PluginContext,
  type Disposable,
  resolveDefaultDataDir,
} from 'irises-extension-sdk';
import {
  CONSOLE_INPUT_SERVICE_ID,
  CONSOLE_SLASH_COMMAND_SERVICE_ID,
  CONSOLE_STATUS_SEGMENT_SERVICE_ID,
  type ConsoleInputService,
  type ConsoleSlashCommandService,
  type ConsoleStatusSegmentService,
} from 'irises-extension-sdk/console';
import { DEFAULT_IDE_CONFIG_TEMPLATE } from './config-template.js';
import { parseIdeConfig } from './config.js';
import { IdeManager } from './manager.js';
import { IDE_MANAGER_SERVICE_ID, type DetectedIde, type IdeConfig, type IdeDebugSnapshot, type IdeStatusSnapshot } from './types.js';
import { detectVscodeCliCommands, installVscodeExtension } from './vscode-installer.js';

const logger = createPluginLogger('ide');

interface RuntimeState {
  manager: IdeManager | null;
  serviceDisposer: Disposable | null;
  consoleDisposers: Disposable[];
  config: IdeConfig;
  dataDir?: string;
  extensionRootDir?: string;
}

const runtimes = new Map<PluginContext, RuntimeState>();

export default definePlugin({
  name: 'ide',
  version: '0.1.0',
  description: 'IDE integration for Iris',

  activate(ctx) {
    ctx.ensureConfigFile?.('ide.yaml', DEFAULT_IDE_CONFIG_TEMPLATE);
    const state: RuntimeState = {
      manager: null,
      serviceDisposer: null,
      consoleDisposers: [],
      config: parseIdeConfig(ctx.readConfigSection?.('ide')),
      extensionRootDir: ctx.getExtensionRootDir(),
    };
    runtimes.set(ctx, state);

    ctx.addHook({
      name: 'ide:context-injection',
      priority: -20,
      onBeforeLLMCall({ request }) {
        const contextText = state.manager?.getContextText();
        if (!contextText) return undefined;
        return {
          request: {
            ...request,
            systemInstruction: {
              ...(request.systemInstruction ?? {}),
              parts: [
                ...(request.systemInstruction?.parts ?? []),
                { text: contextText },
              ],
            },
          },
        };
      },
      async onConfigReload({ rawMergedConfig }) {
        const next = parseIdeConfig(rawMergedConfig.ide);
        state.config = next;
        state.manager?.updateConfig(next);
        if (next.enabled) {
          await state.manager?.detect();
        }
      },
    });

    ctx.onReady(async (api) => {
      state.config = parseIdeConfig(readInitialIdeRaw(ctx, api));
      const globalDataDir = resolveDefaultDataDir();
      state.dataDir = globalDataDir;
      state.extensionRootDir = ctx.getExtensionRootDir();
      const manager = new IdeManager({
        dataDir: globalDataDir,
        getCwd: () => getBackendCwd(api),
        config: state.config,
        logger,
      });
      state.manager = manager;
      state.serviceDisposer?.dispose();
      state.serviceDisposer = ctx.getServiceRegistry().register(IDE_MANAGER_SERVICE_ID, manager, {
        description: 'Iris IDE integration manager',
        version: '1.0.0',
      });
      await manager.initialize();
      logger.info('IDE 扩展初始化完成');
    });

    ctx.onPlatformsReady((_platforms, api) => {
      if (!state.manager) return;
      registerConsoleIntegrations(api, state);
    });
  },

  async deactivate(ctx) {
    const states = ctx ? [runtimes.get(ctx)].filter((item): item is RuntimeState => !!item) : [...runtimes.values()];
    for (const state of states) {
      for (const disposer of state.consoleDisposers.splice(0)) {
        try { disposer.dispose(); } catch { /* ignore */ }
      }
      try { state.serviceDisposer?.dispose(); } catch { /* ignore */ }
      state.serviceDisposer = null;
      await state.manager?.disconnect().catch(() => {});
      state.manager = null;
    }
    if (ctx) runtimes.delete(ctx);
    else runtimes.clear();
  },
});

function readInitialIdeRaw(ctx: PluginContext, api: IrisAPI): unknown {
  try {
    const merged = api.configManager?.readEditableConfig?.();
    if (merged && typeof merged === 'object') return merged.ide;
  } catch (error) {
    logger.warn('读取合并后的 IDE 配置失败，回退到当前配置目录:', error);
  }
  return ctx.readConfigSection?.('ide');
}

function getBackendCwd(api: IrisAPI): string {
  try {
    const cwd = (api.backend as unknown as { getCwd?: () => string }).getCwd?.();
    if (cwd) return cwd;
  } catch {
    // ignore
  }
  return process.cwd();
}

function registerConsoleIntegrations(api: IrisAPI, state: RuntimeState): void {
  const services = api.services;
  const manager = state.manager;
  if (!manager) return;

  // 避免平台热切换/重复 onPlatformsReady 时重复注册。
  for (const disposer of state.consoleDisposers.splice(0)) {
    try { disposer.dispose(); } catch { /* ignore */ }
  }

  if (services.has(CONSOLE_SLASH_COMMAND_SERVICE_ID)) {
    const slash = services.get(CONSOLE_SLASH_COMMAND_SERVICE_ID) as ConsoleSlashCommandService;
    state.consoleDisposers.push(slash.register({
      name: '/ide',
      description: '管理 IDE 集成（status/connect/disconnect/detect/context）',
      acceptsArgs: true,
      getArgSuggestions: ({ arg }) => {
        const base = [
          { value: 'status', description: '查看 IDE 连接状态' },
          { value: 'detect', description: '重新扫描 IDE 插件会话' },
          { value: 'connect', description: '连接第一个匹配当前 cwd 的 IDE' },
          { value: 'disconnect', description: '断开当前 IDE' },
          { value: 'context', description: '预览将注入给模型的 IDE 上下文' },
          { value: 'install', description: '安装 Iris VS Code 扩展（可选 code/cursor/windsurf）' },
          { value: 'list-cli', description: '列出可用于安装的 VS Code 系 CLI' },
          { value: 'debug', description: '输出 IDE 调试信息（状态/lockfile/RPC/近期事件）' },
          { value: 'help', description: '显示帮助' },
        ];
        const q = arg.trim().toLowerCase();
        return q ? base.filter((item) => item.value.includes(q)) : base;
      },
      handle: async ({ arg }) => handleIdeCommand(manager, arg, state),
    }));
  }

  if (services.has(CONSOLE_STATUS_SEGMENT_SERVICE_ID)) {
    const status = services.get(CONSOLE_STATUS_SEGMENT_SERVICE_ID) as ConsoleStatusSegmentService;
    state.consoleDisposers.push(status.register({
      id: 'ide',
      align: 'right',
      priority: 35,
      getSnapshot() {
        const snapshot = manager.status();
        if (snapshot.state === 'connected' && snapshot.current) {
          const selection = snapshot.selection;
          if (selection?.text && selection.lineCount > 0) {
            return { id: 'ide', text: `⧉ ${selection.lineCount} 行选中`, color: '#74b9ff' };
          }
          const file = snapshot.openedFile ?? snapshot.selection?.filePath;
          return { id: 'ide', text: file ? `IDE ${snapshot.current.name}: ${basename(file)}` : `IDE ${snapshot.current.name}`, color: '#74b9ff' };
        }
        if (snapshot.state === 'connecting' || snapshot.state === 'detecting') {
          return { id: 'ide', text: 'IDE…', color: 'dim' };
        }
        if (snapshot.state === 'error') {
          return { id: 'ide', text: 'IDE error', color: 'warn' };
        }
        return undefined;
      },
      onDidChange(listener) {
        return manager.onDidChange(listener);
      },
    }));
  }

  if (services.has(CONSOLE_INPUT_SERVICE_ID)) {
    const input = services.get(CONSOLE_INPUT_SERVICE_ID) as ConsoleInputService;
    state.consoleDisposers.push(manager.onAtMentioned((payload) => {
      const mention = formatIdeMention(payload);
      const prefix = input.hasValue() ? ' ' : '';
      if (!input.insertText(`${prefix}${mention} `)) {
        logger.warn('收到 IDE @ 提及，但 Console 输入框当前不可用。');
      }
    }));
  }
}

async function handleIdeCommand(manager: IdeManager, arg: string, state: RuntimeState) {
  const [subcommand = '', ...rest] = arg.trim().split(/\s+/).filter(Boolean);
  const target = rest.join(' ').trim();

  switch (subcommand) {
    case 'help':
      return {
        label: 'ide',
        message: [
          'IDE 集成命令：',
          '  /ide status              查看连接状态',
          '  /ide detect              重新扫描 <dataDir>/ide/*.lock',
          '  /ide connect [id|port]   连接 IDE',
          '  /ide disconnect          断开 IDE',
          '  /ide context             预览将注入给模型的 IDE 上下文',
          '  /ide install [cli]        安装 Iris VS Code 扩展（cli 可为 code/cursor/windsurf）',
          '  /ide list-cli             列出当前 PATH 中可用的 VS Code 系 CLI',
          '  /ide debug                输出 IDE 调试信息',
          '',
          '直接输入 /ide 会自动检测、尝试连接；如果没有 IDE 会话，会显示可用操作提示。',
        ].join('\n'),
      };
    case 'detect':
    case 'refresh': {
      const detected = await manager.detect();
      return { label: 'ide', message: formatDetected(detected) };
    }
    case 'connect': {
      const ide = await manager.connect(target || undefined);
      return { label: 'ide', message: `已连接 IDE：${ide.name} (${ide.port})` };
    }
    case 'disconnect':
      await manager.disconnect();
      return { label: 'ide', message: '已断开 IDE。' };
    case 'context': {
      const contextText = manager.getContextText();
      return { label: 'ide', message: contextText || '当前没有可注入的 IDE 上下文。' };
    }
    case 'list-cli':
    case 'cli': {
      const commands = await detectVscodeCliCommands(target || undefined);
      return {
        label: 'ide',
        message: commands.length > 0
          ? ['可用 VS Code 系 CLI：', ...commands.map((cmd) => `  - ${cmd.label}: ${cmd.command}${cmd.version ? ` (${cmd.version})` : ''}`)].join('\n')
          : '未在 PATH 中发现 code / code-insiders / cursor / windsurf。',
      };
    }
    case 'debug': {
      const snapshot = manager.getDebugSnapshot();
      let extensionStatus: unknown;
      let extensionStatusError: string | undefined;
      if (snapshot.hasRpcClient) {
        try {
          extensionStatus = await manager.callRpc('getStatus');
        } catch (error) {
          extensionStatusError = error instanceof Error ? error.message : String(error);
        }
      }
      return { label: 'ide', message: formatDebug(snapshot, extensionStatus, extensionStatusError) };
    }
    case 'install':
    case 'setup': {
      const result = await installVscodeExtension({
        extensionRootDir: state.extensionRootDir,
        dataDir: state.dataDir ?? resolveDefaultDataDir(),
        target: target || undefined,
      });
      if (!result.success) return { label: 'ide', message: result.message, isError: true };
      const connected = await waitForFirstValidConnection(manager);
      return {
        label: 'ide',
        message: connected
          ? `${result.message}\n\n已自动连接 IDE：${connected.name} (${connected.port})`
          : `${result.message}\n\n暂未发现匹配当前 cwd 的 IDE 会话。请确认 VS Code 已打开当前工作区；如仍无结果，再执行 /ide detect。`,
      };
    }
    case '':
      return handleDefaultIdeCommand(manager, state);
    case 'status':
      return { label: 'ide', message: formatStatus(manager.status()) };
    default: {
      // 允许 /ide 12345 或 /ide VS Code 作为 connect 快捷方式。


      const ide = await manager.connect([subcommand, ...rest].join(' '));
      return { label: 'ide', message: `已连接 IDE：${ide.name} (${ide.port})` };
    }
  }
}


function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function connectFirstValidIde(manager: IdeManager): Promise<{ connected?: DetectedIde; detected: DetectedIde[]; error?: string }> {
  const detected = await manager.detect();
  const valid = detected.filter((ide) => ide.isValid);
  if (valid.length === 0) return { detected };

  const errors: string[] = [];
  for (const ide of valid) {
    try {
      const connected = await manager.connect(ide.id);
      return { detected, connected };
    } catch (error) {
      errors.push(`${ide.name} (${ide.port}): ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    detected,
    error: errors.join('\n'),
  };
}

async function waitForFirstValidConnection(manager: IdeManager, attempts = 6): Promise<DetectedIde | undefined> {
  for (let i = 0; i < attempts; i++) {
    const result = await connectFirstValidIde(manager);
    if (result.connected) return result.connected;
    if (i < attempts - 1) await sleep(800);
  }
  return undefined;
}

async function ensureVscodeExtensionCurrent(state: RuntimeState): Promise<string | undefined> {
  const result = await installVscodeExtension({
    extensionRootDir: state.extensionRootDir,
    dataDir: state.dataDir ?? resolveDefaultDataDir(),
    activateIfCurrent: false,
  });
  if (!result.success || result.alreadyInstalled) return undefined;
  return result.message;
}

async function handleDefaultIdeCommand(manager: IdeManager, state: RuntimeState) {
  const snapshot = manager.status();
  const current = snapshot.state === 'connected' ? manager.current() : undefined;
  if (current) {
    const updateMessage = await ensureVscodeExtensionCurrent(state);
    return { label: 'ide', message: updateMessage ? `${formatStatus(snapshot)}\n\n${updateMessage}` : formatStatus(snapshot) };
  }

  const first = await connectFirstValidIde(manager);
  if (first.connected) {
    const updateMessage = await ensureVscodeExtensionCurrent(state);
    return { label: 'ide', message: `已连接 IDE：${first.connected.name} (${first.connected.port})${updateMessage ? `\n\n${updateMessage}` : ''}` };
  }
  if (first.error) {
    return { label: 'ide', message: `发现 IDE 会话，但连接失败：${first.error}\n\n${formatDetected(first.detected)}`, isError: true };
  }
  if (first.detected.length > 0) {
    return { label: 'ide', message: formatDetected(first.detected) };
  }

  return {
    label: 'ide',
    message: [
      '未发现 IDE 插件会话。可执行以下操作：',
      '  /ide install       安装 Iris VS Code 扩展（支持 VS Code / Cursor / Windsurf）',
      '  /ide list-cli      查看可用的编辑器 CLI',
      '  /ide detect        重新扫描 IDE 会话',
    ].join('\n'),
  };
}

function formatDetected(detected: ReturnType<IdeManager['list']>): string {
  if (detected.length === 0) return '未发现 IDE 插件会话。可先执行 /ide install 安装 Iris VS Code 扩展，然后在 VS Code 中 Reload Window，再执行 /ide detect。';
  return ['发现 IDE：', ...detected.map((ide) => {
    const mark = ide.isValid ? '✓' : '×';
    const workspace = ide.workspaceFolders.length > 0 ? ide.workspaceFolders.join(', ') : '(无 workspaceFolders)';
    const version = ide.extensionVersion ? ` ext=${ide.extensionVersion}` : '';
    return `  ${mark} ${ide.name} port=${ide.port} transport=${ide.transport}${version} workspace=${workspace}`;
  })].join('\n');
}

function formatStatus(snapshot: IdeStatusSnapshot): string {
  const lines = [`IDE 状态：${snapshot.state}`];
  if (snapshot.current) lines.push(`当前连接：${snapshot.current.name} (${snapshot.current.port})`);
  if (snapshot.error) lines.push(`错误：${snapshot.error}`);
  if (snapshot.selection?.text && snapshot.selection.lineCount > 0) {
    lines.push(`选区：${snapshot.selection.filePath ?? '(unknown file)'} L${snapshot.selection.lineStart ?? '?'}-L${snapshot.selection.lineEnd ?? '?'} (${snapshot.selection.lineCount} 行)`);
  } else if (snapshot.openedFile ?? snapshot.selection?.filePath) {
    lines.push(`当前文件：${snapshot.openedFile ?? snapshot.selection?.filePath}`);
  }
  lines.push('');
  lines.push(formatDetected(snapshot.detected));
  return lines.join('\n');
}

function stringifyDebugData(data: unknown, maxLength = 1200): string {
  if (data === undefined) return '';
  try {
    const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
  } catch {
    return String(data);
  }
}

function extractRpcText(content: unknown): string {
  if (!Array.isArray(content)) return stringifyDebugData(content, 2000);
  const text = content
    .filter((block): block is { type?: string; text?: string } => !!block && typeof block === 'object')
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n');
  return text || stringifyDebugData(content, 2000);
}

function formatDebug(snapshot: IdeDebugSnapshot, extensionStatus: unknown, extensionStatusError?: string): string {
  const lines: string[] = [];
  const status = snapshot.status;
  lines.push('IDE Debug：');
  lines.push(`状态：${status.state}${snapshot.hasRpcClient ? ' (rpc: yes)' : ' (rpc: no)'}`);
  if (status.error) lines.push(`错误：${status.error}`);
  lines.push(`cwd：${snapshot.cwd}`);
  lines.push(`dataDir：${snapshot.dataDir}`);
  lines.push(`config：enabled=${snapshot.config.enabled} autoConnect=${snapshot.config.autoConnect} lockDir=${snapshot.config.lockDir ?? '(default)'} claudeCompat=${snapshot.config.compatibility.claudeCodeLockfiles}`);

  if (status.current) {
    lines.push(`当前 IDE：${status.current.name} port=${status.current.port} transport=${status.current.transport}`);
    lines.push(`当前 URL：${status.current.url}`);
    lines.push(`当前 lockfile：${status.current.lockfilePath}`);
  } else {
    lines.push('当前 IDE：(未连接)');
  }

  if (status.selection?.filePath) {
    lines.push(`选区：${status.selection.filePath} L${status.selection.lineStart ?? '?'}-L${status.selection.lineEnd ?? '?'} (${status.selection.lineCount} 行, text=${status.selection.text ? status.selection.text.length : 0} chars)`);
  } else if (status.openedFile) {
    lines.push(`当前文件：${status.openedFile}`);
  }

  lines.push('');
  lines.push(`检测到 IDE：${snapshot.detected.length}`);
  for (const ide of snapshot.detected) {
    lines.push(`  ${ide.isValid ? '✓' : '×'} ${ide.name} id=${ide.id} port=${ide.port} transport=${ide.transport}`);
    lines.push(`     url=${ide.url}`);
    lines.push(`     lock=${ide.lockfilePath}`);
    lines.push(`     workspace=${ide.workspaceFolders.length ? ide.workspaceFolders.join(', ') : '(none)'}`);
    if (ide.pid) lines.push(`     pid=${ide.pid}`);
    if (ide.extensionVersion) lines.push(`     extensionVersion=${ide.extensionVersion}`);
    if (ide.runningInWindows !== undefined) lines.push(`     runningInWindows=${ide.runningInWindows}`);
  }

  lines.push('');
  if (extensionStatusError) {
    lines.push(`VS Code 扩展状态：读取失败：${extensionStatusError}`);
  } else if (extensionStatus !== undefined) {
    lines.push('VS Code 扩展状态：');
    lines.push(extractRpcText(extensionStatus));
  } else {
    lines.push('VS Code 扩展状态：(未连接或无 RPC client)');
  }

  lines.push('');
  lines.push('近期事件：');
  const events = snapshot.recentEvents.slice(-20);
  if (events.length === 0) {
    lines.push('  (none)');
  } else {
    for (const event of events) {
      const data = stringifyDebugData(event.data, 500);
      lines.push(`  [${event.at}] ${event.kind}: ${event.message}${data ? ` ${data}` : ''}`);
    }
  }

  return lines.join('\n');
}


function basename(filePath: string): string {
  return filePath.replace(/\\/g, '/').split('/').pop() || filePath;
}

function formatIdeMention(payload: { filePath: string; lineStart?: number; lineEnd?: number }): string {
  const normalizedPath = payload.filePath.replace(/\\/g, '/');
  if (payload.lineStart === undefined) return `@${normalizedPath}`;
  const end = payload.lineEnd ?? payload.lineStart;
  const range = end !== payload.lineStart ? `#L${payload.lineStart}-L${end}` : `#L${payload.lineStart}`;
  return `@${normalizedPath}${range}`;
}