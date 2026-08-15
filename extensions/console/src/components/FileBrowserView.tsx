/** @jsxImportSource @opentui/react */

/**
 * TUI 文件浏览器视图
 *
 * 显示当前目录的文件和子目录，支持键盘导航。
 * 与 SessionListView、ModelListView 同构的列表视图。
 */

import React from 'react';
import { C } from '../theme';
import { ICONS, terminalTier } from '../terminal-compat';

/** 文件浏览器的目录条目 */
export interface FileBrowserEntry {
  name: string;
  isDirectory: boolean;
  /** 文件大小（字节），目录为 undefined */
  size?: number;
  /** 文件类型分类 */
  fileType?: 'image' | 'audio' | 'video' | 'document' | 'other';
}

interface FileBrowserViewProps {
  /** 当前浏览的目录路径 */
  currentPath: string;
  /** 目录内容 */
  entries: FileBrowserEntry[];
  selectedIndex: number;
  /** 是否显示隐藏文件 */
  showHidden: boolean;
}

const FILE_TYPE_ICONS: Record<string, { modern: string; basic: string }> = {
  image:    { modern: '📷', basic: '[I]' },
  audio:    { modern: '🎵', basic: '[A]' },
  video:    { modern: '🎬', basic: '[V]' },
  document: { modern: '📄', basic: '[D]' },
  other:    { modern: '📎', basic: '[?]' },
};

const DIR_ICON = terminalTier === 'basic' ? '[/]' : '📁';

function fileIcon(fileType?: string): string {
  const entry = FILE_TYPE_ICONS[fileType || 'other'] || FILE_TYPE_ICONS.other;
  return terminalTier === 'basic' ? entry.basic : entry.modern;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}G`;
}

export function FileBrowserView({ currentPath, entries, selectedIndex, showHidden }: FileBrowserViewProps) {
  return (
    <box flexDirection="column" width="100%" height="100%">
      {/* 标题 + 路径 + 操作提示 */}
      <box flexDirection="column" paddingX={1} paddingTop={1} flexShrink={0}>
        <text>
          <span fg={C.primary}>文件浏览器</span>
          <span fg={C.dim}>{`  ${ICONS.arrowUp}${ICONS.arrowDown} 导航  Enter 选择/进入  Backspace 上级  `}</span>
          <span fg={C.dim}>{`. 隐藏文件${showHidden ? '(显示中)' : '(已隐藏)'}  Esc 取消`}</span>
        </text>
        <text fg={C.warn}>{`${ICONS.selectorArrow} ${currentPath}`}</text>
      </box>

      {/* 文件列表 */}
      <scrollbox flexGrow={1} paddingTop={1}>
        {entries.length === 0 && (
          <text fg={C.dim} paddingLeft={2}>(空目录)</text>
        )}
        {entries.map((entry, index) => {
          const isSelected = index === selectedIndex;
          const icon = entry.isDirectory
            ? DIR_ICON
            : fileIcon(entry.fileType);
          const nameColor = entry.isDirectory
            ? (isSelected ? C.warn : '#e0ac69')
            : (isSelected ? C.text : C.textSec);

          return (
            <box key={entry.name} paddingLeft={1}>
              <text>
                <span fg={isSelected ? C.accent : C.dim}>
                  {isSelected ? `${ICONS.selectorArrow} ` : '  '}
                </span>
                <span>{icon} </span>
                {isSelected
                  ? <strong><span fg={nameColor}>{entry.name}</span></strong>
                  : <span fg={nameColor}>{entry.name}</span>}
                {entry.isDirectory
                  ? <span fg={C.dim}>/</span>
                  : (entry.size != null
                    ? <span fg={C.dim}>{`  ${formatSize(entry.size)}`}</span>
                    : null)}
              </text>
            </box>
          );
        })}
      </scrollbox>
    </box>
  );
}
