/**
 * Bash 命令执行工具（带安全分类器）
 *
 * 在项目目录下通过 bash/zsh 执行命令，返回 stdout 和 stderr。
 * 内置安全检查 + 动态学习：
 *   1. 静态黑名单 → 直接拒绝
 *   2. 静态白名单 → 自动放行
 *   3. 运行时白名单 → 安装依赖后 LLM 评估自动添加
 *   4. AI 分类器 → 调用 LLM 判断安全性（复用 shell 的分类器）
 *   5. 安装命令成功后 → fire-and-forget 学习新工具（复用 shell 的学习模块）
 */

import { exec } from 'child_process';
import { ToolDefinition } from '@/types';
import { resolveProjectPath, getProjectRoot } from '../../utils';
import { getToolLimits } from '../../tool-limits';
import { classifyCommand, getDenyReason } from './whitelist';
import { classifyWithLLM, resolveClassifierDecision } from '../shell/classifier';
import { tryLearnFromInstall } from '../shell/learn';
import type { BashToolDeps } from './types';
import { createLogger } from '@/logger';

const logger = createLogger('BashTool');

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const half = Math.floor(max / 2);
  return text.slice(0, half) + `\n\n... (已截断，共 ${text.length} 字符) ...\n\n` + text.slice(-half);
}

interface BashResult {
  command: string;
  exitCode: number;
  killed: boolean;
  stdout: string;
  stderr: string;
}

/**
 * 获取当前用户的默认 shell。
 * 优先使用 $SHELL 环境变量，回退到 /bin/bash。
 */
function getShell(): string {
  return process.env.SHELL || '/bin/bash';
}

/**
 * 执行 bash 命令并返回结果。
 */
function executeCommand(
  command: string,
  workDir: string,
  timeout: number,
  maxBuffer: number,
  maxOutputChars: number,
): Promise<BashResult> {
  return new Promise<BashResult>((resolve) => {
    exec(
      command,
      {
        cwd: workDir,
        timeout,
        maxBuffer,
        shell: getShell(),
        env: {
          ...process.env,
          // 确保 UTF-8 输出
          LANG: process.env.LANG || 'en_US.UTF-8',
          PYTHONIOENCODING: 'utf-8',
        },
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
 * 对命令执行结果做语义注释。
 * 不修改原始 exitCode，仅在 stderr 末尾追加辅助说明。
 */
function annotateResult(result: BashResult): BashResult {
  // 超时被终止
  if (result.killed) {
    const note = '(命令执行超时被终止。如需更长时间，请增加 timeout 参数。)';
    return { ...result, stderr: result.stderr ? result.stderr + '\n' + note : note };
  }

  // exitCode=1 且无 stderr → 可能是搜索/比较命令的正常结果
  if (result.exitCode === 1 && !result.stderr) {
    const cmd = result.command.trim();
    // grep/rg/ag/ack 返回 1 = 无匹配
    if (/^(grep|egrep|fgrep|rg|ag|ack)\b/i.test(cmd) ||
        /\|\s*(grep|egrep|fgrep|rg|ag|ack)\b/i.test(cmd)) {
      return { ...result, stderr: '(退出码 1 表示无匹配结果，不是错误)' };
    }
    // diff/cmp 返回 1 = 有差异
    if (/^(diff|colordiff|cmp)\b/i.test(cmd)) {
      return { ...result, stderr: '(退出码 1 表示文件有差异，不是错误)' };
    }
  }

  return result;
}

/**
 * 执行命令后尝试学习（fire-and-forget）。
 */
function maybeLearnAfterExec(
  command: string,
  result: BashResult,
  deps?: BashToolDeps,
): void {
  if (!deps || result.exitCode !== 0) return;
  const autoLearn = deps.classifierConfig?.autoLearn;
  const shouldLearn = autoLearn ?? deps.classifierConfig?.enabled ?? false;
  if (!shouldLearn) return;
  void tryLearnFromInstall(command, result.stdout, deps, 'bash');
}

/**
 * 创建 bash 工具。
 *
 * 不提供 deps 时，分类器不可用，非白名单命令一律拒绝。
 * 提供 deps 时，非白名单命令交由 AI 分类器判定。
 */
export function createBashTool(deps?: BashToolDeps): ToolDefinition {
  return {
    declaration: {
      name: 'bash',
      description: `在项目目录下执行 Bash/Shell 命令。返回 stdout、stderr 和退出码。
内置安全检查：只读命令自动放行，危险命令会被拒绝或由 AI 安全分类器判断。

命令规范：
- 多条命令用 && 连接（前命令成功才执行后命令），不要用换行。
- 路径含空格时用双引号包裹。
- 长输出命令加 | head -n N 限制行数，避免输出过大。
- 重定向不需要的输出：> /dev/null 2>&1
- 避免使用 sleep 超过 5 秒，浪费执行时间。

退出码说明：
- grep/rg/ack 返回 1 表示无匹配结果，不是错误。
- diff/cmp 返回 1 表示文件有差异，不是错误。
- killed=true 表示命令超时被终止，需增加 timeout 参数。

Git 安全规范：
- 不要执行 git push、git commit 除非用户明确要求。
- 修改仓库状态前先用 git status / git diff 确认。

force 参数规则：
- 默认不要设置 force。只有命令被分类器拒绝且用户明确确认后才设置 force: true。
- 使用前必须向用户说明拒绝原因和风险，得到肯定回复后才能使用。
- force 无法绕过黑名单（如 rm -rf /、sudo、eval 等绝对禁止的操作）。`,
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: '要执行的命令。多条命令用 && 连接。路径含空格时用双引号包裹。',
          },
          cwd: {
            type: 'string',
            description: '工作目录（相对于项目根目录），默认为项目根目录',
          },
          timeout: {
            type: 'number',
            description: '超时时间（毫秒），默认 30000，最大 600000。超时后进程被终止（killed=true）。',
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
      const timeout = Math.min((args.timeout as number | undefined) ?? limits.defaultTimeout, 600_000);
      const force = args.force === true;

      const projectRoot = getProjectRoot();
      const workDir = cwd ? resolveProjectPath(cwd) : projectRoot;

      // ---- 安全检查 ----
      const staticResult = classifyCommand(command);

      // 1. 黑名单拒绝
      if (staticResult === 'deny') {
        const reason = getDenyReason(command) ?? '命令被安全策略拒绝';
        logger.warn(`Bash 命令被拒绝: ${command.slice(0, 100)} | 理由: ${reason}`);
        return {
          command,
          exitCode: 1,
          killed: false,
          stdout: '',
          stderr: `安全拒绝: ${reason}\n此操作在黑名单中，force 参数也无法绕过。请使用更安全的替代命令。`,
        };
      }

      // 2. 白名单放行
      if (staticResult === 'allow') {
        logger.info(`Bash 命令白名单放行: ${command.slice(0, 100)}`);
        const result = await executeCommand(command, workDir, timeout, limits.maxBuffer, limits.maxOutputChars);
        maybeLearnAfterExec(command, result, deps);
        return annotateResult(result);
      }

      // 2.5. 用户已通过调度器审批
      if (context?.approvedByUser) {
        logger.info(`Bash 命令已获用户批准，跳过分类器: ${command.slice(0, 100)}`);
        const result = await executeCommand(command, workDir, timeout, limits.maxBuffer, limits.maxOutputChars);
        maybeLearnAfterExec(command, result, deps);
        return annotateResult(result);
      }

      // 2.75. force=true → 仅在非交互上下文（无 Y/N 弹窗）中生效
      if (force && !context?.requestApproval) {
        logger.info(`Bash 命令 force 执行（用户已在对话中确认）: ${command.slice(0, 100)}`);
        const result = await executeCommand(command, workDir, timeout, limits.maxBuffer, limits.maxOutputChars);
        maybeLearnAfterExec(command, result, deps);
        return annotateResult(result);
      }

      // 3. unknown → 分类器判定
      const classifierConfig = deps?.classifierConfig;

      if (!deps || !classifierConfig?.enabled) {
        const fallback = classifierConfig?.fallbackPolicy ?? 'deny';
        if (fallback === 'deny') {
          // 尝试通过 Y/N 弹窗请求用户确认
          if (context?.requestApproval) {
            logger.info(`Bash 命令不在白名单且分类器未启用，请求用户确认: ${command.slice(0, 100)}`);
            const approved = await context.requestApproval();
            if (approved) {
              logger.info(`Bash 命令用户已批准: ${command.slice(0, 100)}`);
              const result = await executeCommand(command, workDir, timeout, limits.maxBuffer, limits.maxOutputChars);
              maybeLearnAfterExec(command, result, deps);
              return annotateResult(result);
            }
            return {
              command, exitCode: 1, killed: false, stdout: '',
              stderr: '用户已拒绝执行该命令。',
            };
          }
          // 非交互上下文：返回错误，保留 force 对话确认作为后备
          logger.warn(`Bash 命令不在白名单且分类器未启用，拒绝执行: ${command.slice(0, 100)}`);
          return {
            command,
            exitCode: 1,
            killed: false,
            stdout: '',
            stderr: '命令不在安全白名单中且分类器未启用，拒绝执行。请使用只读命令（如 ls, cat, grep, git status 等），或请用户确认后使用 force: true。',
          };
        }
        logger.info(`Bash 命令不在白名单，分类器未启用，兜底放行: ${command.slice(0, 100)}`);
        const result = await executeCommand(command, workDir, timeout, limits.maxBuffer, limits.maxOutputChars);
        maybeLearnAfterExec(command, result, deps);
        return annotateResult(result);
      }

      // 调用 AI 分类器
      logger.info(`Bash 命令进入 AI 分类器: ${command.slice(0, 100)}`);
      const classifierResult = await classifyWithLLM(command, deps.getRouter(), classifierConfig, getShell(), projectRoot);
      const decision = resolveClassifierDecision(classifierResult, classifierConfig);

      if (decision.allow) {
        logger.info(`Bash 命令分类器放行: ${command.slice(0, 100)} | 理由: ${decision.reason}`);
        const result = await executeCommand(command, workDir, timeout, limits.maxBuffer, limits.maxOutputChars);
        maybeLearnAfterExec(command, result, deps);
        return annotateResult(result);
      }

      // 分类器拒绝 → 尝试通过 Y/N 弹窗请求用户确认
      if (context?.requestApproval) {
        logger.info(`Bash 命令分类器拒绝，请求用户确认: ${command.slice(0, 100)} | 理由: ${decision.reason}`);
        const approved = await context.requestApproval();
        if (approved) {
          logger.info(`Bash 命令用户已批准（分类器拒绝后）: ${command.slice(0, 100)}`);
          const result = await executeCommand(command, workDir, timeout, limits.maxBuffer, limits.maxOutputChars);
          maybeLearnAfterExec(command, result, deps);
          return annotateResult(result);
        }
        return {
          command, exitCode: 1, killed: false, stdout: '',
          stderr: '用户已拒绝执行该命令。',
        };
      }

      // 非交互上下文：返回错误，保留 force 对话确认作为后备
      logger.warn(`Bash 命令分类器拒绝: ${command.slice(0, 100)} | 理由: ${decision.reason}`);
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
 */
export const bash: ToolDefinition = createBashTool();
