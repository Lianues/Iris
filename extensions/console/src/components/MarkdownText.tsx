/** @jsxImportSource @opentui/react */

/**
 * Markdown 渲染组件 (OpenTUI React)
 *
 * 使用 OpenTUI 内置 <markdown> 组件渲染 Markdown 内容。
 * 支持流式模式（streaming）用于 LLM 逐 token 输出场景。
 */

import React, { useMemo } from 'react';
import { SyntaxStyle, parseColor } from '@opentui/core';
import { C } from '../theme';

/**
 * 构造与项目主题匹配的 SyntaxStyle。
 * 包含 Markdown 标记样式和代码块语法高亮样式。
 */
function createSyntaxStyle(): SyntaxStyle {
  return SyntaxStyle.fromStyles({
    // ── Markdown 标记 ──
    default:                 { fg: parseColor(C.text) },
    conceal:                 { fg: parseColor(C.dim) },
    'markup.heading':        { fg: parseColor(C.heading[1]), bold: true },
    'markup.heading.1':      { fg: parseColor(C.heading[1]), bold: true },
    'markup.heading.2':      { fg: parseColor(C.heading[2]), bold: true },
    'markup.heading.3':      { fg: parseColor(C.heading[3]), bold: true },
    'markup.heading.4':      { fg: parseColor(C.heading[4]), bold: true },
    'markup.strong':         { fg: parseColor(C.text), bold: true },
    'markup.italic':         { fg: parseColor(C.text), italic: true },
    'markup.strikethrough':  { fg: parseColor(C.dim) },
    'markup.raw':            { fg: parseColor(C.accent) },
    'markup.link':           { fg: parseColor(C.primaryLight), underline: true },
    'markup.link.url':       { fg: parseColor(C.dim) },
    'markup.link.label':     { fg: parseColor(C.primaryLight) },
    'markup.list':           { fg: parseColor(C.accent) },

    // ── 代码块语法高亮 (Tree-sitter token names) ──
    keyword:                 { fg: parseColor('#c792ea'), bold: true },
    'keyword.import':        { fg: parseColor('#c792ea'), bold: true },
    string:                  { fg: parseColor('#ecc48d') },
    comment:                 { fg: parseColor(C.dim), italic: true },
    number:                  { fg: parseColor('#f78c6c') },
    boolean:                 { fg: parseColor('#ff5370') },
    constant:                { fg: parseColor('#f78c6c') },
    function:                { fg: parseColor('#82aaff') },
    'function.call':         { fg: parseColor('#82aaff') },
    constructor:             { fg: parseColor('#ffcb6b') },
    type:                    { fg: parseColor('#ffcb6b') },
    operator:                { fg: parseColor('#89ddff') },
    variable:                { fg: parseColor(C.text) },
    property:                { fg: parseColor('#f07178') },
    bracket:                 { fg: parseColor(C.textSec) },
    punctuation:             { fg: parseColor(C.textSec) },
  });
}

interface MarkdownTextProps {
  text: string;
  showCursor?: boolean;
}

export function MarkdownText({ text, showCursor }: MarkdownTextProps) {
  const syntaxStyle = useMemo(() => createSyntaxStyle(), []);

  if (!text) {
    return showCursor ? <text><span bg={C.accent}>{' '}</span></text> : null;
  }

  return <markdown content={text} syntaxStyle={syntaxStyle} streaming={showCursor} />;
}
