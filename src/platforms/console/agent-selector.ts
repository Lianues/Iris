/**
 * Agent 选择界面
 *
 * 多 Agent 模式下，在启动 Console TUI 前显示的全屏 Agent 选择列表。
 * 支持上下键选择、Enter 确认、Esc 退出。
 *
 * 不使用 OpenTUI React，因为它是一个一次性的简单交互，
 * 直接用 ANSI 输出 + readline 实现更轻量。
 */

import type { AgentDefinition } from '../../agents';

/** 全局 AI 模式的特殊 agent name */
export const GLOBAL_AGENT_NAME = '__global__';

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

/** 选择列表中的条目 */
interface SelectorItem {
  agent: AgentDefinition;
  /** 是否为全局 AI 条目（使用不同颜色） */
  isGlobal: boolean;
}

/**
 * 显示 Agent 选择界面。
 *
 * 列表顶部始终显示“全局 AI”选项（使用全局配置），用绿色区分。
 * 下方显示各独立 Agent，用青色显示。
 *
 * @returns 选中的 AgentDefinition，用户按 Esc/Ctrl+C 时返回 null。
 *          全局 AI 返回 { name: '__global__', description: '...' }
 */
export function showAgentSelector(agents: AgentDefinition[]): Promise<AgentDefinition | null> {
  return new Promise((resolve) => {
    //I 在顶部 + 各独立 agent
    const items: SelectorItem[] = [
      {
        agent: { name: GLOBAL_AGENT_NAME, description: '使用全局配置（~/.iris/configs/）' },
        isGlobal: true,
      },
      ...agents.map(a => ({ agent: a, isGlobal: false })),
    ];

    if (items.length === 0) {
      resolve(null);
      return;
    }

    let selectedIndex = 0;
    const stdin = process.stdin;
    const stdout = process.stdout;
    const totalItems = items.length;

    const wasRaw = stdin.isRaw;
    if (stdin.setRawMode) stdin.setRawMode(true);
    stdin.resume();

    function render() {
      const lines: string[] = [];

      lines.push('');
      lines.push(`  ${ansi.magenta}${ansi.bold}━━ Iris — 选择 Agent ${ansi.reset}`);
      lines.push('');

      for (let i = 0; i < totalItems; i++) {
        const item = items[i];
        const isSelected = i === selectedIndex;

        if (item.isGlobal) {
          // 全局 AI：绿色
          const marker = isSelected ? `${ansi.green}${ansi.bold} ❯ ` : '   ';
          const nameStyle = isSelected ? `${ansi.green}${ansi.bold}` : `${ansi.green}`;
          lines.push(`${marker}${nameStyle}★ 全局 AI${ansi.reset}`);
          if (item.agent.description) {
            lines.push(`     ${ansi.dim}${item.agent.description}${ansi.reset}`);
          }
        } else {
          // 普通 Agent：青色
          const marker = isSelected ? `${ansi.cyan}${ansi.bold} ❯ ` : '   ';
          const nameStyle = isSelected ? `${ansi.cyan}${ansi.bold}` : `${ansi.white}`;
          lines.push(`${marker}${nameStyle}${item.agent.name}${ansi.reset}`);
          if (item.agent.description) {
            lines.push(`     ${ansi.dim}${item.agent.description}${ansi.reset}`);
          }
        }

        // 全局 AI 和 Agent 列表之间加一条分隔线
        if (item.isGlobal) {
          lines.push(`   ${ansi.dim}──────────────────────────────${ansi.reset}`);
        } else {
          lines.push('');
        }
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
        resolve(items[selectedIndex].agent);
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
