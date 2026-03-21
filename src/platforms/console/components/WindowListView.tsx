/** @jsxImportSource @opentui/react */

import React from 'react';
import type { WindowInfo } from '../../../computer-use/types';
import { C } from '../theme';

interface WindowListViewProps {
  windows: WindowInfo[];
  selectedIndex: number;
  searchText: string;
}

/**
 * 按关键词过滤窗口列表。
 * 匹配窗口标题、进程名称或类名（不区分大小写）。
 */
export function filterWindows(windows: WindowInfo[], searchText: string): WindowInfo[] {
  if (!searchText) return windows;
  const lower = searchText.toLowerCase();
  return windows.filter(
    (w) =>
      w.title.toLowerCase().includes(lower) ||
      w.processName.toLowerCase().includes(lower) ||
      w.className.toLowerCase().includes(lower),
  );
}

export function WindowListView({ windows, selectedIndex, searchText }: WindowListViewProps) {
  const filtered = filterWindows(windows, searchText);

  return (
    <box flexDirection="column" width="100%" height="100%">
      <box padding={1} flexDirection="column">
        <box>
          <text fg={C.primary}>窗口列表</text>
          <text fg={C.dim}>  ↑↓ 选择  Enter 绑定  Esc 返回  输入文字搜索</text>
        </box>
        {searchText ? (
          <box paddingTop={1}>
            <text fg={C.accent}>搜索: </text>
            <text fg={C.text}>{searchText}</text>
            <text fg={C.dim}>  (Backspace 删除)</text>
          </box>
        ) : null}
      </box>
      <scrollbox flexGrow={1}>
        {filtered.length === 0 && (
          <text fg={C.dim} paddingLeft={2}>
            {windows.length === 0 ? '未发现可见窗口' : '未找到匹配的窗口'}
          </text>
        )}
        {filtered.map((info, index) => {
          const isSelected = index === selectedIndex;
          return (
            <box key={info.hwnd} paddingLeft={1}>
              <text>
                <span fg={isSelected ? C.accent : C.dim}>{isSelected ? '❯ ' : '  '}</span>
                {isSelected ? (
                  <strong>
                    <span fg={C.text}>{info.title}</span>
                  </strong>
                ) : (
                  <span fg={C.textSec}>{info.title}</span>
                )}
                <span fg={C.dim}>
                  {'  '}{info.processName} [{info.processId}]
                </span>
                <span fg={isSelected ? C.primaryLight : C.dim}>
                  {'  '}{info.hwnd}
                </span>
              </text>
            </box>
          );
        })}
      </scrollbox>
    </box>
  );
}
