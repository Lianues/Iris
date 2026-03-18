/**
 * Lark Phase 2 测试。
 *
 * 验证卡片构建器、命令解析器的功能。
 */

import { describe, expect, it } from 'vitest';
import { buildLarkCard, formatLarkToolLine } from '../src/platforms/lark/card-builder';
import { LarkCommandRouter, LARK_COMMANDS } from '../src/platforms/lark/commands';

describe('Lark Phase 2: card builder', () => {
  it('构建 thinking 卡片', () => {
    const card = buildLarkCard('thinking');
    expect(card.config.wide_screen_mode).toBe(true);
    expect(card.config.update_multi).toBe(true);
    expect(card.elements[0].tag).toBe('markdown');
    expect(card.elements[0].content).toContain('思考');
  });

  it('构建 streaming 卡片', () => {
    const card = buildLarkCard('streaming', {
      text: '正在生成...',
      toolEntries: [
        { id: '1', toolName: 'read_file', status: 'executing', createdAt: 1 },
      ],
    });
    expect(card.elements.length).toBe(2);
    expect(card.elements[0].content).toBe('正在生成...');
    expect(String(card.elements[1].content)).toContain('read_file');
  });

  it('构建 complete 卡片', () => {
    const card = buildLarkCard('complete', { text: '最终回复' });
    expect(card.elements[0].content).toBe('最终回复');
  });

  it('构建 error 卡片', () => {
    const card = buildLarkCard('complete', { text: '出错了', isError: true });
    const lastEl = card.elements[card.elements.length - 1];
    expect(String(lastEl.content)).toContain('出错');
  });

  it('构建 aborted 卡片', () => {
    const card = buildLarkCard('complete', { text: '部分内容', isAborted: true });
    const lastEl = card.elements[card.elements.length - 1];
    expect(String(lastEl.content)).toContain('停止');
  });

  it('格式化工具状态行', () => {
    expect(formatLarkToolLine({ toolName: 'read_file', status: 'executing' })).toContain('🔧');
    expect(formatLarkToolLine({ toolName: 'write_file', status: 'success' })).toContain('✅');
  });
});

describe('Lark Phase 2: command router', () => {
  const router = new LarkCommandRouter();

  it('解析基础命令', () => {
    expect(router.parse('/new')).toEqual({ name: 'new', args: '' });
    expect(router.parse('/model gpt-4')).toEqual({ name: 'model', args: 'gpt-4' });
  });

  it('非命令返回 null', () => {
    expect(router.parse('hello')).toBeNull();
  });

  it('帮助文本包含所有命令', () => {
    const help = router.buildHelpText();
    for (const cmd of LARK_COMMANDS) {
      expect(help).toContain(`/${cmd.name}`);
    }
  });
});
