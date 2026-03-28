/**
 * Telegram Phase 2 测试。
 *
 * 验证消息构建器、命令解析器的升级功能。
 */

import { describe, expect, it } from 'vitest';
import { TelegramMessageBuilder, formatTelegramToolLine } from '../extensions/telegram/src/message-builder';
import { TelegramCommandRouter, TELEGRAM_BOT_COMMANDS } from '../extensions/telegram/src/commands';

describe('Telegram Phase 2: message builder', () => {
  const builder = new TelegramMessageBuilder();

  it('构建 thinking 占位文本', () => {
    expect(builder.buildThinkingText()).toContain('思考');
  });

  it('构建错误文本', () => {
    expect(builder.buildErrorText('timeout')).toContain('❌');
    expect(builder.buildErrorText('timeout')).toContain('timeout');
  });

  it('构建中止文本（有 buffer）', () => {
    expect(builder.buildAbortedText('已输出部分')).toContain('已输出部分');
    expect(builder.buildAbortedText('已输出部分')).toContain('已中止');
  });

  it('构建中止文本（无 buffer）', () => {
    expect(builder.buildAbortedText('')).toContain('已中止');
  });

  it('格式化工具状态行', () => {
    expect(formatTelegramToolLine({ toolName: 'read_file', status: 'executing' })).toContain('🔧');
    expect(formatTelegramToolLine({ toolName: 'read_file', status: 'executing' })).toContain('read_file');
    expect(formatTelegramToolLine({ toolName: 'write_file', status: 'success' })).toContain('✅');
    expect(formatTelegramToolLine({ toolName: 'shell', status: 'error' })).toContain('❌');
  });
});

describe('Telegram Phase 2: command router', () => {
  const router = new TelegramCommandRouter();

  it('解析基础命令', () => {
    expect(router.parse('/new')).toEqual({ name: 'new', args: '' });
    expect(router.parse('/model gpt-4')).toEqual({ name: 'model', args: 'gpt-4' });
  });

  it('去除 @botname 后缀', () => {
    expect(router.parse('/new@iris_bot')).toEqual({ name: 'new', args: '' });
    expect(router.parse('/model@iris_bot gpt-4')).toEqual({ name: 'model', args: 'gpt-4' });
  });

  it('非命令返回 null', () => {
    expect(router.parse('hello')).toBeNull();
    expect(router.parse('')).toBeNull();
  });

  it('帮助文本包含所有命令', () => {
    const help = router.buildHelpText();
    for (const cmd of TELEGRAM_BOT_COMMANDS) {
      expect(help).toContain(`/${cmd.command}`);
    }
  });
});
