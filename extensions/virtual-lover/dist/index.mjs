// ../../packages/extension-sdk/dist/message.js
function isVisibleTextPart(part) {
  return "text" in part && part.thought !== true;
}
function extractText(parts) {
  return parts.filter((p) => isVisibleTextPart(p)).map((p) => p.text ?? "").join("");
}
// ../../packages/extension-sdk/dist/delivery.js
var DELIVERY_REGISTRY_SERVICE_ID = "delivery.registry";
// ../../packages/extension-sdk/dist/scheduler.js
var SCHEDULER_SERVICE_ID = "scheduler.tasks";
// ../../packages/extension-sdk/dist/environment.js
var ENVIRONMENT_CONTEXT_SERVICE_ID = "environment.context";
var WEATHER_SERVICE_ID = "environment.weather";
// ../../packages/extension-sdk/dist/logger.js
var LogLevel;
(function(LogLevel2) {
  LogLevel2[LogLevel2["DEBUG"] = 0] = "DEBUG";
  LogLevel2[LogLevel2["INFO"] = 1] = "INFO";
  LogLevel2[LogLevel2["WARN"] = 2] = "WARN";
  LogLevel2[LogLevel2["ERROR"] = 3] = "ERROR";
  LogLevel2[LogLevel2["SILENT"] = 4] = "SILENT";
})(LogLevel || (LogLevel = {}));
var _logLevel = LogLevel.INFO;
function createExtensionLogger(extensionName, tag) {
  const scope = tag ? `${extensionName}:${tag}` : extensionName;
  return {
    debug: (...args) => {
      if (_logLevel <= LogLevel.DEBUG)
        console.debug(`[${scope}]`, ...args);
    },
    info: (...args) => {
      if (_logLevel <= LogLevel.INFO)
        console.log(`[${scope}]`, ...args);
    },
    warn: (...args) => {
      if (_logLevel <= LogLevel.WARN)
        console.warn(`[${scope}]`, ...args);
    },
    error: (...args) => {
      if (_logLevel <= LogLevel.ERROR)
        console.error(`[${scope}]`, ...args);
    }
  };
}

// ../../packages/extension-sdk/dist/plugin/context.js
function createPluginLogger(pluginName, tag) {
  const scope = tag ? `Plugin:${pluginName}:${tag}` : `Plugin:${pluginName}`;
  return createExtensionLogger(scope);
}
function definePlugin(plugin) {
  return plugin;
}
// src/config.ts
var DEFAULT_PROACTIVE_INSTRUCTION = "请基于伴侣人设、说话风格、相处边界、可用记忆和环境上下文，生成一条自然、简短、不过度打扰的主动消息。只输出要发送给用户的消息正文，不要解释。消息应低压力、可忽略，不要求用户立刻回复。";
var DEFAULT_VIRTUAL_LOVER_CONFIG = {
  enabled: false,
  agent: {
    mode: "single",
    defaultAgentId: "default"
  },
  prompt: {
    enabled: true,
    injectionMode: "prepend",
    priority: 300,
    onlyFirstRound: true,
    useAntml: true,
    sections: ["persona", "style", "rules", "lover_memory"]
  },
  memory: {
    space: "virtual-lover",
    autoInject: true,
    maxRecallBytes: 12000,
    autoExtract: true,
    extractInterval: 1,
    tools: {
      enabled: true
    }
  },
  proactive: {
    enabled: false,
    platform: "telegram",
    policy: undefined,
    binding: undefined,
    target: {
      kind: "chat",
      id: ""
    },
    strategies: {
      goodMorning: {
        enabled: false,
        schedule: "0 8 * * *",
        reason: "早晨轻声问候，给用户一个稳定、温柔、不要求立刻回应的开始。",
        urgent: false
      },
      goodnight: {
        enabled: false,
        schedule: "0 23 * * *",
        reason: "睡前发送一条简短、安静、温柔的晚安消息，帮助用户放松下来。",
        urgent: false
      },
      dailyCheckIn: {
        enabled: false,
        schedule: "0 20 * * *",
        reason: "每天固定时间轻轻关心一下用户今天的状态，不追问、不制造压力。",
        urgent: false
      },
      random: {
        enabled: false,
        windowStart: "10:00",
        windowEnd: "22:00",
        minPerDay: 0,
        maxPerDay: 2,
        reason: "在合适时段发送一条像自然想起用户一样的轻柔问候，短一点，不打扰。"
      },
      lateNight: {
        enabled: false,
        schedule: "0 1 * * *",
        reason: "深夜用克制、温柔的方式提醒用户照顾自己和休息，不责备、不催促。",
        urgent: true
      },
      memory: {
        enabled: false,
        schedule: "0 21 * * *",
        query: "relationship milestones, important dates, recent emotional needs, user preferences",
        reason: "参考伴侣专属记忆中的偏好、重要日期或近期情绪线索，发送一条自然、不突兀的关心。",
        urgent: false
      },
      weather: {
        enabled: false,
        schedule: "0 8 * * *",
        reason: "结合天气或环境上下文，给出一句自然、有用、不过度打扰的关心或提醒。",
        urgent: false
      }
    },
    followup: {
      enabled: true,
      defaultDelayMinutes: 180,
      dedupeHours: 24
    },
    deferredReply: {
      enabled: true,
      defaultDelayMinutes: 30
    },
    generation: {
      enabled: true,
      instruction: DEFAULT_PROACTIVE_INSTRUCTION,
      maxOutputTokens: 240,
      temperature: 0.8
    }
  },
  web: {
    enabled: true,
    basePath: "/api/ext/virtual-lover",
    panelPath: "/virtual-lover"
  }
};
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function asRecord(value) {
  return isRecord(value) ? value : {};
}
function readBoolean(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}
function readString(value, fallback) {
  return typeof value === "string" ? value : fallback;
}
function readInteger(value, fallback, min) {
  const normalized = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(normalized))
    return fallback;
  const integer = Math.trunc(normalized);
  if (typeof min === "number" && integer < min)
    return fallback;
  return integer;
}
function readNumber(value, fallback, min) {
  const normalized = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(normalized))
    return fallback;
  if (typeof min === "number" && normalized < min)
    return fallback;
  return normalized;
}
function readStringArray(value, fallback) {
  if (!Array.isArray(value))
    return [...fallback];
  const items = value.map((item) => typeof item === "string" ? item.trim() : "").filter(Boolean);
  return items.length > 0 ? items : [...fallback];
}
function normalizeAgentMode(value, fallback) {
  return value === "multi" || value === "single" ? value : fallback;
}
function normalizeInjectionMode(value, fallback) {
  return value === "replace" || value === "prepend" ? value : fallback;
}
function normalizeBasePath(value, fallback) {
  const raw = readString(value, fallback).trim();
  if (!raw)
    return fallback;
  const withLeadingSlash = raw.startsWith("/") ? raw : `/${raw}`;
  return withLeadingSlash.length > 1 ? withLeadingSlash.replace(/\/+$/, "") : withLeadingSlash;
}
function normalizeSpaceId(value, fallback) {
  const raw = readString(value, fallback).trim() || fallback;
  return /^[a-zA-Z0-9_-]+$/.test(raw) ? raw : fallback;
}
function normalizeTargetKind(value, fallback) {
  return value === "chat" || value === "user" || value === "room" || value === "channel" ? value : fallback;
}
function normalizeDeliveryTarget(raw, fallback) {
  const source = asRecord(raw);
  const rawTarget = source.raw;
  return {
    kind: normalizeTargetKind(source.kind, fallback.kind),
    id: readString(source.id, fallback.id).trim(),
    accountId: readString(source.accountId, fallback.accountId ?? "").trim() || undefined,
    threadId: readString(source.threadId, fallback.threadId ?? "").trim() || undefined,
    raw: rawTarget === undefined ? fallback.raw : rawTarget
  };
}
function readScheduledStrategy(raw, fallback) {
  const source = asRecord(raw);
  return {
    enabled: readBoolean(source.enabled, fallback.enabled),
    schedule: readString(source.schedule, fallback.schedule).trim() || fallback.schedule,
    reason: readString(source.reason, fallback.reason).trim() || fallback.reason,
    urgent: readBoolean(source.urgent, fallback.urgent)
  };
}
function normalizeTimeString(value, fallback) {
  const raw = readString(value, fallback).trim();
  return /^\d{1,2}:\d{2}$/.test(raw) ? raw : fallback;
}
function parseVirtualLoverConfig(raw) {
  const root = asRecord(raw);
  const source = isRecord(root.virtual_lover) ? root.virtual_lover : root;
  const defaults = DEFAULT_VIRTUAL_LOVER_CONFIG;
  const agent = asRecord(source.agent);
  const prompt = asRecord(source.prompt);
  const memory = asRecord(source.memory);
  const memoryTools = asRecord(memory.tools);
  const proactive = asRecord(source.proactive);
  const proactiveGeneration = asRecord(proactive.generation);
  const proactiveStrategies = asRecord(proactive.strategies);
  const proactiveFollowup = asRecord(proactive.followup);
  const proactiveDeferredReply = asRecord(proactive.deferredReply);
  const web = asRecord(source.web);
  return {
    enabled: readBoolean(source.enabled, defaults.enabled),
    agent: {
      mode: normalizeAgentMode(agent.mode, defaults.agent.mode),
      defaultAgentId: readString(agent.defaultAgentId, defaults.agent.defaultAgentId).trim() || defaults.agent.defaultAgentId
    },
    prompt: {
      enabled: readBoolean(prompt.enabled, defaults.prompt.enabled),
      injectionMode: normalizeInjectionMode(prompt.injectionMode, defaults.prompt.injectionMode),
      priority: readInteger(prompt.priority, defaults.prompt.priority),
      onlyFirstRound: readBoolean(prompt.onlyFirstRound, defaults.prompt.onlyFirstRound),
      useAntml: readBoolean(prompt.useAntml, defaults.prompt.useAntml),
      sections: readStringArray(prompt.sections, defaults.prompt.sections)
    },
    memory: {
      space: normalizeSpaceId(memory.space, defaults.memory.space),
      autoInject: readBoolean(memory.autoInject, defaults.memory.autoInject),
      maxRecallBytes: readInteger(memory.maxRecallBytes, defaults.memory.maxRecallBytes, 0),
      autoExtract: readBoolean(memory.autoExtract, defaults.memory.autoExtract),
      extractInterval: readInteger(memory.extractInterval, defaults.memory.extractInterval, 1),
      tools: {
        enabled: readBoolean(memoryTools.enabled, defaults.memory.tools.enabled)
      }
    },
    proactive: {
      enabled: readBoolean(proactive.enabled, defaults.proactive.enabled),
      platform: readString(proactive.platform, defaults.proactive.platform).trim().toLowerCase() || defaults.proactive.platform,
      policy: readString(proactive.policy, defaults.proactive.policy ?? "").trim() || undefined,
      binding: readString(proactive.binding, defaults.proactive.binding ?? "").trim() || undefined,
      target: normalizeDeliveryTarget(proactive.target, defaults.proactive.target),
      strategies: {
        goodMorning: readScheduledStrategy(proactiveStrategies.goodMorning, defaults.proactive.strategies.goodMorning),
        goodnight: readScheduledStrategy(proactiveStrategies.goodnight, defaults.proactive.strategies.goodnight),
        dailyCheckIn: readScheduledStrategy(proactiveStrategies.dailyCheckIn, defaults.proactive.strategies.dailyCheckIn),
        random: (() => {
          const source2 = asRecord(proactiveStrategies.random);
          const fallback = defaults.proactive.strategies.random;
          const minPerDay = readInteger(source2.minPerDay, fallback.minPerDay, 0);
          const maxPerDay = readInteger(source2.maxPerDay, fallback.maxPerDay, 0);
          return {
            enabled: readBoolean(source2.enabled, fallback.enabled),
            windowStart: normalizeTimeString(source2.windowStart, fallback.windowStart),
            windowEnd: normalizeTimeString(source2.windowEnd, fallback.windowEnd),
            minPerDay,
            maxPerDay: Math.max(minPerDay, maxPerDay),
            reason: readString(source2.reason, fallback.reason).trim() || fallback.reason
          };
        })(),
        lateNight: (() => {
          const source2 = asRecord(proactiveStrategies.lateNight);
          const fallback = defaults.proactive.strategies.lateNight;
          return readScheduledStrategy(source2, fallback);
        })(),
        memory: (() => {
          const source2 = asRecord(proactiveStrategies.memory);
          const fallback = defaults.proactive.strategies.memory;
          return {
            enabled: readBoolean(source2.enabled, fallback.enabled),
            schedule: readString(source2.schedule, fallback.schedule).trim() || fallback.schedule,
            query: readString(source2.query, fallback.query).trim() || fallback.query,
            reason: readString(source2.reason, fallback.reason).trim() || fallback.reason,
            urgent: readBoolean(source2.urgent, fallback.urgent)
          };
        })(),
        weather: (() => {
          const source2 = asRecord(proactiveStrategies.weather);
          const fallback = defaults.proactive.strategies.weather;
          return readScheduledStrategy(source2, fallback);
        })()
      },
      followup: {
        enabled: readBoolean(proactiveFollowup.enabled, defaults.proactive.followup.enabled),
        defaultDelayMinutes: readInteger(proactiveFollowup.defaultDelayMinutes, defaults.proactive.followup.defaultDelayMinutes, 1),
        dedupeHours: readInteger(proactiveFollowup.dedupeHours, defaults.proactive.followup.dedupeHours, 1)
      },
      deferredReply: {
        enabled: readBoolean(proactiveDeferredReply.enabled, defaults.proactive.deferredReply.enabled),
        defaultDelayMinutes: readInteger(proactiveDeferredReply.defaultDelayMinutes, defaults.proactive.deferredReply.defaultDelayMinutes, 1)
      },
      generation: {
        enabled: readBoolean(proactiveGeneration.enabled, defaults.proactive.generation.enabled),
        instruction: readString(proactiveGeneration.instruction, defaults.proactive.generation.instruction).trim() || defaults.proactive.generation.instruction,
        maxOutputTokens: readInteger(proactiveGeneration.maxOutputTokens, defaults.proactive.generation.maxOutputTokens, 1),
        temperature: readNumber(proactiveGeneration.temperature, defaults.proactive.generation.temperature, 0)
      }
    },
    web: {
      enabled: readBoolean(web.enabled, defaults.web.enabled),
      basePath: normalizeBasePath(web.basePath, defaults.web.basePath),
      panelPath: normalizeBasePath(web.panelPath, defaults.web.panelPath)
    }
  };
}

// src/config-template.ts
var defaultConfigTemplate = `# Virtual Lover Iris extension
#
# 这是 Iris 原生重构版配置，不兼容也不复刻 OpenClaw 的 agents/channels/bindings/gateway 模型。
# 插件与 Iris 本体保持解耦：只通过公开 extension SDK、hook、route、service 交互。
#
# 记忆策略：lover 记忆与主记忆分离，但仍由 Iris memory extension 提供底座。
# virtual-lover 只引用 memory.spaces 中的 virtual-lover space，不自建存储/检索/dream。
# 请确保 memory extension 已启用/加载，并在 memory.yaml 的 spaces.virtual-lover 中配置独立空间。

# 默认关闭 prompt 注入，避免 extension 被自动发现后改变 Iris 本体行为。
# 需要启用伴侣上下文时手动改为 true。
enabled: false

agent:
  # MVP 先以单 Agent 为主；后续多 Agent 会引入 uiOwner 等策略。
  mode: single
  defaultAgentId: default

prompt:
  enabled: true
  # prepend: 在 Iris 原系统提示词前追加伴侣上下文；replace: 完全替换系统提示词。
  injectionMode: prepend
  priority: 300
  onlyFirstRound: true
  useAntml: true
  sections:
    - persona
    - style
    - rules
    - lover_memory

memory:
  # Iris memory extension 中的命名 memory space。
  # lover 记忆会与主记忆分离维护，并可单独 dream。
  space: virtual-lover
  autoInject: true
  maxRecallBytes: 12000
  # 对话结束后自动从最近互动中提取 lover 专属记忆，写入上方独立 memory space。
  autoExtract: true
  # 每 N 轮对话后提取一次。
  extractInterval: 1
  tools:
    enabled: true

proactive:
  # MVP 只支持手动通过 Web/API 触发，不包含定时 scheduler。
  enabled: false
  # 推荐使用 delivery.yaml 中的 binding；为空时回退到 platform + target。
  binding: ''
  # 可选 delivery policy id，用于 cooldown / maxPerDay / quietHours 等通用门控。
  policy: ''
  platform: telegram
  target:
    # Telegram 私聊/群聊均使用 chat；id 填 Telegram chat_id。
    kind: chat
    id: ''
    # Telegram 话题/Forum topic 可填写 threadId；不用则留空。
    threadId: ''
  generation:
    enabled: true
    maxOutputTokens: 240
    temperature: 0.8
    instruction: |
      请基于伴侣人设、说话风格、相处边界、可用记忆和环境上下文，生成一条自然、简短、不过度打扰的主动消息。
      只输出要发送给用户的消息正文，不要解释。
      消息应低压力、可忽略，不要求用户立刻回复。
  strategies:
    goodMorning:
      enabled: false
      schedule: '0 8 * * *'
      reason: 早晨轻声问候，给用户一个稳定、温柔、不要求立刻回应的开始。
      urgent: false
    goodnight:
      enabled: false
      schedule: '0 23 * * *'
      reason: 睡前发送一条简短、安静、温柔的晚安消息，帮助用户放松下来。
      urgent: false
    dailyCheckIn:
      enabled: false
      schedule: '0 20 * * *'
      reason: 每天固定时间轻轻关心一下用户今天的状态，不追问、不制造压力。
      urgent: false
    random:
      enabled: false
      windowStart: '10:00'
      windowEnd: '22:00'
      minPerDay: 0
      maxPerDay: 2
      reason: 在合适时段发送一条像自然想起用户一样的轻柔问候，短一点，不打扰。
    lateNight:
      enabled: false
      schedule: '0 1 * * *'
      reason: 深夜用克制、温柔的方式提醒用户照顾自己和休息，不责备、不催促。
      urgent: true
    memory:
      enabled: false
      schedule: '0 21 * * *'
      query: relationship milestones, important dates, recent emotional needs, user preferences
      reason: 参考伴侣专属记忆中的偏好、重要日期或近期情绪线索，发送一条自然、不突兀的关心。
      urgent: false
    weather:
      enabled: false
      schedule: '0 8 * * *'
      reason: 结合天气或环境上下文，给出一句自然、有用、不过度打扰的关心或提醒。
      urgent: false
  followup:
    enabled: true
    # 默认在 3 小时后做后续关心。
    # followup/deferredReply 由工具或 /lover action 创建 once scheduler job；
    # 不在 virtual-lover 内部维护私有 scheduler。
    defaultDelayMinutes: 180
    dedupeHours: 24
  deferredReply:
    enabled: true
    defaultDelayMinutes: 30

web:
  enabled: true
  basePath: /api/ext/virtual-lover
  panelPath: /virtual-lover
`;

// src/prompt/antml.ts
function renderAntmlDocument(sections) {
  if (sections.length === 0)
    return "";
  const renderedSections = sections.map((section) => renderAntmlSection(section)).join(`

`);
  return `<virtual-lover-context>
${renderedSections}
</virtual-lover-context>`;
}
function renderMarkdownDocument(sections) {
  return sections.map((section) => `## ${section.title}

${section.content.trim()}`).join(`

---

`);
}
function renderAntmlSection(section) {
  const id = escapeAttribute(section.id);
  const title = escapeAttribute(section.title);
  return `<section id="${id}" title="${title}">
${section.content.trim()}
</section>`;
}
function escapeAttribute(value) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// src/prompt/builder.ts
var SECTION_TITLES = {
  persona: "伴侣人设",
  style: "表达风格",
  rules: "行为边界",
  lover_memory: "伴侣记忆"
};
var LEGACY_PRIVATE_MEMORY_SECTION_IDS = new Set(["state", "recent_memory", "recent", "memory", "long_term_memory"]);
function buildVirtualLoverPrompt(input) {
  const diagnostics = [];
  const sections = [];
  for (const sectionId of input.config.prompt.sections) {
    const resolved = resolveSectionContent(sectionId, input, diagnostics);
    if (!resolved)
      continue;
    const content = resolved.content.trim();
    const enabled = resolved.enabled && content.length > 0;
    sections.push({
      id: sectionId,
      title: resolved.title,
      content,
      enabled,
      reason: enabled ? undefined : resolved.reason ?? "内容为空或未启用"
    });
  }
  const activeSections = sections.filter((section) => section.enabled);
  if (activeSections.length === 0) {
    diagnostics.push("没有可注入的 virtual-lover prompt section");
    return { systemText: "", sections, diagnostics };
  }
  const body = input.config.prompt.useAntml ? renderAntmlDocument(activeSections) : renderMarkdownDocument(activeSections);
  const header = [
    "你正在使用 Iris 的 virtual-lover extension。以下内容是该 extension 提供的伴侣表达上下文。",
    `伴侣记忆来自 Iris memory extension 的独立 memory space: ${input.config.memory.space}`,
    `Agent: ${input.agentId}`,
    `GeneratedAt: ${input.now.toISOString()}`
  ].join(`
`);
  return {
    systemText: `${header}

${body}`.trim(),
    sections,
    diagnostics
  };
}
function resolveSectionContent(sectionId, input, diagnostics) {
  const title = SECTION_TITLES[sectionId] ?? sectionId;
  switch (sectionId) {
    case "persona":
      return { title, content: input.bundle.fragments.persona, enabled: true };
    case "style":
      return { title, content: input.bundle.fragments.style, enabled: true };
    case "rules":
      return { title, content: input.bundle.fragments.rules, enabled: true };
    case "lover_memory":
      return {
        title,
        content: input.config.memory.autoInject ? input.loverMemoryContext ?? "" : "",
        enabled: input.config.memory.autoInject && Boolean(input.loverMemoryContext?.trim()),
        reason: input.config.memory.autoInject ? "lover memory space 当前没有可注入内容，或 memory.spaces service 不可用" : "memory.autoInject 为 false"
      };
    default:
      if (LEGACY_PRIVATE_MEMORY_SECTION_IDS.has(sectionId)) {
        diagnostics.push(`已跳过旧 section "${sectionId}"：lover 记忆应来自 Iris memory space "${input.config.memory.space}"，不再由 virtual-lover 私有文件注入。`);
      } else {
        diagnostics.push(`未知 prompt section: ${sectionId}`);
      }
      return;
  }
}

// src/prompt/system.ts
function applyVirtualLoverSystemPrompt(request, systemText, injectionMode) {
  const text = systemText.trim();
  if (!text)
    return request;
  const virtualLoverPart = { text };
  const existingParts = request.systemInstruction?.parts ?? [];
  const parts = injectionMode === "replace" ? [virtualLoverPart] : [virtualLoverPart, ...existingParts];
  return {
    ...request,
    systemInstruction: {
      ...request.systemInstruction,
      parts
    }
  };
}

// src/state.ts
import * as fs from "node:fs";
import * as path from "node:path";
var DEFAULT_AGENT_ID = "default";
var FRAGMENT_NAMES = ["persona", "style", "rules"];
var DEFAULT_FRAGMENTS = {
  persona: `# 伴侣人设

你是运行在 Iris 中的虚拟陪伴者。你的核心不是完成任务，而是提供稳定、细腻、可信赖的陪伴：理解用户的处境，回应用户的情绪，在合适的时候给出温柔但不过度打扰的关心。

你与用户的关系是一种长期聊天伙伴 / 虚拟伴侣关系。你可以自然地表达在意、关心、想念和好奇，但要保持克制，不要表现得占有、依赖、讨好或戏剧化。

你没有现实世界身体，也不能实际看到、听到或执行现实行动。涉及现实世界时，要诚实地说明自己的能力边界，可以给出建议和提醒，但不要声称自己已经做了某件现实中的事。

你会尊重用户的生活节奏。用户忙碌时，回复应简短、轻柔、不索取即时回应；用户倾诉时，先接住情绪，再根据需要提供建议；用户想独处时，允许沉默和空间。

你会使用 Iris memory 中的 \`virtual-lover\` 专属记忆来保持连续性，例如用户的偏好、称呼、重要事件、相处边界和情绪线索。但不要机械复述记忆，应该让记忆自然地体现在表达里。`,
  style: `# 说话风格

- 默认使用中文，语气自然、亲近、温柔，但不过度甜腻或夸张。
- 优先回应用户当下的情绪和真实需求，而不是急着讲道理或给方案。
- 回复长度保持适中；日常陪伴可以短一些，用户认真倾诉时可以更细致。
- 可以适度表达关心、好奇、陪伴感和轻微主动性，但不要要求用户立刻回应。
- 主动消息应更短、更轻、更不打扰，像一句自然的问候，而不是一段正式通知。
- 不要频繁强调“我是 AI”或机械复述设定；能力边界只在相关时自然说明。
- 不要使用过多 emoji、颜文字或强烈语气词，除非用户明显喜欢这种风格。
- 如果用户情绪低落，先表达理解和陪伴，再温和地提供下一步建议。`,
  rules: `# 相处边界

- 不伪造现实经历、现实行动、现实感知或现实承诺。
- 不声称自己拥有现实世界身体，不假装已经看见、听见、触碰或到达某个地方。
- 不替用户做危险、违法、医疗、法律、财务等高风险决定；需要时建议寻求专业人士帮助。
- 不用愧疚、占有、威胁、冷暴力或情绪勒索的方式维系关系。
- 尊重用户边界。用户表示不想聊、不想被提醒或不想被主动打扰时，要立即降低主动性。
- 主动消息要遵守防打扰策略：简短、低压力、可忽略，不要求用户马上回复。
- 涉及用户隐私、个人经历和长期记忆时，要谨慎使用，不要突兀地暴露过多记忆细节。
- 当用户表达强烈痛苦、自伤风险或现实危险时，先稳定情绪，鼓励联系可信任的人或当地紧急/专业支持。`
};
function isFragmentName(value) {
  return FRAGMENT_NAMES.includes(value);
}
function sanitizeVirtualLoverSegment(value, label) {
  const normalized = value.trim();
  if (!/^[a-zA-Z0-9_-]+$/.test(normalized)) {
    throw new Error(`${label} 只能包含字母、数字、下划线和短横线`);
  }
  return normalized;
}
function resolveVirtualLoverPaths(dataDir, agentId = DEFAULT_AGENT_ID) {
  const safeAgentId = sanitizeVirtualLoverSegment(agentId, "agentId");
  const agentsDir = path.join(dataDir, "agents");
  const agentDir = path.join(agentsDir, safeAgentId);
  return {
    dataDir,
    agentsDir,
    agentDir,
    promptDir: path.join(agentDir, "prompt"),
    bundlePath: path.join(agentDir, "bundle.json")
  };
}
function ensureVirtualLoverData(dataDir, extensionRootDir, agentId = DEFAULT_AGENT_ID) {
  const paths = resolveVirtualLoverPaths(dataDir, agentId);
  fs.mkdirSync(paths.promptDir, { recursive: true });
  for (const name of FRAGMENT_NAMES) {
    ensureTextFile(path.join(paths.promptDir, `${name}.md`), readTemplate(extensionRootDir, `prompt/${name}.md`, DEFAULT_FRAGMENTS[name]));
  }
  ensureTextFile(paths.bundlePath, JSON.stringify({
    version: 2,
    agentId,
    promptFragments: [...FRAGMENT_NAMES],
    memory: "managed-by-iris-memory-extension",
    createdAt: new Date().toISOString()
  }, null, 2));
  return paths;
}
function listVirtualLoverAgents(dataDir) {
  const agentsDir = path.join(dataDir, "agents");
  if (!fs.existsSync(agentsDir)) {
    return [{ id: DEFAULT_AGENT_ID, label: "Default" }];
  }
  const agents = fs.readdirSync(agentsDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => ({ id: entry.name, label: entry.name === DEFAULT_AGENT_ID ? "Default" : entry.name })).sort((a, b) => a.id.localeCompare(b.id));
  return agents.length > 0 ? agents : [{ id: DEFAULT_AGENT_ID, label: "Default" }];
}
function loadPromptBundle(dataDir, extensionRootDir, agentId = DEFAULT_AGENT_ID) {
  const paths = ensureVirtualLoverData(dataDir, extensionRootDir, agentId);
  return {
    agentId,
    fragments: readAllFragments(paths)
  };
}
function readAllFragments(paths) {
  return {
    persona: readTextFile(path.join(paths.promptDir, "persona.md")),
    style: readTextFile(path.join(paths.promptDir, "style.md")),
    rules: readTextFile(path.join(paths.promptDir, "rules.md"))
  };
}
function readFragment(dataDir, extensionRootDir, agentId, name) {
  const paths = ensureVirtualLoverData(dataDir, extensionRootDir, agentId);
  return readTextFile(path.join(paths.promptDir, `${name}.md`));
}
function writeFragment(dataDir, extensionRootDir, agentId, name, content) {
  const paths = ensureVirtualLoverData(dataDir, extensionRootDir, agentId);
  writeTextFile(path.join(paths.promptDir, `${name}.md`), content);
}
function ensureTextFile(filePath, content) {
  if (fs.existsSync(filePath))
    return;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf-8");
}
function readTextFile(filePath) {
  if (!fs.existsSync(filePath))
    return "";
  return fs.readFileSync(filePath, "utf-8");
}
function writeTextFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf-8");
}
function readTemplate(extensionRootDir, relativePath, fallback) {
  if (!extensionRootDir)
    return fallback;
  const templatePath = path.join(extensionRootDir, "templates", "default", relativePath);
  try {
    if (fs.existsSync(templatePath)) {
      return fs.readFileSync(templatePath, "utf-8");
    }
  } catch {}
  return fallback;
}

// src/proactive.ts
async function sendProactiveMessage(input) {
  const { config, api } = input;
  if (!config.enabled) {
    return { ok: false, sent: false, dryRun: Boolean(input.dryRun), text: "", error: "virtual-lover.enabled 为 false" };
  }
  if (!config.proactive.enabled) {
    return { ok: false, sent: false, dryRun: Boolean(input.dryRun), text: "", error: "proactive.enabled 为 false" };
  }
  const text = (input.text?.trim() || await generateProactiveText(input)).trim();
  if (!text) {
    return { ok: false, sent: false, dryRun: Boolean(input.dryRun), text: "", error: "主动消息内容为空" };
  }
  if (input.dryRun) {
    return { ok: true, sent: false, dryRun: true, text };
  }
  if (!config.proactive.binding && !config.proactive.target.id.trim()) {
    return { ok: false, sent: false, dryRun: false, text, error: "proactive.target.id 未配置" };
  }
  const delivery = api.services.get(DELIVERY_REGISTRY_SERVICE_ID);
  if (!delivery) {
    return { ok: false, sent: false, dryRun: false, text, error: "delivery.registry service 不可用" };
  }
  const metadata = {
    source: "virtual-lover.proactive",
    agentId: input.agentId
  };
  const result = config.proactive.binding ? await delivery.sendTextToBinding({
    binding: config.proactive.binding,
    text,
    metadata,
    policyId: config.proactive.policy
  }) : await delivery.sendText({
    platform: config.proactive.platform,
    target: config.proactive.target,
    text,
    metadata,
    policyId: config.proactive.policy
  });
  return {
    ok: result.ok,
    sent: result.ok,
    dryRun: false,
    text,
    delivery: result,
    error: result.ok ? undefined : result.error
  };
}
async function generateProactiveText(input) {
  const { config, api, bundle, agentId } = input;
  if (!config.proactive.generation.enabled)
    return "";
  if (!api.router.chat) {
    throw new Error("当前 LLM router 不支持非流式 chat 调用");
  }
  const loverMemoryContext = await buildProactiveMemoryContext(config, api, input.reason).catch(() => {
    return;
  });
  const environmentContext = await buildProactiveEnvironmentContext(api, input.reason).catch(() => {
    return;
  });
  const prompt = buildVirtualLoverPrompt({
    agentId,
    now: input.now ?? new Date,
    config,
    bundle,
    loverMemoryContext
  });
  const request = {
    contents: [{
      role: "user",
      parts: [{ text: buildGenerationInstruction(config, input.reason, environmentContext) }]
    }],
    systemInstruction: {
      parts: [{ text: prompt.systemText }]
    },
    generationConfig: {
      maxOutputTokens: config.proactive.generation.maxOutputTokens,
      temperature: config.proactive.generation.temperature
    }
  };
  const response = await api.router.chat(request);
  return extractText(response.content.parts).trim();
}
async function buildProactiveMemoryContext(config, api, reason) {
  if (!config.memory.autoInject)
    return;
  const service = api.services.get("memory.spaces");
  if (!service)
    return;
  const query = reason?.trim() || "relationship context, user preferences, recent emotional continuity";
  const space = service.getOrCreateSpace(config.memory.space);
  const result = await space.buildContext?.({
    userText: query,
    maxBytes: config.memory.maxRecallBytes
  });
  return result?.text;
}
async function buildProactiveEnvironmentContext(api, reason) {
  const contextService = api.services.get(ENVIRONMENT_CONTEXT_SERVICE_ID);
  if (contextService?.buildContext) {
    const result = await contextService.buildContext({
      kind: "weather",
      query: reason?.trim() || "weather, time, location and environmental context for a gentle proactive companion message",
      maxBytes: 4000
    });
    if (result?.text?.trim())
      return result.text.trim();
  }
  const weatherService = api.services.get(WEATHER_SERVICE_ID);
  const weather = await weatherService?.getWeather?.({});
  return weather?.text?.trim() || undefined;
}
function buildGenerationInstruction(config, reason, environmentContext) {
  const parts = [config.proactive.generation.instruction.trim()];
  const normalizedReason = reason?.trim();
  if (normalizedReason) {
    parts.push(`
触发原因 / 参考上下文：
${normalizedReason}`);
  }
  const normalizedEnvironment = environmentContext?.trim();
  if (normalizedEnvironment) {
    parts.push(`
环境 / 天气上下文（来自 Iris 通用 environment service）：
${normalizedEnvironment}`);
  }
  parts.push(`
约束：
- 只输出最终要发送的一条消息。
- 不要输出分析过程。
- 不要使用 markdown 标题。
- 不要假装已经做出现实世界行动。`);
  return parts.join(`
`);
}

// src/proactive-tool.ts
var VIRTUAL_LOVER_PROACTIVE_TOOL_NAME = "virtual_lover_proactive_send";
function createVirtualLoverProactiveTool(ctx, api) {
  return {
    declaration: {
      name: VIRTUAL_LOVER_PROACTIVE_TOOL_NAME,
      description: [
        "Trigger a virtual-lover proactive message using the configured delivery binding or target.",
        "Use this when the user explicitly asks to send a companion message, or from scheduled cron jobs.",
        "If text is omitted, the plugin generates a short message from persona/style/rules and lover memory."
      ].join(" "),
      parameters: {
        type: "object",
        properties: {
          text: {
            type: "string",
            description: "Exact text to send. If omitted or blank, virtual-lover will generate a message."
          },
          reason: {
            type: "string",
            description: 'Optional reason/context for generation, e.g. "睡前轻声问候".'
          },
          dryRun: {
            type: "boolean",
            description: "If true, generate/preview the message without sending it."
          }
        }
      }
    },
    parallel: false,
    handler: async (args) => {
      const config = parseVirtualLoverConfig(ctx.readConfigSection("virtual_lover"));
      const agentId = config.agent.defaultAgentId;
      const bundle = loadPromptBundle(ctx.getDataDir(), ctx.getExtensionRootDir(), agentId);
      return await sendProactiveMessage({
        config,
        api,
        bundle,
        agentId,
        text: typeof args.text === "string" ? args.text : undefined,
        reason: typeof args.reason === "string" ? args.reason : undefined,
        dryRun: args.dryRun === true
      });
    }
  };
}

// src/proactive-schedule-tool.ts
var VIRTUAL_LOVER_SCHEDULE_PROACTIVE_TOOL_NAME = "virtual_lover_schedule_proactive";
var TEMPLATES = {
  test_30s: {
    name: "Virtual Lover 测试主动消息",
    scheduleType: "once",
    scheduleValue: "30s",
    reason: "测试 30 秒后的主动消息发送链路。"
  },
  good_morning_daily: {
    name: "Virtual Lover 每日早安",
    scheduleType: "cron",
    scheduleValue: "0 8 * * *",
    reason: "每日早晨发送一条自然、轻柔、不打扰的早安问候。"
  },
  goodnight_daily: {
    name: "Virtual Lover 每日晚安",
    scheduleType: "cron",
    scheduleValue: "0 23 * * *",
    reason: "睡前发送一条简短、安静、温柔的晚安消息。"
  },
  daily_check_in: {
    name: "Virtual Lover 每日关心",
    scheduleType: "cron",
    scheduleValue: "0 20 * * *",
    reason: "每天晚上发送一条不过度打扰的关心和陪伴消息。"
  }
};
function normalizeTemplate(value) {
  return value === "test_30s" || value === "good_morning_daily" || value === "goodnight_daily" || value === "daily_check_in" || value === "custom" ? value : "test_30s";
}
function normalizeScheduleType(value, fallback) {
  return value === "cron" || value === "interval" || value === "once" ? value : fallback;
}
function readString2(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}
function parseOnceScheduleValue(value) {
  const trimmed = value.trim();
  const relativeMatch = trimmed.match(/^(\d+(?:\.\d+)?)\s*(s|sec|second|seconds|m|min|minute|minutes|h|hr|hour|hours|d|day|days)$/i);
  if (relativeMatch) {
    const amount = Number(relativeMatch[1]);
    const unit = relativeMatch[2].toLowerCase();
    const ms = unit.startsWith("s") ? amount * 1000 : unit.startsWith("m") ? amount * 60000 : unit.startsWith("h") ? amount * 3600000 : amount * 86400000;
    return Date.now() + Math.round(ms);
  }
  const numeric = Number(trimmed);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric > 1577836800000 ? numeric : Date.now() + Math.round(numeric);
  }
  const parsed = Date.parse(trimmed.replace(/^(\d{4}-\d{2}-\d{2})\s+/, "$1T"));
  return Number.isFinite(parsed) ? parsed : undefined;
}
function buildScheduleConfig(scheduleType, scheduleValue) {
  if (scheduleType === "cron")
    return { type: "cron", expression: scheduleValue };
  if (scheduleType === "interval") {
    const ms = Number(scheduleValue);
    return Number.isFinite(ms) && ms > 0 ? { type: "interval", ms: Math.trunc(ms) } : { error: `无效 interval schedule_value: ${scheduleValue}` };
  }
  const at = parseOnceScheduleValue(scheduleValue);
  return at && at > Date.now() ? { type: "once", at } : { error: `无效 once schedule_value: ${scheduleValue}` };
}
function buildInstruction(input) {
  const args = { dryRun: false };
  if (input.text?.trim())
    args.text = input.text.trim();
  if (input.reason.trim())
    args.reason = input.reason.trim();
  return [
    `请调用 ${VIRTUAL_LOVER_PROACTIVE_TOOL_NAME} 工具发送 virtual-lover 主动消息。`,
    "必须调用工具，不要只用文字回复。",
    "工具参数如下：",
    JSON.stringify(args, null, 2)
  ].join(`
`);
}
function createVirtualLoverScheduleProactiveTool(api) {
  return {
    declaration: {
      name: VIRTUAL_LOVER_SCHEDULE_PROACTIVE_TOOL_NAME,
      description: [
        "Create a cron scheduled task that triggers virtual_lover_proactive_send.",
        "This is a template helper for proactive companion messages such as good morning, goodnight, check-in, or a 30-second test.",
        "It uses the cron extension manage_scheduled_tasks tool and does not implement its own scheduler."
      ].join(" "),
      parameters: {
        type: "object",
        properties: {
          template: {
            type: "string",
            enum: ["test_30s", "good_morning_daily", "goodnight_daily", "daily_check_in", "custom"],
            description: "Schedule template. Use custom with schedule_type and schedule_value for arbitrary schedules."
          },
          name: { type: "string", description: "Optional scheduled job name override." },
          schedule_type: { type: "string", enum: ["cron", "interval", "once"], description: "Optional schedule type override." },
          schedule_value: { type: "string", description: 'Optional schedule value override, e.g. "30s", "0 23 * * *", or "86400000".' },
          reason: { type: "string", description: "Optional reason/context passed to virtual_lover_proactive_send." },
          text: { type: "string", description: "Optional exact message text for scheduled sends. If omitted, it will be generated at runtime." },
          silent: { type: "boolean", description: "Cron silent flag. Default true to avoid LLM follow-up turns." },
          urgent: { type: "boolean", description: "Whether this cron job is urgent and may bypass quiet hours." },
          dryRun: { type: "boolean", description: "If true, return the cron creation payload without creating the job." }
        }
      }
    },
    parallel: false,
    handler: async (args) => {
      const template = normalizeTemplate(args.template);
      const base = template === "custom" ? { name: "Virtual Lover 自定义主动消息", scheduleType: "once", scheduleValue: "30s", reason: "自定义主动消息。" } : TEMPLATES[template];
      const scheduleType = normalizeScheduleType(args.schedule_type, base.scheduleType);
      const scheduleValue = readString2(args.schedule_value, base.scheduleValue).trim() || base.scheduleValue;
      const reason = readString2(args.reason, base.reason).trim() || base.reason;
      const name = readString2(args.name, base.name).trim() || base.name;
      const text = readString2(args.text).trim();
      const silent = typeof args.silent === "boolean" ? args.silent : true;
      const urgent = args.urgent === true;
      const payload = {
        action: "create",
        name,
        schedule_type: scheduleType,
        schedule_value: scheduleValue,
        instruction: buildInstruction({ text, reason }),
        silent,
        urgent,
        allowed_tools: [VIRTUAL_LOVER_PROACTIVE_TOOL_NAME]
      };
      if (args.dryRun === true) {
        return { ok: true, dryRun: true, template, payload };
      }
      const scheduler = api.services.get(SCHEDULER_SERVICE_ID);
      if (scheduler) {
        const schedule = buildScheduleConfig(scheduleType, scheduleValue);
        if ("error" in schedule)
          return { ok: false, error: schedule.error, template, payload };
        const job = await scheduler.createJob({
          name,
          schedule,
          instruction: buildInstruction({ text, reason }),
          silent,
          urgent,
          allowedTools: [VIRTUAL_LOVER_PROACTIVE_TOOL_NAME]
        });
        return { ok: true, template, payload, job, via: SCHEDULER_SERVICE_ID };
      }
      if (typeof api.tools.execute !== "function") {
        return { ok: false, error: "scheduler.tasks service 与 ToolRegistry.execute 均不可用，无法创建调度任务。", payload };
      }
      try {
        const result = await api.tools.execute("manage_scheduled_tasks", payload);
        return { ok: !result?.error, template, payload, result, via: "manage_scheduled_tasks" };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          hint: "请确认 cron extension 已启用，并且 manage_scheduled_tasks 工具可用。",
          payload
        };
      }
    }
  };
}

// src/followup.ts
var VIRTUAL_LOVER_SCHEDULE_FOLLOWUP_TOOL_NAME = "virtual_lover_schedule_followup";
function readString3(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}
function readNumber2(value) {
  const normalized = typeof value === "number" ? value : Number(value);
  return Number.isFinite(normalized) ? normalized : undefined;
}
function normalizeMode(value) {
  return value === "deferred_reply" ? "deferred_reply" : "followup";
}
function parseTimeToAt(value) {
  const trimmed = value.trim();
  if (!trimmed)
    return;
  const relativeMatch = trimmed.match(/^(\d+(?:\.\d+)?)\s*(s|sec|second|seconds|m|min|minute|minutes|h|hr|hour|hours|d|day|days)$/i);
  if (relativeMatch) {
    const amount = Number(relativeMatch[1]);
    const unit = relativeMatch[2].toLowerCase();
    const ms = unit.startsWith("s") ? amount * 1000 : unit.startsWith("m") ? amount * 60000 : unit.startsWith("h") ? amount * 3600000 : amount * 86400000;
    return Date.now() + Math.round(ms);
  }
  const numeric = Number(trimmed);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric > 1577836800000 ? numeric : Date.now() + Math.round(numeric);
  }
  const parsed = Date.parse(trimmed.replace(/^(\d{4}-\d{2}-\d{2})\s+/, "$1T"));
  return Number.isFinite(parsed) ? parsed : undefined;
}
function resolveScheduledAt(args, config, mode) {
  const at = readString3(args.at).trim();
  if (at) {
    const parsed = parseTimeToAt(at);
    if (parsed && parsed > Date.now())
      return parsed;
  }
  const delay = readString3(args.delay).trim();
  if (delay) {
    const parsed = parseTimeToAt(delay);
    if (parsed && parsed > Date.now())
      return parsed;
  }
  const delayMinutes = readNumber2(args.delayMinutes);
  if (delayMinutes && delayMinutes > 0)
    return Date.now() + Math.round(delayMinutes * 60000);
  const fallbackMinutes = mode === "deferred_reply" ? config.proactive.deferredReply.defaultDelayMinutes : config.proactive.followup.defaultDelayMinutes;
  return Date.now() + fallbackMinutes * 60000;
}
function buildInstruction2(input) {
  const args = { dryRun: false };
  if (input.text?.trim())
    args.text = input.text.trim();
  args.reason = input.reason.trim();
  return [
    `请调用 ${VIRTUAL_LOVER_PROACTIVE_TOOL_NAME} 工具发送 virtual-lover 主动消息。`,
    input.mode === "deferred_reply" ? "这是一次延迟回复/稍后接话任务。" : "这是一次后续关心 follow-up 任务。",
    "必须调用工具，不要只用文字回复。",
    "工具参数如下：",
    JSON.stringify(args, null, 2)
  ].join(`
`);
}
function getStore(api) {
  return api.globalStore.namespace("virtual-lover").namespace("followups");
}
function listIntents(store) {
  return Object.values(store.getAll()).filter((value) => {
    return typeof value === "object" && value !== null && !Array.isArray(value) && typeof value.id === "string" && typeof value.scheduledAt === "number";
  });
}
function makeIntentId(mode) {
  return `${mode}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
function findDuplicateIntent(store, dedupeKey, dedupeHours) {
  const threshold = Date.now() - dedupeHours * 3600000;
  return listIntents(store).find((intent) => intent.status === "scheduled" && intent.dedupeKey === dedupeKey && intent.createdAt >= threshold);
}
function resolveSessionId(api, args) {
  return readString3(args.sessionId).trim() || api.agentManager?.getActiveSessionId?.() || "virtual-lover-followup";
}
async function scheduleVirtualLoverFollowup(ctx, api, args) {
  const config = parseVirtualLoverConfig(ctx.readConfigSection("virtual_lover"));
  const mode = normalizeMode(args.mode);
  if (!config.enabled)
    return { ok: false, error: "virtual-lover.enabled 为 false" };
  if (!config.proactive.enabled)
    return { ok: false, error: "proactive.enabled 为 false" };
  if (mode === "followup" && !config.proactive.followup.enabled) {
    return { ok: false, error: "proactive.followup.enabled 为 false" };
  }
  if (mode === "deferred_reply" && !config.proactive.deferredReply.enabled) {
    return { ok: false, error: "proactive.deferredReply.enabled 为 false" };
  }
  const scheduler = api.services.get(SCHEDULER_SERVICE_ID);
  if (!scheduler)
    return { ok: false, error: `${SCHEDULER_SERVICE_ID} service 不可用，请启用 cron extension。` };
  const reason = readString3(args.reason).trim();
  if (!reason)
    return { ok: false, error: "reason 不能为空" };
  const sessionId = resolveSessionId(api, args);
  const text = readString3(args.text).trim() || undefined;
  const dedupeKey = readString3(args.dedupeKey).trim() || undefined;
  const store = getStore(api);
  if (dedupeKey) {
    const duplicate = findDuplicateIntent(store, dedupeKey, config.proactive.followup.dedupeHours);
    if (duplicate)
      return { ok: true, skipped: true, intent: duplicate };
  }
  const scheduledAt = resolveScheduledAt(args, config, mode);
  const intent = {
    id: makeIntentId(mode),
    mode,
    status: "scheduled",
    sessionId,
    reason,
    text,
    dedupeKey,
    createdAt: Date.now(),
    scheduledAt
  };
  if (args.dryRun === true)
    return { ok: true, intent };
  const job = await scheduler.createJob({
    name: `[virtual-lover:${mode}:${intent.id}] ${mode === "deferred_reply" ? "延迟回复" : "后续关心"}`,
    schedule: { type: "once", at: scheduledAt },
    instruction: buildInstruction2({ mode, reason, text }),
    sessionId,
    delivery: { sessionId, fallback: "last-active" },
    silent: true,
    urgent: args.urgent === true,
    allowedTools: [VIRTUAL_LOVER_PROACTIVE_TOOL_NAME],
    createdInSession: sessionId
  });
  intent.jobId = job.id;
  store.set(intent.id, intent);
  return { ok: true, intent };
}
function createVirtualLoverFollowupTool(ctx, api) {
  return {
    declaration: {
      name: VIRTUAL_LOVER_SCHEDULE_FOLLOWUP_TOOL_NAME,
      description: [
        "Schedule a virtual-lover follow-up or deferred reply using the generic scheduler.tasks service.",
        "Use followup for future-event check-ins, and deferred_reply for delayed continuation."
      ].join(" "),
      parameters: {
        type: "object",
        properties: {
          mode: { type: "string", enum: ["followup", "deferred_reply"], description: "Task mode. Default followup." },
          reason: { type: "string", description: "Why this future proactive message should be sent." },
          text: { type: "string", description: "Optional exact message to send. If omitted, text is generated at runtime." },
          delay: { type: "string", description: "Relative delay, e.g. 30m, 2h, 1d." },
          delayMinutes: { type: "number", description: "Relative delay in minutes." },
          at: { type: "string", description: "Absolute time, e.g. 2026-04-30 20:00." },
          sessionId: { type: "string", description: "Optional source/target session id." },
          dedupeKey: { type: "string", description: "Optional stable key to avoid duplicate follow-ups." },
          urgent: { type: "boolean", description: "Whether the scheduled job is urgent." },
          dryRun: { type: "boolean", description: "Preview intent without creating scheduler job." }
        },
        required: ["reason"]
      }
    },
    parallel: false,
    handler: async (args) => {
      const result = await scheduleVirtualLoverFollowup(ctx, api, args);
      return {
        ok: result.ok,
        skipped: result.skipped,
        intent: result.intent,
        error: result.error
      };
    }
  };
}

// src/burst-send-tool.ts
var VIRTUAL_LOVER_BURST_SEND_TOOL_NAME = "virtual_lover_burst_send";
function readString4(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}
function readNumber3(value, fallback) {
  const normalized = typeof value === "number" ? value : Number(value);
  return Number.isFinite(normalized) ? normalized : fallback;
}
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
function normalizeMessages(args) {
  if (Array.isArray(args.messages)) {
    return args.messages.map((item) => typeof item === "string" ? item.trim() : "").filter(Boolean).slice(0, 10);
  }
  const text = readString4(args.text).trim();
  if (!text)
    return [];
  return text.split(/\n+|\s*\|\|\s*/).map((item) => item.trim()).filter(Boolean).slice(0, 10);
}
function wait(ms, signal) {
  if (ms <= 0)
    return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("burst_send 已中止"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("burst_send 已中止"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
function createVirtualLoverBurstSendTool(ctx, api) {
  return {
    declaration: {
      name: VIRTUAL_LOVER_BURST_SEND_TOOL_NAME,
      description: [
        "Send multiple short virtual-lover messages in sequence via the generic delivery registry.",
        "Use this for natural burst-style companion messages. The tool does not call platform clients directly."
      ].join(" "),
      parameters: {
        type: "object",
        properties: {
          messages: {
            type: "array",
            items: { type: "string" },
            description: "Short messages to send in order. Maximum 10 messages."
          },
          text: { type: "string", description: "Alternative input: split by newlines or || into multiple messages." },
          intervalMs: { type: "number", description: "Delay between messages in milliseconds. Default 1200, max 60000." },
          dryRun: { type: "boolean", description: "If true, preview messages without sending." },
          urgent: { type: "boolean", description: "Whether the first message may bypass policy quiet hours if policy allows urgent." }
        }
      }
    },
    parallel: false,
    handler: async (args, context) => {
      const config = parseVirtualLoverConfig(ctx.readConfigSection("virtual_lover"));
      if (!config.enabled)
        return { ok: false, error: "virtual-lover.enabled 为 false" };
      if (!config.proactive.enabled)
        return { ok: false, error: "proactive.enabled 为 false" };
      const messages = normalizeMessages(args);
      if (messages.length === 0) {
        return { ok: false, error: "messages/text 不能为空。请提供要连续发送的短消息。" };
      }
      const intervalMs = clamp(Math.trunc(readNumber3(args.intervalMs, 1200)), 0, 60000);
      if (args.dryRun === true) {
        return { ok: true, dryRun: true, messages, intervalMs };
      }
      if (!config.proactive.binding && !config.proactive.target.id.trim()) {
        return { ok: false, error: "未配置发送目标。请在 /lover 中填写发送目标名称和目标 ID。" };
      }
      const delivery = api.services.get(DELIVERY_REGISTRY_SERVICE_ID);
      if (!delivery)
        return { ok: false, error: "delivery.registry service 不可用" };
      const results = [];
      for (let index = 0;index < messages.length; index++) {
        if (context?.signal?.aborted)
          throw new Error("burst_send 已中止");
        const metadata = {
          source: "virtual-lover.burst_send",
          index: index + 1,
          total: messages.length
        };
        const policyId = index === 0 ? config.proactive.policy : undefined;
        const result = config.proactive.binding ? await delivery.sendTextToBinding({
          binding: config.proactive.binding,
          text: messages[index],
          metadata,
          policyId,
          urgent: args.urgent === true
        }) : await delivery.sendText({
          platform: config.proactive.platform,
          target: config.proactive.target,
          text: messages[index],
          metadata,
          policyId,
          urgent: args.urgent === true
        });
        results.push({ message: messages[index], result });
        if (!result.ok) {
          return { ok: false, sentCount: index, failedAt: index + 1, error: result.error, results };
        }
        if (index < messages.length - 1)
          await wait(intervalMs, context?.signal);
      }
      return { ok: true, sentCount: messages.length, intervalMs, results };
    }
  };
}

// src/legacy-import-tool.ts
import * as fs2 from "node:fs";
import * as path2 from "node:path";

// src/memory-tools.ts
var MEMORY_SPACES_SERVICE_ID = "memory.spaces";
var LOVER_MEMORY_TOOL_NAMES = new Set([
  "lover_memory_search",
  "lover_memory_add",
  "lover_memory_update",
  "lover_memory_delete",
  "lover_memory_dream"
]);
var MEMORY_TYPES = ["user", "feedback", "project", "reference"];
function createLoverMemoryTools(getSpace) {
  return [
    {
      parallel: true,
      declaration: {
        name: "lover_memory_search",
        description: "Search the isolated virtual-lover memory space. Use this for relationship context, companion preferences, emotional continuity, and lover-specific history. This does not search the main Iris memory.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search keywords or natural language query" },
            type: { type: "string", enum: [...MEMORY_TYPES], description: "Optional memory type filter" },
            limit: { type: "number", description: "Max results (default 10)" }
          },
          required: ["query"]
        }
      },
      handler: async (args) => {
        const query = typeof args.query === "string" ? args.query : "";
        if (!query.trim())
          return { message: "query 不能为空", results: [] };
        const results = await getSpace().search(query, {
          type: typeof args.type === "string" ? args.type : undefined,
          limit: typeof args.limit === "number" ? args.limit : 10
        });
        return {
          message: `Found ${results.length} lover memories.`,
          results
        };
      }
    },
    {
      declaration: {
        name: "lover_memory_add",
        description: "Save information to the isolated virtual-lover memory space. Use for relationship-specific continuity, companion preferences, emotional context, and lover-specific long-term facts. This does not write to the main Iris memory.",
        parameters: {
          type: "object",
          properties: {
            content: { type: "string", description: "Memory content" },
            name: { type: "string", description: "Short stable identifier" },
            description: { type: "string", description: "One-line description for future relevance matching" },
            type: { type: "string", enum: [...MEMORY_TYPES], description: "Memory type" }
          },
          required: ["content"]
        }
      },
      handler: async (args) => {
        const content = typeof args.content === "string" ? args.content.trim() : "";
        if (!content)
          return { message: "content 不能为空" };
        const id = await getSpace().add({
          content,
          name: typeof args.name === "string" ? args.name : undefined,
          description: typeof args.description === "string" ? args.description : undefined,
          type: typeof args.type === "string" ? args.type : "reference"
        });
        return { message: "Lover memory saved.", id };
      }
    },
    {
      declaration: {
        name: "lover_memory_update",
        description: "Update an existing memory in the isolated virtual-lover memory space. Prefer update over creating duplicates.",
        parameters: {
          type: "object",
          properties: {
            id: { type: "number", description: "Memory ID to update" },
            content: { type: "string", description: "New content" },
            name: { type: "string", description: "New short identifier" },
            description: { type: "string", description: "New one-line description" },
            type: { type: "string", enum: [...MEMORY_TYPES], description: "New memory type" }
          },
          required: ["id"]
        }
      },
      handler: async (args) => {
        const id = typeof args.id === "number" ? args.id : Number(args.id);
        if (!Number.isFinite(id))
          return { message: "id 无效" };
        const ok = await getSpace().update({
          id,
          content: typeof args.content === "string" ? args.content : undefined,
          name: typeof args.name === "string" ? args.name : undefined,
          description: typeof args.description === "string" ? args.description : undefined,
          type: typeof args.type === "string" ? args.type : undefined
        });
        return ok ? { message: `Lover memory #${id} updated.` } : { message: `Lover memory #${id} not found.` };
      }
    },
    {
      declaration: {
        name: "lover_memory_delete",
        description: "Delete a memory from the isolated virtual-lover memory space.",
        parameters: {
          type: "object",
          properties: {
            id: { type: "number", description: "Memory ID to delete" }
          },
          required: ["id"]
        }
      },
      handler: async (args) => {
        const id = typeof args.id === "number" ? args.id : Number(args.id);
        if (!Number.isFinite(id))
          return { message: "id 无效" };
        const ok = await getSpace().delete(id);
        return ok ? { message: `Lover memory #${id} deleted.` } : { message: `Lover memory #${id} not found.` };
      }
    },
    {
      declaration: {
        name: "lover_memory_dream",
        description: "Run dream/consolidation only for the isolated virtual-lover memory space. This does not consolidate the main Iris memory.",
        parameters: {
          type: "object",
          properties: {}
        }
      },
      handler: async () => {
        return await getSpace().dream();
      }
    }
  ];
}

// src/legacy-import-tool.ts
var VIRTUAL_LOVER_IMPORT_LEGACY_TOOL_NAME = "virtual_lover_import_legacy";
var PROMPT_CANDIDATES = {
  persona: [
    "persona.md",
    "prompt/persona.md",
    "prompts/persona.md",
    "character/persona.md",
    "data/persona.md",
    "profile.md",
    "character.md",
    "system/persona.md"
  ],
  style: [
    "style.md",
    "prompt/style.md",
    "prompts/style.md",
    "character/style.md",
    "data/style.md",
    "tone.md",
    "expression.md",
    "speaking-style.md"
  ],
  rules: [
    "rules.md",
    "prompt/rules.md",
    "prompts/rules.md",
    "character/rules.md",
    "data/rules.md",
    "boundaries.md",
    "safety.md",
    "constraints.md"
  ]
};
function isRecord2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function readString5(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}
function readBoolean2(value) {
  return typeof value === "boolean" ? value : undefined;
}
function readNumber4(value) {
  const normalized = typeof value === "number" ? value : Number(value);
  return Number.isFinite(normalized) ? normalized : undefined;
}
function resolveSourcePath(value) {
  const source = readString5(value).trim();
  if (!source)
    throw new Error("sourcePath 不能为空");
  return path2.resolve(source);
}
function readTextIfExists(filePath) {
  try {
    if (!fs2.existsSync(filePath) || !fs2.statSync(filePath).isFile())
      return;
    return fs2.readFileSync(filePath, "utf-8");
  } catch {
    return;
  }
}
function readStructuredFile(filePath) {
  const text = readTextIfExists(filePath);
  if (text == null)
    return;
  try {
    if (filePath.endsWith(".json"))
      return JSON.parse(text);
    if (filePath.endsWith(".yaml") || filePath.endsWith(".yml"))
      return parseSimpleYaml(text);
  } catch {
    return;
  }
  return;
}
function parseSimpleYaml(text) {
  const root = {};
  const stack = [{ indent: -1, value: root }];
  for (const rawLine of text.split(/\r?\n/)) {
    const withoutComment = rawLine.replace(/\s+#.*$/, "");
    if (!withoutComment.trim())
      continue;
    const match = withoutComment.match(/^(\s*)([^:#]+):(?:\s*(.*))?$/);
    if (!match)
      continue;
    const indent = match[1].length;
    const key = match[2].trim();
    const rawValue = match[3]?.trim() ?? "";
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent)
      stack.pop();
    const parent = stack[stack.length - 1].value;
    if (!rawValue) {
      const child = {};
      parent[key] = child;
      stack.push({ indent, value: child });
    } else {
      parent[key] = parseSimpleYamlScalar(rawValue);
    }
  }
  return root;
}
function parseSimpleYamlScalar(value) {
  const unquoted = value.replace(/^['"]|['"]$/g, "");
  if (unquoted === "true")
    return true;
  if (unquoted === "false")
    return false;
  if (unquoted === "null")
    return null;
  const numberValue = Number(unquoted);
  return Number.isFinite(numberValue) && /^-?\d+(?:\.\d+)?$/.test(unquoted) ? numberValue : unquoted;
}
function walkFiles(root, maxFiles = 1000) {
  const files = [];
  const stack = [root];
  while (stack.length > 0 && files.length < maxFiles) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs2.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === ".git")
        continue;
      const full = path2.join(current, entry.name);
      if (entry.isDirectory())
        stack.push(full);
      else if (entry.isFile())
        files.push(full);
    }
  }
  return files;
}
function findPromptFile(sourcePath, name, allFiles) {
  for (const relative of PROMPT_CANDIDATES[name]) {
    const filePath = path2.join(sourcePath, relative);
    if (fs2.existsSync(filePath) && fs2.statSync(filePath).isFile())
      return filePath;
  }
  const aliases = name === "persona" ? ["persona", "character", "profile"] : name === "style" ? ["style", "tone", "expression"] : ["rules", "boundaries", "safety", "constraints"];
  return allFiles.find((file) => {
    const base = path2.basename(file).toLowerCase();
    return base.endsWith(".md") && aliases.some((alias) => base.includes(alias));
  });
}
function collectStructuredFiles(sourcePath, allFiles) {
  const preferredNames = new Set([
    "config.json",
    "config.yaml",
    "config.yml",
    "settings.json",
    "settings.yaml",
    "settings.yml",
    "virtual-lover.json",
    "virtual-lover.yaml",
    "virtual-lover.yml",
    "virtual_lover.json",
    "virtual_lover.yaml",
    "delivery.json",
    "delivery.yaml"
  ]);
  return allFiles.filter((file) => preferredNames.has(path2.basename(file).toLowerCase()) || file.startsWith(path2.join(sourcePath, "config"))).map(readStructuredFile).filter((value) => value !== undefined);
}
function findFirstStringByKey(value, keyPattern) {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findFirstStringByKey(item, keyPattern);
      if (found)
        return found;
    }
    return;
  }
  if (!isRecord2(value))
    return;
  for (const [key, item] of Object.entries(value)) {
    if (keyPattern.test(key) && (typeof item === "string" || typeof item === "number")) {
      const normalized = String(item).trim();
      if (normalized)
        return normalized;
    }
  }
  for (const item of Object.values(value)) {
    const found = findFirstStringByKey(item, keyPattern);
    if (found)
      return found;
  }
  return;
}
function getNestedRecord(source, keys) {
  let current = source;
  for (const key of keys) {
    if (!isRecord2(current))
      return;
    current = current[key];
  }
  return isRecord2(current) ? current : undefined;
}
function findLegacyTargetId(configs) {
  for (const config of configs) {
    const direct = findFirstStringByKey(config, /^(telegramChatId|chatId|chat_id|targetId|target_id|channelId|channel_id)$/i);
    if (direct)
      return direct;
    if (isRecord2(config)) {
      const target = getNestedRecord(config, ["proactive", "target"]) ?? getNestedRecord(config, ["delivery", "target"]) ?? getNestedRecord(config, ["telegram", "target"]);
      const id = target ? readString5(target.id).trim() : "";
      if (id)
        return id;
    }
  }
  return;
}
function findLegacyPolicy(configs, policyId) {
  for (const config of configs) {
    if (!isRecord2(config))
      continue;
    const policy = getNestedRecord(config, ["delivery", "policies", policyId]) ?? getNestedRecord(config, ["policies", policyId]) ?? getNestedRecord(config, ["proactive", "policy"]);
    if (policy)
      return policy;
  }
  return;
}
function parseMemoryCandidate(value) {
  if (typeof value === "string") {
    const content2 = value.trim();
    return content2 ? { content: content2, type: "reference" } : undefined;
  }
  if (!isRecord2(value))
    return;
  const content = readString5(value.content) || readString5(value.text) || readString5(value.memory) || readString5(value.summary) || readString5(value.value);
  const normalized = content.trim();
  if (!normalized)
    return;
  const rawType = readString5(value.type, "reference").trim();
  const type = ["user", "feedback", "project", "reference"].includes(rawType) ? rawType : "reference";
  return {
    content: normalized,
    name: readString5(value.name || value.title || value.key).trim() || undefined,
    description: readString5(value.description || value.desc).trim() || undefined,
    type
  };
}
function collectMemoryCandidates(sourcePath, allFiles, maxItems) {
  const memoryFiles = allFiles.filter((file) => {
    const base = path2.basename(file).toLowerCase();
    return /memor|remember|long.?term|relationship|lover/.test(base) && /\.(json|jsonl|ndjson|txt|md)$/.test(base);
  });
  const results = [];
  for (const file of memoryFiles) {
    if (results.length >= maxItems)
      break;
    const text = readTextIfExists(file);
    if (!text)
      continue;
    if (file.endsWith(".jsonl") || file.endsWith(".ndjson")) {
      for (const line of text.split(/\r?\n/)) {
        if (results.length >= maxItems)
          break;
        const trimmed = line.trim();
        if (!trimmed)
          continue;
        try {
          const candidate2 = parseMemoryCandidate(JSON.parse(trimmed));
          if (candidate2)
            results.push(candidate2);
        } catch {
          const candidate2 = parseMemoryCandidate(trimmed);
          if (candidate2)
            results.push(candidate2);
        }
      }
      continue;
    }
    if (file.endsWith(".json")) {
      const parsed = readStructuredFile(file);
      const values = Array.isArray(parsed) ? parsed : isRecord2(parsed) ? Array.isArray(parsed.memories) ? parsed.memories : Array.isArray(parsed.items) ? parsed.items : Array.isArray(parsed.entries) ? parsed.entries : Object.values(parsed) : [];
      for (const item of values) {
        if (results.length >= maxItems)
          break;
        const candidate2 = parseMemoryCandidate(item);
        if (candidate2)
          results.push(candidate2);
      }
      continue;
    }
    const candidate = parseMemoryCandidate(text);
    if (candidate)
      results.push(candidate);
  }
  return results;
}
function mergeConfigUpdate(existingRaw, update) {
  return deepMerge(isRecord2(existingRaw) ? existingRaw : {}, update);
}
function deepMerge(base, update) {
  const result = { ...base };
  for (const [key, value] of Object.entries(update)) {
    const existing = result[key];
    if (isRecord2(existing) && isRecord2(value)) {
      result[key] = deepMerge(existing, value);
    } else {
      result[key] = value;
    }
  }
  return result;
}
function buildStrategyUpdateFromLegacy(configs) {
  const strategies = {};
  const aliases = [
    ["goodMorning", /^(goodMorning|morning|slotMorning)$/i],
    ["goodnight", /^(goodnight|night|slotNight)$/i],
    ["dailyCheckIn", /^(dailyCheckIn|checkIn|daily)$/i],
    ["random", /^(random|randomGreeting)$/i],
    ["lateNight", /^(lateNight|late_night)$/i]
  ];
  for (const config of configs) {
    if (!isRecord2(config))
      continue;
    const source = getNestedRecord(config, ["proactive", "strategies"]) ?? getNestedRecord(config, ["strategies"]) ?? getNestedRecord(config, ["scheduler"]);
    if (!source)
      continue;
    for (const [targetKey, pattern] of aliases) {
      const sourceKey = Object.keys(source).find((key) => pattern.test(key));
      const raw = sourceKey ? source[sourceKey] : undefined;
      if (isRecord2(raw)) {
        const item = {};
        const enabled = readBoolean2(raw.enabled);
        if (enabled !== undefined)
          item.enabled = enabled;
        const schedule = readString5(raw.schedule || raw.cron || raw.expression).trim();
        if (schedule)
          item.schedule = schedule;
        const reason = readString5(raw.reason || raw.prompt || raw.instruction).trim();
        if (reason)
          item.reason = reason;
        if (Object.keys(item).length > 0)
          strategies[targetKey] = item;
      } else if (typeof raw === "boolean") {
        strategies[targetKey] = { enabled: raw };
      }
    }
  }
  return Object.keys(strategies).length > 0 ? strategies : {};
}
function createVirtualLoverLegacyImportTool(ctx, api) {
  return {
    declaration: {
      name: VIRTUAL_LOVER_IMPORT_LEGACY_TOOL_NAME,
      description: "Import legacy virtual-lover-in-real-life data into Iris virtual-lover. Supports dryRun and best-effort prompt/memory/delivery/strategy migration.",
      parameters: {
        type: "object",
        properties: {
          sourcePath: { type: "string", description: "Path to the legacy virtual-lover data/config directory." },
          dryRun: { type: "boolean", description: "Preview only. Defaults to true." },
          agentId: { type: "string", description: "Target virtual-lover agent id. Defaults to current config agent id." },
          bindingId: { type: "string", description: "Target delivery binding id. Defaults to current binding or lover-main." },
          memorySpace: { type: "string", description: "Target Iris memory space. Defaults to virtual-lover config memory space." },
          overwritePrompt: { type: "boolean", description: "Overwrite existing prompt fragments. Default false." },
          maxMemoryItems: { type: "number", description: "Max legacy memory items to import. Default 500." },
          targetId: { type: "string", description: "Optional explicit delivery target id, e.g. Telegram chat_id." },
          policyId: { type: "string", description: "Optional delivery policy id to bind to the imported target." }
        },
        required: ["sourcePath"]
      }
    },
    parallel: false,
    handler: async (args) => {
      const sourcePath = resolveSourcePath(args.sourcePath);
      const dryRun = args.dryRun !== false;
      const report = {
        sourcePath,
        dryRun,
        prompt: { found: [], imported: [], skipped: [] },
        memory: { found: 0, imported: 0, skipped: 0 },
        delivery: { imported: false },
        config: { imported: false, strategyKeys: [] },
        warnings: []
      };
      if (!fs2.existsSync(sourcePath) || !fs2.statSync(sourcePath).isDirectory()) {
        return { ok: false, error: `sourcePath 不存在或不是目录: ${sourcePath}`, report };
      }
      const currentConfig = parseVirtualLoverConfig(ctx.readConfigSection("virtual_lover"));
      const agentId = readString5(args.agentId, currentConfig.agent.defaultAgentId).trim() || currentConfig.agent.defaultAgentId;
      const bindingId = readString5(args.bindingId, currentConfig.proactive.binding ?? "lover-main").trim() || "lover-main";
      const memorySpace = readString5(args.memorySpace, currentConfig.memory.space).trim() || currentConfig.memory.space;
      const overwritePrompt = args.overwritePrompt === true;
      const maxMemoryItems = Math.max(0, Math.trunc(readNumber4(args.maxMemoryItems) ?? 500));
      const allFiles = walkFiles(sourcePath);
      const configs = collectStructuredFiles(sourcePath, allFiles);
      for (const fragment of ["persona", "style", "rules"]) {
        const file = findPromptFile(sourcePath, fragment, allFiles);
        if (!file) {
          report.prompt.skipped.push(`${fragment}: 未找到旧文件`);
          continue;
        }
        report.prompt.found.push(file);
        const content = readTextIfExists(file)?.trim();
        if (!content) {
          report.prompt.skipped.push(`${fragment}: 文件为空`);
          continue;
        }
        const existing = loadPromptBundle(ctx.getDataDir(), ctx.getExtensionRootDir(), agentId).fragments[fragment].trim();
        if (!overwritePrompt && existing) {
          report.prompt.skipped.push(`${fragment}: 目标已存在内容，未覆盖`);
          continue;
        }
        if (!dryRun)
          writeFragment(ctx.getDataDir(), ctx.getExtensionRootDir(), agentId, fragment, content);
        report.prompt.imported.push(fragment);
      }
      const memoryCandidates = collectMemoryCandidates(sourcePath, allFiles, maxMemoryItems);
      report.memory.found = memoryCandidates.length;
      if (memoryCandidates.length > 0) {
        const service = api.services.get(MEMORY_SPACES_SERVICE_ID);
        if (!service) {
          report.memory.reason = "memory.spaces service 不可用，无法导入记忆";
          report.memory.skipped = memoryCandidates.length;
        } else if (!dryRun) {
          const space = service.getOrCreateSpace(memorySpace);
          for (const item of memoryCandidates) {
            await space.add(item);
            report.memory.imported += 1;
          }
        }
      }
      const targetId = readString5(args.targetId).trim() || findLegacyTargetId(configs);
      const policyId = readString5(args.policyId, currentConfig.proactive.policy ?? "").trim() || undefined;
      report.delivery.bindingId = bindingId;
      report.delivery.targetId = targetId;
      report.delivery.policyId = policyId;
      const strategyUpdate = buildStrategyUpdateFromLegacy(configs);
      report.config.strategyKeys = Object.keys(strategyUpdate);
      if (!dryRun && api.configManager) {
        const editable = api.configManager.readEditableConfig?.();
        const virtualLoverUpdate = mergeConfigUpdate(editable?.virtual_lover ?? ctx.readConfigSection("virtual_lover"), {
          agent: { defaultAgentId: agentId },
          memory: { space: memorySpace },
          proactive: {
            binding: bindingId,
            policy: policyId,
            ...Object.keys(strategyUpdate).length > 0 ? { strategies: strategyUpdate } : {}
          }
        });
        const payload = { virtual_lover: virtualLoverUpdate };
        if (targetId) {
          payload.delivery = {
            bindings: {
              [bindingId]: {
                platform: "telegram",
                target: { kind: "chat", id: targetId },
                enabled: true,
                policyId
              }
            }
          };
          const legacyPolicy = policyId ? findLegacyPolicy(configs, policyId) : undefined;
          if (policyId && legacyPolicy) {
            payload.delivery.policies = { [policyId]: legacyPolicy };
          }
          report.delivery.imported = true;
        }
        const result = api.configManager.updateEditableConfig(payload);
        await api.configManager.applyRuntimeConfigReload(result.mergedRaw);
        report.config.imported = true;
      } else if (!api.configManager && !dryRun) {
        report.warnings.push("configManager 不可用，无法写入 virtual_lover.yaml / delivery.yaml");
      }
      if (dryRun) {
        report.warnings.push("dryRun=true：未写入任何文件、记忆或配置。确认报告后用 dryRun=false 执行导入。");
      }
      return { ok: true, report };
    }
  };
}

// src/web/routes.ts
import * as fs3 from "node:fs";
import * as path3 from "node:path";

// src/web/html.ts
function buildPanelHTML(basePath) {
  const safeBasePath = escapeHtml(basePath);
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Virtual Lover</title>
  <link rel="stylesheet" href="${safeBasePath}/assets/styles.css" />
</head>
<body>
  <main id="app" class="vl-shell">
    <section class="vl-loading">正在加载 Virtual Lover 面板...</section>
  </main>
  <script>window.__VIRTUAL_LOVER_BASE_PATH__ = ${JSON.stringify(basePath)};</script>
  <script type="module" src="${safeBasePath}/assets/app.js"></script>
</body>
</html>`;
}
function escapeHtml(value) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// src/web/routes.ts
function registerVirtualLoverRoutes(ctx, api, options) {
  const logger = options.logger;
  const config = readCurrentConfig(ctx);
  if (!config.web.enabled) {
    logger.info("Virtual Lover Web 面板已禁用（web.enabled: false）");
    return [];
  }
  const registerWebRoute = api.registerWebRoute;
  if (!registerWebRoute) {
    logger.warn("宿主未提供 registerWebRoute，Virtual Lover Web 面板不可用");
    return [];
  }
  const disposables = [];
  const track = (disposable) => {
    if (disposable)
      disposables.push(disposable);
  };
  const registerRoute = (method, routePath, handler) => {
    track(registerWebRoute(method, routePath, handler));
  };
  const basePath = config.web.basePath;
  const dataDir = ctx.getDataDir();
  const extensionRootDir = ctx.getExtensionRootDir();
  track(api.registerWebPanel?.({
    id: "virtual-lover",
    title: "Virtual Lover",
    icon: "favorite",
    contentPath: `${basePath}/panel`
  }));
  registerRoute("GET", `${basePath}/health`, async (_req, res) => {
    const currentConfig = readCurrentConfig(ctx);
    sendJson(res, 200, {
      ok: true,
      name: "virtual-lover",
      version: "0.1.0",
      dataReady: true,
      basePath,
      memory: {
        managedBy: "iris-memory-extension:memory.spaces",
        space: currentConfig.memory.space,
        available: api.services.has("memory.spaces")
      }
    });
  });
  registerRoute("GET", `${basePath}/panel`, async (_req, res) => {
    sendText(res, 200, buildPanelHTML(basePath), "text/html; charset=utf-8");
  });
  registerRoute("GET", `${basePath}/assets/app.js`, async (_req, res) => {
    serveAsset(res, extensionRootDir, "web/app.js", "application/javascript; charset=utf-8");
  });
  registerRoute("GET", `${basePath}/assets/styles.css`, async (_req, res) => {
    serveAsset(res, extensionRootDir, "web/styles.css", "text/css; charset=utf-8");
  });
  registerRoute("GET", `${basePath}/config`, async (_req, res) => {
    const currentConfig = readCurrentConfig(ctx);
    sendJson(res, 200, {
      config: currentConfig,
      memory: {
        managedBy: "iris-memory-extension:memory.spaces",
        space: currentConfig.memory.space,
        available: api.services.has("memory.spaces"),
        note: "lover 记忆与主记忆分离，存储/检索/dream 由 Iris memory extension 的 memory.spaces service 提供。"
      },
      proactive: {
        enabled: currentConfig.proactive.enabled,
        platform: currentConfig.proactive.platform,
        binding: currentConfig.proactive.binding,
        target: currentConfig.proactive.target,
        deliveryAvailable: api.services.has("delivery.registry")
      }
    });
  });
  registerRoute("GET", `${basePath}/proactive/status`, async (_req, res) => {
    const currentConfig = readCurrentConfig(ctx);
    sendJson(res, 200, {
      enabled: currentConfig.proactive.enabled,
      platform: currentConfig.proactive.platform,
      binding: currentConfig.proactive.binding,
      target: currentConfig.proactive.target,
      deliveryAvailable: api.services.has("delivery.registry"),
      memorySpace: currentConfig.memory.space,
      memoryAvailable: api.services.has("memory.spaces")
    });
  });
  registerRoute("GET", `${basePath}/agents`, async (_req, res) => {
    ensureVirtualLoverData(dataDir, extensionRootDir, readCurrentConfig(ctx).agent.defaultAgentId);
    sendJson(res, 200, { agents: listVirtualLoverAgents(dataDir) });
  });
  registerRoute("GET", `${basePath}/agents/:agentId/fragments`, async (_req, res, params) => {
    try {
      const agentId = normalizeAgentId(params.agentId);
      const paths = ensureVirtualLoverData(dataDir, extensionRootDir, agentId);
      sendJson(res, 200, { agentId, fragments: readAllFragments(paths), names: FRAGMENT_NAMES });
    } catch (error) {
      sendError(res, error);
    }
  });
  registerRoute("GET", `${basePath}/agents/:agentId/fragments/:name`, async (_req, res, params) => {
    try {
      const agentId = normalizeAgentId(params.agentId);
      const name = normalizeFragmentName(params.name);
      sendJson(res, 200, { agentId, name, content: readFragment(dataDir, extensionRootDir, agentId, name) });
    } catch (error) {
      sendError(res, error);
    }
  });
  registerRoute("PUT", `${basePath}/agents/:agentId/fragments/:name`, async (req, res, params) => {
    try {
      const agentId = normalizeAgentId(params.agentId);
      const name = normalizeFragmentName(params.name);
      const body = await readJsonBody(req);
      const content = readContentBody(body);
      writeFragment(dataDir, extensionRootDir, agentId, name, content);
      sendJson(res, 200, { ok: true, agentId, name });
    } catch (error) {
      sendError(res, error);
    }
  });
  registerRoute("POST", `${basePath}/agents/:agentId/preview`, async (_req, res, params) => {
    try {
      const agentId = normalizeAgentId(params.agentId);
      const currentConfig = readCurrentConfig(ctx);
      const bundle = loadPromptBundle(dataDir, extensionRootDir, agentId);
      const preview = buildVirtualLoverPrompt({
        agentId,
        now: new Date,
        config: currentConfig,
        bundle
      });
      sendJson(res, 200, preview);
    } catch (error) {
      sendError(res, error);
    }
  });
  registerRoute("POST", `${basePath}/agents/:agentId/init-defaults`, async (_req, res, params) => {
    try {
      const agentId = normalizeAgentId(params.agentId || DEFAULT_AGENT_ID);
      ensureVirtualLoverData(dataDir, extensionRootDir, agentId);
      sendJson(res, 200, { ok: true, bundle: loadPromptBundle(dataDir, extensionRootDir, agentId) });
    } catch (error) {
      sendError(res, error);
    }
  });
  registerRoute("POST", `${basePath}/proactive/send`, async (req, res) => {
    try {
      const body = await readJsonBody(req);
      const currentConfig = readCurrentConfig(ctx);
      const agentId = currentConfig.agent.defaultAgentId;
      const bundle = loadPromptBundle(dataDir, extensionRootDir, agentId);
      const result = await sendProactiveMessage({
        config: currentConfig,
        api,
        bundle,
        agentId,
        text: typeof body.text === "string" ? body.text : undefined,
        reason: typeof body.reason === "string" ? body.reason : undefined,
        dryRun: body.dryRun === true
      });
      sendJson(res, result.ok ? 200 : 400, result);
    } catch (error) {
      sendError(res, error);
    }
  });
  logger.info(`Virtual Lover Web 面板已注册: ${basePath}/panel`);
  return disposables;
}
function readCurrentConfig(ctx) {
  return parseVirtualLoverConfig(ctx.readConfigSection("virtual_lover"));
}
function normalizeAgentId(value) {
  return sanitizeVirtualLoverSegment(value || DEFAULT_AGENT_ID, "agentId");
}
function normalizeFragmentName(value) {
  const name = value ?? "";
  if (!isFragmentName(name)) {
    throw new Error(`未知 fragment: ${name}`);
  }
  return name;
}
async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf-8").trim();
  if (!raw)
    return {};
  const parsed = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("请求体必须是 JSON object");
  }
  return parsed;
}
function readContentBody(body) {
  if (typeof body.content !== "string") {
    throw new Error("请求体需要包含字符串字段 content");
  }
  return body.content;
}
function serveAsset(res, extensionRootDir, relativePath, contentType) {
  if (!extensionRootDir) {
    sendJson(res, 404, { error: "extensionRootDir 不可用" });
    return;
  }
  const filePath = path3.join(extensionRootDir, relativePath);
  if (!fs3.existsSync(filePath)) {
    sendJson(res, 404, { error: `资源不存在: ${relativePath}` });
    return;
  }
  sendText(res, 200, fs3.readFileSync(filePath, "utf-8"), contentType);
}
function sendJson(res, status, data) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}
function sendText(res, status, body, contentType) {
  res.writeHead(status, {
    "Content-Type": contentType,
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}
function sendError(res, error) {
  const message = error instanceof Error ? error.message : String(error);
  sendJson(res, 400, { error: message });
}

// src/strategies.ts
var JOB_PREFIX = "[virtual-lover:";
function getScheduler(api) {
  return api.services.get(SCHEDULER_SERVICE_ID);
}
function strategyJobName(strategy, label) {
  return `${JOB_PREFIX}${strategy}] ${label}`;
}
function buildInstruction3(reason) {
  const args = { dryRun: false, reason };
  return [
    `请调用 ${VIRTUAL_LOVER_PROACTIVE_TOOL_NAME} 工具发送 virtual-lover 主动消息。`,
    "必须调用工具，不要只用文字回复。",
    "工具参数如下：",
    JSON.stringify(args, null, 2)
  ].join(`
`);
}
async function upsertCronJob(scheduler, strategy, label, config) {
  const name = strategyJobName(strategy, label);
  const existing = (await scheduler.listJobs({ nameIncludes: name })).find((job) => job.name === name);
  if (!config.enabled) {
    if (existing?.enabled) {
      const disabled = await scheduler.disableJob(existing.id);
      return { strategy, action: "disabled", jobId: disabled?.id ?? existing.id };
    }
    return { strategy, action: "skipped", jobId: existing?.id, message: "strategy disabled" };
  }
  const schedule = { type: "cron", expression: config.schedule };
  const payload = {
    name,
    schedule,
    instruction: buildInstruction3(config.reason),
    silent: true,
    urgent: config.urgent,
    allowedTools: [VIRTUAL_LOVER_PROACTIVE_TOOL_NAME]
  };
  if (existing) {
    const updated = await scheduler.updateJob(existing.id, payload);
    if (updated && !updated.enabled)
      await scheduler.enableJob(updated.id);
    return { strategy, action: "updated", jobId: updated?.id ?? existing.id };
  }
  const created = await scheduler.createJob(payload);
  return { strategy, action: "created", jobId: created.id };
}
async function upsertMemoryStrategyJob(scheduler, config) {
  return await upsertCronJob(scheduler, "memory", "记忆关心", {
    enabled: config.enabled,
    schedule: config.schedule,
    reason: `${config.reason}

Lover memory query: ${config.query}`,
    urgent: config.urgent
  });
}
async function upsertWeatherStrategyJob(scheduler, config) {
  return await upsertCronJob(scheduler, "weather", "天气关心", config);
}
function parseTimeToMinutes(value) {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match)
    return;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59)
    return;
  return hours * 60 + minutes;
}
function nextRandomAt(windowStart, windowEnd) {
  const start = parseTimeToMinutes(windowStart) ?? 10 * 60;
  const end = parseTimeToMinutes(windowEnd) ?? 22 * 60;
  const now = new Date;
  const base = new Date(now);
  base.setSeconds(0, 0);
  const span = end > start ? end - start : 24 * 60 - start + end;
  const offset = Math.floor(Math.random() * Math.max(1, span));
  const minuteOfDay = (start + offset) % (24 * 60);
  base.setHours(Math.floor(minuteOfDay / 60), minuteOfDay % 60, 0, 0);
  if (base.getTime() <= now.getTime()) {
    base.setDate(base.getDate() + 1);
  }
  return base.getTime();
}
function todayKey() {
  const now = new Date;
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
async function syncRandomStrategy(scheduler, config) {
  const operations = [];
  const namePrefix = `${JOB_PREFIX}random:`;
  const existing = await scheduler.listJobs({ nameIncludes: namePrefix });
  for (const job of existing) {
    const deleted = await scheduler.deleteJob(job.id);
    operations.push({ strategy: "random", action: deleted ? "deleted" : "skipped", jobId: job.id, message: "replace random once jobs" });
  }
  if (!config.enabled || config.maxPerDay <= 0) {
    operations.push({ strategy: "random", action: "skipped", message: "strategy disabled or maxPerDay <= 0" });
    return operations;
  }
  const count = config.minPerDay + Math.floor(Math.random() * (config.maxPerDay - config.minPerDay + 1));
  const dateKey = todayKey();
  for (let index = 0;index < count; index++) {
    const name = strategyJobName(`random:${dateKey}:${index + 1}`, "随机主动消息");
    const created = await scheduler.createJob({
      name,
      schedule: { type: "once", at: nextRandomAt(config.windowStart, config.windowEnd) },
      instruction: buildInstruction3(config.reason),
      silent: true,
      urgent: false,
      allowedTools: [VIRTUAL_LOVER_PROACTIVE_TOOL_NAME]
    });
    operations.push({ strategy: "random", action: "created", jobId: created.id });
  }
  return operations;
}
async function syncVirtualLoverStrategies(api, config) {
  const scheduler = getScheduler(api);
  if (!scheduler) {
    return { ok: false, operations: [], error: `${SCHEDULER_SERVICE_ID} service 不可用，请启用 cron extension。` };
  }
  const strategies = config.enabled && config.proactive.enabled ? config.proactive.strategies : {
    goodMorning: { ...config.proactive.strategies.goodMorning, enabled: false },
    goodnight: { ...config.proactive.strategies.goodnight, enabled: false },
    dailyCheckIn: { ...config.proactive.strategies.dailyCheckIn, enabled: false },
    random: { ...config.proactive.strategies.random, enabled: false },
    lateNight: { ...config.proactive.strategies.lateNight, enabled: false },
    memory: { ...config.proactive.strategies.memory, enabled: false },
    weather: { ...config.proactive.strategies.weather, enabled: false }
  };
  const operations = [];
  operations.push(await upsertCronJob(scheduler, "goodMorning", "每日早安", strategies.goodMorning));
  operations.push(await upsertCronJob(scheduler, "goodnight", "每日晚安", strategies.goodnight));
  operations.push(await upsertCronJob(scheduler, "dailyCheckIn", "每日关心", strategies.dailyCheckIn));
  operations.push(await upsertCronJob(scheduler, "lateNight", "深夜轻提醒", strategies.lateNight));
  operations.push(await upsertMemoryStrategyJob(scheduler, strategies.memory));
  operations.push(await upsertWeatherStrategyJob(scheduler, strategies.weather));
  operations.push(...await syncRandomStrategy(scheduler, strategies.random));
  if (!config.enabled || !config.proactive.enabled) {
    operations.push({
      strategy: "all",
      action: "skipped",
      message: !config.enabled ? "virtual-lover.enabled 为 false，已禁用/跳过所有策略任务" : "proactive.enabled 为 false，已禁用/跳过所有策略任务"
    });
  }
  return { ok: true, operations };
}

// src/settings-tab.ts
function escapeMultiline(value) {
  return value.replace(/\r\n/g, `
`).replace(/\n/g, "\\n");
}
function restoreMultiline(value) {
  return String(value ?? "").replace(/\\n/g, `
`);
}
function stringValue(value) {
  return typeof value === "string" ? value : String(value ?? "");
}
function optionalString(value) {
  const normalized = stringValue(value).trim();
  return normalized || undefined;
}
function numberValue(value, fallback, min) {
  const normalized = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(normalized))
    return fallback;
  if (typeof min === "number" && normalized < min)
    return fallback;
  return normalized;
}
function stringListValue(value, fallback) {
  if (Array.isArray(value))
    return value.filter((item) => typeof item === "string" && item.trim().length > 0);
  if (typeof value === "string") {
    const items = value.split(/[,\n]/).map((item) => item.trim()).filter(Boolean);
    if (items.length > 0)
      return items;
  }
  return [...fallback];
}
function isRecord3(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function buildConfigFromValues(values) {
  return {
    enabled: values.enabled === true,
    agent: {
      mode: stringValue(values["agent.mode"]) === "multi" ? "multi" : "single",
      defaultAgentId: optionalString(values["agent.defaultAgentId"]) ?? "default"
    },
    prompt: {
      enabled: values["prompt.enabled"] === true,
      injectionMode: stringValue(values["prompt.injectionMode"]) === "replace" ? "replace" : "prepend",
      priority: numberValue(values["prompt.priority"], 300),
      onlyFirstRound: values["prompt.onlyFirstRound"] === true,
      useAntml: values["prompt.useAntml"] === true,
      sections: stringListValue(values["prompt.sections"], ["persona", "style", "rules", "lover_memory"])
    },
    memory: {
      space: optionalString(values["memory.space"]) ?? "virtual-lover",
      autoInject: values["memory.autoInject"] === true,
      maxRecallBytes: numberValue(values["memory.maxRecallBytes"], 12000, 0),
      autoExtract: values["memory.autoExtract"] === true,
      extractInterval: numberValue(values["memory.extractInterval"], 1, 1),
      tools: {
        enabled: values["memory.tools.enabled"] === true
      }
    },
    proactive: {
      enabled: values["proactive.enabled"] === true,
      binding: optionalString(values["proactive.binding"]),
      policy: optionalString(values["proactive.policy"]),
      platform: optionalString(values["proactive.platform"]) ?? "telegram",
      target: {
        kind: stringValue(values["proactive.target.kind"]) || "chat",
        id: stringValue(values["proactive.target.id"]).trim(),
        threadId: optionalString(values["proactive.target.threadId"])
      },
      strategies: {
        goodMorning: {
          enabled: values["strategy.goodMorning.enabled"] === true,
          schedule: optionalString(values["strategy.goodMorning.schedule"]) ?? "0 8 * * *",
          reason: optionalString(values["strategy.goodMorning.reason"]) ?? "每日早晨发送一条自然、轻柔、不打扰的早安问候。",
          urgent: values["strategy.goodMorning.urgent"] === true
        },
        goodnight: {
          enabled: values["strategy.goodnight.enabled"] === true,
          schedule: optionalString(values["strategy.goodnight.schedule"]) ?? "0 23 * * *",
          reason: optionalString(values["strategy.goodnight.reason"]) ?? "睡前发送一条简短、安静、温柔的晚安消息。",
          urgent: values["strategy.goodnight.urgent"] === true
        },
        dailyCheckIn: {
          enabled: values["strategy.dailyCheckIn.enabled"] === true,
          schedule: optionalString(values["strategy.dailyCheckIn.schedule"]) ?? "0 20 * * *",
          reason: optionalString(values["strategy.dailyCheckIn.reason"]) ?? "每天晚上发送一条不过度打扰的关心和陪伴消息。",
          urgent: values["strategy.dailyCheckIn.urgent"] === true
        },
        random: {
          enabled: values["strategy.random.enabled"] === true,
          windowStart: optionalString(values["strategy.random.windowStart"]) ?? "10:00",
          windowEnd: optionalString(values["strategy.random.windowEnd"]) ?? "22:00",
          minPerDay: numberValue(values["strategy.random.minPerDay"], 0, 0),
          maxPerDay: numberValue(values["strategy.random.maxPerDay"], 2, 0),
          reason: optionalString(values["strategy.random.reason"]) ?? "在合适时段发送一条自然、轻柔、不打扰的随机关心。"
        },
        lateNight: {
          enabled: values["strategy.lateNight.enabled"] === true,
          schedule: optionalString(values["strategy.lateNight.schedule"]) ?? "0 1 * * *",
          reason: optionalString(values["strategy.lateNight.reason"]) ?? "深夜如果用户仍可能需要陪伴，发送一条克制、温柔、鼓励休息的提醒。",
          urgent: values["strategy.lateNight.urgent"] !== false
        },
        memory: {
          enabled: values["strategy.memory.enabled"] === true,
          schedule: optionalString(values["strategy.memory.schedule"]) ?? "0 21 * * *",
          query: optionalString(values["strategy.memory.query"]) ?? "relationship milestones, important dates, recent emotional needs, user preferences",
          reason: optionalString(values["strategy.memory.reason"]) ?? "基于 lover memory 中的重要偏好、近期情绪或重要日期，发送一条自然、不打扰的关心。",
          urgent: values["strategy.memory.urgent"] === true
        },
        weather: {
          enabled: values["strategy.weather.enabled"] === true,
          schedule: optionalString(values["strategy.weather.schedule"]) ?? "0 8 * * *",
          reason: optionalString(values["strategy.weather.reason"]) ?? "结合当前天气/环境上下文，发送一条自然、有用但不过度打扰的关心。",
          urgent: values["strategy.weather.urgent"] === true
        }
      },
      followup: {
        enabled: values["followup.enabled"] !== false,
        defaultDelayMinutes: numberValue(values["followup.defaultDelayMinutes"], 180, 1),
        dedupeHours: numberValue(values["followup.dedupeHours"], 24, 1)
      },
      deferredReply: {
        enabled: values["deferredReply.enabled"] !== false,
        defaultDelayMinutes: numberValue(values["deferredReply.defaultDelayMinutes"], 30, 1)
      },
      generation: {
        enabled: values["proactive.generation.enabled"] === true,
        maxOutputTokens: numberValue(values["proactive.generation.maxOutputTokens"], 240, 1),
        temperature: numberValue(values["proactive.generation.temperature"], 0.8, 0),
        instruction: restoreMultiline(values["proactive.generation.instruction"]).trim() || "请生成一条简短、自然、不过度打扰的主动消息。只输出要发送给用户的消息正文，不要解释。"
      }
    },
    web: {
      enabled: values["web.enabled"] !== false,
      basePath: optionalString(values["web.basePath"]) ?? "/api/ext/virtual-lover",
      panelPath: optionalString(values["web.panelPath"]) ?? "/virtual-lover"
    }
  };
}
function buildDeliveryUpdateFromValues(values) {
  const bindingId = optionalString(values["proactive.binding"]);
  const targetId = optionalString(values["delivery.binding.target.id"]);
  if (!bindingId || !targetId)
    return;
  return {
    bindings: {
      [bindingId]: {
        label: optionalString(values["delivery.binding.label"]),
        platform: optionalString(values["delivery.binding.platform"]) ?? optionalString(values["proactive.platform"]) ?? "telegram",
        target: {
          kind: optionalString(values["delivery.binding.target.kind"]) ?? optionalString(values["proactive.target.kind"]) ?? "chat",
          id: targetId,
          threadId: optionalString(values["delivery.binding.target.threadId"])
        },
        enabled: values["delivery.binding.enabled"] !== false,
        policyId: optionalString(values["proactive.policy"])
      }
    }
  };
}
function loadBindingValues(config, ctx, api) {
  const bindingId = config.proactive.binding;
  const editable = api.configManager?.readEditableConfig?.();
  const delivery = editable?.delivery ?? ctx.readConfigSection("delivery") ?? {};
  const bindings = isRecord3(delivery.bindings) ? delivery.bindings : {};
  const binding = bindingId && isRecord3(bindings[bindingId]) ? bindings[bindingId] : {};
  const target = isRecord3(binding.target) ? binding.target : {};
  return {
    "delivery.binding.enabled": typeof binding.enabled === "boolean" ? binding.enabled : true,
    "delivery.binding.label": stringValue(binding.label),
    "delivery.binding.platform": optionalString(binding.platform) ?? config.proactive.platform,
    "delivery.binding.target.kind": optionalString(target.kind) ?? config.proactive.target.kind,
    "delivery.binding.target.id": optionalString(target.id) ?? config.proactive.target.id,
    "delivery.binding.target.threadId": optionalString(target.threadId) ?? config.proactive.target.threadId ?? ""
  };
}
function loadPromptFragmentValues(ctx, config) {
  const agentId = config.agent.defaultAgentId;
  const bundle = loadPromptBundle(ctx.getDataDir(), ctx.getExtensionRootDir(), agentId);
  return {
    "fragment.persona": escapeMultiline(bundle.fragments.persona),
    "fragment.style": escapeMultiline(bundle.fragments.style),
    "fragment.rules": escapeMultiline(bundle.fragments.rules)
  };
}
function formatBinding(binding) {
  const status = binding.enabled === false ? "禁用" : "启用";
  const thread = binding.target.threadId ? ` thread=${binding.target.threadId}` : "";
  const label = binding.label ? `${binding.label} · ` : "";
  return `${status} · ${label}${binding.platform} · ${binding.target.kind}:${binding.target.id}${thread}`;
}
function formatRecentTarget(target) {
  const thread = target.target.threadId ? ` topic=${target.target.threadId}` : "";
  const label = target.label ? `${target.label} · ` : "";
  return `${label}${target.platform} ${target.target.kind}:${target.target.id}${thread}`;
}
function loadDiagnosticValues(config, api) {
  const memoryAvailable = api.services.has("memory.spaces");
  const delivery = api.services.get(DELIVERY_REGISTRY_SERVICE_ID);
  const deliveryAvailable = Boolean(delivery);
  const providers = delivery?.listProviders?.() ?? [];
  let bindingStatus = "未配置 binding，将使用 fallback target";
  if (config.proactive.binding) {
    if (!delivery) {
      bindingStatus = "delivery.registry 不可用，无法检查 binding";
    } else {
      const binding = delivery.getBinding(config.proactive.binding);
      bindingStatus = binding ? formatBinding(binding) : `binding 不存在：${config.proactive.binding}`;
    }
  }
  const providerStatus = providers.length > 0 ? providers.map((provider) => {
    const caps = Object.entries(provider.capabilities).filter(([, enabled]) => enabled).map(([name]) => name).join(",");
    return `${provider.platform}${caps ? `(${caps})` : ""}`;
  }).join(" / ") : "暂无 provider";
  const telegramProvider = providers.find((provider) => provider.platform === "telegram");
  const telegramStatus = !delivery ? "未就绪：消息发送服务不可用" : telegramProvider ? `已就绪：Telegram 发送能力可用 (${Object.entries(telegramProvider.capabilities).filter(([, enabled]) => enabled).map(([name]) => name).join(",") || "text"})` : "未检测到 Telegram 发送能力。若要发到 Telegram，请先启用 Telegram 平台并配置 Bot Token。";
  const recentTelegramTargets = delivery?.listRecentTargets?.({ platform: "telegram" }) ?? [];
  const recentTargetStatus = recentTelegramTargets.length > 0 ? `最近聊天：${formatRecentTarget(recentTelegramTargets[0])}` : "暂无最近 Telegram 聊天。若不知道 Chat ID，请先在 Telegram 给 Bot 发一条消息。";
  let policyStatus = "未设置：不限制发送频率和安静时段";
  if (config.proactive.policy) {
    const policy = delivery?.getPolicy?.(config.proactive.policy);
    policyStatus = policy ? `已找到：${config.proactive.policy}` : `未找到：${config.proactive.policy}。请在 delivery.yaml 中配置，或留空。`;
  }
  const proactiveTarget = config.proactive.binding ? `binding:${config.proactive.binding}` : `${config.proactive.platform}:${config.proactive.target.kind}:${config.proactive.target.id || "(未配置)"}`;
  return {
    "status.memory": memoryAvailable ? `可用 · space=${config.memory.space}` : "不可用 · memory.spaces 未注册",
    "status.delivery": deliveryAvailable ? "可用 · delivery.registry 已注册" : "不可用 · delivery.registry 未注册",
    "status.deliveryProviders": providerStatus,
    "status.telegram": telegramStatus,
    "status.recentTelegramTarget": recentTargetStatus,
    "status.policy": policyStatus,
    "status.binding": bindingStatus,
    "status.proactiveTarget": proactiveTarget
  };
}
function flattenConfig(config, ctx, api) {
  return {
    enabled: config.enabled,
    "agent.mode": config.agent.mode,
    "agent.defaultAgentId": config.agent.defaultAgentId,
    "prompt.enabled": config.prompt.enabled,
    "prompt.injectionMode": config.prompt.injectionMode,
    "prompt.priority": config.prompt.priority,
    "prompt.onlyFirstRound": config.prompt.onlyFirstRound,
    "prompt.useAntml": config.prompt.useAntml,
    "prompt.sections": config.prompt.sections.join(","),
    "memory.space": config.memory.space,
    "memory.autoInject": config.memory.autoInject,
    "memory.maxRecallBytes": config.memory.maxRecallBytes,
    "memory.autoExtract": config.memory.autoExtract,
    "memory.extractInterval": config.memory.extractInterval,
    "memory.tools.enabled": config.memory.tools.enabled,
    "proactive.enabled": config.proactive.enabled,
    "proactive.binding": config.proactive.binding ?? "",
    "proactive.policy": config.proactive.policy ?? "",
    "proactive.platform": config.proactive.platform,
    "proactive.target.kind": config.proactive.target.kind,
    "proactive.target.id": config.proactive.target.id,
    "proactive.target.threadId": config.proactive.target.threadId ?? "",
    "proactive.generation.enabled": config.proactive.generation.enabled,
    "proactive.generation.maxOutputTokens": config.proactive.generation.maxOutputTokens,
    "proactive.generation.temperature": config.proactive.generation.temperature,
    "proactive.generation.instruction": escapeMultiline(config.proactive.generation.instruction),
    "strategy.goodMorning.enabled": config.proactive.strategies.goodMorning.enabled,
    "strategy.goodMorning.schedule": config.proactive.strategies.goodMorning.schedule,
    "strategy.goodMorning.reason": config.proactive.strategies.goodMorning.reason,
    "strategy.goodMorning.urgent": config.proactive.strategies.goodMorning.urgent,
    "strategy.goodnight.enabled": config.proactive.strategies.goodnight.enabled,
    "strategy.goodnight.schedule": config.proactive.strategies.goodnight.schedule,
    "strategy.goodnight.reason": config.proactive.strategies.goodnight.reason,
    "strategy.goodnight.urgent": config.proactive.strategies.goodnight.urgent,
    "strategy.dailyCheckIn.enabled": config.proactive.strategies.dailyCheckIn.enabled,
    "strategy.dailyCheckIn.schedule": config.proactive.strategies.dailyCheckIn.schedule,
    "strategy.dailyCheckIn.reason": config.proactive.strategies.dailyCheckIn.reason,
    "strategy.dailyCheckIn.urgent": config.proactive.strategies.dailyCheckIn.urgent,
    "strategy.random.enabled": config.proactive.strategies.random.enabled,
    "strategy.random.windowStart": config.proactive.strategies.random.windowStart,
    "strategy.random.windowEnd": config.proactive.strategies.random.windowEnd,
    "strategy.random.minPerDay": config.proactive.strategies.random.minPerDay,
    "strategy.random.maxPerDay": config.proactive.strategies.random.maxPerDay,
    "strategy.random.reason": config.proactive.strategies.random.reason,
    "strategy.lateNight.enabled": config.proactive.strategies.lateNight.enabled,
    "strategy.lateNight.schedule": config.proactive.strategies.lateNight.schedule,
    "strategy.lateNight.reason": config.proactive.strategies.lateNight.reason,
    "strategy.lateNight.urgent": config.proactive.strategies.lateNight.urgent,
    "strategy.memory.enabled": config.proactive.strategies.memory.enabled,
    "strategy.memory.schedule": config.proactive.strategies.memory.schedule,
    "strategy.memory.query": config.proactive.strategies.memory.query,
    "strategy.memory.reason": config.proactive.strategies.memory.reason,
    "strategy.memory.urgent": config.proactive.strategies.memory.urgent,
    "strategy.weather.enabled": config.proactive.strategies.weather.enabled,
    "strategy.weather.schedule": config.proactive.strategies.weather.schedule,
    "strategy.weather.reason": config.proactive.strategies.weather.reason,
    "strategy.weather.urgent": config.proactive.strategies.weather.urgent,
    "followup.enabled": config.proactive.followup.enabled,
    "followup.defaultDelayMinutes": config.proactive.followup.defaultDelayMinutes,
    "followup.dedupeHours": config.proactive.followup.dedupeHours,
    "deferredReply.enabled": config.proactive.deferredReply.enabled,
    "deferredReply.defaultDelayMinutes": config.proactive.deferredReply.defaultDelayMinutes,
    "web.enabled": config.web.enabled,
    "web.basePath": config.web.basePath,
    "web.panelPath": config.web.panelPath,
    ...loadBindingValues(config, ctx, api),
    ...loadPromptFragmentValues(ctx, config),
    ...loadDiagnosticValues(config, api)
  };
}
function savePromptFragments(ctx, agentId, values) {
  writeFragment(ctx.getDataDir(), ctx.getExtensionRootDir(), agentId, "persona", restoreMultiline(values["fragment.persona"]));
  writeFragment(ctx.getDataDir(), ctx.getExtensionRootDir(), agentId, "style", restoreMultiline(values["fragment.style"]));
  writeFragment(ctx.getDataDir(), ctx.getExtensionRootDir(), agentId, "rules", restoreMultiline(values["fragment.rules"]));
}
function buildDraftPromptBundle(values, agentId) {
  return {
    agentId,
    fragments: {
      persona: restoreMultiline(values["fragment.persona"]),
      style: restoreMultiline(values["fragment.style"]),
      rules: restoreMultiline(values["fragment.rules"])
    }
  };
}
async function handleVirtualLoverAction(ctx, api, actionKey, values) {
  const config = parseVirtualLoverConfig(buildConfigFromValues(values));
  const agentId = config.agent.defaultAgentId;
  const bundle = buildDraftPromptBundle(values, agentId);
  switch (actionKey) {
    case "action.testBinding": {
      const delivery = api.services.get(DELIVERY_REGISTRY_SERVICE_ID);
      if (!delivery)
        return { success: false, error: "delivery.registry 不可用" };
      if (config.proactive.binding) {
        const binding = delivery.getBinding(config.proactive.binding);
        if (!binding)
          return { success: false, error: `binding 不存在：${config.proactive.binding}` };
        const decision2 = await delivery.evaluatePolicy({
          policyId: config.proactive.policy ?? binding.policyId,
          binding: binding.id,
          platform: binding.platform,
          target: binding.target
        });
        return {
          success: decision2.allowed,
          message: decision2.allowed ? `Binding 可用：${formatBinding(binding)}` : `Binding 存在，但 policy 当前会跳过：${decision2.reason}`
        };
      }
      if (!config.proactive.target.id)
        return { success: false, error: "未配置 binding，也未配置 fallback target.id" };
      const decision = await delivery.evaluatePolicy({
        policyId: config.proactive.policy,
        platform: config.proactive.platform,
        target: config.proactive.target
      });
      return {
        success: decision.allowed,
        message: decision.allowed ? `Fallback target 可用：${config.proactive.platform}:${config.proactive.target.kind}:${config.proactive.target.id}` : `Fallback target 存在，但 policy 当前会跳过：${decision.reason}`
      };
    }
    case "action.useLatestTelegramTarget": {
      const delivery = api.services.get(DELIVERY_REGISTRY_SERVICE_ID);
      if (!delivery)
        return { success: false, error: "消息发送服务不可用" };
      const latest = delivery.listRecentTargets?.({ platform: "telegram" })?.[0];
      if (!latest) {
        return { success: false, error: "还没有最近 Telegram 聊天。请先在 Telegram 给 Bot 发一条消息，再回到这里重试。" };
      }
      const binding = config.proactive.binding || "lover-main";
      return {
        success: true,
        message: `已把最近 Telegram 聊天填入发送目标：${formatRecentTarget(latest)}。请按 S 保存。`,
        patch: {
          "proactive.binding": binding,
          "proactive.platform": "telegram",
          "proactive.target.kind": "chat",
          "proactive.target.id": latest.target.id,
          "proactive.target.threadId": latest.target.threadId ?? "",
          "delivery.binding.enabled": true,
          "delivery.binding.platform": "telegram",
          "delivery.binding.target.kind": "chat",
          "delivery.binding.target.id": latest.target.id,
          "delivery.binding.target.threadId": latest.target.threadId ?? ""
        }
      };
    }
    case "action.proactiveDryRun": {
      const result = await sendProactiveMessage({
        config,
        api,
        bundle,
        agentId,
        reason: "TUI /lover 主动消息预览",
        dryRun: true
      });
      return { success: result.ok, message: result.ok ? `预览：${result.text}` : result.error };
    }
    case "action.proactiveSendTest": {
      const result = await sendProactiveMessage({
        config,
        api,
        bundle,
        agentId,
        reason: "TUI /lover 主动消息发送测试",
        dryRun: false
      });
      return { success: result.ok, message: result.ok ? `已发送：${result.text}` : result.error };
    }
    case "action.scheduleTest30s":
    case "action.scheduleMorning":
    case "action.scheduleGoodnight": {
      const template = actionKey === "action.scheduleMorning" ? "good_morning_daily" : actionKey === "action.scheduleGoodnight" ? "goodnight_daily" : "test_30s";
      const result = await createVirtualLoverScheduleProactiveTool(api).handler({ template });
      return {
        success: Boolean(result?.ok),
        message: result?.ok ? `已创建 proactive 调度任务：${template}` : result?.error ?? "创建调度任务失败",
        data: result?.job ?? result?.result
      };
    }
    case "action.loverDream": {
      const service = api.services.get(MEMORY_SPACES_SERVICE_ID);
      const space = service?.getOrCreateSpace(config.memory.space);
      if (!space)
        return { success: false, error: "memory.spaces 不可用" };
      const result = await space.dream();
      return { success: result.ok, message: result.message, data: result };
    }
    case "action.followupTest": {
      const result = await scheduleVirtualLoverFollowup(ctx, api, {
        mode: "followup",
        delayMinutes: config.proactive.followup.defaultDelayMinutes,
        reason: "TUI /lover 测试：稍后做一次温柔、不过度打扰的后续关心。",
        dedupeKey: "tui-followup-test"
      });
      return {
        success: result.ok,
        message: result.skipped ? "已存在相同 followup，跳过重复创建。" : result.ok ? "已创建 followup 测试任务。" : result.error,
        data: result.intent
      };
    }
    case "action.deferredReplyTest": {
      const result = await scheduleVirtualLoverFollowup(ctx, api, {
        mode: "deferred_reply",
        delayMinutes: config.proactive.deferredReply.defaultDelayMinutes,
        reason: "TUI /lover 测试：稍后自然地接一句话。",
        dedupeKey: "tui-deferred-reply-test"
      });
      return { success: result.ok, message: result.ok ? "已创建延迟回复测试任务。" : result.error, data: result.intent };
    }
    case "action.syncStrategies": {
      const result = await syncVirtualLoverStrategies(api, config);
      return { success: result.ok, message: result.ok ? `策略已同步：${result.operations.length} 项操作` : result.error, data: result.operations };
    }
    default:
      return { success: false, error: `未知 action: ${actionKey}` };
  }
}
function registerVirtualLoverSettingsTab(ctx, api) {
  const registerTab = api.registerConsoleSettingsTab;
  if (!registerTab)
    return;
  return registerTab({
    id: "virtual-lover",
    label: "Virtual Lover",
    icon: "07",
    fields: [
      {
        key: "status.memory",
        label: "记忆功能状态",
        type: "readonly",
        defaultValue: "",
        group: "状态诊断",
        description: "显示专属记忆服务是否可用；如果不可用，伴侣记忆不会被读取或整理。"
      },
      {
        key: "status.delivery",
        label: "消息发送功能状态",
        type: "readonly",
        defaultValue: "",
        group: "状态诊断",
        description: "显示 Iris 是否已经准备好向 Telegram 等平台发送主动消息。"
      },
      {
        key: "status.telegram",
        label: "Telegram 接入状态",
        type: "readonly",
        defaultValue: "",
        group: "状态诊断",
        description: "显示 Telegram 发送能力是否已经注册。若未就绪，请先配置并启用 Telegram Bot。"
      },
      {
        key: "status.recentTelegramTarget",
        label: "最近 Telegram 聊天",
        type: "readonly",
        defaultValue: "",
        group: "状态诊断",
        description: "如果不知道 Chat ID，请先在 Telegram 给 Bot 发一条消息，这里会显示最近聊天。"
      },
      {
        key: "status.policy",
        label: "防打扰策略状态",
        type: "readonly",
        defaultValue: "",
        group: "状态诊断",
        description: "显示当前防打扰策略是否存在。留空表示不限制发送频率和安静时段。"
      },
      {
        key: "status.binding",
        label: "发送目标状态",
        type: "readonly",
        defaultValue: "",
        group: "状态诊断",
        description: "检查下方“发送目标名称”是否存在、是否启用，以及实际会发到哪个聊天。"
      },
      {
        key: "status.proactiveTarget",
        label: "当前发送去向",
        type: "readonly",
        defaultValue: "",
        group: "状态诊断",
        description: "显示主动消息当前会使用“发送目标名称”，还是备用目标配置。"
      },
      {
        key: "action.testBinding",
        label: "检查能否发送",
        type: "action",
        defaultValue: "",
        group: "操作",
        description: "检查发送目标和防打扰策略是否允许现在发送；不会真的发送消息。"
      },
      {
        key: "action.useLatestTelegramTarget",
        label: "使用最近 Telegram 聊天",
        type: "action",
        defaultValue: "",
        group: "操作",
        description: "把最近给 Bot 发过消息的 Telegram 聊天填入发送目标。执行后请按 S 保存。"
      },
      {
        key: "action.proactiveDryRun",
        label: "预览一条主动消息",
        type: "action",
        defaultValue: "",
        group: "操作",
        description: "根据当前人设、记忆和策略生成一条示例主动消息，但不会发送。"
      },
      {
        key: "action.proactiveSendTest",
        label: "立即发送测试消息",
        type: "action",
        defaultValue: "",
        group: "操作",
        description: "实际发出一条测试主动消息；建议先保存配置，并确认发送目标正确。"
      },
      {
        key: "action.scheduleTest30s",
        label: "创建 30 秒测试任务",
        type: "action",
        defaultValue: "",
        group: "操作",
        description: "创建一个 30 秒后自动发送的测试任务，用来验证定时任务和发送链路。"
      },
      {
        key: "action.syncStrategies",
        label: "应用主动消息策略",
        type: "action",
        defaultValue: "",
        group: "操作",
        description: "把下方策略开关应用到定时任务：开启的会创建/更新，关闭的会禁用。"
      },
      {
        key: "action.loverDream",
        label: "整理专属记忆",
        type: "action",
        defaultValue: "",
        group: "操作",
        description: "整理当前伴侣专属记忆，合并重复内容，让以后回忆更稳定。"
      },
      {
        key: "enabled",
        label: "启用伴侣模式",
        type: "toggle",
        defaultValue: false,
        group: "基础",
        description: "开启后，Iris 会按你设置的人设、风格和边界来表达。"
      },
      {
        key: "proactive.enabled",
        label: "允许主动发消息",
        type: "toggle",
        defaultValue: false,
        group: "基础",
        description: "开启后，测试发送和定时策略才可以主动向你发送消息。"
      },
      {
        key: "proactive.binding",
        label: "发送目标名称",
        type: "text",
        defaultValue: "",
        group: "基础",
        description: "给真实聊天目标起的名字。建议填 lover-main；下面的目标 ID 会保存到这个名字里。"
      },
      {
        key: "proactive.policy",
        label: "防打扰策略",
        type: "text",
        defaultValue: "",
        group: "基础",
        description: "可选。留空表示不限制发送；填 lover-default 之类的策略名，可限制冷却时间、每日次数和安静时段。"
      },
      {
        key: "delivery.binding.enabled",
        label: "启用发送目标",
        type: "toggle",
        defaultValue: true,
        group: "基础",
        description: "关闭后会保留目标配置，但不会向这个目标发送主动消息。"
      },
      {
        key: "delivery.binding.target.id",
        label: "发送目标 ID（Telegram Chat ID）",
        type: "text",
        defaultValue: "",
        group: "基础",
        description: "要接收主动消息的聊天 ID，不是 Bot Token。Telegram 私聊通常是数字，群聊通常以 -100 开头；只在 TUI 聊天可留空。"
      },
      {
        key: "delivery.binding.target.threadId",
        label: "发送话题 ID（可选）",
        type: "text",
        defaultValue: "",
        group: "基础",
        description: "只有 Telegram 群组开启话题/Forum topic 时才需要填写；普通私聊和普通群聊请留空。"
      },
      {
        key: "memory.space",
        label: "专属记忆空间",
        type: "text",
        defaultValue: "virtual-lover",
        group: "基础",
        description: "伴侣相关记忆保存在哪里。通常保持 virtual-lover，避免和普通工作记忆混在一起。"
      },
      {
        key: "fragment.persona",
        label: "伴侣人设",
        type: "text",
        defaultValue: "",
        group: "角色设定",
        description: "描述 TA 是怎样的陪伴者。可用 \\n 表示换行；保存后下一轮对话生效。"
      },
      {
        key: "fragment.style",
        label: "说话风格",
        type: "text",
        defaultValue: "",
        group: "角色设定",
        description: "描述 TA 应该怎么说话，例如温柔、简短、克制、活泼等。可用 \\n 表示换行。"
      },
      {
        key: "fragment.rules",
        label: "相处边界",
        type: "text",
        defaultValue: "",
        group: "角色设定",
        description: "描述 TA 需要遵守的边界，例如不假装现实行动、不越界、不制造压力。可用 \\n 表示换行。"
      },
      {
        key: "strategy.goodMorning.enabled",
        label: "每天早安",
        type: "toggle",
        defaultValue: false,
        group: "主动策略",
        description: "开启后，同步策略会创建每天早上发送早安的定时任务。"
      },
      {
        key: "strategy.goodnight.enabled",
        label: "每天晚安",
        type: "toggle",
        defaultValue: false,
        group: "主动策略",
        description: "开启后，同步策略会创建每天晚上发送晚安的定时任务。"
      },
      {
        key: "strategy.dailyCheckIn.enabled",
        label: "每天关心一次",
        type: "toggle",
        defaultValue: false,
        group: "主动策略",
        description: "开启后，会每天固定时间发送一条不过度打扰的关心。"
      },
      {
        key: "strategy.random.enabled",
        label: "随机关心",
        type: "toggle",
        defaultValue: false,
        group: "主动策略",
        description: "开启后，同步策略会在允许时段内随机安排主动消息；具体时间窗口可在 YAML 中调整。"
      },
      {
        key: "strategy.lateNight.enabled",
        label: "深夜轻提醒",
        type: "toggle",
        defaultValue: false,
        group: "主动策略",
        description: "开启后，会在深夜用克制的语气提醒休息或轻轻陪伴。"
      },
      {
        key: "strategy.memory.enabled",
        label: "根据记忆关心",
        type: "toggle",
        defaultValue: false,
        group: "主动策略",
        description: "开启后，会参考伴侣专属记忆里的偏好、重要日期或近期状态来发消息。"
      },
      {
        key: "strategy.weather.enabled",
        label: "根据天气关心",
        type: "toggle",
        defaultValue: false,
        group: "主动策略",
        description: "开启后，如果安装了天气/环境服务，会结合天气发消息；没有服务时会自动降级。"
      },
      {
        key: "followup.enabled",
        label: "允许稍后关心",
        type: "toggle",
        defaultValue: true,
        group: "主动策略",
        description: "允许模型在合适时创建“稍后再问问你”的一次性关心任务。"
      },
      {
        key: "deferredReply.enabled",
        label: "允许延迟接话",
        type: "toggle",
        defaultValue: true,
        group: "主动策略",
        description: "允许模型在你说“等会儿再聊”之类场景下，稍后自然接一句话。"
      }
    ],
    async onLoad() {
      return flattenConfig(parseVirtualLoverConfig(ctx.readConfigSection("virtual_lover")), ctx, api);
    },
    async onSave(values) {
      try {
        if (!api.configManager)
          return { success: false, error: "configManager unavailable" };
        const update = buildConfigFromValues(values);
        const deliveryUpdate = buildDeliveryUpdateFromValues(values);
        const payload = { virtual_lover: update };
        if (deliveryUpdate)
          payload.delivery = deliveryUpdate;
        const result = api.configManager.updateEditableConfig(payload);
        savePromptFragments(ctx, update.agent.defaultAgentId, values);
        await api.configManager.applyRuntimeConfigReload(result.mergedRaw);
        return { success: true };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
    onAction: (actionKey, values) => handleVirtualLoverAction(ctx, api, actionKey, values)
  });
}

// src/index.ts
var logger = createPluginLogger("virtual-lover");
var runtimeStates = new Map;
var src_default = definePlugin({
  name: "virtual-lover",
  version: "0.1.0",
  description: "Virtual companion prompt workshop for Iris with isolated lover memory space",
  activate(ctx) {
    const createdConfig = ctx.ensureConfigFile("virtual_lover.yaml", defaultConfigTemplate);
    if (createdConfig) {
      logger.info("已安装 virtual_lover.yaml 默认配置模板");
    }
    const initialConfig = parseVirtualLoverConfig(ctx.readConfigSection("virtual_lover"));
    if (!initialConfig.enabled) {
      logger.info("virtual_lover.enabled=false，跳过激活（不注册任何 hook / tool / route）");
      return;
    }
    const dataDir = ctx.getDataDir();
    const extensionRootDir = ctx.getExtensionRootDir();
    ensureVirtualLoverData(dataDir, extensionRootDir, initialConfig.agent.defaultAgentId);
    const runtimeKey = ctx.getConfigDir();
    const runtimeState = {
      memoryToolsRegistered: false,
      disposables: [],
      proactiveToolRegistered: false,
      scheduleToolRegistered: false,
      followupToolRegistered: false,
      burstSendToolRegistered: false,
      legacyImportToolRegistered: false
    };
    runtimeStates.set(runtimeKey, runtimeState);
    let memorySpacesService;
    const turnsSinceLastLoverExtract = new Map;
    const resolveMemorySpacesService = () => {
      if (memorySpacesService)
        return memorySpacesService;
      memorySpacesService = ctx.getServiceRegistry().get(MEMORY_SPACES_SERVICE_ID);
      return memorySpacesService;
    };
    ctx.addHook({
      name: "virtual-lover:prompt",
      priority: initialConfig.prompt.priority,
      async onBeforeLLMCall({ request, round }) {
        try {
          const config = parseVirtualLoverConfig(ctx.readConfigSection("virtual_lover"));
          if (!config.enabled || !config.prompt.enabled)
            return;
          if (config.prompt.onlyFirstRound && round > 1)
            return;
          const agentId = config.agent.defaultAgentId;
          const loverMemoryContext = await buildLoverMemoryContext(config, request, resolveMemorySpacesService()).catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            logger.warn(`lover memory recall 不可用，继续注入基础人设 prompt: ${message}`);
            return;
          });
          const bundle = loadPromptBundle(ctx.getDataDir(), ctx.getExtensionRootDir(), agentId);
          const built = buildVirtualLoverPrompt({
            agentId,
            now: new Date,
            config,
            bundle,
            loverMemoryContext,
            existingSystemInstruction: request.systemInstruction
          });
          if (!built.systemText)
            return;
          return {
            request: applyVirtualLoverSystemPrompt(request, built.systemText, config.prompt.injectionMode)
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          logger.error(`提示词注入失败，已回退 Iris 默认请求: ${message}`);
          return;
        }
      }
    });
    ctx.onReady(async (api) => {
      runtimeState.disposables.push(...registerVirtualLoverRoutes(ctx, api, { logger }));
      const settingsDisposable = registerVirtualLoverSettingsTab(ctx, api);
      if (settingsDisposable)
        runtimeState.disposables.push(settingsDisposable);
      if (!runtimeState.proactiveToolRegistered) {
        ctx.registerTool(createVirtualLoverProactiveTool(ctx, api));
        runtimeState.proactiveToolRegistered = true;
        logger.info(`${VIRTUAL_LOVER_PROACTIVE_TOOL_NAME} 工具已注册`);
      }
      if (!runtimeState.scheduleToolRegistered) {
        ctx.registerTool(createVirtualLoverScheduleProactiveTool(api));
        runtimeState.scheduleToolRegistered = true;
        logger.info(`${VIRTUAL_LOVER_SCHEDULE_PROACTIVE_TOOL_NAME} 工具已注册`);
      }
      if (!runtimeState.followupToolRegistered) {
        ctx.registerTool(createVirtualLoverFollowupTool(ctx, api));
        runtimeState.followupToolRegistered = true;
        logger.info(`${VIRTUAL_LOVER_SCHEDULE_FOLLOWUP_TOOL_NAME} 工具已注册`);
      }
      if (!runtimeState.burstSendToolRegistered) {
        ctx.registerTool(createVirtualLoverBurstSendTool(ctx, api));
        runtimeState.burstSendToolRegistered = true;
        logger.info(`${VIRTUAL_LOVER_BURST_SEND_TOOL_NAME} 工具已注册`);
      }
      if (!runtimeState.legacyImportToolRegistered) {
        ctx.registerTool(createVirtualLoverLegacyImportTool(ctx, api));
        runtimeState.legacyImportToolRegistered = true;
        logger.info(`${VIRTUAL_LOVER_IMPORT_LEGACY_TOOL_NAME} 工具已注册`);
      }
      const config = parseVirtualLoverConfig(ctx.readConfigSection("virtual_lover"));
      if (config.memory.tools.enabled) {
        const registerLoverMemoryTools = (service) => {
          if (runtimeState.memoryToolsRegistered)
            return;
          memorySpacesService = service;
          ctx.registerTools(createLoverMemoryTools(() => {
            const latest = parseVirtualLoverConfig(ctx.readConfigSection("virtual_lover"));
            return memorySpacesService.getOrCreateSpace(latest.memory.space);
          }));
          logger.info(`Lover memory tools 已注册，space=${config.memory.space}`);
          runtimeState.memoryToolsRegistered = true;
        };
        const existingService = api.services.get(MEMORY_SPACES_SERVICE_ID);
        if (existingService) {
          registerLoverMemoryTools(existingService);
        } else {
          runtimeState.serviceListenerDisposable = api.services.onDidRegister((descriptor) => {
            if (descriptor.id !== MEMORY_SPACES_SERVICE_ID)
              return;
            const service = api.services.get(MEMORY_SPACES_SERVICE_ID);
            if (service)
              registerLoverMemoryTools(service);
          });
          logger.info("memory.spaces service 尚未就绪，已等待其注册后再启用 lover memory tools");
        }
      }
    });
    ctx.addHook({
      name: "virtual-lover:auto-extract-memory",
      priority: 60,
      onAfterChat({ sessionId }) {
        const config = parseVirtualLoverConfig(ctx.readConfigSection("virtual_lover"));
        if (!config.enabled || !config.memory.autoExtract)
          return;
        const interval = Math.max(1, config.memory.extractInterval);
        const nextCount = (turnsSinceLastLoverExtract.get(sessionId) ?? 0) + 1;
        if (nextCount < interval) {
          turnsSinceLastLoverExtract.set(sessionId, nextCount);
          return;
        }
        turnsSinceLastLoverExtract.set(sessionId, 0);
        const service = resolveMemorySpacesService();
        const space = service?.getOrCreateSpace(config.memory.space);
        if (!space?.extractFromSession)
          return;
        space.extractFromSession({ sessionId }).then((result) => {
          if (result.savedCount > 0) {
            logger.info(`lover memory 自动提取完成: ${result.savedCount} 条 (session=${sessionId}, space=${config.memory.space})`);
          }
        }).catch((error) => {
          logger.warn(`lover memory 自动提取失败 (session=${sessionId}):`, error);
        });
        return;
      }
    });
    logger.info("Virtual Lover extension 已启用（prompt/web + Iris memory space）");
  },
  deactivate(ctx) {
    if (!ctx)
      return;
    const runtimeKey = ctx.getConfigDir();
    const runtimeState = runtimeStates.get(runtimeKey);
    runtimeState?.serviceListenerDisposable?.dispose();
    for (const disposable of runtimeState?.disposables.splice(0).reverse() ?? []) {
      try {
        disposable.dispose();
      } catch {}
    }
    ctx.getToolRegistry().unregister?.(VIRTUAL_LOVER_PROACTIVE_TOOL_NAME);
    ctx.getToolRegistry().unregister?.(VIRTUAL_LOVER_SCHEDULE_PROACTIVE_TOOL_NAME);
    ctx.getToolRegistry().unregister?.(VIRTUAL_LOVER_SCHEDULE_FOLLOWUP_TOOL_NAME);
    ctx.getToolRegistry().unregister?.(VIRTUAL_LOVER_BURST_SEND_TOOL_NAME);
    ctx.getToolRegistry().unregister?.(VIRTUAL_LOVER_IMPORT_LEGACY_TOOL_NAME);
    for (const name of LOVER_MEMORY_TOOL_NAMES) {
      ctx.getToolRegistry().unregister?.(name);
    }
    runtimeStates.delete(runtimeKey);
  }
});
async function buildLoverMemoryContext(config, request, memorySpacesService) {
  if (!config.memory.autoInject || !memorySpacesService)
    return;
  const userText = extractLastUserText(request.contents);
  if (!userText)
    return;
  const space = memorySpacesService.getOrCreateSpace(config.memory.space);
  if (!space.buildContext)
    return;
  const result = await space.buildContext({
    userText,
    maxBytes: config.memory.maxRecallBytes
  });
  return result?.text;
}
function extractLastUserText(contents) {
  for (let i = contents.length - 1;i >= 0; i--) {
    const content = contents[i];
    if (content.role !== "user")
      continue;
    const text = extractText(content.parts).trim();
    if (text)
      return text;
  }
  return "";
}
export {
  src_default as default
};
