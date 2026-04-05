/**
 * 统一配置贡献注册中心类型定义
 *
 * 允许插件声明式注册自己的配置 schema（字段定义、默认值、验证规则），
 * 宿主/平台可统一查询所有已注册的配置 schema 并渲染各自的设置 UI。
 *
 * 这是对现有 registerConsoleSettingsTab 的通用化升级：
 * - registerConsoleSettingsTab 仅限 Console TUI 平台使用
 * - ConfigContribution 是平台无关的通用配置注册，任何平台都可以消费
 *
 * 使用示例：
 * ```typescript
 * // 插件 —— 注册配置
 * activate(ctx) {
 *   ctx.getConfigContributions().register({
 *     sectionId: 'memory',
 *     title: '记忆系统',
 *     fields: [
 *       { key: 'provider', type: 'select', label: '存储引擎', default: 'local',
 *         options: [{ label: '本地文件', value: 'local' }, { label: 'Letta', value: 'letta' }] },
 *       { key: 'autoRecall', type: 'boolean', label: '自动召回', default: true },
 *     ],
 *     onLoad: () => ctx.readConfigSection('memory') ?? {},
 *     onSave: (values) => { // 写回 memory.yaml },
 *   });
 * }
 *
 * // 平台 —— 消费配置（渲染自己的 UI）
 * const allConfigs = api.configContributions.getAll();
 * // Web  → 渲染为 HTML 表单
 * // Console → 渲染为终端交互表单
 * // Telegram → 渲染为 inline keyboard
 * ```
 */

import type { Disposable } from './service.js';

/** 配置字段 schema */
export interface ConfigFieldSchema {
  /** 字段 key（在该 section 内唯一） */
  key: string;
  /** 字段类型 */
  type: 'string' | 'number' | 'boolean' | 'select' | 'multiselect' | 'text' | 'password' | 'json';
  /** 显示标签 */
  label: string;
  /** 帮助描述 */
  description?: string;
  /** 默认值 */
  default?: unknown;
  /** 是否必填 */
  required?: boolean;
  /** select/multiselect 的选项列表 */
  options?: Array<{ label: string; value: string | number }>;
  /** 验证规则 */
  validation?: {
    min?: number;
    max?: number;
    pattern?: string;
    message?: string;
  };
  /** 分组/分类标签，方便 UI 按组聚类显示 */
  group?: string;
}

/** 插件注册的配置贡献 */
export interface ConfigContribution {
  /** 贡献来源插件名（由宿主自动填充，无需手动设置） */
  pluginName?: string;
  /** 配置分区唯一标识，如 "memory"、"cron" */
  sectionId: string;
  /** 显示标题 */
  title: string;
  /** 描述 */
  description?: string;
  /** 配置字段 schema 列表 */
  fields: ConfigFieldSchema[];
  /** 读取当前值（设置页面打开时调用） */
  onLoad(): Promise<Record<string, unknown>> | Record<string, unknown>;
  /** 保存修改后的值（用户保存时调用） */
  onSave(values: Record<string, unknown>): Promise<void> | void;
}

/** 配置贡献注册中心接口 */
export interface ConfigContributionRegistryLike {
  /**
   * 注册一个配置贡献。
   * @param contribution 配置贡献定义
   * @returns Disposable，调用 dispose() 注销
   * @throws 如果 sectionId 已被注册
   */
  register(contribution: ConfigContribution): Disposable;

  /** 获取所有已注册的配置贡献 */
  getAll(): ConfigContribution[];

  /** 按 sectionId 获取指定配置贡献 */
  get(sectionId: string): ConfigContribution | undefined;

  /** 获取指定插件注册的所有配置贡献 */
  getByPlugin(pluginName: string): ConfigContribution[];

  /** 监听配置贡献变化（注册/注销时触发） */
  onDidChange(listener: () => void): Disposable;
}
