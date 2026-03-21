/**
 * Computer Use 工具定义
 *
 * 将 Computer 接口包装为 LLM 可调用的 ToolDefinition。
 * 适用于 browser 和 screen 两种执行环境，走普通 function calling 路径。
 *
 * 坐标约定：LLM 输出 0-999 归一化坐标，handler 内部完成反归一化。
 */

import { ToolDefinition } from '../types';
import type { CUToolPolicy } from '../config/types';
import type { Computer, EnvState } from './types';
import { denormalizeX, denormalizeY } from './coordinator';

/**
 * 将 EnvState 转为 handler 返回值。
 *
 * 使用 scheduler 的通用 __response / __parts 约定字段。
 * scheduler 会将 __parts（InlineDataPart[]）放入 functionResponse.parts，
 * 使截图作为多模态内联数据回传给模型。
 */
function toResult(state: EnvState): unknown {
  return {
    __response: { url: state.url },
    __parts: [{
      inlineData: {
        mimeType: 'image/png',
        data: state.screenshot.toString('base64'),
      },
    }],
  };
}

/** Computer Use 预定义函数名集合 */
export const COMPUTER_USE_FUNCTION_NAMES = new Set([
  'get_screenshot', 'click_at', 'hover_at', 'type_text_at',
  'scroll_document', 'scroll_at', 'key_combination', 'navigate',
  'go_back', 'go_forward', 'search', 'wait_5_seconds', 'drag_and_drop',
]);

/**
 * 各环境的内置默认工具策略。
 * 用户未配置 environmentTools 时使用这些默认值。
 */
export const DEFAULT_ENVIRONMENT_TOOLS: Record<string, CUToolPolicy> = {
  /** browser 环境：全部启用 */
  browser: {},

  /** screen 环境：排除浏览器导航相关工具 */
  screen: {
    exclude: ['go_back', 'go_forward', 'search'],
  },

  /** background 环境（screen + backgroundMode）：排除导航 + 拖拽 */
  background: {
    exclude: ['go_back', 'go_forward', 'search', 'drag_and_drop'],
  },
};

/**
 * 根据环境确定策略键名。
 */
export function resolveEnvironmentKey(
  environment: 'browser' | 'screen',
  backgroundMode?: boolean,
): string {
  if (environment === 'screen' && backgroundMode) return 'background';
  return environment;
}

/**
 * 根据工具策略过滤工具列表。
 * include 优先于 exclude；都不配置则全部保留。
 */
function applyToolPolicy(tools: ToolDefinition[], policy: CUToolPolicy): ToolDefinition[] {
  if (policy.include) {
    const allowed = new Set(policy.include);
    return tools.filter(t => allowed.has(t.declaration.name));
  }
  if (policy.exclude) {
    const blocked = new Set(policy.exclude);
    return tools.filter(t => !blocked.has(t.declaration.name));
  }
  return tools;
}

/**
 * 创建 Computer Use 工具定义，根据环境策略过滤。
 *
 * @param computer 执行环境实例
 * @param envKey 环境键名（browser / screen / background）
 * @param userPolicy 用户配置的工具策略（覆盖内置默认）
 */
export function createComputerUseTools(
  computer: Computer,
  envKey: string,
  userPolicy?: CUToolPolicy,
): ToolDefinition[] {
  /** 每次调用实时获取屏幕/窗口尺寸，适应窗口大小变化 */
  const sz = () => computer.screenSize();

  const all: ToolDefinition[] = [
    // ---- 截图与导航 ----
    {
      declaration: {
        name: 'get_screenshot',
        description: '获取当前屏幕截图。用于查看当前屏幕内容、确认操作结果、或在开始操作前了解当前界面状态。',
      },
      handler: async () => toResult(await computer.openWebBrowser()),
    },
    {
      declaration: {
        name: 'go_back',
        description: '后退到上一页。在浏览器中触发后退导航，在桌面环境中发送 Alt+Left。',
      },
      handler: async () => toResult(await computer.goBack()),
    },
    {
      declaration: {
        name: 'go_forward',
        description: '前进到下一页。在浏览器中触发前进导航，在桌面环境中发送 Alt+Right。',
      },
      handler: async () => toResult(await computer.goForward()),
    },
    {
      declaration: {
        name: 'search',
        description: '打开搜索引擎首页。在需要从新的搜索开始时使用。',
      },
      handler: async () => toResult(await computer.search()),
    },
    {
      declaration: {
        name: 'navigate',
        description: '在浏览器中打开指定 URL。桌面环境下会调用系统默认浏览器。',
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string', description: '目标 URL' },
          },
          required: ['url'],
        },
      },
      handler: async (args) => toResult(await computer.navigate(args.url as string)),
    },
    {
      declaration: {
        name: 'wait_5_seconds',
        description: '等待 5 秒。用于等待内容加载、动画播放或界面更新完成。',
      },
      handler: async () => toResult(await computer.wait5Seconds()),
    },

    // ---- 鼠标操作 ----
    {
      declaration: {
        name: 'click_at',
        description: '点击屏幕上的指定位置。x 和 y 为 0-999 的归一化坐标，按比例映射到屏幕实际像素。',
        parameters: {
          type: 'object',
          properties: {
            x: { type: 'number', description: 'X 坐标 (0-999)' },
            y: { type: 'number', description: 'Y 坐标 (0-999)' },
          },
          required: ['x', 'y'],
        },
      },
      handler: async (args) => {
        const [sw, sh] = sz();
        return toResult(await computer.clickAt(
          denormalizeX(args.x as number, sw),
          denormalizeY(args.y as number, sh),
        ));
      },
    },
    {
      declaration: {
        name: 'hover_at',
        description: '将鼠标悬停在指定位置。可用于触发悬停菜单或提示信息。x 和 y 为 0-999 的归一化坐标。',
        parameters: {
          type: 'object',
          properties: {
            x: { type: 'number', description: 'X 坐标 (0-999)' },
            y: { type: 'number', description: 'Y 坐标 (0-999)' },
          },
          required: ['x', 'y'],
        },
      },
      handler: async (args) => {
        const [sw, sh] = sz();
        return toResult(await computer.hoverAt(
          denormalizeX(args.x as number, sw),
          denormalizeY(args.y as number, sh),
        ));
      },
    },
    {
      declaration: {
        name: 'drag_and_drop',
        description: '将元素从起始坐标拖放到目标坐标。所有坐标为 0-999 的归一化值。',
        parameters: {
        type: 'object',
          properties: {
            x: { type: 'number', description: '起始 X 坐标 (0-999)' },
            y: { type: 'number', description: '起始 Y 坐标 (0-999)' },
            destination_x: { type: 'number', description: '目标 X 坐标 (0-999)' },
            destination_y: { type: 'number', description: '目标 Y 坐标 (0-999)' },
          },
          required: ['x', 'y', 'destination_x', 'destination_y'],
        },
      },
      handler: async (args) => {
        const [sw, sh] = sz();
        return toResult(await computer.dragAndDrop(
          denormalizeX(args.x as number, sw),
          denormalizeY(args.y as number, sh),
          denormalizeX(args.destination_x as number, sw),
          denormalizeY(args.destination_y as number, sh),
        ));
      },
    },

    // ---- 键盘操作 ----
    {
      declaration: {
        name: 'type_text_at',
        description: [
          '在指定位置输入文本。',
          '点击目标坐标后输入文本。',
          '默认不清空已有内容，不自动按回车。',
          '如需清空输入框再输入，设 clear_before_typing=true（会 Ctrl+A 全选后删除）。',
          '如需输入后按回车，设 press_enter=true。',
          '某些情况下，如需换行而非提交，改用 key_combination 发送 Shift+Enter 等组合键避免提交。',
          'x 和 y 为 0-999 的归一化坐标。',
        ].join(''),
        parameters: {
          type: 'object',
          properties: {
            x: { type: 'number', description: 'X 坐标 (0-999)' },
            y: { type: 'number', description: 'Y 坐标 (0-999)' },
            text: { type: 'string', description: '要输入的文本' },
            press_enter: { type: 'boolean', description: '输入后是否按回车，默认 false' },
            clear_before_typing: { type: 'boolean', description: '输入前是否 Ctrl+A 全选并删除已有内容，默认 false' },
          },
          required: ['x', 'y', 'text'],
        },
      },
      handler: async (args) => {
        const [sw, sh] = sz();
        return toResult(await computer.typeTextAt(
          denormalizeX(args.x as number, sw),
          denormalizeY(args.y as number, sh),
          args.text as string,
          (args.press_enter as boolean | undefined) ?? false,
          (args.clear_before_typing as boolean | undefined) ?? false,
        ));
      },
    },
    {
      declaration: {
        name: 'key_combination',
        description: '按下键盘按键或组合键。例如 "Control+C"、"Enter"、"Alt+Tab"。多个键用 "+" 连接。',
        parameters: {
          type: 'object',
          properties: {
            keys: { type: 'string', description: '按键描述，如 "Enter"、"Control+C"、"Alt+F4"' },
          },
          required: ['keys'],
        },
      },
      handler: async (args) => {
        const keys = (args.keys as string).split('+').map(k => k.trim());
        return toResult(await computer.keyCombination(keys));
      },
    },

    // ---- 滚动 ----
    {
      declaration: {
        name: 'scroll_document',
        description: '滚动当前窗口内容。direction 可选 "up"、"down"、"left"、"right"。',
        parameters: {
          type: 'object',
          properties: {
            direction: { type: 'string', description: '滚动方向: up / down / left / right' },
          },
          required: ['direction'],
        },
      },
      handler: async (args) => toResult(
        await computer.scrollDocument(args.direction as 'up' | 'down' | 'left' | 'right'),
      ),
    },
    {
      declaration: {
        name: 'scroll_at',
        description: [
          '在指定位置按方向滚动指定幅度。',
          '坐标和幅度均为0-999 的归一化值。默认幅度 800。',
        ].join(''),
        parameters: {
          type: 'object',
          properties: {
            x: { type: 'number', description: 'X 坐标 (0-999)' },
            y: { type: 'number', description: 'Y 坐标 (0-999)' },
            direction: { type: 'string', description: '滚动方向: up / down / left / right' },
            magnitude: { type: 'number', description: '滚动幅度 (0-999)，默认 800' },
          },
          required: ['x', 'y', 'direction'],
        },
      },
      handler: async (args) => {
        const direction = args.direction as 'up' | 'down' | 'left' | 'right';
        const rawMagnitude = (args.magnitude as number | undefined) ?? 800;
        const [sw, sh] = sz();
        // magnitude 也是归一化值，需要按方向反归一化
        const magnitude = (direction === 'up' || direction === 'down')
          ? denormalizeY(rawMagnitude, sh)
          : denormalizeX(rawMagnitude, sw);
        return toResult(await computer.scrollAt(
          denormalizeX(args.x as number, sw),
          denormalizeY(args.y as number, sh),
          direction,
          magnitude,
        ));
      },
    },
  ];

  // 用户策略覆盖内置默认；未配置则使用内置默认
  const policy = userPolicy ?? DEFAULT_ENVIRONMENT_TOOLS[envKey] ?? {};
  return applyToolPolicy(all, policy);
}
