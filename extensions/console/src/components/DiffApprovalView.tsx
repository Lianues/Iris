/** @jsxImportSource @opentui/react */

/**
 * diff 审批视图
 *
 * 数据来源统一为 Backend.getToolDiffPreview，避免 Console 本地读取文件导致
 * session cwd / remote 场景下展示错误 diff。
 */

import React, { useEffect, useMemo, useState } from 'react';
import type { ToolDiffPreviewItemLike, ToolDiffPreviewResponseLike, ToolInvocation } from 'irises-extension-sdk';
import { C } from '../theme';
import { ICONS } from '../terminal-compat';

interface DiffApprovalViewProps {
  invocation: ToolInvocation;
  pendingCount: number;
  choice: 'approve' | 'reject';
  view: 'unified' | 'split';
  showLineNumbers: boolean;
  wrapMode: 'none' | 'word';
  previewIndex?: number;
  getPreview?: (toolId: string) => ToolDiffPreviewResponseLike | Promise<ToolDiffPreviewResponseLike>;
}

function normalizePreviewIndex(index: number, itemCount: number): number {
  return itemCount > 0 ? ((index % itemCount) + itemCount) % itemCount : 0;
}

function loadingPreview(invocation: ToolInvocation): ToolDiffPreviewResponseLike {
  return {
    toolName: invocation.toolName,
    title: 'Diff 审批',
    toolLabel: invocation.toolName,
    summary: ['正在加载 diff 预览…'],
    items: [],
  };
}

function errorPreview(invocation: ToolInvocation, message: string): ToolDiffPreviewResponseLike {
  return {
    toolName: invocation.toolName,
    title: 'Diff 审批',
    toolLabel: invocation.toolName,
    summary: ['生成预览失败。'],
    items: [{
      id: `${invocation.id}:preview.error`,
      filePath: typeof invocation.args.path === 'string' ? invocation.args.path : '',
      label: invocation.toolName,
      added: 0,
      removed: 0,
      message,
    }],
  };
}

export function DiffApprovalView({
  invocation,
  pendingCount,
  choice,
  view,
  showLineNumbers,
  wrapMode,
  previewIndex = 0,
  getPreview,
}: DiffApprovalViewProps) {
  const [preview, setPreview] = useState<ToolDiffPreviewResponseLike>(() => loadingPreview(invocation));
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    if (!getPreview) {
      setLoading(false);
      setPreview(errorPreview(invocation, '当前平台不支持 diff 预览。'));
      return () => { cancelled = true; };
    }

    setLoading(true);
    setPreview(loadingPreview(invocation));
    Promise.resolve(getPreview(invocation.id))
      .then((nextPreview) => {
        if (cancelled) return;
        setPreview(nextPreview);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setPreview(errorPreview(invocation, err instanceof Error ? err.message : String(err)));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [getPreview, invocation.id]);

  const items = preview.items ?? [];
  const normalizedPreviewIndex = normalizePreviewIndex(previewIndex, items.length);
  const currentItem = items[normalizedPreviewIndex] as ToolDiffPreviewItemLike | undefined;
  const toolLabel = preview.toolLabel ?? preview.toolName ?? invocation.toolName;

  const summaryLines = useMemo(() => {
    if (loading && preview.summary.length === 0) return ['正在加载 diff 预览…'];
    return preview.summary ?? [];
  }, [loading, preview.summary]);

  return (
    <box flexDirection="column" width="100%" height="100%" padding={1} backgroundColor="#0d1117">
      {/* 头部信息 */}
      <box flexDirection="column" borderStyle="double" borderColor={C.warn} paddingX={1} paddingY={0} flexShrink={0}>
        <text>
          <span fg={C.warn}><strong>{preview.title || 'Diff 审批'}</strong></span>
          <span fg={C.dim}>{`  ${toolLabel}`}</span>
          {pendingCount > 1 ? <span fg={C.dim}>{`  (剩余 ${pendingCount - 1} 个)`}</span> : null}
          {items.length > 1 ? <span fg={C.dim}>{`  (预览 ${normalizedPreviewIndex + 1}/${items.length})`}</span> : null}
          {currentItem?.diff ? <span fg={C.dim}>{`  +${currentItem.added} -${currentItem.removed}`}</span> : null}
        </text>
        <text>
          <span fg={C.text}>文件 </span>
          <span fg={C.primaryLight}>{currentItem?.filePath || '(未提供路径)'}</span>
          <span fg={C.dim}>{`  视图:${view === 'split' ? '分栏' : '统一'}  行号:${showLineNumbers ? '开' : '关'}  换行:${wrapMode === 'word' ? '开' : '关'}`}</span>
        </text>
        {currentItem?.label ? <text fg={C.dim}>{currentItem.label}</text> : null}
        {summaryLines.map((line: string, index: number) => (
          <text key={`${toolLabel}.summary.${index}`} fg={C.dim}>{line}</text>
        ))}
      </box>

      {/* diff 内容区（带滚动条） */}
      <scrollbox
        flexGrow={1}
        flexShrink={1}
        marginTop={1}
        borderStyle="single"
        borderColor={C.border}
        verticalScrollbarOptions={{ visible: true }}
        horizontalScrollbarOptions={{ visible: false }}
      >
        {loading ? (
          <text fg={C.dim} paddingX={1} paddingY={1}>加载 diff 预览中…</text>
        ) : currentItem?.diff ? (
          <diff
            diff={currentItem.diff}
            view={view}
            filetype={currentItem.filetype}
            showLineNumbers={showLineNumbers}
            wrapMode={wrapMode}
            addedBg="#17361f"
            removedBg="#3b1f24"
            contextBg="#0d1117"
            lineNumberFg="#6b7280"
            lineNumberBg="#111827"
            addedLineNumberBg="#122b18"
            removedLineNumberBg="#2f161b"
            addedSignColor="#22c55e"
            removedSignColor="#ef4444"
            selectionBg="#264f78"
            selectionFg="#ffffff"
            style={{ width: '100%' }}
          />
        ) : (
          <text fg={currentItem?.message ? C.textSec : C.dim} paddingX={1} paddingY={1}>
            {currentItem?.message ?? '当前没有可显示的 diff。'}
          </text>
        )}
      </scrollbox>

      {/* 底部操作区 */}
      <box flexDirection="column" marginTop={1} borderStyle="single" borderColor={choice === 'approve' ? C.accent : C.error} paddingX={1} paddingY={0} flexShrink={0}>
        <text>
          <span fg={C.text}>审批结果 </span>
          <span fg={choice === 'approve' ? C.accent : C.textSec}>{choice === 'approve' ? '[批准]' : ' 批准 '}</span>
          <span fg={C.dim}> </span>
          <span fg={choice === 'reject' ? C.error : C.textSec}>{choice === 'reject' ? '[拒绝]' : ' 拒绝 '}</span>
        </text>
        <text fg={C.dim}>
          {items.length > 1 ? `${ICONS.arrowUp} / ${ICONS.arrowDown} 切换文件　` : ''}
          {`Tab / ${ICONS.arrowLeft} / ${ICONS.arrowRight} 切换　Enter 确认　Y 批准　N 拒绝　V 切换视图　L 切换行号　W 切换换行　Esc 中断本次生成`}
        </text>
      </box>
    </box>
  );
}
