import {
  DELIVERY_REGISTRY_SERVICE_ID,
  type DeliveryBinding,
  type DeliveryRegistryService,
  type DeliveryRecentTarget,
  type Disposable,
  type IrisAPI,
  type PluginContext,
} from 'irises-extension-sdk';
import { parseVirtualLoverConfig, type VirtualLoverConfig } from './config.js';
import { loadPromptBundle, writeFragment } from './state.js';
import { sendProactiveMessage } from './proactive.js';
import { createVirtualLoverScheduleProactiveTool } from './proactive-schedule-tool.js';
import { MEMORY_SPACES_SERVICE_ID, type MemorySpacesServiceLike } from './memory-tools.js';
import { syncVirtualLoverStrategies } from './strategies.js';
import { scheduleVirtualLoverFollowup } from './followup.js';

const CONSOLE_SETTINGS_TAB_SERVICE_ID = 'console:settings-tab';

type ConsoleSettingsFieldLike = {
  key: string;
  label: string;
  type: 'toggle' | 'number' | 'text' | 'select' | 'readonly' | 'action';
  options?: { label: string; value: string }[];
  defaultValue?: unknown;
  description?: string;
  group?: string;
};

type ConsoleSettingsTabDefinitionLike = {
  id: string;
  label: string;
  icon?: string;
  fields: ConsoleSettingsFieldLike[];
  onLoad: () => Promise<Record<string, unknown>>;
  onSave: (values: Record<string, unknown>) => Promise<{ success: boolean; error?: string }>;
  onAction?: (actionKey: string, values: Record<string, unknown>) => Promise<{ success: boolean; error?: string; message?: string; data?: unknown; patch?: Record<string, unknown> }> | { success: boolean; error?: string; message?: string; data?: unknown; patch?: Record<string, unknown> };
};

interface ConsoleSettingsTabServiceLike {
  register(tab: ConsoleSettingsTabDefinitionLike): Disposable;
}

function registerConsoleSettingsTab(api: IrisAPI, tab: ConsoleSettingsTabDefinitionLike): Disposable {
  let disposed = false;
  let registration: Disposable | undefined;
  void api.services.waitFor<ConsoleSettingsTabServiceLike>(CONSOLE_SETTINGS_TAB_SERVICE_ID, 5000).then((service) => {
    if (disposed) return;
    registration = service.register(tab);
  }).catch(() => {});
  return { dispose: () => { disposed = true; try { registration?.dispose(); } catch { /* ignore */ } } };
}

function escapeMultiline(value: string): string {
  return value.replace(/\r\n/g, '\n').replace(/\n/g, '\\n');
}

function restoreMultiline(value: unknown): string {
  return String(value ?? '').replace(/\\n/g, '\n');
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : String(value ?? '');
}

function optionalString(value: unknown): string | undefined {
  const normalized = stringValue(value).trim();
  return normalized || undefined;
}

function numberValue(value: unknown, fallback: number, min?: number): number {
  const normalized = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(normalized)) return fallback;
  if (typeof min === 'number' && normalized < min) return fallback;
  return normalized;
}

function stringListValue(value: unknown, fallback: string[]): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  if (typeof value === 'string') {
    const items = value.split(/[,\n]/).map((item) => item.trim()).filter(Boolean);
    if (items.length > 0) return items;
  }
  return [...fallback];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function buildConfigFromValues(values: Record<string, unknown>): Record<string, unknown> {
  return {
    enabled: values.enabled === true,
    agent: {
      mode: stringValue(values['agent.mode']) === 'multi' ? 'multi' : 'single',
      defaultAgentId: optionalString(values['agent.defaultAgentId']) ?? 'default',
    },
    prompt: {
      enabled: values['prompt.enabled'] === true,
      injectionMode: stringValue(values['prompt.injectionMode']) === 'replace' ? 'replace' : 'prepend',
      priority: numberValue(values['prompt.priority'], 300),
      onlyFirstRound: values['prompt.onlyFirstRound'] === true,
      useAntml: values['prompt.useAntml'] === true,
      sections: stringListValue(values['prompt.sections'], ['persona', 'style', 'rules', 'lover_memory']),
    },
    memory: {
      space: optionalString(values['memory.space']) ?? 'virtual-lover',
      autoInject: values['memory.autoInject'] === true,
      maxRecallBytes: numberValue(values['memory.maxRecallBytes'], 12000, 0),
      autoExtract: values['memory.autoExtract'] === true,
      extractInterval: numberValue(values['memory.extractInterval'], 1, 1),
      tools: {
        enabled: values['memory.tools.enabled'] === true,
      },
    },
    proactive: {
      enabled: values['proactive.enabled'] === true,
      binding: optionalString(values['proactive.binding']),
      policy: optionalString(values['proactive.policy']),
      platform: optionalString(values['proactive.platform']) ?? 'telegram',
      target: {
        kind: stringValue(values['proactive.target.kind']) || 'chat',
        id: stringValue(values['proactive.target.id']).trim(),
        threadId: optionalString(values['proactive.target.threadId']),
      },
      strategies: {
        goodMorning: {
          enabled: values['strategy.goodMorning.enabled'] === true,
          schedule: optionalString(values['strategy.goodMorning.schedule']) ?? '0 8 * * *',
          reason: optionalString(values['strategy.goodMorning.reason']) ?? '每日早晨发送一条自然、轻柔、不打扰的早安问候。',
          urgent: values['strategy.goodMorning.urgent'] === true,
        },
        goodnight: {
          enabled: values['strategy.goodnight.enabled'] === true,
          schedule: optionalString(values['strategy.goodnight.schedule']) ?? '0 23 * * *',
          reason: optionalString(values['strategy.goodnight.reason']) ?? '睡前发送一条简短、安静、温柔的晚安消息。',
          urgent: values['strategy.goodnight.urgent'] === true,
        },
        dailyCheckIn: {
          enabled: values['strategy.dailyCheckIn.enabled'] === true,
          schedule: optionalString(values['strategy.dailyCheckIn.schedule']) ?? '0 20 * * *',
          reason: optionalString(values['strategy.dailyCheckIn.reason']) ?? '每天晚上发送一条不过度打扰的关心和陪伴消息。',
          urgent: values['strategy.dailyCheckIn.urgent'] === true,
        },
        random: {
          enabled: values['strategy.random.enabled'] === true,
          windowStart: optionalString(values['strategy.random.windowStart']) ?? '10:00',
          windowEnd: optionalString(values['strategy.random.windowEnd']) ?? '22:00',
          minPerDay: numberValue(values['strategy.random.minPerDay'], 0, 0),
          maxPerDay: numberValue(values['strategy.random.maxPerDay'], 2, 0),
          reason: optionalString(values['strategy.random.reason']) ?? '在合适时段发送一条自然、轻柔、不打扰的随机关心。',
        },
        lateNight: {
          enabled: values['strategy.lateNight.enabled'] === true,
          schedule: optionalString(values['strategy.lateNight.schedule']) ?? '0 1 * * *',
          reason: optionalString(values['strategy.lateNight.reason']) ?? '深夜如果用户仍可能需要陪伴，发送一条克制、温柔、鼓励休息的提醒。',
          urgent: values['strategy.lateNight.urgent'] !== false,
        },
        memory: {
          enabled: values['strategy.memory.enabled'] === true,
          schedule: optionalString(values['strategy.memory.schedule']) ?? '0 21 * * *',
          query: optionalString(values['strategy.memory.query']) ?? 'relationship milestones, important dates, recent emotional needs, user preferences',
          reason: optionalString(values['strategy.memory.reason']) ?? '基于 lover memory 中的重要偏好、近期情绪或重要日期，发送一条自然、不打扰的关心。',
          urgent: values['strategy.memory.urgent'] === true,
        },
        weather: {
          enabled: values['strategy.weather.enabled'] === true,
          schedule: optionalString(values['strategy.weather.schedule']) ?? '0 8 * * *',
          reason: optionalString(values['strategy.weather.reason']) ?? '结合当前天气/环境上下文，发送一条自然、有用但不过度打扰的关心。',
          urgent: values['strategy.weather.urgent'] === true,
        },
      },
      followup: {
        enabled: values['followup.enabled'] !== false,
        defaultDelayMinutes: numberValue(values['followup.defaultDelayMinutes'], 180, 1),
        dedupeHours: numberValue(values['followup.dedupeHours'], 24, 1),
      },
      deferredReply: {
        enabled: values['deferredReply.enabled'] !== false,
        defaultDelayMinutes: numberValue(values['deferredReply.defaultDelayMinutes'], 30, 1),
      },
      generation: {
        enabled: values['proactive.generation.enabled'] === true,
        maxOutputTokens: numberValue(values['proactive.generation.maxOutputTokens'], 240, 1),
        temperature: numberValue(values['proactive.generation.temperature'], 0.8, 0),
        instruction: restoreMultiline(values['proactive.generation.instruction']).trim()
          || '请生成一条简短、自然、不过度打扰的主动消息。只输出要发送给用户的消息正文，不要解释。',
      },
    },
    web: {
      enabled: values['web.enabled'] !== false,
      basePath: optionalString(values['web.basePath']) ?? '/api/ext/virtual-lover',
      panelPath: optionalString(values['web.panelPath']) ?? '/virtual-lover',
    },
  };
}

function buildDeliveryUpdateFromValues(values: Record<string, unknown>): Record<string, unknown> | undefined {
  const bindingId = optionalString(values['proactive.binding']);
  const targetId = optionalString(values['delivery.binding.target.id']);
  if (!bindingId || !targetId) return undefined;

  return {
    bindings: {
      [bindingId]: {
        label: optionalString(values['delivery.binding.label']),
        platform: optionalString(values['delivery.binding.platform']) ?? optionalString(values['proactive.platform']) ?? 'telegram',
        target: {
          kind: optionalString(values['delivery.binding.target.kind']) ?? optionalString(values['proactive.target.kind']) ?? 'chat',
          id: targetId,
          threadId: optionalString(values['delivery.binding.target.threadId']),
        },
        enabled: values['delivery.binding.enabled'] !== false,
        policyId: optionalString(values['proactive.policy']),
      },
    },
  };
}

function loadBindingValues(config: VirtualLoverConfig, ctx: PluginContext, api: IrisAPI): Record<string, unknown> {
  const bindingId = config.proactive.binding;
  const editable = api.configManager?.readEditableConfig?.() as Record<string, unknown> | undefined;
  const delivery = (editable?.delivery ?? ctx.readConfigSection('delivery') ?? {}) as Record<string, unknown>;
  const bindings = isRecord(delivery.bindings) ? delivery.bindings : {};
  const binding = bindingId && isRecord(bindings[bindingId]) ? bindings[bindingId] as Record<string, unknown> : {};
  const target = isRecord(binding.target) ? binding.target : {};

  return {
    'delivery.binding.enabled': typeof binding.enabled === 'boolean' ? binding.enabled : true,
    'delivery.binding.label': stringValue(binding.label),
    'delivery.binding.platform': optionalString(binding.platform) ?? config.proactive.platform,
    'delivery.binding.target.kind': optionalString(target.kind) ?? config.proactive.target.kind,
    'delivery.binding.target.id': optionalString(target.id) ?? config.proactive.target.id,
    'delivery.binding.target.threadId': optionalString(target.threadId) ?? config.proactive.target.threadId ?? '',
  };
}

function loadPromptFragmentValues(ctx: PluginContext, config: VirtualLoverConfig): Record<string, unknown> {
  const agentId = config.agent.defaultAgentId;
  const bundle = loadPromptBundle(ctx.getDataDir(), ctx.getExtensionRootDir(), agentId);
  return {
    'fragment.persona': escapeMultiline(bundle.fragments.persona),
    'fragment.style': escapeMultiline(bundle.fragments.style),
    'fragment.rules': escapeMultiline(bundle.fragments.rules),
  };
}

function formatBinding(binding: DeliveryBinding): string {
  const status = binding.enabled === false ? '禁用' : '启用';
  const thread = binding.target.threadId ? ` thread=${binding.target.threadId}` : '';
  const label = binding.label ? `${binding.label} · ` : '';
  return `${status} · ${label}${binding.platform} · ${binding.target.kind}:${binding.target.id}${thread}`;
}

function formatRecentTarget(target: DeliveryRecentTarget): string {
  const thread = target.target.threadId ? ` topic=${target.target.threadId}` : '';
  const label = target.label ? `${target.label} · ` : '';
  return `${label}${target.platform} ${target.target.kind}:${target.target.id}${thread}`;
}

function loadDiagnosticValues(config: VirtualLoverConfig, api: IrisAPI): Record<string, unknown> {
  const memoryAvailable = api.services.has('memory.spaces');
  const delivery = api.services.get<DeliveryRegistryService>(DELIVERY_REGISTRY_SERVICE_ID);
  const deliveryAvailable = Boolean(delivery);
  const providers = delivery?.listProviders?.() ?? [];

  let bindingStatus = '未配置 binding，将使用 fallback target';
  if (config.proactive.binding) {
    if (!delivery) {
      bindingStatus = 'delivery.registry 不可用，无法检查 binding';
    } else {
      const binding = delivery.getBinding(config.proactive.binding);
      bindingStatus = binding
        ? formatBinding(binding)
        : `binding 不存在：${config.proactive.binding}`;
    }
  }

  const providerStatus = providers.length > 0
    ? providers.map((provider) => {
      const caps = Object.entries(provider.capabilities)
        .filter(([, enabled]) => enabled)
        .map(([name]) => name)
        .join(',');
      return `${provider.platform}${caps ? `(${caps})` : ''}`;
    }).join(' / ')
    : '暂无 provider';

  const telegramProvider = providers.find((provider) => provider.platform === 'telegram');
  const telegramStatus = !delivery
    ? '未就绪：消息发送服务不可用'
    : telegramProvider
      ? `已就绪：Telegram 发送能力可用 (${Object.entries(telegramProvider.capabilities).filter(([, enabled]) => enabled).map(([name]) => name).join(',') || 'text'})`
      : '未检测到 Telegram 发送能力。若要发到 Telegram，请先启用 Telegram 平台并配置 Bot Token。';

  const recentTelegramTargets = delivery?.listRecentTargets?.({ platform: 'telegram' }) ?? [];
  const recentTargetStatus = recentTelegramTargets.length > 0
    ? `最近聊天：${formatRecentTarget(recentTelegramTargets[0])}`
    : '暂无最近 Telegram 聊天。若不知道 Chat ID，请先在 Telegram 给 Bot 发一条消息。';

  let policyStatus = '未设置：不限制发送频率和安静时段';
  if (config.proactive.policy) {
    const policy = delivery?.getPolicy?.(config.proactive.policy);
    policyStatus = policy
      ? `已找到：${config.proactive.policy}`
      : `未找到：${config.proactive.policy}。请在 delivery.yaml 中配置，或留空。`;
  }

  const proactiveTarget = config.proactive.binding
    ? `binding:${config.proactive.binding}`
    : `${config.proactive.platform}:${config.proactive.target.kind}:${config.proactive.target.id || '(未配置)'}`;

  return {
    'status.memory': memoryAvailable ? `可用 · space=${config.memory.space}` : '不可用 · memory.spaces 未注册',
    'status.delivery': deliveryAvailable ? '可用 · delivery.registry 已注册' : '不可用 · delivery.registry 未注册',
    'status.deliveryProviders': providerStatus,
    'status.telegram': telegramStatus,
    'status.recentTelegramTarget': recentTargetStatus,
    'status.policy': policyStatus,
    'status.binding': bindingStatus,
    'status.proactiveTarget': proactiveTarget,
  };
}

function flattenConfig(config: VirtualLoverConfig, ctx: PluginContext, api: IrisAPI): Record<string, unknown> {
  return {
    enabled: config.enabled,
    'agent.mode': config.agent.mode,
    'agent.defaultAgentId': config.agent.defaultAgentId,
    'prompt.enabled': config.prompt.enabled,
    'prompt.injectionMode': config.prompt.injectionMode,
    'prompt.priority': config.prompt.priority,
    'prompt.onlyFirstRound': config.prompt.onlyFirstRound,
    'prompt.useAntml': config.prompt.useAntml,
    'prompt.sections': config.prompt.sections.join(','),
    'memory.space': config.memory.space,
    'memory.autoInject': config.memory.autoInject,
    'memory.maxRecallBytes': config.memory.maxRecallBytes,
    'memory.autoExtract': config.memory.autoExtract,
    'memory.extractInterval': config.memory.extractInterval,
    'memory.tools.enabled': config.memory.tools.enabled,
    'proactive.enabled': config.proactive.enabled,
    'proactive.binding': config.proactive.binding ?? '',
    'proactive.policy': config.proactive.policy ?? '',
    'proactive.platform': config.proactive.platform,
    'proactive.target.kind': config.proactive.target.kind,
    'proactive.target.id': config.proactive.target.id,
    'proactive.target.threadId': config.proactive.target.threadId ?? '',
    'proactive.generation.enabled': config.proactive.generation.enabled,
    'proactive.generation.maxOutputTokens': config.proactive.generation.maxOutputTokens,
    'proactive.generation.temperature': config.proactive.generation.temperature,
    'proactive.generation.instruction': escapeMultiline(config.proactive.generation.instruction),
    'strategy.goodMorning.enabled': config.proactive.strategies.goodMorning.enabled,
    'strategy.goodMorning.schedule': config.proactive.strategies.goodMorning.schedule,
    'strategy.goodMorning.reason': config.proactive.strategies.goodMorning.reason,
    'strategy.goodMorning.urgent': config.proactive.strategies.goodMorning.urgent,
    'strategy.goodnight.enabled': config.proactive.strategies.goodnight.enabled,
    'strategy.goodnight.schedule': config.proactive.strategies.goodnight.schedule,
    'strategy.goodnight.reason': config.proactive.strategies.goodnight.reason,
    'strategy.goodnight.urgent': config.proactive.strategies.goodnight.urgent,
    'strategy.dailyCheckIn.enabled': config.proactive.strategies.dailyCheckIn.enabled,
    'strategy.dailyCheckIn.schedule': config.proactive.strategies.dailyCheckIn.schedule,
    'strategy.dailyCheckIn.reason': config.proactive.strategies.dailyCheckIn.reason,
    'strategy.dailyCheckIn.urgent': config.proactive.strategies.dailyCheckIn.urgent,
    'strategy.random.enabled': config.proactive.strategies.random.enabled,
    'strategy.random.windowStart': config.proactive.strategies.random.windowStart,
    'strategy.random.windowEnd': config.proactive.strategies.random.windowEnd,
    'strategy.random.minPerDay': config.proactive.strategies.random.minPerDay,
    'strategy.random.maxPerDay': config.proactive.strategies.random.maxPerDay,
    'strategy.random.reason': config.proactive.strategies.random.reason,
    'strategy.lateNight.enabled': config.proactive.strategies.lateNight.enabled,
    'strategy.lateNight.schedule': config.proactive.strategies.lateNight.schedule,
    'strategy.lateNight.reason': config.proactive.strategies.lateNight.reason,
    'strategy.lateNight.urgent': config.proactive.strategies.lateNight.urgent,
    'strategy.memory.enabled': config.proactive.strategies.memory.enabled,
    'strategy.memory.schedule': config.proactive.strategies.memory.schedule,
    'strategy.memory.query': config.proactive.strategies.memory.query,
    'strategy.memory.reason': config.proactive.strategies.memory.reason,
    'strategy.memory.urgent': config.proactive.strategies.memory.urgent,
    'strategy.weather.enabled': config.proactive.strategies.weather.enabled,
    'strategy.weather.schedule': config.proactive.strategies.weather.schedule,
    'strategy.weather.reason': config.proactive.strategies.weather.reason,
    'strategy.weather.urgent': config.proactive.strategies.weather.urgent,
    'followup.enabled': config.proactive.followup.enabled,
    'followup.defaultDelayMinutes': config.proactive.followup.defaultDelayMinutes,
    'followup.dedupeHours': config.proactive.followup.dedupeHours,
    'deferredReply.enabled': config.proactive.deferredReply.enabled,
    'deferredReply.defaultDelayMinutes': config.proactive.deferredReply.defaultDelayMinutes,
    'web.enabled': config.web.enabled,
    'web.basePath': config.web.basePath,
    'web.panelPath': config.web.panelPath,
    ...loadBindingValues(config, ctx, api),
    ...loadPromptFragmentValues(ctx, config),
    ...loadDiagnosticValues(config, api),
  };
}

function savePromptFragments(ctx: PluginContext, agentId: string, values: Record<string, unknown>): void {
  writeFragment(ctx.getDataDir(), ctx.getExtensionRootDir(), agentId, 'persona', restoreMultiline(values['fragment.persona']));
  writeFragment(ctx.getDataDir(), ctx.getExtensionRootDir(), agentId, 'style', restoreMultiline(values['fragment.style']));
  writeFragment(ctx.getDataDir(), ctx.getExtensionRootDir(), agentId, 'rules', restoreMultiline(values['fragment.rules']));
}


function buildDraftPromptBundle(values: Record<string, unknown>, agentId: string) {
  return {
    agentId,
    fragments: {
      persona: restoreMultiline(values['fragment.persona']),
      style: restoreMultiline(values['fragment.style']),
      rules: restoreMultiline(values['fragment.rules']),
    },
  };
}

async function handleVirtualLoverAction(ctx: PluginContext, api: IrisAPI, actionKey: string, values: Record<string, unknown>) {
  const config = parseVirtualLoverConfig(buildConfigFromValues(values));
  const agentId = config.agent.defaultAgentId;
  const bundle = buildDraftPromptBundle(values, agentId);

  switch (actionKey) {
    case 'action.testBinding': {
      const delivery = api.services.get<DeliveryRegistryService>(DELIVERY_REGISTRY_SERVICE_ID);
      if (!delivery) return { success: false, error: 'delivery.registry 不可用' };
      if (config.proactive.binding) {
        const binding = delivery.getBinding(config.proactive.binding);
        if (!binding) return { success: false, error: `binding 不存在：${config.proactive.binding}` };
        const decision = await delivery.evaluatePolicy({
          policyId: config.proactive.policy ?? binding.policyId,
          binding: binding.id,
          platform: binding.platform,
          target: binding.target,
        });
        return {
          success: decision.allowed,
          message: decision.allowed
            ? `Binding 可用：${formatBinding(binding)}`
            : `Binding 存在，但 policy 当前会跳过：${decision.reason}`,
        };
      }
      if (!config.proactive.target.id) return { success: false, error: '未配置 binding，也未配置 fallback target.id' };
      const decision = await delivery.evaluatePolicy({
        policyId: config.proactive.policy,
        platform: config.proactive.platform,
        target: config.proactive.target,
      });
      return {
        success: decision.allowed,
        message: decision.allowed
          ? `Fallback target 可用：${config.proactive.platform}:${config.proactive.target.kind}:${config.proactive.target.id}`
          : `Fallback target 存在，但 policy 当前会跳过：${decision.reason}`,
      };
    }
    case 'action.useLatestTelegramTarget': {
      const delivery = api.services.get<DeliveryRegistryService>(DELIVERY_REGISTRY_SERVICE_ID);
      if (!delivery) return { success: false, error: '消息发送服务不可用' };
      const latest = delivery.listRecentTargets?.({ platform: 'telegram' })?.[0];
      if (!latest) {
        return { success: false, error: '还没有最近 Telegram 聊天。请先在 Telegram 给 Bot 发一条消息，再回到这里重试。' };
      }
      const binding = config.proactive.binding || 'lover-main';
      return {
        success: true,
        message: `已把最近 Telegram 聊天填入发送目标：${formatRecentTarget(latest)}。请按 S 保存。`,
        patch: {
          'proactive.binding': binding,
          'proactive.platform': 'telegram',
          'proactive.target.kind': 'chat',
          'proactive.target.id': latest.target.id,
          'proactive.target.threadId': latest.target.threadId ?? '',
          'delivery.binding.enabled': true,
          'delivery.binding.platform': 'telegram',
          'delivery.binding.target.kind': 'chat',
          'delivery.binding.target.id': latest.target.id,
          'delivery.binding.target.threadId': latest.target.threadId ?? '',
        },
      };
    }
    case 'action.proactiveDryRun': {
      const result = await sendProactiveMessage({
        config,
        api,
        bundle,
        agentId,
        reason: 'TUI /lover 主动消息预览',
        dryRun: true,
      });
      return { success: result.ok, message: result.ok ? `预览：${result.text}` : result.error };
    }
    case 'action.proactiveSendTest': {
      const result = await sendProactiveMessage({
        config,
        api,
        bundle,
        agentId,
        reason: 'TUI /lover 主动消息发送测试',
        dryRun: false,
      });
      return { success: result.ok, message: result.ok ? `已发送：${result.text}` : result.error };
    }
    case 'action.scheduleTest30s':
    case 'action.scheduleMorning':
    case 'action.scheduleGoodnight': {
      const template = actionKey === 'action.scheduleMorning'
        ? 'good_morning_daily'
        : actionKey === 'action.scheduleGoodnight'
          ? 'goodnight_daily'
          : 'test_30s';
      const result = await createVirtualLoverScheduleProactiveTool(api).handler({ template });
      return {
        success: Boolean((result as any)?.ok),
        message: (result as any)?.ok
          ? `已创建 proactive 调度任务：${template}`
          : ((result as any)?.error ?? '创建调度任务失败'),
        data: (result as any)?.job ?? (result as any)?.result,
      };
    }
    case 'action.loverDream': {
      const service = api.services.get<MemorySpacesServiceLike>(MEMORY_SPACES_SERVICE_ID);
      const space = service?.getOrCreateSpace(config.memory.space);
      if (!space) return { success: false, error: 'memory.spaces 不可用' };
      const result = await space.dream();
      return { success: result.ok, message: result.message, data: result };
    }
    case 'action.followupTest': {
      const result = await scheduleVirtualLoverFollowup(ctx, api, {
        mode: 'followup',
        delayMinutes: config.proactive.followup.defaultDelayMinutes,
        reason: 'TUI /lover 测试：稍后做一次温柔、不过度打扰的后续关心。',
        dedupeKey: 'tui-followup-test',
      });
      return {
        success: result.ok,
        message: result.skipped ? '已存在相同 followup，跳过重复创建。' : (result.ok ? '已创建 followup 测试任务。' : result.error),
        data: result.intent,
      };
    }
    case 'action.deferredReplyTest': {
      const result = await scheduleVirtualLoverFollowup(ctx, api, {
        mode: 'deferred_reply',
        delayMinutes: config.proactive.deferredReply.defaultDelayMinutes,
        reason: 'TUI /lover 测试：稍后自然地接一句话。',
        dedupeKey: 'tui-deferred-reply-test',
      });
      return { success: result.ok, message: result.ok ? '已创建延迟回复测试任务。' : result.error, data: result.intent };
    }
    case 'action.syncStrategies': {
      const result = await syncVirtualLoverStrategies(api, config);
      return { success: result.ok, message: result.ok ? `策略已同步：${result.operations.length} 项操作` : result.error, data: result.operations };
    }
    default:
      return { success: false, error: `未知 action: ${actionKey}` };
  }
}

export function registerVirtualLoverSettingsTab(ctx: PluginContext, api: IrisAPI): Disposable | undefined {
  return registerConsoleSettingsTab(api, {

    id: 'virtual-lover',
    label: 'Virtual Lover',
    icon: '07',
    fields: [
      // 状态：只保留用户判断“现在能不能用”的核心信息。
      { key: 'status.memory', label: '记忆功能状态', type: 'readonly', defaultValue: '', group: '状态诊断',
        description: '显示专属记忆服务是否可用；如果不可用，伴侣记忆不会被读取或整理。' },
      { key: 'status.delivery', label: '消息发送功能状态', type: 'readonly', defaultValue: '', group: '状态诊断',
        description: '显示 Iris 是否已经准备好向 Telegram 等平台发送主动消息。' },
      { key: 'status.telegram', label: 'Telegram 接入状态', type: 'readonly', defaultValue: '', group: '状态诊断',
        description: '显示 Telegram 发送能力是否已经注册。若未就绪，请先配置并启用 Telegram Bot。' },
      { key: 'status.recentTelegramTarget', label: '最近 Telegram 聊天', type: 'readonly', defaultValue: '', group: '状态诊断',
        description: '如果不知道 Chat ID，请先在 Telegram 给 Bot 发一条消息，这里会显示最近聊天。' },
      { key: 'status.policy', label: '防打扰策略状态', type: 'readonly', defaultValue: '', group: '状态诊断',
        description: '显示当前防打扰策略是否存在。留空表示不限制发送频率和安静时段。' },
      { key: 'status.binding', label: '发送目标状态', type: 'readonly', defaultValue: '', group: '状态诊断',
        description: '检查下方“发送目标名称”是否存在、是否启用，以及实际会发到哪个聊天。' },
      { key: 'status.proactiveTarget', label: '当前发送去向', type: 'readonly', defaultValue: '', group: '状态诊断',
        description: '显示主动消息当前会使用“发送目标名称”，还是备用目标配置。' },

      // 操作：TUI 主入口应优先让用户可以直接验证和执行，而不是记工具名。
      { key: 'action.testBinding', label: '检查能否发送', type: 'action', defaultValue: '', group: '操作',
        description: '检查发送目标和防打扰策略是否允许现在发送；不会真的发送消息。' },
      { key: 'action.useLatestTelegramTarget', label: '使用最近 Telegram 聊天', type: 'action', defaultValue: '', group: '操作',
        description: '把最近给 Bot 发过消息的 Telegram 聊天填入发送目标。执行后请按 S 保存。' },
      { key: 'action.proactiveDryRun', label: '预览一条主动消息', type: 'action', defaultValue: '', group: '操作',
        description: '根据当前人设、记忆和策略生成一条示例主动消息，但不会发送。' },
      { key: 'action.proactiveSendTest', label: '立即发送测试消息', type: 'action', defaultValue: '', group: '操作',
        description: '实际发出一条测试主动消息；建议先保存配置，并确认发送目标正确。' },
      { key: 'action.scheduleTest30s', label: '创建 30 秒测试任务', type: 'action', defaultValue: '', group: '操作',
        description: '创建一个 30 秒后自动发送的测试任务，用来验证定时任务和发送链路。' },
      { key: 'action.syncStrategies', label: '应用主动消息策略', type: 'action', defaultValue: '', group: '操作',
        description: '把下方策略开关应用到定时任务：开启的会创建/更新，关闭的会禁用。' },
      { key: 'action.loverDream', label: '整理专属记忆', type: 'action', defaultValue: '', group: '操作',
        description: '整理当前伴侣专属记忆，合并重复内容，让以后回忆更稳定。' },

      // 基础：普通用户最可能要改的选项。
      { key: 'enabled', label: '启用伴侣模式', type: 'toggle', defaultValue: false, group: '基础',
        description: '开启后，Iris 会按你设置的人设、风格和边界来表达。' },
      { key: 'proactive.enabled', label: '允许主动发消息', type: 'toggle', defaultValue: false, group: '基础',
        description: '开启后，测试发送和定时策略才可以主动向你发送消息。' },
      { key: 'proactive.binding', label: '发送目标名称', type: 'text', defaultValue: '', group: '基础',
        description: '给真实聊天目标起的名字。建议填 lover-main；下面的目标 ID 会保存到这个名字里。' },
      { key: 'proactive.policy', label: '防打扰策略', type: 'text', defaultValue: '', group: '基础',
        description: '可选。留空表示不限制发送；填 lover-default 之类的策略名，可限制冷却时间、每日次数和安静时段。' },
      { key: 'delivery.binding.enabled', label: '启用发送目标', type: 'toggle', defaultValue: true, group: '基础',
        description: '关闭后会保留目标配置，但不会向这个目标发送主动消息。' },
      { key: 'delivery.binding.target.id', label: '发送目标 ID（Telegram Chat ID）', type: 'text', defaultValue: '', group: '基础',
        description: '要接收主动消息的聊天 ID，不是 Bot Token。Telegram 私聊通常是数字，群聊通常以 -100 开头；只在 TUI 聊天可留空。' },
      { key: 'delivery.binding.target.threadId', label: '发送话题 ID（可选）', type: 'text', defaultValue: '', group: '基础',
        description: '只有 Telegram 群组开启话题/Forum topic 时才需要填写；普通私聊和普通群聊请留空。' },
      { key: 'memory.space', label: '专属记忆空间', type: 'text', defaultValue: 'virtual-lover', group: '基础',
        description: '伴侣相关记忆保存在哪里。通常保持 virtual-lover，避免和普通工作记忆混在一起。' },

      // Prompt 内容：这是用户最常调的“角色体验”部分。
      { key: 'fragment.persona', label: '伴侣人设', type: 'text', defaultValue: '', group: '角色设定',
        description: '描述 TA 是怎样的陪伴者。可用 \\n 表示换行；保存后下一轮对话生效。' },
      { key: 'fragment.style', label: '说话风格', type: 'text', defaultValue: '', group: '角色设定',
        description: '描述 TA 应该怎么说话，例如温柔、简短、克制、活泼等。可用 \\n 表示换行。' },
      { key: 'fragment.rules', label: '相处边界', type: 'text', defaultValue: '', group: '角色设定',
        description: '描述 TA 需要遵守的边界，例如不假装现实行动、不越界、不制造压力。可用 \\n 表示换行。' },

      // 策略：默认只暴露开关，具体 cron/reason/urgent 等高级项继续走 YAML。
      { key: 'strategy.goodMorning.enabled', label: '每天早安', type: 'toggle', defaultValue: false, group: '主动策略',
        description: '开启后，同步策略会创建每天早上发送早安的定时任务。' },
      { key: 'strategy.goodnight.enabled', label: '每天晚安', type: 'toggle', defaultValue: false, group: '主动策略',
        description: '开启后，同步策略会创建每天晚上发送晚安的定时任务。' },
      { key: 'strategy.dailyCheckIn.enabled', label: '每天关心一次', type: 'toggle', defaultValue: false, group: '主动策略',
        description: '开启后，会每天固定时间发送一条不过度打扰的关心。' },
      { key: 'strategy.random.enabled', label: '随机关心', type: 'toggle', defaultValue: false, group: '主动策略',
        description: '开启后，同步策略会在允许时段内随机安排主动消息；具体时间窗口可在 YAML 中调整。' },
      { key: 'strategy.lateNight.enabled', label: '深夜轻提醒', type: 'toggle', defaultValue: false, group: '主动策略',
        description: '开启后，会在深夜用克制的语气提醒休息或轻轻陪伴。' },
      { key: 'strategy.memory.enabled', label: '根据记忆关心', type: 'toggle', defaultValue: false, group: '主动策略',
        description: '开启后，会参考伴侣专属记忆里的偏好、重要日期或近期状态来发消息。' },
      { key: 'strategy.weather.enabled', label: '根据天气关心', type: 'toggle', defaultValue: false, group: '主动策略',
        description: '开启后，如果安装了天气/环境服务，会结合天气发消息；没有服务时会自动降级。' },
      { key: 'followup.enabled', label: '允许稍后关心', type: 'toggle', defaultValue: true, group: '主动策略',
        description: '允许模型在合适时创建“稍后再问问你”的一次性关心任务。' },
      { key: 'deferredReply.enabled', label: '允许延迟接话', type: 'toggle', defaultValue: true, group: '主动策略',
        description: '允许模型在你说“等会儿再聊”之类场景下，稍后自然接一句话。' },
    ],
    async onLoad() {
      return flattenConfig(parseVirtualLoverConfig(ctx.readConfigSection('virtual_lover')), ctx, api);
    },
    async onSave(values) {
      try {
        if (!api.configManager) return { success: false, error: 'configManager unavailable' };
        const update = buildConfigFromValues(values);
        const deliveryUpdate = buildDeliveryUpdateFromValues(values);
        const payload: Record<string, unknown> = { virtual_lover: update };
        if (deliveryUpdate) payload.delivery = deliveryUpdate;
        const result = api.configManager.updateEditableConfig(payload as any);
        savePromptFragments(ctx, (update.agent as Record<string, unknown>).defaultAgentId as string, values);
        await api.configManager.applyRuntimeConfigReload(result.mergedRaw);
        return { success: true };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
    onAction: (actionKey, values) => handleVirtualLoverAction(ctx, api, actionKey, values),
  });
}
