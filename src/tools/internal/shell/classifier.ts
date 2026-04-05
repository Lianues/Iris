/**
 * 命令 AI 安全分类器（shell / bash 共用）
 *
 * 当白名单无法判定时，调用 LLM 判断命令是否安全。
 * 复用 Iris 现有的 LLMRouter，不引入新依赖。
 * 通过 platform 参数区分 Windows (PowerShell) 和 Unix (bash) 场景。
 */

import type { LLMRouter } from '@/llm/router';
import type { Content } from '@/types';
import type { ClassifierResult, ShellClassifierConfig } from './types';
import { createLogger } from '@/logger';

const logger = createLogger('ShellClassifier');

/** 分类器默认配置 */
const DEFAULTS: Required<Omit<ShellClassifierConfig, 'model'>> = {
  enabled: true,
  confidenceThreshold: 0.8,
  fallbackPolicy: 'deny',
  timeout: 8000,
  autoLearn: true,
};

/**
 * 分类器系统提示词。
 *
 * 不给工具、不要多话，只返回结构化 JSON。
 * 用英文以确保所有模型都能理解。
 * 根据 platform 自动切换 Windows / Unix 的危险模式列表。
 */
function buildClassifierPrompt(shell: string, cwd: string): string {
  const isWindows = process.platform === 'win32';
  const isMac = process.platform === 'darwin';
  const platform = isWindows ? 'Windows' : isMac ? 'macOS' : 'Linux';

  const dangerousPatterns = isWindows
    ? `- Pipe combinations hiding dangerous ops (e.g. download + execute)
- File redirects (> >>) overwrite files
- rm/del/Remove-Item delete files
- Package install commands (npm install, pip install) modify the project
- chmod/chown/icacls modify permissions
- git push/commit/reset --hard modify repository state
- Registry modifications (reg add/delete, Set-ItemProperty on HKLM:)
- Service modifications (sc config, Set-Service)
- Invoke-Expression / iex (eval equivalent)
- Start-Process with -Verb RunAs (privilege escalation)`
    : `- Pipe combinations hiding dangerous ops (e.g. curl | bash, download + execute)
- File redirects (> >>) overwrite files
- rm/rmdir delete files or directories
- Package install commands (apt install, pip install, npm install) modify the system
- chmod/chown modify permissions or ownership
- git push/commit/reset --hard modify repository state
- sudo/su privilege escalation
- eval/exec/source dynamic code execution
- crontab modification
- systemctl/service daemon management
- iptables/ufw firewall modification
- dd disk operations, mkfs filesystem formatting
- Fork bombs and resource exhaustion`;

  return `You are a shell command safety classifier for ${platform} systems.
Your ONLY job is to decide whether a command is safe to execute.

Reply with ONLY a JSON object, no other text:
{"safe": true/false, "confidence": 0.0-1.0, "reason": "brief reason"}

Safety criteria:
- safe=true: Command only reads information, doesn't modify filesystem, doesn't send data externally, doesn't execute dangerous operations
- safe=false: Command modifies/deletes files, installs/uninstalls software, makes network requests that could be harmful, executes scripts, modifies system configuration

Dangerous patterns to watch for:
${dangerousPatterns}

Context:
- Platform: ${platform}
- Shell: ${shell}
- Working directory: ${cwd}`;
}

/**
 * 解析分类器 LLM 响应。
 *
 * 尝试从文本中提取 JSON，容忍模型在 JSON 前后加了多余文本的情况。
 */
function parseClassifierResponse(content: Content): ClassifierResult | null {
  const text = content.parts
    ?.map(p => 'text' in p ? p.text : '')
    .join('')
    .trim();

  if (!text) return null;

  try {
    // 直接解析
    const parsed = JSON.parse(text);
    return validateResult(parsed);
  } catch {
    // 尝试从文本中提取 JSON 块
    const jsonMatch = text.match(/\{[\s\S]*?\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        return validateResult(parsed);
      } catch {
        // 解析失败
      }
    }
  }

  logger.warn(`分类器响应解析失败: ${text.slice(0, 200)}`);
  return null;
}

/**
 * 验证解析后的对象结构。
 */
function validateResult(parsed: unknown): ClassifierResult | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;

  if (typeof obj.safe !== 'boolean') return null;

  const confidence = typeof obj.confidence === 'number'
    ? Math.max(0, Math.min(1, obj.confidence))
    : 0.5;

  const reason = typeof obj.reason === 'string'
    ? obj.reason
    : (obj.safe ? 'classified as safe' : 'classified as dangerous');

  return { safe: obj.safe, confidence, reason };
}

/**
 * 调用 AI 分类器判断命令安全性。
 *
 * @param command  要判断的 shell 命令
 * @param router   LLM 路由器
 * @param config   分类器配置
 * @param shell    当前使用的 shell 可执行名称
 * @param cwd      当前工作目录（用于构建分类器 prompt）
 * @returns 分类结果，超时/异常时返回 null
 */
export async function classifyWithLLM(
  command: string,
  router: LLMRouter,
  config?: Partial<ShellClassifierConfig>,
  shell?: string,
  cwd?: string,
): Promise<ClassifierResult | null> {
  const systemPrompt = buildClassifierPrompt(shell ?? 'powershell.exe', cwd ?? process.cwd());

  const timeout = config?.timeout ?? DEFAULTS.timeout;

  try {
    // 使用 AbortController 实现超时
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await router.chat(
        {
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [
            {
              role: 'user',
              parts: [{ text: `Is this command safe to execute?\n\n${command}` }],
            },
          ],
          // 不传 tools，分类器不需要调用任何工具
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 200,
          },
        },
        config?.model,
        controller.signal,
      );

      return parseClassifierResponse(response.content);
    } finally {
      clearTimeout(timer);
    }
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      logger.warn(`分类器超时 (${timeout}ms): ${command.slice(0, 80)}`);
    } else {
      logger.error(`分类器调用失败: ${err instanceof Error ? err.message : err}`);
    }
    return null;
  }
}

/**
 * 分类器结果判定：结合置信度阈值和兜底策略，返回最终决定。
 *
 * @returns { allow: boolean, reason: string }
 */
export function resolveClassifierDecision(
  result: ClassifierResult | null,
  config?: Partial<ShellClassifierConfig>,
): { allow: boolean; reason: string } {
  const threshold = config?.confidenceThreshold ?? DEFAULTS.confidenceThreshold;
  const fallback = config?.fallbackPolicy ?? DEFAULTS.fallbackPolicy;

  // 分类器调用失败 → 兜底策略
  if (!result) {
    return {
      allow: fallback === 'allow',
      reason: `分类器无法判定，兜底策略: ${fallback}`,
    };
  }

  // 高置信度安全 → 放行
  if (result.safe && result.confidence >= threshold) {
    return { allow: true, reason: result.reason };
  }

  // 高置信度危险 → 拒绝
  if (!result.safe && result.confidence >= threshold) {
    return { allow: false, reason: result.reason };
  }

  // 置信度不足 → 兜底策略
  return {
    allow: fallback === 'allow',
    reason: `置信度不足 (${result.confidence.toFixed(2)}, 阈值 ${threshold}): ${result.reason}。兜底策略: ${fallback}`,
  };
}
