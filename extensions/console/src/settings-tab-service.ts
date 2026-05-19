import type { ConfigManagerLike, Disposable, RawEditableConfig } from 'irises-extension-sdk';
import { createKeyedRegistry, createListenerSignal } from './service-registry-utils';

export const CONSOLE_SETTINGS_TAB_SERVICE_ID = 'console:settings-tab';

/** Console Settings Tab 中的单个表单字段 */
export interface ConsoleSettingsField {
  /** 字段唯一标识（在该 tab 内唯一） */
  key: string;
  /** 显示标签 */
  label: string;
  /** 字段类型 */
  type: 'toggle' | 'number' | 'text' | 'select' | 'readonly' | 'action';
  /** select 类型的可选项 */
  options?: { label: string; value: string }[];
  /** 默认值 */
  defaultValue?: unknown;
  /** 字段说明（显示为 info 行） */
  description?: string;
  /** 分组标题（非空时在该字段前插入 section 头行） */
  group?: string;
}

export interface ConsoleSettingsActionResult {
  success: boolean;
  message?: string;
  error?: string;
  data?: unknown;
  /** 可选：action 执行后回填到当前 tab 草稿值中，用户仍需按 S 保存。 */
  patch?: Record<string, unknown>;
}

/** Console Settings Tab 页定义 */
export interface ConsoleSettingsTabDefinition {
  /** tab 唯一标识 */
  id: string;
  /** tab 显示标签 */
  label: string;
  /** tab 序号图标（如 '04'），缺省按内置 tab 数量自动递增 */
  icon?: string;
  /** 表单字段列表 */
  fields: ConsoleSettingsField[];
  /** 加载当前值（Settings 页面打开时调用） */
  onLoad: () => Promise<Record<string, unknown>>;
  /** 保存修改后的值（用户按 S 保存时调用） */
  onSave: (values: Record<string, unknown>) => Promise<{ success: boolean; error?: string }>;
  /** 执行 action 字段（用户在 action row 上按 Enter 时调用） */
  onAction?: (actionKey: string, values: Record<string, unknown>) => Promise<ConsoleSettingsActionResult> | ConsoleSettingsActionResult;
}

export interface ConsoleSettingsTabService {
  register(tab: ConsoleSettingsTabDefinition): Disposable;
  list(): ConsoleSettingsTabDefinition[];
  onDidChange(listener: () => void): Disposable;
}

export function createConsoleSettingsTabService(): ConsoleSettingsTabService {
  const tabs = createKeyedRegistry<ConsoleSettingsTabDefinition>();
  const changes = createListenerSignal<[]>();

  return {
    register(tab) {
      tabs.replace(tab.id, tab);
      changes.emit();
      let disposed = false;
      return {
        dispose() {
          if (disposed) return;
          disposed = true;
          if (tabs.deleteIf(tab.id, tab)) {
            changes.emit();
          }
        },
      };
    },
    list() {
      return Array.from(tabs.values());
    },
    onDidChange(listener) {
      return changes.on(listener);
    },
  };
}

export function createNetSettingsTab(configManager?: ConfigManagerLike): ConsoleSettingsTabDefinition | undefined {
  if (!configManager?.readEditableConfig || !configManager?.updateEditableConfig) return undefined;
  return {
    id: 'net',
    label: '多端互联',
    icon: '04',
    fields: [
      { key: 'enabled', label: '启用 Net 服务', type: 'toggle', defaultValue: false,
        description: '启用后其他设备可通过 WebSocket 连接控制此 Iris 实例' },
      { key: 'port', label: '端口', type: 'number', defaultValue: 9100 },
      { key: 'host', label: '监听地址', type: 'text', defaultValue: '0.0.0.0' },
      { key: 'token', label: '认证 Token', type: 'text',
        description: '远程连接密码（首次自动生成，可自行修改）' },
      { key: 'gatewayAgent', label: '远程网关 Agent', type: 'text', defaultValue: 'master',
        description: '多 Agent 模式下只由该 Agent 启动远程入口；连接后仍可在远程端切换其他 Agent' },
      { key: 'relay.url', label: '中继地址', type: 'text',
        description: '不在同一局域网时，通过公网中继服务器连接（如 wss://relay.example.com:9001）' },
      { key: 'relay.nodeId', label: '中继节点 ID', type: 'text',
        description: '本机在中继上的唯一标识，远程连接时需要用到（如 my-vps）' },
      { key: 'relay.token', label: '中继 Token', type: 'text',
        description: '中继服务器的认证密码（与上面的认证 Token 不同）' },
    ],
    onLoad: async () => {
      const raw = (configManager.readEditableConfig() ?? {}) as RawEditableConfig & Record<string, any>;
      const net = raw.net ?? {};
      let token = net.token ?? '';
      if (!token) token = randomToken(24);
      return {
        enabled: net.enabled ?? false,
        port: net.port ?? 9100,
        host: net.host ?? '0.0.0.0',
        token,
        gatewayAgent: net.gatewayAgent ?? 'master',
        'relay.url': net.relay?.url ?? '',
        'relay.nodeId': net.relay?.nodeId ?? '',
        'relay.token': net.relay?.token ?? '',
      };
    },
    onSave: async (values) => {
      try {
        const netUpdate: Record<string, unknown> = {
          enabled: values.enabled,
          port: values.port,
          host: values.host,
          token: values.token,
          gatewayAgent: values.gatewayAgent,
        };
        if (values['relay.url'] || values['relay.nodeId'] || values['relay.token']) {
          netUpdate.relay = {
            url: values['relay.url'] || undefined,
            nodeId: values['relay.nodeId'] || undefined,
            token: values['relay.token'] || undefined,
          };
        }
        const merged = configManager.updateEditableConfig({ net: netUpdate });
        if (configManager.applyRuntimeConfigReload) {
          const result = await configManager.applyRuntimeConfigReload(merged.mergedRaw);
          return result.success ? { success: true } : { success: false, error: result.error };
        }
        return { success: true };
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
  };
}

function randomToken(length: number): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}
