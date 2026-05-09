import type { PlanSessionState } from './types';

export function buildPlanModeInstructions(state: PlanSessionState, planExists: boolean): string {
  const reentry = state.hasExited
    ? '\n你之前已经退出过 Plan Mode；如果这是同一任务，请先读取并更新已有计划；如果是新任务，请覆盖旧计划。'
    : '';

  return `【Plan Mode 已启用】

你现在处于 Iris 的 Agent-local Plan Mode。该模式属于当前 Agent 的当前 session，不是全局权限模式。

必须遵守：
1. 先阅读、搜索、理解代码和需求；不要直接修改业务代码。
2. 只允许通过 read_plan / write_plan 读取和更新计划。不要使用 write_file/apply_diff/insert_code/delete_code 等业务文件编辑工具写计划。
3. 当前计划文件由 Iris 管理：${state.planFilePath}
4. 计划文件当前${planExists ? '已存在' : '不存在或为空'}。请在完成设计后用 write_plan 写入完整 Markdown 计划。
5. Plan Mode 下允许使用只读工具，包括 memory_search 读取长期记忆；不要运行会修改文件、记忆、安装依赖、提交代码、删除文件或改变外部状态的命令。
6. 如果需求不清楚，或存在多个合理技术路线，请优先使用 AskQuestionFirst 给用户结构化选项；决定使用 AskQuestionFirst 时必须直接调用工具，不要先输出普通说明文字。不要用 ExitPlanMode 代替澄清问题。
7. 当计划完整且可执行时，必须调用 ExitPlanMode 请求用户批准。不要只用普通文本或 AskQuestionFirst 询问“是否可以执行”。
${reentry}`;
}

export function buildPlanModeExitReminder(state: PlanSessionState): string {
  return `【已退出 Plan Mode】

用户已经批准当前 Agent 当前 session 的计划。计划文件：${state.planFilePath}
如果计划中包含可识别的步骤，Iris 已将其同步到当前会话的进度面板。
现在可以按已批准计划执行实现。后续工具权限仍遵循 Iris 当前 Agent 的原有 tools.yaml / 审批策略。`;
}

export function buildPlanModeAvailabilityInstructions(): string {
  return `【Plan Mode 可用】

Iris 支持 Agent-local Plan Mode。你可以在合适场景调用 EnterPlanMode，让当前 Agent 先只读探索、写计划并请求用户批准，再执行实现。

如果用户指令不清楚、缺少关键偏好，或多个技术路线都合理，可以先使用 AskQuestionFirst 给用户 2-4 个结构化选项，然后再继续任务。决定使用 AskQuestionFirst 时必须直接调用工具，不要先输出“好的，我先问你...”之类的普通文本；否则用户会在 TUI 中先看到文字但暂时看不到交互面板。

何时应该调用 EnterPlanMode：
- 用户明确要求先规划、先设计、先给方案、进入 plan mode / 计划模式。
- 用户明确说“先不要写代码/先别改文件，先分析方案”。
- 任务复杂、跨多个文件、架构不清楚、存在多种实现路线，直接改动风险较高。
- 需求含糊，需要先探索代码并形成可审阅计划。

何时不应该调用 EnterPlanMode：
- 简单明确的小任务、单文件小改动、解释问题、回答概念、修 typo。
- 用户只是用“我计划/我打算/我想”表达意图，例如“我计划用 Python 写冒泡排序”通常不等于要求进入 Plan Mode；如果任务本身简单明确，应直接帮助实现或回答。

如果决定进入 Plan Mode，请调用 EnterPlanMode；不要只用普通文本宣布进入计划模式。`;
}
