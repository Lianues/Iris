/**
 * /commit 内置指令提示词。
 *
 * 思路：提供仓库状态和最近提交风格，让模型自己检查 diff、组织提交信息，
 * 并通过非交互 git 命令创建本地 commit。
 *
 * 注意：这里不直接内联完整 git diff，避免 TUI 把巨大的动态 prompt 当成用户消息展示；
 * prompt 会要求模型自己通过 shell/bash 工具读取 `git diff HEAD`。
 */

export interface GitCommitPromptInput {
  /** `git status --short --branch` 的输出。 */
  statusShort: string;
  /** `git log --oneline -10` 的输出；仓库无提交时可为空。 */
  recentCommits?: string;
  /** 用户在 `/commit ...` 后补充的额外要求。 */
  extraInstruction?: string;
}

function fence(text: string, fallback = '(无输出)'): string {
  const value = text.trimEnd() || fallback;
  return `\`\`\`\n${value}\n\`\`\``;
}

function formatExtraInstruction(extraInstruction?: string): string {
  const trimmed = extraInstruction?.trim();
  if (!trimmed) return '';
  return `\n## 用户补充要求\n\n${trimmed}\n`;
}

export function isGitPorcelainEmpty(output: string): boolean {
  return output.trim().length === 0;
}

export function buildGitCommitPrompt({
  statusShort,
  recentCommits,
  extraInstruction,
}: GitCommitPromptInput): string {
  return `## 上下文

当前 Git 状态：
${fence(statusShort)}

最近提交（用于参考风格）：
${fence(recentCommits ?? '', '(无最近提交或 git log 不可用)')}
${formatExtraInstruction(extraInstruction)}
## 任务

请基于当前变更创建一个本地 Git commit。

步骤：

1. 先检查变更：运行 \`git diff HEAD\`；对未跟踪文件，按需查看文件内容后再决定是否暂存。
2. 生成提交信息：参考最近提交风格；标题简洁（建议 72 字以内）；复杂改动可加 1-3 条正文，说明原因、影响或关键细节，不要逐文件罗列。
3. 暂存并提交：优先使用显式 \`git add <path>...\`，不要无脑暂存无关文件；使用非交互方式写入多行 commit message。
4. 完成后运行 \`git status --short\` 和 \`git rev-parse --short HEAD\`，回复 commit hash 和提交摘要。

安全约束：

- 不修改 git config。
- 不使用 \`git commit --amend\`，除非用户明确要求。
- 不跳过 hooks（如 \`--no-verify\`），除非用户明确要求。
- 不提交疑似敏感文件，例如 \`.env\`、凭据、私钥、token、证书等。
- 不 push；本命令只创建本地提交。
- 不使用需要交互式 TTY 的 git 命令（如 \`git add -i\`、\`git rebase -i\`）。

多行提交信息示例：

\`\`\`bash
git commit -m "$(cat <<'EOF'
提交标题

提交正文，可选。
EOF
)"
\`\`\`

\`\`\`powershell
$commitMessage = @'
提交标题

提交正文，可选。
'@
Set-Content -LiteralPath .git/IRIS_COMMIT_MESSAGE -Value $commitMessage -Encoding UTF8
git commit -F .git/IRIS_COMMIT_MESSAGE
Remove-Item -LiteralPath .git/IRIS_COMMIT_MESSAGE -ErrorAction SilentlyContinue
\`\`\`

如果 hook 失败，请报告失败原因，不要自行绕过。`;
}
