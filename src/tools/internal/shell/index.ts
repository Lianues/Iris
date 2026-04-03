/**
 * Shell 命令执行工具（带安全分类器）
 *
 * 在项目目录下执行 Shell 命令，返回 stdout 和 stderr。
 * 内置安全检查 + 动态学习：
 *   1. 静态黑名单 → 直接拒绝
 *   2. 静态白名单 → 自动放行
 *   3. 运行时白名单 → 安装依赖后 LLM 评估自动添加
 *   4. AI 分类器 → 调用 LLM 判断安全性
 *   5. 安装命令成功后 → fire-and-forget 学习新工具
 */

import { exec, execFileSync } from 'child_process';
import { ToolDefinition } from '../../../types';
import { resolveProjectPath } from '../../utils';
import { getToolLimits } from '../../tool-limits';
import { classifyCommand, getDenyReason } from './whitelist';
import { classifyWithLLM, resolveClassifierDecision } from './classifier';
import { tryLearnFromInstall } from './learn';
import type { ShellToolDeps } from './types';
import { createLogger } from '../../../logger';

const logger = createLogger('ShellTool');

/**
 * PowerShell 编码前缀：强制所有输出为 UTF-8。
 * 中文 Windows 默认使用 GBK (codepage 936)，不设置此项会导致中文乱码。
 */
const PS_UTF8_PREFIX = '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ';

/**
 * 检测可用的 PowerShell 可执行路径。
 * 优先使用 pwsh.exe (PowerShell 7+)，不可用时回退到 powershell.exe (5.1)。
 */
let _resolvedShell: string | undefined;
function getShell(): string {
  if (_resolvedShell) return _resolvedShell;

  try {
    execFileSync('pwsh.exe', ['-NoProfile', '-Command', 'exit 0'], {
      stdio: 'ignore',
      timeout: 5000,
      windowsHide: true,
    });
    _resolvedShell = 'pwsh.exe';
    logger.info('使用 PowerShell 7+ (pwsh.exe)');
  } catch {
    _resolvedShell = 'powershell.exe';
    logger.info('pwsh.exe 不可用，回退到 Windows PowerShell 5.1 (powershell.exe)');
  }

  return _resolvedShell;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const half = Math.floor(max / 2);
  return text.slice(0, half) + `\n\n... (已截断，共 ${text.length} 字符) ...\n\n` + text.slice(-half);
}

/**
 * Shell 命令执行结果。
 */
interface ShellResult {
  command: string;
  exitCode: number;
  killed: boolean;
  stdout: string;
  stderr: string;
}

/**
 * 执行 shell 命令并返回结果。
 */
function executeCommand(
  command: string,
  workDir: string,
  timeout: number,
  maxBuffer: number,
  maxOutputChars: number,
): Promise<ShellResult> {
  const wrappedCommand = PS_UTF8_PREFIX + command;

  return new Promise<ShellResult>((resolve) => {
    exec(
      wrappedCommand,
      {
        cwd: workDir,
        timeout,
        maxBuffer,
        shell: getShell(),
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      },
      (error, stdout, stderr) => {
        const exitCode = error ? (error as any).code ?? 1 : 0;
        const killed = error ? !!(error as any).killed : false;

        resolve({
          command,
          exitCode,
          killed,
          stdout: truncate(stdout, maxOutputChars),
          stderr: truncate(stderr, maxOutputChars),
        });
      },
    );
  });
}

/**
 * 执行命令后尝试学习（fire-and-forget）。
 * 仅在命令成功执行且 autoLearn 启用时触发。
 */
function maybeLearnAfterExec(
  command: string,
  result: ShellResult,
  deps?: ShellToolDeps,
): void {
  if (!deps || result.exitCode !== 0) return;
  const autoLearn = deps.classifierConfig?.autoLearn;
  // autoLearn 默认跟随 classifier.enabled（未显式设置时）
  const shouldLearn = autoLearn ?? deps.classifierConfig?.enabled ?? false;
  if (!shouldLearn) return;
  void tryLearnFromInstall(command, result.stdout, deps);
}

/**
 * 创建 shell 工具。
 *
 * 不提供 deps 时，分类器不可用，非白名单命令一律拒绝。
 * 提供 deps 时，非白名单命令交由 AI 分类器判定。
 */
export function createShellTool(deps?: ShellToolDeps): ToolDefinition {
  return {
    declaration: {
      name: 'shell',
      description: `在项目目录下执行 Shell 命令。返回命令的 stdout、stderr 和退出码。超时默认 30 秒。
内置安全检查：只读命令自动放行，危险命令会被拒绝或由 AI 安全分类器判断。

force 参数使用规则：
- 默认不要设置 force。只有当命令被安全分类器拒绝，且用户在对话中明确确认要执行时，才设置 force: true 重试。
- 使用 force 前必须先向用户确认，说明命令被拒绝的原因和可能的风险，得到用户肯定回复后才能使用。
- 禁止在用户未确认的情况下自行设置 force。
- force 无法绕过黑名单（如 format C:、Invoke-Expression 等绝对禁止的操作）。`,
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: '要执行的 Shell 命令',
          },
          cwd: {
            type: 'string',
            description: '工作目录（相对于项目根目录），默认为项目根目录',
          },
          timeout: {
            type: 'number',
            description: '超时时间（毫秒），默认 30000',
          },
          force: {
            type: 'boolean',
            description: '强制执行（跳过 AI 安全分类器）。仅在命令被分类器拒绝且用户明确确认后使用。无法绕过黑名单。',
          },
        },
        required: ['command'],
      },
    },
    handler: async (args, context) => {
      const limits = getToolLimits().shell;

      const command = args.command as string;
      const cwd = args.cwd as string | undefined;
      const timeout = (args.timeout as number | undefined) ?? limits.defaultTimeout;
      const force = args.force === true;

      // 解析工作目录（安全检查：禁止超出项目范围）
      const projectRoot = process.cwd();
      const workDir = cwd ? resolveProjectPath(cwd) : projectRoot;

      // ---- 安全检查 ----
      const staticResult = classifyCommand(command);

      // 1. 黑名单拒绝（即使用户已批准也不放行——这些是绝对危险的操作）
      if (staticResult === 'deny') {
        const reason = getDenyReason(command) ?? '命令被安全策略拒绝';
        logger.warn(`Shell 命令被拒绝: ${command.slice(0, 100)} | 理由: ${reason}`);
        return {
          command,
          exitCode: 1,
          killed: false,
          stdout: '',
          stderr: `安全拒绝: ${reason}`,
        };
      }

      // 2. 白名单放行
      if (staticResult === 'allow') {
        logger.info(`Shell 命令白名单放行: ${command.slice(0, 100)}`);
        const result = await executeCommand(command, workDir, timeout, limits.maxBuffer, limits.maxOutputChars);
        maybeLearnAfterExec(command, result, deps);
        return result;
      }

      // 2.5. 用户已通过调度器审批（TUI Y/N 确认 或 allowPatterns 匹配）→ 跳过分类器
      // 尊重用户的明确授权意图，不再用 AI 分类器二次否决。
      if (context?.approvedByUser) {
        logger.info(`Shell 命令已获用户批准，跳过分类器: ${command.slice(0, 100)}`);
        const result = await executeCommand(command, workDir, timeout, limits.maxBuffer, limits.maxOutputChars);
        maybeLearnAfterExec(command, result, deps);
        return result;
      }

      // 2.75. force=true → 用户在对话中明确确认后 LLM 带 force 重试，跳过分类器
      // 黑名单已在上面拦截，到这里的 force 只跳过分类器/兜底策略。
      if (force) {
        logger.info(`Shell 命令 force 执行（用户已在对话中确认）: ${command.slice(0, 100)}`);
        const result = await executeCommand(command, workDir, timeout, limits.maxBuffer, limits.maxOutputChars);
        maybeLearnAfterExec(command, result, deps);
        return result;
      }

      // 3. unknown → 分类器判定
      const classifierConfig = deps?.classifierConfig;

      // 分类器未启用 → 兜底策略
      if (!deps || !classifierConfig?.enabled) {
        const fallback = classifierConfig?.fallbackPolicy ?? 'deny';
        if (fallback === 'deny') {
          logger.warn(`Shell 命令不在白名单且分类器未启用，拒绝执行: ${command.slice(0, 100)}`);
          return {
            command,
            exitCode: 1,
            killed: false,
            stdout: '',
            stderr: '命令不在安全白名单中且分类器未启用，拒绝执行。请使用更具体的只读命令，或联系管理员启用 AI 安全分类器。',
          };
        }
        // fallback === 'allow'
        logger.info(`Shell 命令不在白名单，分类器未启用，兜底放行: ${command.slice(0, 100)}`);
        const result = await executeCommand(command, workDir, timeout, limits.maxBuffer, limits.maxOutputChars);
        maybeLearnAfterExec(command, result, deps);
        return result;
      }

      // 调用 AI 分类器
      logger.info(`Shell 命令进入 AI 分类器: ${command.slice(0, 100)}`);
      const classifierResult = await classifyWithLLM(command, deps.getRouter(), classifierConfig, getShell());
      const decision = resolveClassifierDecision(classifierResult, classifierConfig);

      if (decision.allow) {
        logger.info(`Shell 命令分类器放行: ${command.slice(0, 100)} | 理由: ${decision.reason}`);
        const result = await executeCommand(command, workDir, timeout, limits.maxBuffer, limits.maxOutputChars);
        maybeLearnAfterExec(command, result, deps);
        return result;
      }

      logger.warn(`Shell 命令分类器拒绝: ${command.slice(0, 100)} | 理由: ${decision.reason}`);
      return {
        command,
        exitCode: 1,
        killed: false,
        stdout: '',
        stderr: `AI 安全分类器拒绝执行: ${decision.reason}`,
      };
    },
  };
}

/**
 * 向后兼容的静态导出（无分类器，非白名单命令默认拒绝）。
 * 建议新代码使用 createShellTool(deps) 来启用分类器。
 */
export const shell: ToolDefinition = createShellTool();
