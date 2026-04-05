/**
 * CLI 入口
 *
 * 将 Iris 核心层暴露为命令行接口，支持外部传入提示词执行完整 Agent 循环。
 *
 * 用法：
 *   iris chat "分析这个项目"
 *   iris chat -p "重构代码" --session my-task
 *   echo "帮我找 bug" | iris chat
 *
 * 每次调用使用独立的 sessionId，天然支持多进程并行调用。
 */

import { IrisCore } from './core/iris-core';
import type { IrisCoreOptions } from './core/iris-core';
import { isMultiAgentEnabled, loadAgentDefinitions, resolveAgentPaths } from './agents';
import type { Content } from './types';
import type { ToolInvocation } from './types/tool';
import { createRequire } from 'module';

// ============ 参数解析 ============

interface CLIOptions {
  prompt: string;
  sessionId: string;
  model?: string;
  agent?: string;
  cwd?: string;
  stream?: boolean;
  outputFormat: 'text' | 'json';
  printTools: boolean;
  help: boolean;
  version: boolean;
}

const HELP_TEXT = `
iris chat - AI Agent 命令行接口

用法:
  iris chat <prompt>              位置参数传入提示词
  iris chat -p <prompt>           指定提示词
  echo "<prompt>" | iris chat     管道传入提示词

参数:
  -p, --prompt <text>           提示词文本
  -s, --session <id>            会话ID（支持多轮对话）
  --model <name>                覆盖默认模型
  --agent <name>                指定 Agent（多 Agent 模式）
  --cwd <dir>                   工具执行的工作目录
  --stream                      流式输出（边生成边打印）
  --no-stream                   禁用流式输出
  --output <format>             输出格式: text (default) | json
  --print-tools                 工具调用过程输出到 stderr
  -h, --help                    显示帮助
  -v, --version                 显示版本

示例:
  iris chat "分析项目目录结构"
  iris chat -p "找出所有 TODO" --output json
  iris chat -p "继续优化" -s my-task
  iris chat -p "写个 HTTP 服务器" --stream --print-tools
`.trim();

function generateSessionId(): string {
  const now = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, '0');
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const rand = Math.random().toString(36).slice(2, 6);
  return `cli_${date}_${time}_${rand}`;
}

function parseArgs(argv: string[]): CLIOptions {
  const args = argv.slice(2); // 跳过 node 和脚本路径
  let prompt = '';
  let sessionId = '';
  let model: string | undefined;
  let agent: string | undefined;
  let cwd: string | undefined;
  let stream: boolean | undefined;
  let outputFormat: 'text' | 'json' = 'text';
  let printTools = false;
  let help = false;
  let version = false;

  const positionalArgs: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '-h':
      case '--help':
        help = true;
        break;
      case '-v':
      case '--version':
        version = true;
        break;
      case '-p':
      case '--prompt':
        prompt = args[++i] || '';
        break;
      case '-s':
      case '--session':
        sessionId = args[++i] || '';
        break;
      case '--model':
        model = args[++i] || undefined;
        break;
      case '--agent':
        agent = args[++i] || undefined;
        break;
      case '--cwd':
        cwd = args[++i] || undefined;
        break;
      case '--stream':
        stream = true;
        break;
      case '--no-stream':
        stream = false;
        break;
      case '--output':
        outputFormat = (args[++i] || 'text') as 'text' | 'json';
        break;
      case '--print-tools':
        printTools = true;
        break;
      default:
        if (!arg.startsWith('-')) {
          positionalArgs.push(arg);
        }
        break;
    }
  }

  // 位置参数作为 prompt
  if (!prompt && positionalArgs.length > 0) {
    prompt = positionalArgs.join(' ');
  }

  if (!sessionId) {
    sessionId = generateSessionId();
  }

  return { prompt, sessionId, model, agent, cwd, stream, outputFormat, printTools, help, version };
}

async function readStdin(): Promise<string> {
  // 如果是 TTY（交互式终端），不从 stdin 读取
  if (process.stdin.isTTY) return '';

  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    process.stdin.on('data', (chunk) => chunks.push(chunk));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8').trim()));
    // stdin 无数据时给一个合理的超时
    setTimeout(() => resolve(Buffer.concat(chunks).toString('utf-8').trim()), 100);
  });
}

// ============ 主流程 ============

async function main() {
  const options = parseArgs(process.argv);

  if (options.help) {
    console.log(HELP_TEXT);
    process.exit(0);
  }

  if (options.version) {
    try {
      const v = (globalThis as any).IRIS_VERSION
        || (() => {
          const require = createRequire(import.meta.url);
          return require('../package.json').version;
        })();
      console.log(`iris ${v}`);
    } catch {
      console.log('iris (unknown version)');
    }
    process.exit(0);
  }

  // 尝试从 stdin 读取 prompt
  if (!options.prompt) {
    const stdinInput = await readStdin();
    if (stdinInput) {
      options.prompt = stdinInput;
    }
  }

  if (!options.prompt) {
    console.error('错误: 未提供提示词。');
    console.error('用法: iris chat "你的提示词"');
    console.error('运行 iris chat --help 查看详细帮助。');
    process.exit(1);
  }

  // 初始化核心
  let coreOpts: IrisCoreOptions | undefined;
  if (options.agent) {
    // 指定了 --agent：从多 Agent 注册表查找
    if (!isMultiAgentEnabled()) {
      console.error('错误: 使用 --agent 需先在 ~/.iris/agents.yaml 中设置 enabled: true。');
      process.exit(1);
    }
    const agentDefs = loadAgentDefinitions();
    const def = agentDefs.find(d => d.name === options.agent);
    if (!def) {
      console.error(`错误: 未找到 Agent "${options.agent}"。可用 Agent: ${agentDefs.map(d => d.name).join(', ')}`);
      process.exit(1);
    }
    coreOpts = { agentName: def.name, agentPaths: resolveAgentPaths(def) };
  } else if (isMultiAgentEnabled()) {
    // 多 Agent 模式但未指定 --agent：使用第一个 agent
    const agentDefs = loadAgentDefinitions();
    if (agentDefs.length > 0) {
      const def = agentDefs[0];
      coreOpts = { agentName: def.name, agentPaths: resolveAgentPaths(def) };
    }
  }

  const core = new IrisCore(coreOpts);
  await core.start();
  const backend = core.backend;

  // CLI 模式下强制所有工具自动审批（headless 无人交互）
  backend.reloadConfig({
    toolsConfig: { autoApproveAll: true, permissions: {} },
  });

  // 设置工作目录
  if (options.cwd) {
    backend.setCwd(options.cwd);
  }

  // 覆盖模型
  if (options.model) {
    backend.switchModel(options.model);
  }

  // 覆盖流式设置
  if (options.stream !== undefined) {
    backend.reloadConfig({ stream: options.stream });
  }

  // 收集结果
  let responseText = '';
  const toolCalls: Array<{ name: string; args: Record<string, unknown>; result?: unknown }> = [];
  let durationMs = 0;
  let hasError = false;

  // tool handles 通过 tool:execute 事件直接驱动，不再需要 printedToolStates
  // 监听事件
  const sid = options.sessionId;

  // 流式输出
  if (backend.isStreamEnabled()) {
    backend.on('stream:chunk', (_sid: string, chunk: string) => {
      if (_sid !== sid) return;
      if (options.outputFormat === 'text') {
        process.stdout.write(chunk);
      }
      responseText += chunk;
    });
  }

  // 非流式输出
  backend.on('response', (_sid: string, text: string) => {
    if (_sid !== sid) return;
    responseText = text;
  });

  // 工具调用状态
  backend.on('tool:execute', (_sid, handle) => {
    if (_sid !== sid || !options.printTools) return;
    handle.on('state', (status: string, prev: string) => {
      if (status === 'executing' && prev !== 'executing') {
        process.stderr.write(`[tool] ${handle.toolName}(${summarizeArgs(handle.getSnapshot().args)})\n`);
      } else if (status === 'success' && prev !== 'success') {
        process.stderr.write(`[tool] ${handle.toolName} ✓\n`);
      } else if (status === 'error' && prev !== 'error') {
        process.stderr.write(`[tool] ${handle.toolName} ✗ ${handle.getSnapshot().error || ''}\n`);
      }
    });
  });

  // 完整的 assistant 内容（用于收集工具调用记录）
  backend.on('assistant:content', (_sid: string, content: Content) => {
    if (_sid !== sid) return;
    for (const part of content.parts) {
      if ('functionCall' in part) {
        toolCalls.push({
          name: part.functionCall.name,
          args: part.functionCall.args,
        });
      }
    }
  });

  // 错误
  backend.on('error', (_sid: string, error: string) => {
    if (_sid !== sid) return;
    hasError = true;
    process.stderr.write(`[error] ${error}\n`);
  });

  // 执行
  await new Promise<void>((resolve) => {
    backend.on('done', (_sid: string, ms: number) => {
      if (_sid !== sid) return;
      durationMs = ms;
      resolve();
    });

    backend.chat(sid, options.prompt).catch((err) => {
      process.stderr.write(`[fatal] ${err instanceof Error ? err.message : String(err)}\n`);
      hasError = true;
      resolve();
    });
  });

  // 输出结果
  if (options.outputFormat === 'json') {
    const result = {
      sessionId: sid,
      response: responseText,
      toolCalls,
      model: backend.getCurrentModelInfo().modelId,
      durationMs,
    };
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else if (!backend.isStreamEnabled()) {
    // 非流式模式：等全部完成后一次性输出
    process.stdout.write(responseText + '\n');
  } else {
    // 流式模式已经实时输出了，补一个换行
    process.stdout.write('\n');
  }

  await core.shutdown();
  process.exit(hasError ? 1 : 0);
}

function summarizeArgs(args: Record<string, unknown>): string {
  const entries = Object.entries(args);
  if (entries.length === 0) return '';
  return entries
    .map(([k, v]) => {
      const s = typeof v === 'string' ? v : JSON.stringify(v);
      return `${k}=${s.length > 60 ? s.slice(0, 57) + '...' : s}`;
    })
    .join(', ');
}

main().catch((err) => {
  console.error('启动失败:', err);
  process.exit(1);
});
