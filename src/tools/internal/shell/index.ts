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
import { ToolDefinition } from '@/types';
import { resolveProjectPath, getProjectRoot } from '../../utils';
import { getToolLimits } from '../../tool-limits';
import { classifyCommand, getDenyReason } from './whitelist';
import { classifyWithLLM, resolveClassifierDecision } from './classifier';
import { tryLearnFromInstall } from './learn';
import type { ShellToolDeps } from './types';
import {
  buildNonInteractiveEnv,
  closeChildStdin,
  detectInteractiveFailure,
  formatInteractiveFailureHint,
} from '../non-interactive-command';
import { createLogger } from '@/logger';
import { maybeAddCallmeTrailerToGitCommit } from '@/git/callme';
import { getSkillAccessPreflightRejection } from '../skill-access-guard';
import { killProcessTree } from '../process-tree';

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
  abortedByUser?: boolean;
  stdout: string;
  stderr: string;
}

/**
 * 解析 timeout 参数。
 * - 未指定：使用 tools.limits.shell.defaultTimeout（默认 30s）
 * - 显式指定正数：按用户/模型指定值执行，不再设置 10 分钟硬上限
 * - 显式指定 0：交给 Node exec 语义，表示不启用超时
 */
function resolveCommandTimeout(value: unknown, defaultTimeout: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return defaultTimeout;
  return value;
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
  signal?: AbortSignal,
): Promise<ShellResult> {
  const wrappedCommand = PS_UTF8_PREFIX + command;

  return new Promise<ShellResult>((resolve) => {
    let abortedByUser = false;
    let settled = false;
    let onAbort: () => void = () => {};
    const execOptions = {
      cwd: workDir,
      timeout,
      maxBuffer,
      shell: getShell(),
      windowsHide: true,
      detached: process.platform === 'win32',
      env: buildNonInteractiveEnv({ ...process.env, PYTHONIOENCODING: 'utf-8' }, 'powershell'),
    } as any;
    const child = exec(
      wrappedCommand,
      execOptions,
      (error: any, stdout: string, stderr: string) => {
        settled = true;
        signal?.removeEventListener('abort', onAbort);
        // Windows: 确保进程树被完全终止。
        // 管道截断（Select-Object -First N）或超时后，npx/node 等原生子进程
        // 可能不会随 PowerShell 退出而终止，成为孤儿进程占满 CPU。
        if (process.platform === 'win32') {
          killProcessTree(child.pid, { forceAfterMs: false });
        }

        const exitCode = abortedByUser ? 1 : (error ? (error as any).code ?? 1 : 0);
        const killed = abortedByUser || (error ? !!(error as any).killed : false);

        resolve({
          command,
          exitCode,
          killed,
          abortedByUser: abortedByUser || undefined,
          stdout: truncate(stdout, maxOutputChars),
          stderr: truncate(stderr, maxOutputChars),
        });
      },
    );

    closeChildStdin(child);

    onAbort = () => {
      if (settled) return;
      abortedByUser = true;
      if (process.platform === 'win32') {
        killProcessTree(child.pid, { forceAfterMs: false });
      }
      try { child.kill(); } catch { /* 进程可能已退出 */ }
    };

    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

/**
 * 对命令执行结果做语义注释。
 * 不修改原始 exitCode，仅在 stderr 末尾追加辅助说明。
 */
function annotateResult(result: ShellResult): ShellResult {
  const appendStderrNote = (current: ShellResult, note: string): ShellResult => ({
    ...current,
    stderr: current.stderr ? current.stderr + '\n' + note : note,
  });

  if (result.abortedByUser) {
    return appendStderrNote(result, '命令已被用户终止。');
  }

  let annotated = result;

  // 超时被终止
  if (result.killed) {
    annotated = appendStderrNote(annotated, '(命令执行超时被终止。如需更长时间，请增加 timeout 参数。)');
  }

  const interactiveHint = detectInteractiveFailure({
    command: result.command,
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    killed: result.killed,
  });
  if (interactiveHint) {
    annotated = appendStderrNote(annotated, formatInteractiveFailureHint(interactiveHint));
  }

  // exitCode=1 且无 stderr → 可能是搜索/比较命令的正常结果
  if (annotated.exitCode === 1 && !annotated.stderr) {
    const cmd = annotated.command.trim();
    // Select-String/findstr/grep/rg 返回 1 = 无匹配
    if (/^(select-string|sls|findstr|grep|rg)\b/i.test(cmd) ||
        /\|\s*(select-string|sls|findstr|grep|rg)\b/i.test(cmd)) {
      return { ...annotated, stderr: '(退出码 1 表示无匹配结果，不是错误)' };
    }
    // fc/Compare-Object/diff 返回 1 = 有差异
    if (/^(fc|compare-object|diff)\b/i.test(cmd)) {
      return { ...annotated, stderr: '(退出码 1 表示文件有差异，不是错误)' };
    }
  }

  return annotated;
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
    approvalMode: 'handler',
    declaration: {
      name: 'shell',
      description: `在项目目录下通过 PowerShell 后台执行非交互命令。返回 stdout、stderr 和退出码。
内置安全检查：只读命令自动放行，危险命令会被拒绝或由 AI 安全分类器判断。

交互限制：
- 本工具不提供交互式终端，只适合可自动完成的后台命令。
- 需要 TTY、密码输入、按键确认、全屏 TUI/编辑器/REPL 的命令可能无法完成。
- 请优先改用非交互参数、预配置凭据或明确的一次性命令；如果确实需要人工交互，请用户在外部终端执行。

命令规范：
- 多条命令用分号 ; 分隔，不要用换行。
- 路径含空格时用引号包裹："C:\\Program Files\\app"
- 长输出命令加 | Select-Object -First N 限制行数，避免输出过大。
- 避免使用 Start-Sleep 超过 5 秒，浪费执行时间。

退出码说明：
- Select-String/findstr 返回 1 表示无匹配结果，不是错误。
- fc/Compare-Object 返回 1 表示文件有差异，不是错误。
- killed=true 表示命令超时被终止，需增加 timeout 参数。

Git 安全规范：
- 不要执行 git push、git commit 除非用户明确要求。
- 修改仓库状态前先用 git status / git diff 确认。
- 如果用户通过 /callme 开启署名，Iris 会在 git commit 命令中自动追加固定链接署名（默认关闭）。

force 参数规则：
- 默认不要设置 force。只有命令被分类器拒绝且用户明确确认后才设置 force: true。
- 使用前必须向用户说明拒绝原因和风险，得到肯定回复后才能使用。
- force 无法绕过黑名单（如 format C:、Invoke-Expression 等绝对禁止的操作）。但在 tools.yaml 中开启 autoApproveAll 或 shell.autoApprove 后，黑名单将被关闭。`,
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: '要执行的 PowerShell 命令。多条命令用分号分隔。路径含空格时用引号包裹。',
          },
          cwd: {
            type: 'string',
            description: '工作目录（相对于项目根目录），默认为项目根目录',
          },
          timeout: {
            type: 'number',
            description: '超时时间（毫秒），默认 30000。显式设置时不设硬上限；设置为 0 表示不启用超时。超时后进程被终止（killed=true）。',
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

      let command = args.command as string;
      const cwd = args.cwd as string | undefined;
      const timeout = resolveCommandTimeout(args.timeout, limits.defaultTimeout);
      const force = args.force === true;

      const commandWithCallme = maybeAddCallmeTrailerToGitCommit(command, 'powershell', deps?.getCallmeConfig?.());
      if (commandWithCallme !== command) {
        logger.info(`已按 /callme 配置为 git commit 注入链接署名: ${command.slice(0, 100)}`);
        command = commandWithCallme;
      }

      // 解析工作目录（安全检查：禁止超出项目范围）
      const projectRoot = getProjectRoot();
      const workDir = cwd ? resolveProjectPath(cwd) : projectRoot;
      const skillAccessRejection = getSkillAccessPreflightRejection(command, cwd, workDir);
      if (skillAccessRejection) {
        return { command, exitCode: 1, killed: false, stdout: '', stderr: skillAccessRejection };
      }

      // ---- 安全检查 ----
      const staticResult = classifyCommand(command);

      // 1. 黑名单拒绝
      // 当用户通过 tools.yaml 配置 autoApproveAll 或 shell.autoApprove 时，
      // approvedByUser 为 true，跳过黑名单限制，允许所有指令运行。
      if (staticResult === 'deny') {
        if (context?.approvedByUser) {
          logger.info(`Shell 命令黑名单已被 autoApprove 配置跳过: ${command.slice(0, 100)}`);
        } else {
          const reason = getDenyReason(command) ?? '命令被安全策略拒绝';
          logger.warn(`Shell 命令被拒绝: ${command.slice(0, 100)} | 理由: ${reason}`);
          return {
            command,
            exitCode: 1,
            killed: false,
            stdout: '',
            stderr: `安全拒绝: ${reason}\n此操作在黑名单中，force 参数也无法绕过。请在 tools.yaml 中开启 autoApproveAll 或 shell.autoApprove 以解除限制。`,
          };
        }
      }

      // 2. 白名单放行
      if (staticResult === 'allow') {
        logger.info(`Shell 命令白名单放行: ${command.slice(0, 100)}`);
        const result = await executeCommand(command, workDir, timeout, limits.maxBuffer, limits.maxOutputChars, context?.signal);
        maybeLearnAfterExec(command, result, deps);
        return annotateResult(result);
      }

      // 2.5. 用户已通过调度器审批（TUI Y/N 确认 或 allowPatterns 匹配）→ 跳过分类器
      // 尊重用户的明确授权意图，不再用 AI 分类器二次否决。
      if (context?.approvedByUser) {
        logger.info(`Shell 命令已获用户批准，跳过分类器: ${command.slice(0, 100)}`);
        const result = await executeCommand(command, workDir, timeout, limits.maxBuffer, limits.maxOutputChars, context?.signal);
        maybeLearnAfterExec(command, result, deps);
        return annotateResult(result);
      }

      // 2.75. force=true → 仅在非交互上下文（无 Y/N 弹窗）中生效，
      // 用于 LLM 对话确认后重试。交互上下文中 Y/N 已替代 force，忽略以防绕过用户拒绝。
      if (force && !context?.requestApproval) {
        logger.info(`Shell 命令 force 执行（用户已在对话中确认）: ${command.slice(0, 100)}`);
        const result = await executeCommand(command, workDir, timeout, limits.maxBuffer, limits.maxOutputChars, context?.signal);
        maybeLearnAfterExec(command, result, deps);
        return annotateResult(result);
      }

      // 3. unknown → 分类器判定
      const classifierConfig = deps?.classifierConfig;

      // 分类器未启用 → 兜底策略
      if (!deps || !classifierConfig?.enabled) {
        const fallback = classifierConfig?.fallbackPolicy ?? 'deny';
        if (fallback === 'deny') {
          // 尝试通过 Y/N 弹窗请求用户确认
          if (context?.requestApproval) {
            logger.info(`Shell 命令不在白名单且分类器未启用，请求用户确认: ${command.slice(0, 100)}`);
            const approved = await context.requestApproval();
            if (approved) {
              logger.info(`Shell 命令用户已批准: ${command.slice(0, 100)}`);
              const result = await executeCommand(command, workDir, timeout, limits.maxBuffer, limits.maxOutputChars, context?.signal);
              maybeLearnAfterExec(command, result, deps);
              return annotateResult(result);
            }
            return {
              command, exitCode: 1, killed: false, stdout: '',
              stderr: '用户已拒绝执行该命令。',
            };
          }
          // 非交互上下文：返回错误，保留 force 对话确认作为后备
          logger.warn(`Shell 命令不在白名单且分类器未启用，拒绝执行: ${command.slice(0, 100)}`);
          return {
            command,
            exitCode: 1,
            killed: false,
            stdout: '',
            stderr: '命令不在安全白名单中且分类器未启用，拒绝执行。请使用只读命令（如 Get-ChildItem, Get-Content, git status 等），或请用户确认后使用 force: true。',
          };
        }
        // fallback === 'allow'
        logger.info(`Shell 命令不在白名单，分类器未启用，兜底放行: ${command.slice(0, 100)}`);
        const result = await executeCommand(command, workDir, timeout, limits.maxBuffer, limits.maxOutputChars, context?.signal);
        maybeLearnAfterExec(command, result, deps);
        return annotateResult(result);
      }

      // 调用 AI 分类器
      logger.info(`Shell 命令进入 AI 分类器: ${command.slice(0, 100)}`);
      const classifierResult = await classifyWithLLM(command, deps.getRouter(), classifierConfig, getShell(), projectRoot);
      const decision = resolveClassifierDecision(classifierResult, classifierConfig);

      if (decision.allow) {
        logger.info(`Shell 命令分类器放行: ${command.slice(0, 100)} | 理由: ${decision.reason}`);
        const result = await executeCommand(command, workDir, timeout, limits.maxBuffer, limits.maxOutputChars, context?.signal);
        maybeLearnAfterExec(command, result, deps);
        return annotateResult(result);
      }

      // 分类器拒绝 → 尝试通过 Y/N 弹窗请求用户确认
      if (context?.requestApproval) {
        logger.info(`Shell 命令分类器拒绝，请求用户确认: ${command.slice(0, 100)} | 理由: ${decision.reason}`);
        const approved = await context.requestApproval();
        if (approved) {
          logger.info(`Shell 命令用户已批准（分类器拒绝后）: ${command.slice(0, 100)}`);
          const result = await executeCommand(command, workDir, timeout, limits.maxBuffer, limits.maxOutputChars, context?.signal);
          maybeLearnAfterExec(command, result, deps);
          return annotateResult(result);
        }
        return {
          command, exitCode: 1, killed: false, stdout: '',
          stderr: '用户已拒绝执行该命令。',
        };
      }

      // 非交互上下文：返回错误，保留 force 对话确认作为后备
      logger.warn(`Shell 命令分类器拒绝: ${command.slice(0, 100)} | 理由: ${decision.reason}`);
      return {
        command,
        exitCode: 1,
        killed: false,
        stdout: '',
        stderr: `AI 安全分类器拒绝执行: ${decision.reason}\n如果用户确认需要执行此命令，可以设置 force: true 重试。`,
      };
    },
  };
}

/**
 * 向后兼容的静态导出（无分类器，非白名单命令默认拒绝）。
 * 建议新代码使用 createShellTool(deps) 来启用分类器。
 */
export const shell: ToolDefinition = createShellTool();
