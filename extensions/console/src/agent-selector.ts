/**
 * Agent 选择界面
 *
 * 多 Agent 模式下，在启动 Console TUI 前显示的全屏 Agent 选择列表。
 * 支持上下键选择、Enter 确认、Esc 退出。
 *
 * 不使用 OpenTUI React，因为它是一个一次性的简单交互，
 * 直接用 ANSI 输出 + readline 实现更轻量。
 *
 * 多 Agent 配置分层重构：移除 GLOBAL_AGENT_NAME / __global__ 特判。
 * 不再有"全局 AI"选项，所有 agent 都是普通条目。
 */

import type { AgentDefinitionLike as AgentDefinition } from '@irises/extension-sdk';

const ESC = '\x1b';
const CSI = `${ESC}[`;

const ansi = {
  clear: `${CSI}2J${CSI}H`,
  hideCursor: `${CSI}?25l`,
  showCursor: `${CSI}?25h`,
  reset: `${CSI}0m`,
  bold: `${CSI}1m`,
  dim: `${CSI}2m`,
  cyan: `${CSI}36m`,
  green: `${CSI}32m`,
  yellow: `${CSI}33m`,
  magenta: `${CSI}35m`,
  white: `${CSI}37m`,
};

/**
 * 显示 Agent 选择界面。
 *
 * 多 Agent 配置分层重构：移除"全局 AI"选项，所有 agent 统一显示。
 *
 * @returns 选中的 AgentDefinition，用户按 Esc/Ctrl+C 时返回 null。
 */
export function showAgentSelector(agents: AgentDefinition[]): Promise<AgentDefinition | null> {
  return new Promise((resolve) => {
    if (agents.length === 0) {
      resolve(null);
      return;
    }

    let selectedIndex = 0;
    const stdin = process.stdin;
    const stdout = process.stdout;
    const totalItems = agents.length;

    const wasRaw = stdin.isRaw;
    if (stdin.setRawMode) stdin.setRawMode(true);
    stdin.resume();

    function render() {
      const lines: string[] = [];

      lines.push('');
      lines.push(`  ${ansi.magenta}${ansi.bold}━━ Iris — 选择 Agent ${ansi.reset}`);
      lines.push('');

      for (let i = 0; i < totalItems; i++) {
        const agent = agents[i];
        const isSelected = i === selectedIndex;

        const marker = isSelected ? `${ansi.cyan}${ansi.bold} ❯ ` : '   ';
        const nameStyle = isSelected ? `${ansi.cyan}${ansi.bold}` : `${ansi.white}`;
        lines.push(`${marker}${nameStyle}${agent.name}${ansi.reset}`);
        if (agent.description) {
          lines.push(`     ${ansi.dim}${agent.description}${ansi.reset}`);
        }
        lines.push('');
      }

      lines.push(`  ${ansi.dim}↑↓ 选择  Enter 确认  Esc 退出${ansi.reset}`);
      lines.push('');

      stdout.write(ansi.clear + ansi.hideCursor + lines.join('\n'));
    }

    function cleanup() {
      stdin.removeListener('data', onData);
      if (stdin.setRawMode) stdin.setRawMode(wasRaw ?? false);
      stdout.write(ansi.showCursor + ansi.clear);
    }

    function onData(buf: Buffer) {
      const key = buf.toString('utf-8');

      // Esc
      if (key === ESC || key === '\x1b') {
        cleanup();
        resolve(null);
        return;
      }

      // Ctrl+C
      if (key === '\x03') {
        cleanup();
        resolve(null);
        return;
      }

      // Enter
      if (key === '\r' || key === '\n') {
        cleanup();
        resolve(agents[selectedIndex]);
        return;
      }

      // 上箭头
      if (key === '\x1b[A') {
        selectedIndex = (selectedIndex - 1 + totalItems) % totalItems;
        render();
        return;
      }

      // 下箭头
      if (key === '\x1b[B') {
        selectedIndex = (selectedIndex + 1) % totalItems;
        render();
        return;
      }
    }

    stdin.on('data', onData);
    render();
  });
}
