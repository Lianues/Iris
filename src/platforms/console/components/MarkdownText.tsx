/**
 * Markdown 渲染组件 (OpenTUI React)
 *
 * 使用 marked.lexer() 将 Markdown 解析为 token 树，
 * 再将各 token 映射为 OpenTUI React 组件。
 *
 * 块级：标题、代码块、引用、有序/无序列表、分隔线、表格、段落
 * 行内：粗体、斜体、行内代码、删除线、链接
 */

import React, { useMemo } from 'react';
import { useTerminalDimensions } from '@opentui/react';
import { marked } from 'marked';
import { highlight } from 'cli-highlight';
import { C } from '../theme';

namespace Tokens {
  export interface Base {
    type: string;
    text?: string;
    tokens?: Token[];
  }

  export interface Text extends Base {
    type: 'text';
    text: string;
    tokens?: Token[];
  }

  export interface Strong extends Base {
    type: 'strong';
    tokens: Token[];
  }

  export interface Em extends Base {
    type: 'em';
    tokens: Token[];
  }

  export interface Codespan extends Base {
    type: 'codespan';
    text: string;
  }

  export interface Del extends Base {
    type: 'del';
    tokens: Token[];
  }

  export interface Link extends Base {
    type: 'link';
    href: string;
    text?: string;
    tokens?: Token[];
  }

  export interface Image extends Base {
    type: 'image';
    href: string;
    text: string;
  }

  export interface Br extends Base {
    type: 'br';
  }

  export interface Escape extends Base {
    type: 'escape';
    text: string;
  }

  export interface Heading extends Base {
    type: 'heading';
    depth: number;
    text: string;
    tokens: Token[];
  }

  export interface Paragraph extends Base {
    type: 'paragraph';
    tokens: Token[];
  }

  export interface Code extends Base {
    type: 'code';
    text: string;
    lang?: string;
  }

  export interface Blockquote extends Base {
    type: 'blockquote';
    tokens?: Token[];
  }

  export interface ListItem {
    task?: boolean;
    checked?: boolean;
    tokens: Token[];
  }

  export interface List extends Base {
    type: 'list';
    items: ListItem[];
    ordered?: boolean;
    start?: number;
  }

  export interface Hr extends Base {
    type: 'hr';
  }

  export interface TableCell {
    text: string;
    tokens: Token[];
  }

  export interface Table extends Base {
    type: 'table';
    header: TableCell[];
    rows: TableCell[][];
  }

  export interface HTML extends Base {
    type: 'html';
    text: string;
  }

  export interface Space extends Base {
    type: 'space';
  }

  export type Token =
    | Text
    | Strong
    | Em
    | Codespan
    | Del
    | Link
    | Image
    | Br
    | Escape
    | Heading
    | Paragraph
    | Code
    | Blockquote
    | List
    | Hr
    | Table
    | HTML
    | Space
    | Base;
}

type Token = Tokens.Token;

// ── 工具函数 ──────────────────────────────────────────────────

function displayWidth(str: string): number {
  let w = 0;
  for (const ch of str) {
    const c = ch.codePointAt(0) ?? 0;
    if (
      (c >= 0x1100 && c <= 0x115f) ||
      (c >= 0x2e80 && c <= 0x303e) ||
      (c >= 0x3040 && c <= 0x33bf) ||
      (c >= 0x3400 && c <= 0x4dbf) ||
      (c >= 0x4e00 && c <= 0xa4cf) ||
      (c >= 0xac00 && c <= 0xd7af) ||
      (c >= 0xf900 && c <= 0xfaff) ||
      (c >= 0xfe30 && c <= 0xfe4f) ||
      (c >= 0xff01 && c <= 0xff60) ||
      (c >= 0xffe0 && c <= 0xffe6) ||
      (c >= 0x20000 && c <= 0x2fffd) ||
      (c >= 0x30000 && c <= 0x3fffd)
    ) { w += 2; } else { w += 1; }
  }
  return w;
}

function unescape(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

// ── 行内 token 渲染 ──────────────────────────────────────────

function renderInline(tokens: Token[], kp = ''): React.ReactNode[] {
  const out: React.ReactNode[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const k = `${kp}${i}`;

    switch (t.type) {
      case 'text': {
        const tt = t as Tokens.Text;
        if (tt.tokens && tt.tokens.length > 0) {
          out.push(<span key={k}>{renderInline(tt.tokens, `${k}.`)}</span>);
        } else {
          out.push(<span key={k}>{unescape(tt.text)}</span>);
        }
        break;
      }
      case 'strong': {
        const tt = t as Tokens.Strong;
        out.push(
          <strong key={k}><span fg={C.text}>{renderInline(tt.tokens, `${k}.`)}</span></strong>,
        );
        break;
      }
      case 'em': {
        const tt = t as Tokens.Em;
        out.push(
          <em key={k}>{renderInline(tt.tokens, `${k}.`)}</em>,
        );
        break;
      }
      case 'codespan': {
        const tt = t as Tokens.Codespan;
        out.push(
          <span key={k} bg={C.dim} fg={C.text}>{` ${unescape(tt.text)} `}</span>,
        );
        break;
      }
      case 'del': {
        const tt = t as Tokens.Del;
        out.push(
          <span key={k} fg={C.dim}>~~{renderInline(tt.tokens, `${k}.`)}~~</span>,
        );
        break;
      }
      case 'link': {
        const tt = t as Tokens.Link;
        const label = tt.tokens?.length
          ? renderInline(tt.tokens, `${k}.`)
          : unescape(tt.text ?? tt.href);
        out.push(
          <span key={k}>
            <u><span fg={C.primaryLight}>{label}</span></u>
            {tt.href ? <span fg={C.dim}>{` (${tt.href})`}</span> : null}
          </span>,
        );
        break;
      }
      case 'image': {
        const tt = t as Tokens.Image;
        out.push(<span key={k} fg={C.dim}>[image: {unescape(tt.text || tt.href)}]</span>);
        break;
      }
      case 'br':
        out.push(<span key={k}>{'\n'}</span>);
        break;
      case 'escape':
        out.push(<span key={k}>{(t as Tokens.Escape).text}</span>);
        break;
      default: {
        if (Array.isArray(t.tokens)) {
          out.push(<span key={k}>{renderInline(t.tokens, `${k}.`)}</span>);
        } else if (typeof t.text === 'string') {
          out.push(<span key={k}>{unescape(t.text)}</span>);
        }
        break;
      }
    }
  }

  return out;
}

// ── 块级 token 渲染 ──────────────────────────────────────────

function renderBlock(
  token: Token,
  key: string,
  termWidth: number,
  cursor?: React.ReactNode,
): React.ReactNode {
  switch (token.type) {
    // ── 标题 ──
    case 'heading': {
      const t = token as Tokens.Heading;
      const color = C.heading[t.depth] ?? C.text;

      if (t.depth <= 2) {
        const lineChar = t.depth === 1 ? '\u2550' : '\u2500';
        const lineWidth = Math.max(displayWidth(unescape(t.text)), 4);
        return (
          <box key={key} flexDirection="column">
            <text fg={color}>
              <strong>{renderInline(t.tokens, `${key}.`)}</strong>
              {cursor}
            </text>
            <text fg={color}>{lineChar.repeat(lineWidth)}</text>
          </box>
        );
      }

      return (
        <box key={key}>
          <text fg={color}>
            <strong>{'#'.repeat(t.depth)} {renderInline(t.tokens, `${key}.`)}</strong>
            {cursor}
          </text>
        </box>
      );
    }

    // ── 段落 ──
    case 'paragraph': {
      const t = token as Tokens.Paragraph;
      return (
        <box key={key}>
          <text>
            {renderInline(t.tokens, `${key}.`)}
            {cursor}
          </text>
        </box>
      );
    }

    // ── 代码块 ──
    case 'code': {
      const t = token as Tokens.Code;

      // 使用 cli-highlight 进行高亮渲染
      let highlighted = t.text;
      try {
        highlighted = highlight(t.text, { language: t.lang || 'plaintext', ignoreIllegals: true });
      } catch (e) {
        // fallback
      }

      const lines = highlighted.split('\n');
      while (lines.length > 0 && lines[lines.length - 1].replace(/\x1b\[[0-9;]*m/g, '').trim() === '') {
        lines.pop();
      }
      return (
        <box key={key} flexDirection="column">
          <text>
            <span fg={C.dim}>{'\u256D\u2500 '}</span>
            <span fg={C.dim}><strong>{t.lang || 'code'}</strong></span>
          </text>
          {lines.map((line, li) => (
            <text key={li}>
              <span fg={C.dim}>{'\u2502  '}</span>
              {line}
            </text>
          ))}
          <text>
            <span fg={C.dim}>{'\u2570\u2500'}</span>
            {cursor}
          </text>
        </box>
      );
    }

    // ── 引用 ──
    case 'blockquote': {
      const t = token as Tokens.Blockquote;
      const inner = t.tokens || [];
      return (
        <box key={key} flexDirection="column">
          {inner.map((bt, bi) => {
            const isLast = bi === inner.length - 1;
            if (bt.type === 'paragraph') {
              return (
                <box key={bi}>
                  <text>
                    <span fg={C.dim}>{'\u258C '}</span>
                    <em><span fg={C.dim}>
                      {renderInline((bt as Tokens.Paragraph).tokens, `${key}.${bi}.`)}
                      {isLast && cursor}
                    </span></em>
                  </text>
                </box>
              );
            }
            return (
              <box key={bi} flexDirection="row">
                <text fg={C.dim}>{'\u258C '}</text>
                <box flexDirection="column">
                  {renderBlock(bt, `${key}.${bi}`, termWidth, isLast ? cursor : undefined)}
                </box>
              </box>
            );
          })}
        </box>
      );
    }

    // ── 列表 ──
    case 'list': {
      const t = token as Tokens.List;
      return (
        <box key={key} flexDirection="column">
          {t.items.map((item, ii) => {
            const isLastItem = ii === t.items.length - 1;
            let marker: string;
            if (item.task) {
              marker = item.checked ? '\u2611 ' : '\u2610 ';
            } else if (t.ordered) {
              marker = `${(t.start ?? 1) + ii}. `;
            } else {
              marker = '\u2022 ';
            }

            return (
              <box key={ii}>
                <text>{'  '}{marker}</text>
                <box flexDirection="column" flexGrow={1}>
                  {item.tokens.map((it, iti) => {
                    const isLastToken = iti === item.tokens.length - 1;
                    const itemCursor = isLastItem && isLastToken ? cursor : undefined;

                    if (it.type === 'text') {
                      const txt = it as Tokens.Text;
                      if (txt.tokens && txt.tokens.length > 0) {
                        return (
                          <text key={iti}>
                            {renderInline(txt.tokens, `${key}.${ii}.${iti}.`)}
                            {itemCursor}
                          </text>
                        );
                      }
                      return (
                        <text key={iti}>
                          {unescape(txt.text)}
                          {itemCursor}
                        </text>
                      );
                    }
                    return renderBlock(it, `${key}.${ii}.${iti}`, termWidth, itemCursor);
                  })}
                </box>
              </box>
            );
          })}
        </box>
      );
    }

    // ── 分隔线 ──
    case 'hr':
      return (
        <box key={key}>
          <text fg={C.dim}>{'\u2500'.repeat(Math.max(3, termWidth - 10))}{cursor}</text>
        </box>
      );

    // ── 表格 ──
    case 'table': {
      const t = token as Tokens.Table;
      const colCount = t.header.length;

      const colWidths: number[] = t.header.map(h => displayWidth(unescape(h.text)));
      for (const row of t.rows) {
        for (let ci = 0; ci < colCount; ci++) {
          if (ci < row.length) {
            colWidths[ci] = Math.max(colWidths[ci], displayWidth(unescape(row[ci].text)));
          }
        }
      }

      const renderCell = (cell: Tokens.TableCell, ci: number, kp: string, bold?: boolean): React.ReactNode => {
        const textW = displayWidth(unescape(cell.text));
        const total = Math.max(0, colWidths[ci] - textW);
        const padL = Math.floor(total / 2);
        const padR = total - padL;
        return (
          <span key={ci}>
            <span fg={C.dim}>{'\u2502'}</span>
            {' '.repeat(padL + 1)}
            {bold ? <strong>{renderInline(cell.tokens, kp)}</strong> : renderInline(cell.tokens, kp)}
            {' '.repeat(padR + 1)}
          </span>
        );
      };

      const hrLine = colWidths.map(w => '\u2500'.repeat(w + 2)).join('\u253C');
      const topLine = colWidths.map(w => '\u2500'.repeat(w + 2)).join('\u252C');
      const botLine = colWidths.map(w => '\u2500'.repeat(w + 2)).join('\u2534');

      return (
        <box key={key} flexDirection="column">
          <text fg={C.dim}>{'\u250C'}{topLine}{'\u2510'}</text>
          <text>
            {t.header.map((cell, ci) => renderCell(cell, ci, `${key}.h${ci}.`, true))}
            <span fg={C.dim}>{'\u2502'}</span>
          </text>
          <text fg={C.dim}>{'\u251C'}{hrLine}{'\u2524'}</text>
          {t.rows.map((row, ri) => (
            <text key={ri}>
              {row.map((cell, ci) => renderCell(cell, ci, `${key}.r${ri}.c${ci}.`))}
              <span fg={C.dim}>{'\u2502'}</span>
            </text>
          ))}
          <text fg={C.dim}>{'\u2514'}{botLine}{'\u2518'}</text>
          {cursor && <text>{cursor}</text>}
        </box>
      );
    }

    // ── HTML ──
    case 'html': {
      const t = token as Tokens.HTML;
      const text = t.text.trim();
      if (!text) return cursor ? <text key={key}>{cursor}</text> : null;
      return <text key={key} fg={C.dim}>{text}{cursor}</text>;
    }

    // ── 空行 ──
    case 'space':
      return cursor ? <text key={key}>{cursor}</text> : null;

    // ── 未知类型 ──
    default: {
      if (Array.isArray(token.tokens)) {
        return (
          <box key={key}>
            <text>
              {renderInline(token.tokens, `${key}.`)}
              {cursor}
            </text>
          </box>
        );
      }
      if (typeof token.text === 'string') {
        return (
          <text key={key}>
            {unescape(token.text)}
            {cursor}
          </text>
        );
      }
      return cursor ? <text key={key}>{cursor}</text> : null;
    }
  }
}

// ── 主组件 ────────────────────────────────────────────────

interface MarkdownTextProps {
  text: string;
  showCursor?: boolean;
}

export function MarkdownText({ text, showCursor }: MarkdownTextProps) {
  const { width: termWidth } = useTerminalDimensions();

  const tokens = useMemo<Token[] | null>(() => {
    if (!text) return null;
    try {
      return marked.lexer(text) as Token[];
    } catch {
      return null;
    }
  }, [text]);

  const cursorNode = showCursor
    ? <span bg={C.accent}>{' '}</span>
    : undefined;

  if (!text || !tokens || tokens.length === 0) {
    return showCursor ? <text><span bg={C.accent}>{' '}</span></text> : null;
  }

  let lastIdx = -1;
  for (let i = tokens.length - 1; i >= 0; i--) {
    if (tokens[i].type !== 'space') {
      lastIdx = i;
      break;
    }
  }

  if (lastIdx < 0) {
    return showCursor ? <text><span bg={C.accent}>{' '}</span></text> : null;
  }

  const nodes: React.ReactNode[] = [];
  for (let i = 0; i <= lastIdx; i++) {
    const isLast = i === lastIdx;
    const node = renderBlock(
      tokens[i],
      `b${i}`,
      termWidth,
      isLast ? cursorNode : undefined,
    );
    if (node != null) {
      nodes.push(node);
    }
  }

  if (nodes.length === 0) {
    return showCursor ? <text><span bg={C.accent}>{' '}</span></text> : null;
  }

  return <box flexDirection="column">{nodes}</box>;
}
