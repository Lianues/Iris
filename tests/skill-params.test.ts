/**
 * Skill 参数替换引擎测试。
 */

import { describe, expect, it } from 'vitest';
import { parseSkillArguments, substituteSkillParams } from '../src/tools/internal/skill-params';

describe('parseSkillArguments', () => {
  it('空字符串返回空结果', () => {
    const result = parseSkillArguments('');
    expect(result).toEqual({ raw: '', positional: [], named: {} });
  });

  it('仅空白返回空结果', () => {
    const result = parseSkillArguments('   ');
    expect(result).toEqual({ raw: '', positional: [], named: {} });
  });

  it('按空格分割位置参数', () => {
    const result = parseSkillArguments('src/main.ts dev');
    expect(result.positional).toEqual(['src/main.ts', 'dev']);
    expect(result.raw).toBe('src/main.ts dev');
  });

  it('支持双引号包裹含空格的参数', () => {
    const result = parseSkillArguments('"hello world" foo');
    expect(result.positional).toEqual(['hello world', 'foo']);
  });

  it('支持单引号包裹含空格的参数', () => {
    const result = parseSkillArguments("'hello world' foo");
    expect(result.positional).toEqual(['hello world', 'foo']);
  });

  it('按 namedKeys 顺序映射命名参数', () => {
    const result = parseSkillArguments('src/main.ts dev', ['file', 'branch']);
    expect(result.named).toEqual({ file: 'src/main.ts', branch: 'dev' });
  });

  it('位置参数不足时命名参数缺失', () => {
    const result = parseSkillArguments('src/main.ts', ['file', 'branch']);
    expect(result.named).toEqual({ file: 'src/main.ts' });
    expect(result.named.branch).toBeUndefined();
  });

  it('无 namedKeys 时 named 为空对象', () => {
    const result = parseSkillArguments('foo bar');
    expect(result.named).toEqual({});
  });
});

describe('substituteSkillParams', () => {
  const args = parseSkillArguments('src/core dev', ['file', 'branch']);

  it('替换 $ARGUMENTS 为完整参数��符串', () => {
    const result = substituteSkillParams('Review $ARGUMENTS', args);
    expect(result).toBe('Review src/core dev');
  });

  it('替换 $0 和 $1 为位置参数', () => {
    const result = substituteSkillParams('File: $0, Branch: $1', args);
    expect(result).toBe('File: src/core, Branch: dev');
  });

  it('位置参数越界时替换为空字符串', () => {
    const result = substituteSkillParams('$0 $1 $2 $3', args);
    expect(result).toBe('src/core dev  ');
  });

  it('替换命名参数 $file 和 $branch', () => {
    const result = substituteSkillParams(
      'Check $file on branch $branch',
      args,
      ['file', 'branch'],
    );
    expect(result).toBe('Check src/core on branch dev');
  });

  it('未声明的 $xxx 保持原样，但因无已知占位符仍追加参数', () => {
    const result = substituteSkillParams('$unknown stays', args, ['file']);
    // $unknown 不是已知占位符，视为"无占位符"，参数追加到末尾
    expect(result).toBe('$unknown stays\n\nARGUMENTS: src/core dev');
  });

  it('无占位符时追加 ARGUMENTS 到末尾', () => {
    const result = substituteSkillParams('Please review the code.', args);
    expect(result).toBe('Please review the code.\n\nARGUMENTS: src/core dev');
  });

  it('空参数时清空兼容占位符', () => {
    const emptyArgs = parseSkillArguments('');
    const result = substituteSkillParams('$ARGUMENTS and $0', emptyArgs);
    expect(result).toBe(' and ');
  });

  it('支持 Claude Code 的 $ARGUMENTS[n] 语法', () => {
    const args = parseSkillArguments('one "two words"');
    expect(substituteSkillParams('$ARGUMENTS[0]|$ARGUMENTS[1]|$ARGUMENTS[9]', args))
      .toBe('one|two words|');
  });

  it('支持反斜杠转义与空引号参数', () => {
    const args = parseSkillArguments('one\\ two "" three');
    expect(args.positional).toEqual(['one two', '', 'three']);
  });

  it('防止二次展开：$0 的值包含 $1 时不会再次替换', () => {
    // 构造 $0 的值本身含 $1 的场景
    const tricky = parseSkillArguments('$1 realarg');
    const result = substituteSkillParams('First: $0, Second: $1', tricky);
    // $0 → "$1"（字面量），$1 → "realarg"，结果中的 "$1" 不会再被展开
    expect(result).toBe('First: $1, Second: realarg');
  });

  it('多个 $ARGUMENTS 都被替换', () => {
    const result = substituteSkillParams('A: $ARGUMENTS, B: $ARGUMENTS', args);
    expect(result).toBe('A: src/core dev, B: src/core dev');
  });
});
