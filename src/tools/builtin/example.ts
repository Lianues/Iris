/**
 * 示例工具 —— 获取当前时间
 *
 * 这是一个最简单的工具示例，展示如何定义 ToolDefinition。
 * 添加新工具时，参照此文件的结构即可。
 */

import { ToolDefinition } from '../../types';

/** 获取当前时间 */
export const getCurrentTime: ToolDefinition = {
  parallel: true,
  declaration: {
    name: 'get_current_time',
    description: '获取当前的日期和时间',
  },
  handler: async () => {
    const now = new Date();
    return {
      iso: now.toISOString(),
      local: now.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
      timestamp: now.getTime(),
    };
  },
};

/** 安全数学表达式求值器（递归下降解析） */
function safeEvaluate(expr: string): number {
  let pos = 0;
  const str = expr.replace(/\s+/g, '');

  function parseExpr(): number {
    let result = parseTerm();
    while (pos < str.length && (str[pos] === '+' || str[pos] === '-')) {
      const op = str[pos++];
      const right = parseTerm();
      result = op === '+' ? result + right : result - right;
    }
    return result;
  }

  function parseTerm(): number {
    let result = parseFactor();
    while (pos < str.length && (str[pos] === '*' || str[pos] === '/')) {
      const op = str[pos++];
      const right = parseFactor();
      if (op === '/' && right === 0) throw new Error('除以零');
      result = op === '*' ? result * right : result / right;
    }
    return result;
  }

  function parseFactor(): number {
    if (str[pos] === '(') {
      pos++; // skip '('
      const result = parseExpr();
      if (str[pos] !== ')') throw new Error('括号不匹配');
      pos++; // skip ')'
      return result;
    }
    // handle unary minus
    if (str[pos] === '-') {
      pos++;
      return -parseFactor();
    }
    // parse number
    const start = pos;
    while (pos < str.length && (str[pos] >= '0' && str[pos] <= '9' || str[pos] === '.')) {
      pos++;
    }
    if (pos === start) throw new Error(`意外的字符: ${str[pos] ?? 'EOF'}`);
    return parseFloat(str.slice(start, pos));
  }

  const result = parseExpr();
  if (pos < str.length) throw new Error(`意外的字符: ${str[pos]}`);
  return result;
}

/** 简单计算器 */
export const calculator: ToolDefinition = {
  parallel: true,
  declaration: {
    name: 'calculator',
    description: '计算一个数学表达式的结果',
    parameters: {
  type: 'object',
      properties: {
        expression: {
          type: 'string',
          description: '数学表达式，例如 "2 + 3 * 4"',
        },
      },
      required: ['expression'],
    },
  },
  handler: async (args) => {
    const expr = args.expression as string;
    const result = safeEvaluate(expr);
    return { expression: expr, result };
  },
};
