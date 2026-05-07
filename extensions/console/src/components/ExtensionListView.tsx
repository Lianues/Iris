/** @jsxImportSource @opentui/react */

import React from 'react';
import { useTerminalDimensions } from '@opentui/react';
import { C } from '../theme';
import { BORDER_CHARS, ICONS } from '../terminal-compat';

export interface ExtensionItem {
  name: string;
  version: string;
  description: string;
  status: 'active' | 'disabled' | 'available' | 'platform';
  /** 进入 /extension 时的真实状态；status 是当前草稿状态。 */
  originalStatus?: 'active' | 'disabled' | 'available' | 'platform';
  hasPlugin: boolean;
  source: string;
  installSource?: 'git' | string;
  gitUrl?: string;
  gitRef?: string;
  gitCommit?: string;
  gitSubdir?: string;
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  active: { label: 'active', color: '#2ecc71' },
  disabled: { label: 'disabled', color: '#e74c3c' },
  available: { label: 'available', color: '#f39c12' },
  platform: { label: 'platform', color: '#95a5a6' },
};

/**
 * 扩展来源徽章（installed/agent-installed/embedded/workspace）。
 * 影响是否可删除：embedded / workspace 不可在 TUI 内删除（属于发行包/源码仓库）。
 */
const SOURCE_BADGES: Record<string, { label: string; color: string }> = {
  installed:         { label: 'G', color: '#74b9ff' }, // Global installed
  'agent-installed': { label: 'A', color: '#ff7675' }, // Agent installed
  embedded:          { label: 'E', color: '#a29bfe' }, // Embedded
  workspace:         { label: 'W', color: '#fdcb6e' }, // Workspace dev
};

const GIT_INPUT_PLACEHOLDER = 'https://github.com/user/repo.git#main:extensions/demo';

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function splitFixedWidth(value: string, width: number): string[] {
  if (width <= 0) return [''];
  if (!value) return [''];
  const result: string[] = [];
  for (let index = 0; index < value.length; index += width) {
    result.push(value.slice(index, index + width));
  }
  return result.length > 0 ? result : [''];
}

function renderCursorChar(char: string, visible: boolean) {
  return visible
    ? <span bg={C.accent} fg={C.cursorFg}>{char || ' '}</span>
    : <span fg={C.text}>{char || ' '}</span>;
}

function GitInputFrame({
  value,
  cursor,
  cursorVisible,
}: {
  value: string;
  cursor: number;
  cursorVisible: boolean;
}) {
  const { width: terminalWidth } = useTerminalDimensions();
  // OpenTUI 的真实可用列数在不同终端/全屏缓冲区下可能比 useTerminalDimensions()
  // 返回值少几列；如果边框刚好铺满整行，右侧边角容易被终端自动换到下一行，
  // 看起来就像“边框嵌进输入内容”。这里主动留出安全边距，并限制最大宽度，
  // 让长 Git URL 通过内部多行换行展示，而不是让外层终端换行破坏边框。
  const safeTerminalWidth = Math.max(20, terminalWidth || 80);
  const frameWidth = Math.max(12, Math.min(88, safeTerminalWidth - 8));
  const innerWidth = Math.max(12, frameWidth - 4); // │ + spaces + content + spaces + │
  const safeCursor = clamp(cursor, 0, value.length);
  const topBorder = `${BORDER_CHARS.topLeft}${BORDER_CHARS.horizontal.repeat(innerWidth + 2)}${BORDER_CHARS.topRight}`;
  const bottomBorder = `${BORDER_CHARS.bottomLeft}${BORDER_CHARS.horizontal.repeat(innerWidth + 2)}${BORDER_CHARS.bottomRight}`;

  const lines = value
    ? splitFixedWidth(value, innerWidth)
    : splitFixedWidth(` ${GIT_INPUT_PLACEHOLDER}`, innerWidth - 1);
  if (value && safeCursor === value.length && value.length > 0 && value.length % innerWidth === 0) {
    lines.push('');
  }

  return (
    <box flexDirection="column" width={frameWidth} height={Math.max(3, lines.length + 2)} flexShrink={0}>
      <text wrapMode="none" fg={C.accent}>{topBorder}</text>
      {lines.map((line, lineIndex) => {
        const start = value ? lineIndex * innerWidth : 0;
        const end = start + line.length;

        const wrapLine = (node: React.ReactNode, visualWidth: number) => (
          <text key={`git-input-line-${lineIndex}`} wrapMode="none">
            <span fg={C.accent}>{`${BORDER_CHARS.vertical} `}</span>
            {node}
            <span>{' '.repeat(Math.max(0, innerWidth - visualWidth))}</span>
            <span fg={C.accent}>{` ${BORDER_CHARS.vertical}`}</span>
          </text>
        );

        if (!value) {
          const placeholderPart = line;
          return wrapLine(
            <>
              {lineIndex === 0 && renderCursorChar(' ', cursorVisible)}
              <span fg={C.dim}>{placeholderPart}</span>
            </>,
            placeholderPart.length + (lineIndex === 0 ? 1 : 0),
          );
        }

        if (safeCursor >= start && safeCursor < end) {
          const local = safeCursor - start;
          return wrapLine(
            <>
              <span fg={C.text}>{line.slice(0, local)}</span>
              {renderCursorChar(line[local] || ' ', cursorVisible)}
              <span fg={C.text}>{line.slice(local + 1)}</span>
            </>,
            line.length,
          );
        }

        if (safeCursor === end && lineIndex === lines.length - 1) {
          return wrapLine(
            <>
              <span fg={C.text}>{line}</span>
              {renderCursorChar(' ', cursorVisible)}
            </>,
            line.length + 1,
          );
        }

        return wrapLine(<span fg={C.text}>{line}</span>, line.length);
      })}
      <text wrapMode="none" fg={C.accent}>{bottomBorder}</text>
    </box>
  );
}

interface ExtensionListViewProps {
  extensions: ExtensionItem[];
  selectedIndex: number;
  /** 正在切换中的扩展名（显示 loading 状态） */
  togglingName: string | null;
  /** 最近一次操作的状态消息 */
  statusMessage: string | null;
  statusIsError: boolean;
  busy?: boolean;
  gitInputMode?: boolean;
  gitInputValue?: string;
  gitInputCursor?: number;
  gitInputCursorVisible?: boolean;
  /** 在 git-input 之前的 scope 选择子模式 */
  scopePickMode?: boolean;
  /** 当前已选 scope（仅显示用） */
  installScope?: 'global' | 'agent';
  pendingDeleteName?: string | null;
  pendingUpdateName?: string | null;
}

export function ExtensionListView({
  extensions,
  selectedIndex,
  togglingName,
  statusMessage,
  statusIsError,
  busy = false,
  gitInputMode = false,
  gitInputValue = '',
  gitInputCursor = 0,
  gitInputCursorVisible = true,
  scopePickMode = false,
  installScope = 'agent',
  pendingDeleteName = null,
  pendingUpdateName = null,
}: ExtensionListViewProps) {
  const total = extensions.length;
  const pluginCount = extensions.filter((item) => item.hasPlugin).length;
  const platformCount = total - pluginCount;

  return (
    <box flexDirection="column" width="100%" height="100%">
      <box padding={1}>
        <text fg={C.primary}>{`${ICONS.bullet} `}</text>
        <text fg={C.primary}>{'Extension '}</text>
        <text fg={C.dim}>{`(${pluginCount} plugins, ${platformCount} platforms)`}</text>
        <text fg={C.dim}>{busy
          ? '  处理中，请稍候...'
          : `  ${ICONS.arrowUp}${ICONS.arrowDown} 选择  Enter 标记  S 保存(启用时会安装缺失依赖)  G 拉取 Git  U 升级  D 删除  Esc 返回`}
        </text>
      </box>
      {scopePickMode && (
        <box flexDirection="column" paddingLeft={2} paddingRight={2} paddingBottom={1}>
          <text fg={C.primary}>{'选择安装范围：'}</text>
          <text fg={C.text}>{'  [1] 全局      ~/.iris/extensions/         （所有 agent 共享）'}</text>
          <text fg={C.text}>{'  [2] 此 agent  ~/.iris/agents/<id>/extensions/（仅当前 agent，优先级更高）'}</text>
          <text fg={C.dim}>{'按数字选择，Esc 取消。选完会进入 Git 地址输入。'}</text>
        </box>
      )}
      {gitInputMode && (
        <box flexDirection="column" paddingLeft={2} paddingRight={2} paddingBottom={1}>
          <text fg={C.primary}>{`Git 地址（→ ${installScope === 'global' ? '全局' : '此 agent'}，支持 #ref:subdir）：`}</text>
          <GitInputFrame value={gitInputValue} cursor={gitInputCursor} cursorVisible={gitInputCursorVisible} />
          <text fg={C.dim}>{'Enter 拉取并安装，Esc 取消。不会执行第三方 install/build 脚本。'}</text>
        </box>
      )}
      {statusMessage && (
        <box paddingLeft={2} paddingBottom={1}>
          <text fg={statusIsError ? C.error : C.accent}>{statusMessage}</text>
        </box>
      )}
      <scrollbox flexGrow={1}>
        {extensions.length === 0 && (
          <text fg={C.dim} paddingLeft={2}>
            {'No extensions found.'}
          </text>
        )}
        {extensions.map((item, index) => {
          const isSelected = index === selectedIndex;
          const statusInfo = STATUS_LABELS[item.status] ?? STATUS_LABELS.platform;
          const isToggling = item.name === togglingName;
          const isDirty = item.originalStatus != null && item.originalStatus !== item.status;
          const isGit = item.installSource === 'git' || !!item.gitUrl;
          const isPendingDelete = pendingDeleteName === item.name;
          const isPendingUpdate = pendingUpdateName === item.name;
          const showHeader = index === 0 || extensions[index - 1]?.hasPlugin !== item.hasPlugin;

          return (
            <box key={item.name} flexDirection="column">
              {showHeader && <text fg={C.primary}>{item.hasPlugin ? 'Plugins' : 'Platforms'}</text>}
              <box paddingLeft={1}>
              <text>
                <span fg={isSelected ? C.accent : C.dim}>
                  {isSelected ? `${ICONS.selectorArrow} ` : '  '}
                </span>
                <span fg={statusInfo.color}>{`[${isToggling ? '...' : `${statusInfo.label}${isDirty ? '*' : ''}`}] `}</span>
                {(() => {
                  const badge = SOURCE_BADGES[item.source];
                  return badge ? <span fg={badge.color}>{`[${badge.label}] `}</span> : null;
                })()}
                {isSelected
                  ? <strong><span fg={C.text}>{item.name}</span></strong>
                  : <span fg={C.textSec}>{item.name}</span>}
                <span fg={C.dim}>{` v${item.version}`}</span>
                {isGit && (
                  <span fg="#74b9ff">
                    {item.gitCommit ? ` [git:${item.gitCommit.slice(0, 8)}]` : ' [git]'}
                  </span>
                )}
                <span fg={C.dim}>{` ${ICONS.emDash} ${item.description || '(no description)'}`}</span>
                {isPendingDelete && <span fg={C.error}>{'  再按 D 确认删除'}</span>}
                {isPendingUpdate && <span fg={C.warn}>{'  再按 U 确认升级'}</span>}
              </text>
              </box>
            </box>
          );
        })}
      </scrollbox>
    </box>
  );
}
