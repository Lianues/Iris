/**
 * 命令白名单动态学习（shell / bash 共用）
 *
 * 当 shell/bash 执行安装命令（pip install、npm install -g、apt install 等）成功后，
 * 启动一个轻量 sub-agent（带对应工具的 ToolLoop），让 LLM 自己
 * 执行 --help 探测新安装的 CLI 工具，分析哪些子命令是只读安全的，
 * 将结果写入运行时白名单。
 *
 * 设计原则：
 *   - fire-and-forget：不阻塞命令返回，评估失败静默忽略
 *   - 只添加 safeSubcommands，不添加 safe: true（写操作仍走分类器）
 *   - 运行时白名单不持久化（重启后清空）
 *   - LLM 基于真实 --help 输出做安全分类，不凭空推断
 */

import type { CommandSafetyConfig, ShellClassifierConfig, ShellToolDeps } from './types';
import { addToRuntimeWhitelist, getRuntimeWhitelistSize } from './whitelist';
import { ToolLoop, type LLMCaller } from '@/core/tool-loop';
import { ToolRegistry } from '../../registry';
import { PromptAssembler } from '@/prompt/assembler';
import { createLogger } from '@/logger';

const logger = createLogger('ShellLearn');

// ============ 安装命令检测 ============

/** 安装命令检测结果 */
export interface InstallDetection {
  packageManager: string;
  packages: string[];
}

/**
 * 从命令字符串中提取包名列表。
 * 通用逻辑：跳过 flags（以 - 开头的参数），收集剩余的位置参数作为包名。
 */
function extractPositionalPackages(args: string): string[] {
  return args
    .split(/\s+/)
    .filter(a => a && !a.startsWith('-'))
    // 去掉版本约束（如 express@latest, requests>=2.0）
    .map(a => a.replace(/[@>=<~^!].*/g, ''))
    .filter(Boolean);
}

/**
 * pip/pip3 install 包名提取。
 * pip install 默认就是全局安装（或 venv 内），都值得学习。
 * 跳过 -r/--requirement（从文件安装）和 -e/--editable（开发模式）。
 */
function extractPipPackages(fullCommand: string): string[] {
  // 去掉 pip/pip3 install 前缀
  const args = fullCommand.replace(/^(pip3?|python\s+-m\s+pip)\s+install\s*/i, '');
  // 如果有 -r 或 -e，不提取（太复杂）
  if (/\s(-r|--requirement|-e|--editable)\s/i.test(' ' + args + ' ')) return [];
  return extractPositionalPackages(args);
}

/**
 * npm install -g 包名提取。
 * 只匹配全局安装（-g/--global），本地 npm install 不触发。
 */
function extractNpmGlobalPackages(fullCommand: string): string[] {
  // 确认有 -g 或 --global
  if (!/(\s|^)(-g|--global)(\s|$)/i.test(fullCommand)) return [];
  // 去掉 npm install 前缀
  const args = fullCommand.replace(/^npm\s+install\s*/i, '');
  return extractPositionalPackages(args);
}

/**
 * npx 包名提取。
 * npx 会临时安装并执行包，值得学习其 CLI 命令。
 */
function extractNpxPackages(fullCommand: string): string[] {
  const args = fullCommand.replace(/^npx\s*/i, '');
  // npx 的第一个非 flag 参数就是包名
  const packages = extractPositionalPackages(args);
  return packages.slice(0, 1); // 只取第一个
}

/**
 * yarn/pnpm global add 包名提取。
 */
function extractYarnPnpmGlobalPackages(fullCommand: string): string[] {
  const args = fullCommand.replace(/^(yarn|pnpm)\s+(global\s+)?add\s*/i, '');
  return extractPositionalPackages(args);
}

/**
 * cargo install 包名提取。
 */
function extractCargoPackages(fullCommand: string): string[] {
  const args = fullCommand.replace(/^cargo\s+install\s*/i, '');
  return extractPositionalPackages(args);
}

/**
 * go install 包名提取。
 * go install 的参数是模块路径（如 golang.org/x/tools/cmd/goimports@latest）。
 * 提取最后一段路径作为命令名。
 */
function extractGoPackages(fullCommand: string): string[] {
  const args = fullCommand.replace(/^go\s+install\s*/i, '');
  return args
    .split(/\s+/)
    .filter(a => a && !a.startsWith('-'))
    .map(a => {
      // 去掉版本后缀
      const withoutVersion = a.replace(/@.*$/, '');
      // 取最后一段路径
      const parts = withoutVersion.split('/');
      return parts[parts.length - 1];
    })
    .filter(Boolean);
}

/**
 * dotnet tool install 包名提取。
 */
function extractDotnetToolPackages(fullCommand: string): string[] {
  const args = fullCommand.replace(/^dotnet\s+tool\s+install\s*/i, '');
  return extractPositionalPackages(args);
}

/**
 * scoop/choco/winget install 包名提取。
 */
function extractGenericInstallPackages(fullCommand: string): string[] {
  const args = fullCommand.replace(/^(scoop|choco|chocolatey|winget)\s+install\s*/i, '');
  return extractPositionalPackages(args);
}

/**
 * apt/apt-get/brew/yum/dnf/pacman/zypper/apk install 包名提取。
 */
function extractLinuxPkgManagerPackages(fullCommand: string): string[] {
  const args = fullCommand.replace(
    /^(sudo\s+)?(apt-get|apt|brew|yum|dnf|zypper\s+install|apk\s+add|pacman\s+-S)\s+(install\s+)?/i,
    '',
  );
  return extractPositionalPackages(args);
}

/** 安装命令模式列表 */
const INSTALL_PATTERNS: Array<{
  regex: RegExp;
  manager: string;
  extractor: (cmd: string) => string[];
}> = [
  { regex: /^(pip3?|python\s+-m\s+pip)\s+install\b/i, manager: 'pip', extractor: extractPipPackages },
  { regex: /^npm\s+install\s+.*(-g|--global)/i, manager: 'npm', extractor: extractNpmGlobalPackages },
  { regex: /^npx\s+/i, manager: 'npx', extractor: extractNpxPackages },
  { regex: /^yarn\s+global\s+add\b/i, manager: 'yarn', extractor: extractYarnPnpmGlobalPackages },
  { regex: /^pnpm\s+(add\s+.*-g|add\s+.*--global)/i, manager: 'pnpm', extractor: extractYarnPnpmGlobalPackages },
  { regex: /^cargo\s+install\b/i, manager: 'cargo', extractor: extractCargoPackages },
  { regex: /^go\s+install\b/i, manager: 'go', extractor: extractGoPackages },
  { regex: /^dotnet\s+tool\s+install\b/i, manager: 'dotnet', extractor: extractDotnetToolPackages },
  { regex: /^scoop\s+install\b/i, manager: 'scoop', extractor: extractGenericInstallPackages },
  { regex: /^(choco|chocolatey)\s+install\b/i, manager: 'choco', extractor: extractGenericInstallPackages },
  { regex: /^winget\s+install\b/i, manager: 'winget', extractor: extractGenericInstallPackages },

  // Linux 包管理器
  { regex: /^(sudo\s+)?apt(-get)?\s+install\b/i, manager: 'apt', extractor: extractLinuxPkgManagerPackages },
  { regex: /^brew\s+install\b/i, manager: 'brew', extractor: extractLinuxPkgManagerPackages },
  { regex: /^(sudo\s+)?pacman\s+-S\b/i, manager: 'pacman', extractor: extractLinuxPkgManagerPackages },
  { regex: /^(sudo\s+)?yum\s+install\b/i, manager: 'yum', extractor: extractLinuxPkgManagerPackages },
  { regex: /^(sudo\s+)?dnf\s+install\b/i, manager: 'dnf', extractor: extractLinuxPkgManagerPackages },
  { regex: /^(sudo\s+)?zypper\s+install\b/i, manager: 'zypper', extractor: extractLinuxPkgManagerPackages },
  { regex: /^(sudo\s+)?apk\s+add\b/i, manager: 'apk', extractor: extractLinuxPkgManagerPackages },
];

/**
 * 检测命令是否是安装命令，提取包管理器和包名列表。
 *
 * @returns 检测结果，非安装命令返回 null
 */
export function detectInstallCommand(command: string): InstallDetection | null {
  const trimmed = command.trim();
  for (const pattern of INSTALL_PATTERNS) {
    if (pattern.regex.test(trimmed)) {
      const packages = pattern.extractor(trimmed);
      if (packages.length > 0) {
        return { packageManager: pattern.manager, packages };
      }
    }
  }
  return null;
}

// ============ LLM 评估器（ToolLoop 模式） ============

/** LLM 评估返回的单条命令学习结果 */
export interface LearnedCommand {
  command: string;
  safeSubcommands: string[];
  description?: string;
}

/**
 * 学习 sub-agent 的系统提示词。
 *
 * 关键设计：LLM 拥有 shell 工具，可以自己执行 --help 获取真实帮助文本，
 * 然后基于真实输出做安全分类，而不是凭训练知识猜测。
 */
/**
 * 构建学习系统提示词。
 * toolName 参数用于指定 sub-agent 使用的工具名（shell 或 bash）。
 */
function buildLearnPrompt(toolName: string): string {
  const platform = process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'macOS' : 'Linux';
  return `You are a CLI tool safety analyzer for ${platform}.
You have access to a ${toolName} tool. Your job is to discover what CLI commands a newly installed package provides, and determine which subcommands are READ-ONLY safe.

Workflow:
1. For each package, try running "<package-name> --help" or "<package-name> -h" using the ${toolName} tool
2. If the package name doesn't match the command name (common!), try common variations:
   - The package name itself (e.g. "httpie" → try "httpie --help")
   - Known aliases (e.g. "httpie" installs "http" command)
   - If the first attempt fails, try "<package-name> help" or just "<package-name>"
3. Read the --help output carefully and identify ALL subcommands/flags
4. Classify each subcommand as safe (read-only) or unsafe (writes/modifies)
5. Return your final answer as a JSON code block

Safety criteria:
- SAFE: subcommands that only READ information (list, show, info, status, version, help, check, verify, get, view, search, find, inspect, describe, explain, print, dump, export to stdout)
- UNSAFE: subcommands that WRITE/MODIFY (install, delete, create, update, push, deploy, remove, set, add, init, run, exec, start, stop, restart, config set, apply, destroy)
- Always include --help and --version as safe
- If unsure about a subcommand, do NOT include it as safe

Final answer format — return ONLY a JSON code block:
\`\`\`json
[{
  "command": "actual-command-name",
  "safeSubcommands": ["sub1", "sub2", "--flag1"],
  "description": "brief description of what this tool does"
}]
\`\`\`

If the package does not install any CLI commands (e.g. it's a library), return:
\`\`\`json
[]
\`\`\`

IMPORTANT:
- Use the ${toolName} tool to run --help. Do NOT guess from memory.
- The command name often differs from the package name (e.g. package "httpie" → command "http")
- Some packages install multiple commands
- Keep commands simple: just "<cmd> --help" or "<cmd> <subcmd> --help"
- Do NOT run any destructive commands. Only --help, -h, help, --version.`;
}

/**
 * 从 ToolLoop 的最终文本输出中提取 JSON 结果。
 */
function parseToolLoopResult(text: string): LearnedCommand[] {
  if (!text) return [];

  // 优先从 ```json ... ``` 代码块中提取
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  const jsonText = codeBlockMatch ? codeBlockMatch[1].trim() : text.trim();

  try {
    const parsed = JSON.parse(jsonText);
    return validateLearnResult(parsed);
  } catch {
    // 尝试从文本中提取 JSON 数组
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        return validateLearnResult(parsed);
      } catch { /* 解析失败 */ }
    }
  }

  logger.warn(`学习结果解析失败: ${text.slice(0, 200)}`);
  return [];
}

/**
 * 验证解析后的数组结构。
 */
export function validateLearnResult(parsed: unknown): LearnedCommand[] {
  if (!Array.isArray(parsed)) return [];

  return parsed
    .filter((item): item is Record<string, unknown> =>
      item != null && typeof item === 'object'
      && typeof (item as any).command === 'string'
      && Array.isArray((item as any).safeSubcommands)
    )
    .map(item => ({
      command: String(item.command).toLowerCase().trim(),
      safeSubcommands: (item.safeSubcommands as unknown[])
        .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
        .map(s => s.trim()),
      description: typeof item.description === 'string' ? item.description : undefined,
    }))
    .filter(item => item.command.length > 0 && item.safeSubcommands.length > 0);
}

/**
 * 使用 ToolLoop 运行学习 sub-agent。
 *
 * 给 LLM 配备 shell 工具，让它自己执行 --help 探测新安装的 CLI 工具，
 * 然后基于真实输出分析哪些子命令是只读安全的。
 */
async function runLearnAgent(
  packages: string[],
  packageManager: string,
  deps: ShellToolDeps,
  toolName: string = 'shell',
): Promise<LearnedCommand[]> {
  const router = deps.getRouter();

  // 构建只含 shell 工具的子工具集
  // 学习 agent 只需要 shell 来执行 --help，不需要其他工具
  let subTools: ToolRegistry;
  if (deps.tools) {
    subTools = deps.tools.createSubset([toolName]);
  } else {
    // fallback: 没有 tools 注入时无法运行 ToolLoop
    logger.warn('未注入 ToolRegistry，无法启动学习 agent');
    return [];
  }

  const prompt = new PromptAssembler();
  prompt.setSystemPrompt(buildLearnPrompt(toolName));

  // 学习 agent 的工具调用必须自动批准（只执行 --help），
  // 不管用户主配置中的 autoApprove 是什么。
  const learnPermissions = {
    ...(deps.getToolPolicies?.() ?? {}),
    [toolName]: { autoApprove: true },  // 强制覆盖
  };

  const loop = new ToolLoop(subTools, prompt, {
    maxRounds: 10,  // --help 探测不需要太多轮次
    toolsConfig: { permissions: learnPermissions },
    retryOnError: deps.retryOnError,
  });

  // LLM 调用器（非流式，轻量）
  const callLLM: LLMCaller = async (request, modelName, signal) => {
    const response = await router.chat(request, modelName ?? deps.classifierConfig?.model, signal);
    return response.content;
  };

  const userPrompt = `I just installed these packages via ${packageManager}:
${packages.map(p => `- ${p}`).join('\n')}

Please use the ${toolName} tool to run --help for each package and analyze which subcommands are read-only safe. Remember: the command name may differ from the package name.`;

  const result = await loop.run(
    [{ role: 'user', parts: [{ text: userPrompt }] }],
    callLLM,
    { modelName: deps.classifierConfig?.model },
  );

  if (result.error) {
    logger.warn(`学习 agent 执行失败: ${result.error}`);
    return [];
  }

  return parseToolLoopResult(result.text);
}

// ============ 入口函数 ============

/**
 * 安装命令成功后的学习入口。
 *
 * 检测命令是否是安装命令 → 提取包名 → 启动学习 sub-agent（带 shell 工具）
 * → LLM 自己执行 --help 探测 → 分析安全子命令 → 写入运行时白名单。
 * 设计为 fire-and-forget，所有错误静默处理。
 *
 * @param command   执行的命令
 * @param stdout    命令的标准输出（可用于辅助判断）
 * @param deps      依赖注入
 * @param toolName  当前工具名（'shell' 或 'bash'），用于学习 sub-agent
 */
export async function tryLearnFromInstall(
  command: string,
  stdout: string,
  deps: ShellToolDeps,
  toolName: string = 'shell',
): Promise<void> {
  try {
    // 1. 检测是否是安装命令
    const detection = detectInstallCommand(command);
    if (!detection) return;

    logger.info(`检测到安装命令: ${detection.packageManager} → [${detection.packages.join(', ')}]`);

    // 2. 启动学习 sub-agent
    const learned = await runLearnAgent(
      detection.packages,
      detection.packageManager,
      deps,
      toolName,
    );

    if (learned.length === 0) {
      logger.info(`学习完成，未发现新的 CLI 命令`);
      return;
    }

    // 3. 写入运行时白名单
    for (const entry of learned) {
      const config: CommandSafetyConfig = {
        safeSubcommands: entry.safeSubcommands,
      };
      addToRuntimeWhitelist(entry.command, config);
      logger.info(
        `运行时白名单新增: ${entry.command} → [${entry.safeSubcommands.join(', ')}]`
        + (entry.description ? ` (${entry.description})` : ''),
      );
    }

    logger.info(`学习完成，运行时白名单共 ${getRuntimeWhitelistSize()} 条`);
  } catch (err: unknown) {
    // fire-and-forget，静默处理所有错误
    logger.error(`白名单学习失败: ${err instanceof Error ? err.message : err}`);
  }
}
